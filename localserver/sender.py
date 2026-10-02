import socket
import json
import os
import sys
import threading
import csv
from pathlib import Path
 
 
# =========================================================
# CONFIGURATION
# =========================================================
 
SERVER_IP = "172.17.227.246"
SERVER_PORT = 5000
 
DEVICE_ID = "MARS"
 
UPLOAD_STATUS_FILE = Path(r"C:\DeviceSetups\Pluto\uploadStatus.txt")

def _load_csv_files():
    base = Path(UPLOAD_STATUS_FILE.read_text(encoding="utf-8").split(",")[0].strip())
    return [
        base / "data" / "sessions" / "sessions.csv",
        base / "data" / "configdata.csv",
    ]

CSV_FILES = _load_csv_files()
 
# Local copy of the patients allocated to this laptop's device
PATIENTS_FILE = Path(r"C:\patients.json")
 
SYNC_INTERVAL_SECONDS = 15
 
NUDGE_PORT = 5001   # must match patients_store.NUDGE_PORT
 
sync_lock = threading.Lock()

BUFFER_SIZE = 64 * 1024


def read_homer_ids():
    """Return unique HomerID values from configdata.csv."""
    try:
        with open(CSV_FILES[1], newline="", encoding="utf-8") as f:
            return list({row["HomerID"] for row in csv.DictReader(f) if row.get("HomerID")})
    except (FileNotFoundError, KeyError):
        return []
 
 
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
        "patients_version": version,
        "homer_ids": read_homer_ids()
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
 
 
if __name__ == "__main__":

    mode = sys.argv[1] if len(sys.argv) > 1 else "--upload"

    if mode == "--login":
        # Called once at login: pull patient/HomerID assignments from server
        print(f"[Login] Syncing patients for device: {DEVICE_ID}")
        sync_patients()

    elif mode == "--upload":
        # Called after a session ends: upload updated CSVs then sync
        print(f"[Upload] Sending session data for device: {DEVICE_ID}")
        for csv_file in CSV_FILES:
            send_file(csv_file)
        sync_patients()

    else:
        print(f"Unknown mode: {mode}")
        print("Usage: sender.py [--login | --upload]")
 