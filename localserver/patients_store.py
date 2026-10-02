"""
patients.json + devices.json storage for NeuroDash.

patients.json
    {"version": 18, "updated_at": "...",
     "patients": [{"user_id": "testr", "status": "active",
                   "devices": ["MARS01"]}]}

devices.json  (laptop heartbeat / sync status)
    {"MARS01": {"last_seen": "...", "version": 18, "ip": "..."}}

Admin usage:
    python patients_store.py add testr MARS01 [PLUTO01 ...] [--side left|right|both]
    python patients_store.py set testr --side left
    python patients_store.py status testr paused
    python patients_store.py devices testr MARS02
    python patients_store.py list
    python patients_store.py laptops
"""

import json
import os
import socket
import sys
from datetime import datetime
from pathlib import Path

DATA_FOLDER = Path(r"D:\NeuroDashData")

PATIENTS_FILE = DATA_FOLDER / "patients.json"
DEVICES_FILE = DATA_FOLDER / "devices.json"
SYNC_LOG = DATA_FOLDER / "sync_log.csv"

VALID_STATUS = {"active", "paused", "discharged"}
VALID_SIDE = {"left", "right", "both"}

NUDGE_PORT = 5001

POLL_SECONDS = 60
OFFLINE_AFTER = 3 * POLL_SECONDS

# A laptop uploads sessions.csv about once a minute while a patient is training. A patient counts as "in use" if an
# upload arrived within this window (a few missed uploads are tolerated). Keep ACTIVE_WINDOW_SECONDS in the web app's
# .env equal to this value.
PRESENCE_FILE = DATA_FOLDER / "presence.json"
ACTIVE_WINDOW_SECONDS = 300
PRESENCE_KEEP_SECONDS = 24 * 3600


def now():
    return datetime.now().isoformat(timespec="seconds")


def _read(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def _write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")

    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    os.replace(temp, path)


# ---------------------------------------------------------
# patients.json
# ---------------------------------------------------------

def load_patients():
    return _read(
        PATIENTS_FILE,
        {"version": 0, "updated_at": now(), "patients": []}
    )


def _save_patients(data):
    data["version"] += 1
    data["updated_at"] = now()
    _write_atomic(PATIENTS_FILE, data)
    send_nudge(data["version"])
    return data


# ---------------------------------------------------------
# UDP nudge: tells laptops "patients.json changed, sync now".
# Best effort only; laptops still poll as the fallback.
# ---------------------------------------------------------

def _broadcast_addresses():
    addresses = {"255.255.255.255"}

    try:
        for info in socket.getaddrinfo(
            socket.gethostname(), None, socket.AF_INET
        ):
            ip = info[4][0]
            if not ip.startswith("127."):
                # assumes a /24 home/clinic network
                addresses.add(ip.rsplit(".", 1)[0] + ".255")
    except OSError:
        pass

    return addresses


def send_nudge(version):
    message = json.dumps({
        "type": "patients_changed",
        "version": version
    }).encode("utf-8")

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)

    try:
        for address in _broadcast_addresses():
            try:
                sock.sendto(message, (address, NUDGE_PORT))
            except OSError:
                pass
    finally:
        sock.close()


def upsert_patient(
    user_id, status=None, devices=None, side=None
):
    """Create the patient, or update the given fields. Bumps version
    only if something actually changed."""

    if status is not None and status not in VALID_STATUS:
        raise ValueError(f"status must be one of {sorted(VALID_STATUS)}")

    if side is not None:
        side = side.lower()
        if side not in VALID_SIDE:
            raise ValueError(f"side must be one of {sorted(VALID_SIDE)}")

    if devices is not None:
        devices = sorted({d.upper() for d in devices})

    data = load_patients()

    patient = next(
        (p for p in data["patients"] if p["user_id"] == user_id),
        None
    )

    if patient is None:
        patient = {
            "user_id": user_id,
            "status": status or "active",
            "side": side,
            "devices": devices or []
        }
        data["patients"].append(patient)

    else:
        before = dict(patient)

        # limb is no longer part of patients.json; patients created before side existed get null
        patient.pop("limb", None)
        patient.setdefault("side", None)

        if status is not None:
            patient["status"] = status

        if side is not None:
            patient["side"] = side

        if devices is not None:
            patient["devices"] = devices

        if patient == before:
            return data

    return _save_patients(data)


def patients_for_device(data, device_id):
    return [
        p for p in data["patients"]
        if device_id.upper() in p["devices"]
    ]


# ---------------------------------------------------------
# devices.json (heartbeat)
# ---------------------------------------------------------

def record_sync(device_id, device_version, ip):
    """Called on every laptop sync request."""

    devices = _read(DEVICES_FILE, {})

    devices[device_id] = {
        "last_seen": now(),
        "version": device_version,
        "ip": ip
    }

    _write_atomic(DEVICES_FILE, devices)


def log_sync(device_id, from_version, to_version):
    """Append a line when a laptop actually receives an update."""

    new_file = not SYNC_LOG.exists()

    with open(SYNC_LOG, "a", encoding="utf-8") as f:
        if new_file:
            f.write("time,device,from_version,to_version\n")
        f.write(f"{now()},{device_id},{from_version},{to_version}\n")


def device_status():
    """List of (device, last_seen, version, state)."""

    current = load_patients()["version"]
    devices = _read(DEVICES_FILE, {})
    rows = []

    for device_id, info in sorted(devices.items()):
        age = (
            datetime.now() - datetime.fromisoformat(info["last_seen"])
        ).total_seconds()

        if age > OFFLINE_AFTER:
            state = "OFFLINE"
        elif info["version"] == current:
            state = "up to date"
        else:
            state = "outdated"

        rows.append((device_id, info["last_seen"], info["version"], state))

    return rows


# ---------------------------------------------------------
# presence.json: who is training right now
#
#   {"testr": {"device": "MARS01", "last_upload": "2026-10-01T16:20:05", "ip": "..."}}
#
# Written by the server each time a sessions.csv arrives for a patient. The dashboard reads it to show
# "In session now", and laptops ask about it (action "check_user") before logging a patient in.
# ---------------------------------------------------------

def _age_seconds(iso, at=None):
    try:
        return ((at or datetime.now()) - datetime.fromisoformat(iso)).total_seconds()
    except (TypeError, ValueError):
        return float("inf")


def record_presence(user_id, device_id, ip=None, at=None):
    """Note that `device_id` has just uploaded a session for `user_id`."""

    presence = _read(PRESENCE_FILE, {})

    stamp = (at or datetime.now()).isoformat(timespec="seconds")
    presence[user_id] = {"device": device_id, "last_upload": stamp, "ip": ip}

    # Keep the file small: forget patients idle for a day.
    presence = {
        uid: p for uid, p in presence.items()
        if _age_seconds(p.get("last_upload"), at) <= PRESENCE_KEEP_SECONDS
    }

    _write_atomic(PRESENCE_FILE, presence)


def clear_presence(user_id, device_id=None):
    """Free the patient now. If device_id is given, only that laptop may free it.
    Returns True if something was cleared."""

    presence = _read(PRESENCE_FILE, {})
    entry = presence.get(user_id)

    if entry is None:
        return False

    if device_id is not None and entry.get("device") != device_id:
        return False

    del presence[user_id]
    _write_atomic(PRESENCE_FILE, presence)
    return True


def presence_for(user_id, at=None):
    """The active session for a patient, or None if nobody is training."""

    entry = _read(PRESENCE_FILE, {}).get(user_id)

    if not entry:
        return None

    age = _age_seconds(entry.get("last_upload"), at)

    if age > ACTIVE_WINDOW_SECONDS:
        return None

    return {
        "device": entry.get("device"),
        "last_upload": entry.get("last_upload"),
        "seconds_ago": int(age),
    }


# ---------------------------------------------------------
# Admin CLI
# ---------------------------------------------------------

def _main(argv):
    if not argv:
        print(__doc__)
        return

    cmd, args = argv[0], argv[1:]

    # --side / --status can appear anywhere after the command
    options = {}
    rest = []
    it = iter(args)

    for arg in it:
        if arg in ("--side", "--status"):
            options[arg[2:]] = next(it, None)
        else:
            rest.append(arg)

    args = rest

    if cmd == "add" and len(args) >= 1:
        upsert_patient(
            args[0], devices=args[1:] or None, **options
        )
    elif cmd == "set" and len(args) == 1 and options:
        upsert_patient(args[0], **options)
    elif cmd == "status" and len(args) == 2:
        upsert_patient(args[0], status=args[1])
    elif cmd == "devices" and len(args) >= 1:
        upsert_patient(args[0], devices=args[1:])
    elif cmd == "list":
        data = load_patients()
        print(f"patients.json version {data['version']}")
        for p in data["patients"]:
            print(
                f"  {p['user_id']:<12} {p['status']:<11} "
                f"{p.get('side') or '-':<6} "
                f"{p['devices']}"
            )
        return
    elif cmd == "laptops":
        print(f"current version {load_patients()['version']}")
        for row in device_status():
            print("  {:<10} {}  v{:<4} {}".format(*row))
        return
    else:
        print(__doc__)
        return

    print(f"OK. patients.json is now version {load_patients()['version']}")


if __name__ == "__main__":
    _main(sys.argv[1:])
