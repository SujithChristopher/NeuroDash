"""Receiving robotic-assessment uploads (kept apart from s2.py so it can be tested without a socket server).

A laptop uploads one timepoint of one limb at a time, once its assessment is locked and only when its data changed:

    laptop  -> header {action: "assessment", device_id, client_id, patient_id, limb, timepoint, fingerprint, file_size}
    server  -> {success, send}            send=false: "I already have exactly this" (nothing is transferred)
    laptop  -> file_size bytes: a zip of the timepoint folder (the raw trial files are normally left out)
    server  -> {success, saved}

The zip is unpacked into  <data folder>/<patient>/_assessments/<DEVICE>_<limb>_<TP>/  and a ".fingerprint" file is written
LAST, so the web app (which watches for it) never reads a half-unpacked folder. The web app does the parsing and keeps the
results in its database; the files stay on disk as the original record.
"""

import re
import shutil
import threading
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath

LIMBS = {"left", "right", "both"}
TIMEPOINT = re.compile(r"^[A-Za-z]\d{1,2}$")
ALLOWED_SUFFIXES = {".csv", ".json", ".locked", ".txt"}

MAX_ZIP_BYTES = 200 * 1024 * 1024
MAX_UNPACKED_BYTES = 800 * 1024 * 1024
MAX_MEMBERS = 5000

FINGERPRINT_FILE = ".fingerprint"

_replace_lock = threading.Lock()


class AssessmentError(ValueError):
    """The upload is refused; the message goes back to the laptop."""


def clean_id(value):
    """Keep it safe to use as a folder name."""

    value = "".join(c for c in str(value or "").strip() if c.isalnum() or c in "-_")
    return value or None


def check_header(header):
    """Validate the upload header; returns (patient, limb, timepoint, fingerprint, file_size)."""

    patient = clean_id(header.get("patient_id"))
    limb = str(header.get("limb", "")).strip().lower()
    timepoint = str(header.get("timepoint", "")).strip().upper()
    fingerprint = str(header.get("fingerprint", "")).strip()
    try:
        file_size = int(header.get("file_size", 0))
    except (TypeError, ValueError):
        file_size = 0

    if not patient:
        raise AssessmentError("No patient ID.")
    if limb not in LIMBS:
        raise AssessmentError(f'Limb must be one of {sorted(LIMBS)}, not "{limb}".')
    if not TIMEPOINT.match(timepoint):
        raise AssessmentError(f'"{timepoint}" is not a timepoint such as A0 or A1.')
    if not re.fullmatch(r"[0-9a-fA-F]{16,128}", fingerprint):
        raise AssessmentError("The fingerprint must be a hex digest.")
    if file_size <= 0 or file_size > MAX_ZIP_BYTES:
        raise AssessmentError(f"The package must be between 1 byte and {MAX_ZIP_BYTES // (1024 * 1024)} MB.")

    return patient, limb, timepoint, fingerprint, file_size


def package_folder(data_folder, patient, device_id, limb, timepoint):
    return Path(data_folder) / patient / "_assessments" / f"{device_id.upper()}_{limb}_{timepoint}"


def stored_fingerprint(folder):
    try:
        return (Path(folder) / FINGERPRINT_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return None


def safe_extract(zip_path, target):
    """Unpack a zip into `target`, refusing anything that could escape it or is not an assessment file."""

    target = Path(target).resolve()

    with zipfile.ZipFile(zip_path) as archive:
        members = [m for m in archive.infolist() if not m.is_dir()]

        if len(members) > MAX_MEMBERS:
            raise AssessmentError("Too many files in the package.")
        if sum(m.file_size for m in members) > MAX_UNPACKED_BYTES:
            raise AssessmentError("The package is too large once unpacked.")

        for member in members:
            name = member.filename.replace("\\", "/")
            parts = PurePosixPath(name).parts

            if name.startswith("/") or ".." in parts or (parts and re.match(r"^[A-Za-z]:$", parts[0])):
                raise AssessmentError(f"Unsafe path in the package: {member.filename}")
            if PurePosixPath(name).name == FINGERPRINT_FILE:
                continue  # only the server writes it
            if PurePosixPath(name).suffix.lower() not in ALLOWED_SUFFIXES:
                raise AssessmentError(f"File type not allowed in an assessment package: {member.filename}")

            out = (target / PurePosixPath(name)).resolve()
            if target != out and target not in out.parents:
                raise AssessmentError(f"Unsafe path in the package: {member.filename}")

            out.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, open(out, "wb") as sink:
                shutil.copyfileobj(source, sink)


def install(zip_path, data_folder, patient, device_id, limb, timepoint, fingerprint, scratch):
    """Unpack the zip and make it the stored package, keeping the previous one in _backup. Returns the folder."""

    destination = package_folder(data_folder, patient, device_id, limb, timepoint)
    staging = Path(scratch) / f"assessment_{datetime.now():%Y%m%d%H%M%S%f}"

    try:
        staging.mkdir(parents=True, exist_ok=True)
        safe_extract(zip_path, staging)
        if not any(staging.iterdir()):
            raise AssessmentError("The package is empty.")

        with _replace_lock:
            destination.parent.mkdir(parents=True, exist_ok=True)

            if destination.exists():
                backup = destination.parent / "_backup"
                backup.mkdir(exist_ok=True)
                shutil.move(str(destination), str(backup / f"{destination.name}_{datetime.now():%Y-%m-%d_%H-%M-%S}"))

            shutil.move(str(staging), str(destination))
            (destination / FINGERPRINT_FILE).write_text(fingerprint, encoding="utf-8")
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    return destination
