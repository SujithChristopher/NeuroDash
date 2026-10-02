import socket
import json
import os
import sys
import threading
import time
from pathlib import Path


# =========================================================
# CONFIGURATION
# =========================================================

SERVER_IP = "192.168.1.105"
SERVER_PORT = 5000

DEVICE_ID = "PLUTO01"

CSV_FILES = [
    Path(r"C:\PLUTO\Data\sessions.csv"),
    Path(r"C:\PLUTO\Data\configdata.csv"),
]

# Local copy of the patients allocated to this laptop's device
PATIENTS_FILE = Path(r"C:\PLUTO\Data\patients.json")

SYNC_INTERVAL_SECONDS = 60

NUDGE_PORT = 5001   # must match patients_store.NUDGE_PORT

sync_lock = threading.Lock()

BUFFER_SIZE = 64 * 1024


# =========================================================
# SEND FILE
# =========================================================

def send_file(CSV_FILE):

    print()
    print("=" * 50)
    print("       NeuroDash CSV Sender")
    print("=" * 50)

    # -----------------------------------------------------
    # Check file
    # -----------------------------------------------------

    if not CSV_FILE.exists():

        print()
        print("ERROR:")
        print(f"File not found:")
        print(CSV_FILE)

        return

    file_size = CSV_FILE.stat().st_size

    print()
    print(f"Device      : {DEVICE_ID}")
    print(f"Server      : {SERVER_IP}:{SERVER_PORT}")
    print(f"File        : {CSV_FILE.name}")
    print(f"Size        : {file_size:,} bytes")

    # -----------------------------------------------------
    # Prepare header
    # -----------------------------------------------------

    header = {
        "device_id": DEVICE_ID,
        "filename": CSV_FILE.name,
        "file_size": file_size
    }

    header_data = json.dumps(
        header
    ).encode("utf-8")

    header_length = len(
        header_data
    ).to_bytes(
        4,
        byteorder="big"
    )

    # -----------------------------------------------------
    # Connect
    # -----------------------------------------------------

    client = socket.socket(
        socket.AF_INET,
        socket.SOCK_STREAM
    )

    client.settimeout(30)

    try:

        print()
        print("Connecting to server...")

        client.connect(
            (SERVER_IP, SERVER_PORT)
        )

        print("Connected!")
        print("Sending file...")

        # Send header size
        client.sendall(
            header_length
        )

        # Send header
        client.sendall(
            header_data
        )

        # -------------------------------------------------
        # Send CSV
        # -------------------------------------------------

        sent = 0

        with open(CSV_FILE, "rb") as file:

            while True:

                data = file.read(
                    BUFFER_SIZE
                )

                if not data:
                    break

                client.sendall(data)

                sent += len(data)

                percentage = (
                    sent / file_size
                ) * 100 if file_size else 100

                print(
                    f"\rProgress: {percentage:.1f}%",
                    end=""
                )

        print()
        print("Upload complete.")

        # -------------------------------------------------
        # Wait for server confirmation
        # -------------------------------------------------

        response_data = client.recv(4096)

        response = json.loads(
            response_data.decode("utf-8")
        )

        print()

        if response.get("success"):

            print("SUCCESS!")
            print(
                "Server received the CSV successfully."
            )

        else:

            print("SERVER ERROR:")
            print(
                response.get(
                    "message",
                    "Unknown error"
                )
            )

    except ConnectionRefusedError:

        print()
        print("ERROR:")
        print("Server refused the connection.")
        print(
            "Check that server.py is running."
        )

    except socket.timeout:

        print()
        print("ERROR:")
        print("Connection timed out.")

    except Exception as error:

        print()
        print("ERROR:")
        print(error)

    finally:

        client.close()


# =========================================================

def receive_exact(connection, size):

    data = bytearray()

    while len(data) < size:

        packet = connection.recv(size - len(data))

        if not packet:
            raise ConnectionError("Server closed the connection.")

        data.extend(packet)

    return bytes(data)


def local_patients_version():

    try:
        with open(PATIENTS_FILE, "r", encoding="utf-8") as f:
            return int(json.load(f).get("version", 0))
    except (FileNotFoundError, ValueError):
        return 0


def listen_for_nudge():
    """Sync immediately when the server broadcasts a change."""

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", NUDGE_PORT))

    print(f"Listening for server nudges on UDP {NUDGE_PORT}")

    while True:

        try:
            data, address = sock.recvfrom(1024)
            message = json.loads(data.decode("utf-8"))
        except (OSError, ValueError):
            continue

        if (
            message.get("type") == "patients_changed"
            and int(message.get("version", 0)) > local_patients_version()
        ):
            print(f"Nudge from {address[0]}")
            sync_patients()


def sync_patients():
    """Ask the server for patients.json changes. Also acts as the
    heartbeat that shows this laptop is online."""

    with sync_lock:
        _sync_patients()


def _sync_patients():

    version = local_patients_version()

    header_data = json.dumps({
        "action": "sync",
        "device_id": DEVICE_ID,
        "patients_version": version
    }).encode("utf-8")

    try:

        with socket.create_connection(
            (SERVER_IP, SERVER_PORT), timeout=30
        ) as client:

            client.sendall(len(header_data).to_bytes(4, "big"))
            client.sendall(header_data)

            length = int.from_bytes(receive_exact(client, 4), "big")

            response = json.loads(
                receive_exact(client, length).decode("utf-8")
            )

    except Exception as error:

        print(f"Sync failed: {error}")
        return

    if not response.get("success"):
        print(f"Sync error: {response.get('message')}")
        return

    if response["up_to_date"]:
        print(f"Patients up to date (v{response['version']})")
        return

    PATIENTS_FILE.parent.mkdir(parents=True, exist_ok=True)

    temp = PATIENTS_FILE.with_suffix(".tmp")

    with open(temp, "w", encoding="utf-8") as f:
        json.dump({
            "version": response["version"],
            "updated_at": response["updated_at"],
            "patients": response["patients"]
        }, f, indent=2)

    os.replace(temp, PATIENTS_FILE)

    print(
        f"Patients updated: v{version} -> v{response['version']} "
        f"({len(response['patients'])} for {DEVICE_ID})"
    )


# =========================================================
# PATIENT IN USE? (call before logging a patient in)
# =========================================================

def _ask_server(action, user_id):
    """One request/response with the server. Returns the reply dict, or None if the server is unreachable."""

    header_data = json.dumps({
        "action": action,
        "device_id": DEVICE_ID,
        "user_id": user_id
    }).encode("utf-8")

    try:

        with socket.create_connection(
            (SERVER_IP, SERVER_PORT), timeout=10
        ) as client:

            client.sendall(len(header_data).to_bytes(4, "big"))
            client.sendall(header_data)

            length = int.from_bytes(receive_exact(client, 4), "big")

            return json.loads(
                receive_exact(client, length).decode("utf-8")
            )

    except Exception as error:

        print(f"Could not reach the server: {error}")
        return None


def check_patient_in_use(user_id):
    """Is this patient being trained on ANOTHER laptop right now?

    Returns (in_use, details). `details` is {"device", "last_upload", "seconds_ago"} when in use, else None.
    If the server cannot be reached the patient is treated as free (in_use False), so training is never blocked
    by a network problem; the caller may still want to warn.

        in_use, who = check_patient_in_use("118")
        if in_use:
            show_message(f"{who['device']} is training this patient ({who['seconds_ago']} s ago).")
    """

    reply = _ask_server("check_user", user_id)

    if not reply or not reply.get("success"):
        return False, None

    return bool(reply.get("in_use")), reply.get("in_use_by")


def release_patient(user_id):
    """Call when a session ends, so the patient is free immediately instead of after the idle timeout."""

    reply = _ask_server("release", user_id)

    return bool(reply and reply.get("released"))


if __name__ == "__main__":

    if "--check" in sys.argv:

        user = sys.argv[sys.argv.index("--check") + 1]
        busy, who = check_patient_in_use(user)

        if busy:
            print(f"{user} is IN USE on {who['device']} ({who['seconds_ago']} s since its last upload).")
        else:
            print(f"{user} is free.")

        sys.exit(0)

    if "--release" in sys.argv:

        user = sys.argv[sys.argv.index("--release") + 1]
        print("Released." if release_patient(user) else "Nothing to release.")

        sys.exit(0)

    if "--sync" in sys.argv:

        threading.Thread(target=listen_for_nudge, daemon=True).start()

        # Run continuously: poll as the fallback if a nudge is missed
        while True:

            sync_patients()
            time.sleep(SYNC_INTERVAL_SECONDS)

    for csv_file in CSV_FILES:

        send_file(csv_file)

    sync_patients()