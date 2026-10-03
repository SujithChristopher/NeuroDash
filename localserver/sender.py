import socket
import json
import os
import sys
import threading
import csv
import signal
import time
from pathlib import Path
 
 
# =========================================================
# CONFIGURATION
# =========================================================
 
SERVER_IP = "172.17.227.246"
SERVER_PORT = 5000
 
DEVICE_ID = "MARS"

# Which LAPTOP this is. DEVICE_ID is the kind of device (several laptops can all be "MARS"), so the patient lock needs
# this to tell two MARS laptops apart. Defaults to the computer's name; set NEURODASH_CLIENT_ID to override it.
CLIENT_ID = os.environ.get("NEURODASH_CLIENT_ID") or socket.gethostname()

# While a patient is playing, the laptop tells the server every HEARTBEAT_SECONDS that it still holds them. The server frees
# a patient after ACTIVE_WINDOW_SECONDS without one (see patients_store.py), so keep that at least 3x this value.
HEARTBEAT_SECONDS = 30

# How long a claim / check / release waits for the server before giving up (a claim then counts as granted, so a dead
# network delays a patient's login by at most this long).
LOCK_TIMEOUT_SECONDS = 3
 
UPLOAD_STATUS_FILE = Path(r"C:\DeviceSetups\Pluto\uploadStatus.txt")

def _load_csv_files():
    try:
        base = Path(UPLOAD_STATUS_FILE.read_text(encoding="utf-8").split(",")[0].strip())
    except OSError:
        return []  # not a training laptop (no uploadStatus.txt): nothing to upload, the patient lock still works

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
    except (FileNotFoundError, KeyError, IndexError):
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
        "client_id": CLIENT_ID,
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
 
 
def local_view():
    """The 'view' token the server gave with the list this laptop holds (which patients it was shown)."""

    try:
        with open(PATIENTS_FILE, "r", encoding="utf-8") as f:
            return str(json.load(f).get("view", ""))
    except (FileNotFoundError, ValueError):
        return ""


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

        elif message.get("type") == "presence_changed":
            # A patient started or stopped training somewhere: refresh which patients this laptop offers.
            print(f"Presence nudge from {address[0]}")
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
        "client_id": CLIENT_ID,
        "view": local_view(),
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
            "view": response.get("view"),
            "patients": response["patients"]
        }, f, indent=2)
 
    os.replace(temp, PATIENTS_FILE)
 
    print(
        f"Patients updated: v{version} -> v{response['version']} "
        f"({len(response['patients'])} for {DEVICE_ID})"
    )
 
 
# =========================================================
# PATIENT LOCK (one laptop per patient at a time)
#
# The training software calls claim_patient() when a patient logs in. If another laptop already holds that patient
# the claim is refused and the session must not start. release_patient() frees the patient when the session ends.
# The server also treats a patient as held for a few minutes after their last upload, so a crashed laptop never
# locks a patient for good.
# =========================================================

def _ask_server(action, user_id):
    """One request/response with the server. Returns the reply dict, or None if the server is unreachable."""

    header_data = json.dumps({
        "action": action,
        "device_id": DEVICE_ID,
        "client_id": CLIENT_ID,
        "user_id": user_id
    }).encode("utf-8")

    try:

        with socket.create_connection(
            (SERVER_IP, SERVER_PORT), timeout=LOCK_TIMEOUT_SECONDS
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


class PatientInUse(Exception):
    """Another laptop already holds this patient. `.holder` is {"device", "last_upload", "seconds_ago"}."""

    def __init__(self, user_id, holder):
        self.user_id = user_id
        self.holder = holder or {}
        super().__init__(
            f"{user_id} is being trained on {self.holder.get('device', 'another device')}"
            f"{' (laptop ' + self.holder['client'] + ')' if self.holder.get('client') else ''} "
            f"({self.holder.get('seconds_ago', '?')} s since its last activity)."
        )


def check_patient_in_use(user_id):
    """Only asks: is this patient held by ANOTHER laptop? Returns (in_use, holder). Does not lock anything."""

    reply = _ask_server("check_user", user_id)

    if not reply or not reply.get("success"):
        return False, None

    return bool(reply.get("in_use")), reply.get("in_use_by")


def claim_patient(user_id):
    """Lock the patient for THIS laptop. Call it when the patient logs in, before the session starts.

    Returns (True, None) when the patient is yours (calling it again just renews the hold), or (False, holder) when
    another laptop has them: then do not start the session. The hold lapses by itself a few minutes after the last
    upload, so call claim_patient again now and then if a session can go quiet for longer than that.
    If the server cannot be reached the claim counts as granted, so a network problem never stops therapy.
    """

    reply = _ask_server("claim_user", user_id)

    if not reply or not reply.get("success"):
        return True, None

    if reply.get("claimed"):
        return True, None

    return False, reply.get("in_use_by")


def release_patient(user_id):
    """Call when a session ends, so the patient is free immediately instead of after the idle timeout."""

    reply = _ask_server("release", user_id)

    return bool(reply and reply.get("released"))


class _Heartbeat(threading.Thread):
    """Renews the claim every `interval` seconds while a session runs, so the server always knows this laptop is
    still playing and no other laptop can take the patient. If a renewal is refused (another laptop got the patient
    while this one was offline) it stops and records who has them in `.lost`."""

    def __init__(self, user_id, on_lost=None, interval=None):
        super().__init__(daemon=True)
        self.user_id = user_id
        self.on_lost = on_lost
        self.interval = HEARTBEAT_SECONDS if interval is None else interval
        self.lost = None
        self._halt = threading.Event()

    def run(self):
        while not self._halt.wait(self.interval):
            reply = _ask_server("claim_user", self.user_id)

            if reply and reply.get("success") and not reply.get("claimed"):
                self.lost = reply.get("in_use_by") or {}

                if self.on_lost:
                    self.on_lost(self.lost)

                return

            # An unreachable server changes nothing: keep trying, the next beat may get through.

    def stop(self):
        self._halt.set()


class hold_patient:
    """Lock the patient for the length of a session, keep telling the server this laptop is still playing, and release
    automatically at the end, even if the session crashes.

        try:
            with hold_patient("118", on_lost=lambda who: stop_the_game(who)) as hold:
                run_the_session()
        except PatientInUse as busy:
            show_message(str(busy))

    `on_lost(holder)` is called from the heartbeat thread if another laptop took the patient (only possible after this laptop
    lost the network for longer than the server's window). `hold.lost` is then set too.
    """

    def __init__(self, user_id, on_lost=None, interval=None):
        self.user_id = user_id
        self._beat = _Heartbeat(user_id, on_lost, interval)

    @property
    def lost(self):
        return self._beat.lost

    def __enter__(self):
        ok, holder = claim_patient(self.user_id)

        if not ok:
            raise PatientInUse(self.user_id, holder)

        self._beat.start()
        return self

    def __exit__(self, *exc):
        self._beat.stop()
        release_patient(self.user_id)
        return False


def hold_session(user_id, interval=None, stop=None):
    """Stay connected to the server for one patient's session: claim, then renew until `stop` is set, then release.

    Returns an exit code: 0 = ended normally, 2 = another laptop already holds the patient (nothing was started),
    3 = the hold was lost to another laptop while running. This is what `python sender.py --hold 118` runs, so training
    software can start it as a background process at login and end it when the session ends.
    """

    stop = stop or threading.Event()
    interval = HEARTBEAT_SECONDS if interval is None else interval

    ok, holder = claim_patient(user_id)

    if not ok:
        print(f"REFUSED: {PatientInUse(user_id, holder)}")
        return 2

    print(f"{user_id} is locked to {CLIENT_ID} ({DEVICE_ID}); renewing every {interval} s. Stop with Ctrl+C.")

    try:
        while not stop.wait(interval):
            reply = _ask_server("claim_user", user_id)

            if reply and reply.get("success") and not reply.get("claimed"):
                print(f"LOST: {PatientInUse(user_id, reply.get('in_use_by'))}")
                return 3
    finally:
        release_patient(user_id)

    print(f"{user_id} released.")
    return 0


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

    elif mode == "--hold":
        # Stay connected for one patient's session: python sender.py --hold 118
        # Exit code 2 = refused (held by another laptop), 3 = lost it while running, 0 = stopped normally.
        if len(sys.argv) < 3:
            print("Usage: sender.py --hold <patient ID>")
            sys.exit(1)

        stop_event = threading.Event()

        def _stop(*_):
            stop_event.set()

        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)
        sys.exit(hold_session(sys.argv[2], stop=stop_event))

    elif mode in ("--claim", "--release", "--check"):
        # Patient lock, e.g.  python sender.py --claim 118   (exit code 2 = the patient is held by another laptop)
        if len(sys.argv) < 3:
            print(f"Usage: sender.py {mode} <patient ID>")
            sys.exit(1)

        user = sys.argv[2]

        if mode == "--claim":
            ok, holder = claim_patient(user)

            if ok:
                print(f"{user} is now locked to {DEVICE_ID}.")
            else:
                print(f"REFUSED: {PatientInUse(user, holder)}")
                sys.exit(2)

        elif mode == "--release":
            print("Released." if release_patient(user) else "Nothing to release.")

        else:
            busy, holder = check_patient_in_use(user)

            if busy:
                print(f"{user} is IN USE: {PatientInUse(user, holder)}")
                sys.exit(2)

            print(f"{user} is free.")

    else:
        print(f"Unknown mode: {mode}")
        print("Usage: sender.py [--login | --upload | --hold ID | --claim ID | --release ID | --check ID]")
 