import csv
import socket
import json
import os
import shutil
from datetime import datetime
from pathlib import Path

import patients_store

# =========================================================
# CONFIGURATION
# =========================================================

HOST = "0.0.0.0"
PORT = 5000

DATA_FOLDER = patients_store.DATA_FOLDER

ALLOWED_DEVICES = {
    "LAPTOP-1",
    "PLUTO",
    "MARS",
    "ATOBOT",
    "HYPERCUBE",
    "NOARK",
    "DYNABO",
    "MOBBO",
    "WEARABLE"
}

BUFFER_SIZE = 64 * 1024  # 64 KB

# Files whose first lines contain ":Location:", ":Device:", ":User:"
USER_HEADER_FILES = {"sessions.csv", "configdata.csv"}


# =========================================================
# READ USER ID FROM FILE HEADER
# =========================================================

def clean_id(value):
    """Keep it safe to use as a folder name."""

    value = "".join(
        c for c in value.strip() if c.isalnum() or c in "-_"
    )

    return value or None


def read_homer_id(path):
    """configdata.csv: return the HomerID column value, or None.

    Raises ValueError if the file mixes several HomerIDs."""

    with open(
        path, "r", encoding="utf-8-sig", errors="replace", newline=""
    ) as f:

        reader = csv.DictReader(f)

        ids = {
            clean_id(row.get("HomerID") or "")
            for row in reader
        }

    ids.discard(None)

    if len(ids) > 1:
        raise ValueError(
            f"configdata.csv contains several HomerIDs: {sorted(ids)}"
        )

    return ids.pop() if ids else None


def read_user_id(path):
    """sessions.csv: return the value of the ':User:' line, or None."""

    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:

        for line in f:

            line = line.strip()

            if not line.startswith(":"):
                break  # header lines are over

            key, _, value = line[1:].partition(":")

            if key.strip().lower() == "user":

                return clean_id(value)

    return None


# =========================================================
# RECEIVE EXACT NUMBER OF BYTES
# =========================================================

def receive_exact(connection, size):
    data = bytearray()

    while len(data) < size:
        packet = connection.recv(
            min(BUFFER_SIZE, size - len(data))
        )

        if not packet:
            raise ConnectionError(
                "Connection closed before all data was received."
            )

        data.extend(packet)

    return bytes(data)


# =========================================================
# SYNC (laptop asks: anything new in patients.json?)
# =========================================================

def send_sync_response(connection, message):
    """Length-prefixed JSON, since the reply can be large."""

    payload = json.dumps(message).encode("utf-8")

    connection.sendall(len(payload).to_bytes(4, byteorder="big"))
    connection.sendall(payload)


def handle_sync(connection, address, device_id, header):

    device_version = int(header.get("patients_version", 0))

    data = patients_store.load_patients()
    server_version = data["version"]

    # Heartbeat: remember this laptop was seen and what it holds
    patients_store.record_sync(device_id, device_version, address[0])

    if device_version == server_version:

        send_sync_response(connection, {
            "success": True,
            "up_to_date": True,
            "version": server_version
        })

        print(f"Sync      : up to date (v{server_version})")
        return

    # Only send this laptop's patients, but keep the global version
    send_sync_response(connection, {
        "success": True,
        "up_to_date": False,
        "version": server_version,
        "updated_at": data["updated_at"],
        "patients": patients_store.patients_for_device(
            data, device_id
        )
    })

    patients_store.log_sync(device_id, device_version, server_version)

    print(f"Sync      : sent v{server_version} (had v{device_version})")


# =========================================================
# PRESENCE (is this patient being used on another laptop?)
# =========================================================

def handle_presence(connection, device_id, header, action):
    """check_user: "can I log this patient in?"   release: "my session has ended, free the patient".

    The patient counts as in use while an upload from a laptop arrived within
    patients_store.ACTIVE_WINDOW_SECONDS. A laptop is never blocked by its own session.
    """

    user_id = clean_id(str(header.get("user_id", "")))

    if not user_id:
        send_sync_response(connection, {
            "success": False,
            "message": "user_id is required"
        })
        return

    if action == "release":

        # Only the laptop that holds the patient can free it.
        released = patients_store.clear_presence(user_id, device_id)

        send_sync_response(connection, {
            "success": True,
            "user_id": user_id,
            "released": released
        })

        print(f"Release   : {user_id} by {device_id} ({'freed' if released else 'nothing to free'})")
        return

    session = patients_store.presence_for(user_id)

    own = session is not None and session["device"] == device_id
    blocked = session is not None and not own

    send_sync_response(connection, {
        "success": True,
        "user_id": user_id,
        "in_use": blocked,
        "own_session": own,
        "in_use_by": session if blocked else None,
        "window_seconds": patients_store.ACTIVE_WINDOW_SECONDS
    })

    print(
        f"Check     : {user_id} -> "
        f"{'IN USE by ' + session['device'] if blocked else 'free'}"
    )


# =========================================================
# HANDLE DEVICE
# =========================================================

def handle_device(connection, address):

    print()
    print("=" * 60)
    print(f"Connection from: {address[0]}")
    print("=" * 60)

    try:

        # -------------------------------------------------
        # Receive 4-byte header length
        # -------------------------------------------------

        header_length_data = receive_exact(connection, 4)

        header_length = int.from_bytes(
            header_length_data,
            byteorder="big"
        )

        # -------------------------------------------------
        # Receive JSON header
        # -------------------------------------------------

        header_data = receive_exact(
            connection,
            header_length
        )

        header = json.loads(
            header_data.decode("utf-8")
        )

        device_id = header["device_id"].upper()
        action = header.get("action", "upload")

        print(f"Device ID : {device_id}")
        print(f"Action    : {action}")

        if action == "sync":

            if device_id not in ALLOWED_DEVICES:
                send_sync_response(connection, {
                    "success": False,
                    "message": "Unknown device"
                })
                print("REJECTED: Unknown device")
                return

            handle_sync(connection, address, device_id, header)
            return

        if action in ("check_user", "release"):

            if device_id not in ALLOWED_DEVICES:
                send_sync_response(connection, {
                    "success": False,
                    "message": "Unknown device"
                })
                print("REJECTED: Unknown device")
                return

            handle_presence(connection, device_id, header, action)
            return

        filename = os.path.basename(header["filename"])
        file_size = int(header["file_size"])

        print(f"Filename  : {filename}")
        print(f"File size : {file_size:,} bytes")

        # -------------------------------------------------
        # Validate device
        # -------------------------------------------------

        if device_id not in ALLOWED_DEVICES:

            message = {
                "success": False,
                "message": "Unknown device"
            }

            connection.sendall(
                json.dumps(message).encode("utf-8")
            )

            print("REJECTED: Unknown device")
            return

        # -------------------------------------------------
        # Only accept CSV
        # -------------------------------------------------

        if not filename.lower().endswith(".csv"):

            message = {
                "success": False,
                "message": "Only CSV files are allowed"
            }

            connection.sendall(
                json.dumps(message).encode("utf-8")
            )

            print("REJECTED: Not a CSV file")
            return

        # -------------------------------------------------
        # Create device folder
        # -------------------------------------------------

        # -------------------------------------------------
        # Receive CSV into a temporary file first, because the
        # user id (and so the destination) is inside the file
        # -------------------------------------------------

        incoming_folder = DATA_FOLDER / "_incoming"

        incoming_folder.mkdir(
            parents=True,
            exist_ok=True
        )

        temp_path = incoming_folder / (
            f"{device_id}_{datetime.now():%Y%m%d%H%M%S%f}.tmp"
        )

        print("Receiving file...")

        remaining = file_size

        with open(temp_path, "wb") as output_file:

            while remaining > 0:

                packet = connection.recv(
                    min(BUFFER_SIZE, remaining)
                )

                if not packet:
                    raise ConnectionError(
                        "Connection lost during transfer."
                    )

                output_file.write(packet)

                remaining -= len(packet)

        # -------------------------------------------------
        # Confirm file size
        # -------------------------------------------------

        received_size = temp_path.stat().st_size

        if received_size != file_size:

            temp_path.unlink(missing_ok=True)

            raise ValueError(
                "Received file size does not match "
                "the sender file size."
            )

        # -------------------------------------------------
        # Work out destination: DATA/UserId/Device/filename
        # -------------------------------------------------

        user_id = None

        if filename.lower() in USER_HEADER_FILES:

            try:

                if filename.lower() == "configdata.csv":
                    user_id = read_homer_id(temp_path)
                    source = "HomerID"
                else:
                    user_id = read_user_id(temp_path)
                    source = "':User:' line"

                if user_id is None:
                    raise ValueError(
                        f"No {source} found in {filename}"
                    )

            except Exception:

                temp_path.unlink(missing_ok=True)
                raise

        if user_id:
            device_folder = DATA_FOLDER / user_id / device_id
        else:
            # Files without a header (e.g. raw trial data)
            device_folder = DATA_FOLDER / device_id

        device_folder.mkdir(
            parents=True,
            exist_ok=True
        )

        destination = device_folder / filename

        # -------------------------------------------------
        # Backup existing file
        # -------------------------------------------------

        if destination.exists():

            backup_folder = device_folder / "backup"

            backup_folder.mkdir(
                parents=True,
                exist_ok=True
            )

            timestamp = datetime.now().strftime(
                "%Y-%m-%d_%H-%M-%S"
            )

            backup_filename = (
                f"{destination.stem}_{timestamp}"
                f"{destination.suffix}"
            )

            backup_path = (
                backup_folder / backup_filename
            )

            shutil.copy2(
                destination,
                backup_path
            )

            print(
                f"Backup    : {backup_path}"
            )

        shutil.move(str(temp_path), str(destination))

        # A sessions.csv arrives about once a minute while a patient trains:
        # remember who is using the patient so other laptops (and the dashboard) can tell.
        if user_id and filename.lower() == "sessions.csv":
            patients_store.record_presence(user_id, device_id, address[0])

        if user_id:
            print(f"User ID   : {user_id}")

        print("File received successfully!")
        print(f"Saved to  : {destination}")
        print(f"Received  : {received_size:,} bytes")

        # -------------------------------------------------
        # Send confirmation
        # -------------------------------------------------

        response = {
            "success": True,
            "message": "File received successfully",
            "device_id": device_id,
            "user_id": user_id,
            "filename": filename
        }

        connection.sendall(
            json.dumps(response).encode("utf-8")
        )

    except Exception as error:

        print()
        print("ERROR:")
        print(error)

        try:

            response = {
                "success": False,
                "message": str(error)
            }

            connection.sendall(
                json.dumps(response).encode("utf-8")
            )

        except:
            pass

    finally:

        connection.close()

        print("Connection closed.")
        print("=" * 60)


# =========================================================
# START SERVER
# =========================================================

def start_server():

    DATA_FOLDER.mkdir(
        parents=True,
        exist_ok=True
    )

    server = socket.socket(
        socket.AF_INET,
        socket.SOCK_STREAM
    )

    # Allows quick server restart
    server.setsockopt(
        socket.SOL_SOCKET,
        socket.SO_REUSEADDR,
        1
    )

    server.bind(
        (HOST, PORT)
    )

    server.listen(10)

    # Find local IP
    try:

        temp_socket = socket.socket(
            socket.AF_INET,
            socket.SOCK_DGRAM
        )

        temp_socket.connect(
            ("8.8.8.8", 80)
        )

        local_ip = temp_socket.getsockname()[0]

        temp_socket.close()

    except:

        local_ip = socket.gethostbyname(
            socket.gethostname()
        )

    print()
    print("=" * 60)
    print("          NeuroDash Demo Data Server")
    print("=" * 60)
    print()
    print(f"Server IP   : {local_ip}")
    print(f"Port        : {PORT}")
    print(f"Storage     : {DATA_FOLDER}")
    print()
    print("Server is ready.")
    print("Waiting for devices...")
    print()
    print("Press CTRL+C to stop.")
    print("=" * 60)

    try:

        while True:

            connection, address = server.accept()

            handle_device(
                connection,
                address
            )

    except KeyboardInterrupt:

        print()
        print("Stopping server...")

    finally:

        server.close()


# =========================================================

if __name__ == "__main__":

    start_server()