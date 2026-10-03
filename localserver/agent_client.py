"""Drop-in helper for the TRAINING SOFTWARE (Python, standard library only): talk to the laptop agent (agent.py).

Copy this one file next to the training software and call it in three places:

    import agent_client as nd

    # 1. when a patient logs in, BEFORE the session starts
    try:
        nd.start(patient_id)
    except nd.PatientBusy as busy:
        show_message(busy.message)         # "118 is being trained on PLUTO (laptop LAPTOP-B) ..."
        return                             # refuse the login

    # 2. after every trial (the agent also notices this on its own from sessions.csv, so this call is optional)
    if nd.trial_ended().get("lost"):
        stop_the_game()                    # another laptop took the patient: end the session

    # 3. when the session ends, the therapist logs out, or the program closes (also in your crash/exit handler)
    nd.stop()

or in one block (stop() is called even if the session crashes):

    with nd.session(patient_id):
        run_the_session()

If the agent is not running or the server cannot be reached, start() does NOT raise: a network or setup problem never
stops therapy. It returns {"ok": True, "agent": False} (agent not running) or {"ok": True, "server_reachable": False}.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = f"http://127.0.0.1:{os.environ.get('NEURODASH_AGENT_PORT', '5055')}"
TIMEOUT_SECONDS = 6  # the agent waits at most 3 s for the server, so this leaves room for its answer


class PatientBusy(Exception):
    """Another laptop is training this patient. `.holder` says which; `.message` is ready to show the therapist."""

    def __init__(self, message, holder=None):
        super().__init__(message)
        self.message = message
        self.holder = holder or {}


def _call(path, base=None, timeout=TIMEOUT_SECONDS):
    url = (base or BASE_URL) + path

    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:  # 409 (busy), 400, ...: the body still carries the answer
        try:
            return error.code, json.loads(error.read() or b"{}")
        except ValueError:
            return error.code, {}
    except (urllib.error.URLError, OSError, ValueError):
        return None, {}  # agent not running / not reachable


def start(patient_id, base=None):
    """Claim the patient for this laptop. Raises PatientBusy when another laptop has them; otherwise returns the reply."""

    code, body = _call("/start?patient=" + urllib.parse.quote(str(patient_id)), base)

    if code == 409:
        raise PatientBusy(body.get("message") or f"{patient_id} is being trained on another laptop.", body.get("in_use_by"))

    if code is None:
        return {"ok": True, "agent": False}  # the agent is not running: do not block the session

    return body


def stop(base=None):
    """Release the patient. Safe to call when nothing is held or the agent is not running."""

    _, body = _call("/stop", base)
    return body


def trial_ended(base=None):
    """Tell the agent a trial just ended: it renews the claim and refreshes the patient list, once. The reply has
    "lost" filled in when another laptop took the patient (stop the session then). Optional: the agent also sees
    sessions.csv change."""

    _, body = _call("/trial-ended", base)
    return body


def status(base=None):
    """What the agent is doing: {"patient", "lost", "server_reachable", "last_sync", ...} ({} when it is not running)."""

    _, body = _call("/status", base)
    return body


def is_busy(patient_id, base=None):
    """Asks only (locks nothing): is this patient being trained on another laptop? Returns (busy, holder)."""

    _, body = _call("/check?patient=" + urllib.parse.quote(str(patient_id)), base)
    return bool(body.get("in_use")), body.get("in_use_by")


class session:
    """`with session(patient_id):` claims the patient on entry (raises PatientBusy if refused) and always releases on exit."""

    def __init__(self, patient_id, base=None):
        self.patient_id = patient_id
        self.base = base

    def __enter__(self):
        start(self.patient_id, self.base)
        return self

    def __exit__(self, *exc):
        stop(self.base)
        return False
