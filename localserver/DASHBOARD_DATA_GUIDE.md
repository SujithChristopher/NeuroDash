# NeuroDash local server: guide

How the server stores patients, tracks the training devices, stops two devices training the same patient, and how a device talks to it.

1. [The data folder](#1-the-data-folder)
2. [patients.json](#2-patientsjson)
3. [devices.json and sync_log.csv](#3-devicesjson-and-sync_logcsv)
4. [Uploaded session data](#4-uploaded-session-data)
5. [Keeping devices in sync](#5-keeping-devices-in-sync)
6. [One device per patient (the patient lock)](#6-one-device-per-patient-the-patient-lock)
7. [The agent](#7-the-agent)
8. [Setting up a device](#8-setting-up-a-device)
9. [Calling the agent from the training software](#9-calling-the-agent-from-the-training-software)
10. [Limits and troubleshooting](#10-limits-and-troubleshooting)

## 1. The data folder

Everything lives under one folder (`DATA_FOLDER` in `patients_store.py`, `NEURODASH_DATA_DIR` in the web app's `.env`; they must be the same folder).

```
D:\NeuroDashData\
  patients.json            patients, status, side, allocated devices   (the web app writes it)
  devices.json             last time each device checked in            (server writes)
  sync_log.csv             one line each time a device got an update   (server writes)
  presence.json            who is training which patient right now     (server writes)
  <UserId>\<Device>\       uploaded sessions.csv, configdata.csv (+ backup\)
  <Device>\                uploaded files with no user header (e.g. raw data)
  _incoming\               temporary files while an upload is arriving
  _reports\                saved patient reports (web app)
```

Three programs are involved:

| Program | Where | Does |
|---|---|---|
| `s2.py` | the server computer | receives uploads, answers syncs and lock requests (TCP port 5000), broadcasts nudges (UDP 5001) |
| `sender.py` / `sender_rapberryPI.py` | each training device | uploads `sessions.csv` and `configdata.csv`, and holds the device's settings and server calls |
| `agent.py` | each training device | keeps the patient list fresh and holds the patient lock (see [7](#7-the-agent)) |

## 2. patients.json

```json
{
  "version": 6,
  "updated_at": "2026-10-01T14:40:19",
  "patients": [
    { "user_id": "AG10001", "status": "active", "side": "right", "devices": ["MARS", "PLUTO"] }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | Integer for the whole file. Goes up by 1 on every real change. Devices compare it with their own copy to know if they are behind. |
| `updated_at` | Time of the last change (local server time). |
| `user_id` | Patient ID. Must equal the `:User:` value in `sessions.csv` and the `HomerID` in `configdata.csv`, since uploads are filed under it. Letters, digits, `-`, `_` only. |
| `status` | `active`, `paused` or `discharged`. Do not delete patients; discharge them so devices can see the change. |
| `side` | `left`, `right` or `both` (`null` if not set yet). |
| `devices` | Training devices this patient is allocated to, upper-case, sorted. |

Rules:
- **Therapy plans are not stored here**, only identity, status, side and allocation. The web app is the source of truth; this file is a copy for the devices. It never holds names, dates of birth or contact details.
- **A device only receives patients whose `devices` includes its own `DEVICE_ID`.** A patient on `["PLUTO"]` is invisible to a device that identifies as `MARS`. An empty list on a device usually means this mismatch.
- **`devices` is replaced as a whole.** Always send the full list.
- **An identical change does nothing**: no version bump, no nudge.
- **Who is training right now is not stored here.** The patient lock lives in `presence.json`; the version of this file never changes for it.

The web app writes this file whenever a plan with devices is created or changed, or a patient's status changes. To change it by hand, use `patients_store.py` (atomic write, validation, version bump, nudge) and make sure only one process writes at a time:

```python
import patients_store as ps

ps.upsert_patient("118", devices=["PLUTO", "MARS"], side="right")
ps.upsert_patient("118", status="paused")          # only status changes
ps.load_patients()                                 # read current data
ps.device_status()                                 # device status rows (section 3)
```

```
python patients_store.py add 118 PLUTO MARS --side right
python patients_store.py status 118 paused
python patients_store.py devices 118 PLUTO
python patients_store.py list
python patients_store.py laptops
```

## 3. devices.json and sync_log.csv

`devices.json` is written by the server on **every** sync request, so it works as each device's heartbeat:

```json
{ "MARS": { "last_seen": "2026-10-01T14:16:05", "version": 2, "ip": "192.168.0.102" } }
```

| Field | Meaning |
|---|---|
| `last_seen` | Server time of the device's most recent sync request. |
| `version` | The `patients.json` version the device said it holds. |
| `ip` | The device's address as seen by the server. |

The dashboard's Data Sync page shows each row as:

| State | Rule |
|---|---|
| `OFFLINE` | `last_seen` is older than 180 s. Checked first. |
| `up to date` | Online and `version` equals the current `patients.json` version. |
| `outdated` | Online but `version` is lower. Normally clears within seconds. |

Settings: `POLL_SECONDS = 60` and `OFFLINE_AFTER = 3 * POLL_SECONDS` in `patients_store.py`. Offline devices stay in the file with an old `last_seen`; remove stale entries (for example renamed IDs) by editing it.

**An idle device looks offline.** The agent only checks in when something happens (see section 7), so a device with nobody playing shows OFFLINE after 3 minutes. To show it online all day set `NEURODASH_KEEPALIVE_SECONDS=120` for the agent.

`sync_log.csv` is an append-only history, one line only when a device actually **receives** an update (not for "up to date" checks):

```
time,device,from_version,to_version
2026-10-01T14:16:05,MARS,2,3
```

## 4. Uploaded session data

Devices upload `sessions.csv` and `configdata.csv` whole (`sender.py` / `sender_rapberryPI.py`). The server picks the folder from the file's content:

| File | Patient ID read from |
|---|---|
| `sessions.csv` | The `:User:` header line |
| `configdata.csv` | The `HomerID` column (rejected if it holds several different IDs) |

Saved as `<UserId>\<Device>\<filename>`. An existing file is copied to `backup\` with a timestamp before being replaced. Files with no user header go to `<Device>\`. The web app reads these folders and imports them into its database. An upload also counts as a sign of life for the patient lock.

## 5. Keeping devices in sync

- **Nudge (fast):** when `patients.json` changes, or a patient starts or stops training, the server broadcasts a small UDP message on port 5001: `{"type": "patients_changed", "version": N}` or `{"type": "presence_changed"}`. A device running the agent hears it and syncs at once. Nudges are best effort: they need the devices on the same subnet, a router that allows broadcasts, and the firewall open for UDP 5001.
- **Events:** the agent also syncs when it starts, when a patient starts or stops, and at the end of every trial. `sender.py --login` and `--upload` sync as well.
- **The device's copy** of the patient list is a file next to the device software (`PATIENTS_FILE` in the sender) with only that device's patients and the global `version`.
- **Hiding busy patients:** a device sends its `client_id` and a `view` token with every sync. The server answers with only the patients that are **not** being trained on another device, plus a new `view`. `patients.json` on the server is never changed for this and its version does not move; the device's copy simply becomes a filtered view. When a patient is claimed or released the server nudges the others, so the list refreshes within a second. Older senders that send no `view` get the full list.

## 6. One device per patient (the patient lock)

`presence.json` keeps `{patient: {device, client, last_upload, ip}}`. `device` is the kind of device (`MARS`); `client` is the **device's own id**, its computer name or `NEURODASH_CLIENT_ID`, because several devices can all be `MARS`. A patient is **held** by a device from the moment it claims them. The hold is refreshed by any sign of life from that device: the claim, the end of a trial (the agent renews the claim), and every `sessions.csv` upload. If nothing arrives for `ACTIVE_WINDOW_SECONDS`, the hold lapses by itself, so a crashed device never locks a patient for good.

| Request (length-prefixed JSON: 4-byte length, then JSON) | Reply |
|---|---|
| `{"action":"claim_user","device_id":"MARS","client_id":"LAPTOP-A","user_id":"118"}` | `claimed` true, or false with `in_use_by` `{device, client, seconds_ago}` when another device holds the patient. Claiming your own patient again just renews the hold. |
| `{"action":"check_user",...}` | Only asks: `in_use`, `in_use_by`, `own_session`. Locks nothing. |
| `{"action":"release",...}` | `released` (only the device that holds the patient can release). |

The server handles each device in its own thread, so a large upload never delays another device's claim, and claims take a lock so two devices claiming the same patient at the same moment cannot both succeed.

**`ACTIVE_WINDOW_SECONDS`** must be longer than your longest trial, because the hold is only refreshed when a trial ends or a file is uploaded. The default is **900 s (15 minutes)**, since some games run that long. A crashed device keeps its patient for up to that long unless the software calls `/stop`, or someone runs `sender.py --release <ID>` from it. Set it as an environment variable for `s2.py` and also in the web app's `.env`, with the same value in both.

## 7. The agent

`agent.py` runs all day on each training device. It does **not** poll the server on a timer; it checks in only when something happens:

| When | What the agent does |
|---|---|
| it starts | one patient-list sync |
| the training software calls `/start` | claims the patient (the lock) |
| a trial ends | renews the claim (and finds out if another device took the patient) and refreshes the patient list, once |
| the training software calls `/stop` | releases the patient |
| another device starts or stops a patient | the server's nudge arrives and the agent refreshes the list |

A trial end is noticed because `sessions.csv` changes (a check of that file on the device every 2 s, with no network traffic), or the software can say so with `/trial-ended`. The agent does **not** upload `sessions.csv` or `configdata.csv`: the sender keeps doing that.

The dashboard shows a held patient as **In session now** (with the device's name) on the patient page, the patient list and Data Sync, and as **In progress** in the therapist's "Sessions today".

## 8. Setting up a device

**Server computer** (once, and again after every update): copy the current `s2.py` **and** `patients_store.py` (both: the new `s2.py` uses functions that only exist in the new `patients_store.py`), then restart `s2.py`. An old server answers a lock request by closing the connection, which shows on the device as "Could not reach the server: Server closed the connection". Open TCP 5000 and UDP 5001 in its firewall.

**Windows training laptop:** copy two files into one folder, `agent.py` and `sender.py`. Edit `SERVER_IP` and `DEVICE_ID` in `sender.py` (`DEVICE_ID` must be on the server's `ALLOWED_DEVICES`). Then:

```
python agent.py
```

**Raspberry Pi:** copy two files, `agent.py` and `sender_rapberryPI.py`. Edit `SERVER_IP`, `DEVICE_ID` and `ROOT_DIR` in `sender_rapberryPI.py`. Then `python3 agent.py`. With no `sender.py` next to it the agent uses `sender_rapberryPI.py` on its own (to force it: `python3 agent.py --sender sender_rapberryPI`). A Pi keeps one folder per patient (`ROOT_DIR/<patient>/sessions.csv`), so the agent watches the **held patient's** `sessions.csv`.

For both:
- Give every device a different computer name or hostname, since that is its id for the lock (or set `NEURODASH_CLIENT_ID`).
- Open **UDP 5001** inbound if a firewall is on, so nudges arrive. The device must reach the server on TCP 5000.
- Start the agent at boot. Windows: `schtasks /Create /SC ONLOGON /TN "NeuroDash Agent" /TR "pythonw C:\path\to\agent.py"`. Raspberry Pi: a systemd service, for example `/etc/systemd/system/neurodash-agent.service`, then `sudo systemctl enable --now neurodash-agent`:

```
[Unit]
Description=NeuroDash agent
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/pi/NeuroDash
ExecStart=/usr/bin/python3 /home/pi/NeuroDash/agent.py
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

- `agent_client.py` is optional: copy it only if the training software is Python (section 9).
- The sender keeps uploading as it does now (`sender.py --upload`, `sender_rapberryPI.py --upload`).

## 9. Calling the agent from the training software

The software talks to the agent on the **same device only** (`127.0.0.1`, port 5055, or `NEURODASH_AGENT_PORT`). GET or POST both work; the patient can be in the query string, a form body or a JSON body. Three places in the software:

1. **When a patient is selected and starts:** call `/start`. On **409** show the message and stay on the login screen. On 200 start the session.
2. **After each trial (optional):** call `/trial-ended` or read `lost` from `/status`. `lost` filled in means another device took the patient: stop the session.
3. **When the session ends, on logout, and in the exit and crash handler:** call `/stop`.

| Call | Meaning | Reply |
|---|---|---|
| `/start?patient=118` | A patient is starting here | `200 {"ok":true}`, or `409 {"ok":false,"in_use_by":{...},"message":"118 is being trained on PLUTO (laptop LAPTOP-B) ..."}` |
| `/trial-ended` | A trial just ended | `200 {"ok":true,"lost":null,...}`; `lost` is an object when another device took the patient |
| `/stop` | The session ended | `200 {"ok":true,"released":"118"}` |
| `/check?patient=118` | Asks only, locks nothing | `{"in_use":false,"in_use_by":null}` |
| `/status` | What the agent is doing | `{"client","device","patient","lost","server_reachable","last_trial","last_sync"}` |

If the server cannot be reached, `/start` still answers `ok` after at most 3 s with `"server_reachable": false`, so a network fault never stops therapy. If the agent is not running, the software gets no answer: treat that as "allowed" too.

```powershell
Invoke-RestMethod "http://127.0.0.1:5055/start?patient=118"          # PowerShell (a 409 raises an error)
curl "http://127.0.0.1:5055/start?patient=118"                        # curl
```

**Python software:** copy `agent_client.py` next to it (standard library only).

```python
import agent_client as nd

try:
    nd.start(patient_id)             # raises PatientBusy on a 409
except nd.PatientBusy as busy:
    show_message(busy.message)
    return

if nd.trial_ended().get("lost"):     # after a trial
    stop_the_game()

nd.stop()                            # at the end (or: with nd.session(patient_id): run_the_session())
```

**Unity (C#):** `testdata\AgentSession.cs` and `testdata\login.cs` in this folder are working copies. The login handler calls `AgentSession.Instance.CallStart(...)`; on a 409 it stays on the login scene and shows "User is using another device", writes no config and loads no scene. Decide by `responseCode`: `UnityWebRequest` reports an HTTP 409 as an error (`ProtocolError`), which must not be treated as "agent offline". Assign the `statusMessage` text field in the Inspector or the message cannot appear.

**Without the agent**, the sender can do the same from a command line: `python sender.py --hold 118` (claims, renews every 30 s until stopped, then releases; exit 2 = busy, 3 = lost), `--claim 118`, `--release 118`, `--check 118` (exit 2 = in use on another device). On a Pi, `sender_rapberryPI.py --login 118` keeps the lock until stopped (exit 2 busy, 3 server unreachable, 4 no patient), and `--check 118` only asks.

## 10. Limits and troubleshooting

**Limits**
- **The server cannot stop a device by itself.** The training software must call `/start` (or `--claim`) when a patient logs in and refuse when it is refused. Until it does, the lock only appears after the first upload of the session.
- If the server cannot be reached, a claim counts as granted, so a network problem never stops therapy. Two devices that are both offline can then both play; the next trial-end check after the network returns finds the conflict (`lost`).
- A device killed without cleanup (power loss, `taskkill /F`) keeps its patient until the window passes.
- Every device needs the updated sender and agent (with the device's own id) for two devices of the same type to block each other; an older sender is identified by its device name only.
- `DEVICE_ID` decides which patients a device gets (the kind of device); `CLIENT_ID` is only used by the patient lock and the dashboard's "In session now" label.
- A device ID must be on the server's `ALLOWED_DEVICES` to sync, upload or claim. There is no other authentication.
- Side in `patients.json` is not compared with `TrainingSide` in `configdata.csv`.

**Troubleshooting**

| Symptom | Likely cause |
|---|---|
| `Could not reach the server: Server closed the connection.` on a lock request, while syncing works | The server computer still runs an old `s2.py` / `patients_store.py`. Copy both and restart it. |
| Login goes ahead although the patient is in use | The agent is not running on that device (the answer is "allowed"), the check was run on the device that holds the patient (its own session is never blocked), the training software never calls `/start`, or the game build is old. Run `curl "http://127.0.0.1:5055/start?patient=<ID>"` on that device: it must answer 409 from any other device. |
| A patient stays "in session" after the game closed | The software did not call `/stop`. It frees itself after `ACTIVE_WINDOW_SECONDS`, or run `sender.py --release <ID>` on the device that held it. |
| A device shows OFFLINE while idle | Expected: the agent only checks in on events. Set `NEURODASH_KEEPALIVE_SECONDS=120` to show it online all day. |
| A device's patient list is empty | Its `DEVICE_ID` is not in the patients' `devices`, or the patient is `paused` / `discharged`. |
| `Ctrl+C` does not stop `s2.py` | Use the current `s2.py` (it wakes up every second), or press Ctrl+Break, or end the process (`netstat -ano \| findstr :5000`, then `taskkill /PID <id> /F`). |
