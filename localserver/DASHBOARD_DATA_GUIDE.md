# NeuroDash server data: guide for the dashboard

How the server stores patients, tracks laptops, and shares changes. Everything lives under `D:\NeuroDashData\` (set by `DATA_FOLDER` in `patients_store.py`).

```
D:\NeuroDashData\
  patients.json            patients, status, side, allocated devices  (dashboard writes)
  devices.json             last heartbeat from each laptop                  (server writes)
  sync_log.csv             one line each time a laptop received an update   (server writes)
  <UserId>\<Device>\       uploaded sessions.csv, configdata.csv (+ backup\)
  <Device>\                uploaded files with no user header (e.g. raw data)
  _incoming\               temporary files while an upload is arriving
```

## The big picture

```
 Dashboard --(add/edit patient)--> patients.json  (version +1)
                                        |
                          UDP broadcast "patients_changed" (port 5001)
                                        v
 Laptop (sender.py --sync)  <--- also polls every 60 s as fallback
      |  "sync, I hold version N"  (TCP port 5000)
      v
 Server (s2.py): records heartbeat in devices.json
      - if N == current: replies "up to date"
      - else: replies with new version + only that laptop's patients,
              and appends a line to sync_log.csv
```

The dashboard only ever writes `patients.json`. It reads `devices.json` and `sync_log.csv` to show which laptops are online and up to date.

## patients.json

```json
{
  "version": 6,
  "updated_at": "2026-10-01T14:40:19",
  "patients": [
    {
      "user_id": "testr",
      "status": "active",
      "side": "right",
      "devices": ["MARS01", "PLUTO"]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | Integer for the whole file. Goes up by 1 on every real change. Laptops compare it with their own copy to know if they are behind. |
| `updated_at` | Time of the last change (local server time). |
| `user_id` | Patient ID. Must equal the `:User:` value in `sessions.csv` and the `HomerID` in `configdata.csv`, since uploads are filed under it. Letters, digits, `-`, `_` only. |
| `status` | `active`, `paused` or `discharged`. Do not delete patients; discharge them so laptops can see the change. |
| `side` | `left`, `right` or `both` (`null` if not set yet). |
| `devices` | Training devices this patient is allocated to, upper-case, sorted. |

Rules:
- **Therapy plans are not stored here**, only identity, status, side and allocation.
- **A laptop only receives patients whose `devices` includes its own device ID.** A patient on `["PLUTO"]` is invisible to a laptop identifying as `MARS01`. An empty `patients` list on a laptop usually means this ID mismatch.
- **`devices` is replaced as a whole.** Always send the full list.
- **Nothing happens if a change is identical**: no version bump, no nudge.

### How the dashboard changes it

Use the functions in `patients_store.py` rather than editing the JSON by hand. They write atomically (temp file then rename), validate values, bump `version` and send the nudge.

```python
import patients_store as ps

ps.upsert_patient("118", devices=["PLUTO", "MARS01"], side="right")
ps.upsert_patient("118", status="paused")          # only status changes
ps.load_patients()                                 # read current data
ps.device_status()                                 # laptop status rows (below)
```

`upsert_patient(user_id, status=None, devices=None, side=None)` creates the patient if new (default status `active`), otherwise updates only the arguments you pass. Invalid status or side raises `ValueError`.

The same thing from a terminal:
```
python patients_store.py add 118 PLUTO MARS01 --side right
python patients_store.py set 118 --side left
python patients_store.py status 118 paused
python patients_store.py devices 118 PLUTO
python patients_store.py list
python patients_store.py laptops
```

Only one process should write at a time. Two simultaneous edits can overwrite each other, so let the dashboard be the single writer.

## devices.json (heartbeat)

```json
{
  "PLUTO": {
    "last_seen": "2026-10-01T14:16:05",
    "version": 2,
    "ip": "192.168.0.102"
  }
}
```

Written by the server on **every** sync request (even "up to date"), so it works as a heartbeat. The key is the device ID the laptop sends.

| Field | Meaning |
|---|---|
| `last_seen` | Server time of the laptop's most recent sync request. |
| `version` | The `patients.json` version the laptop said it holds. |
| `ip` | Laptop's address as seen by the server. |

### Status shown on the dashboard

`ps.device_status()` returns `(device, last_seen, version, state)` per row:

| State | Rule |
|---|---|
| `OFFLINE` | `last_seen` is older than 180 s (3 missed 60 s polls). Checked first. |
| `up to date` | Online and `version` equals the current `patients.json` version. |
| `outdated` | Online but `version` is lower than current. Normally clears within seconds. |

Offline laptops stay in the file with an old `last_seen`; remove stale entries (for example renamed IDs) by editing the file.

Settings: `POLL_SECONDS = 60` and `OFFLINE_AFTER = 3 * POLL_SECONDS` in `patients_store.py`. If you change the poll interval in `sender.py` (`SYNC_INTERVAL_SECONDS`), change `POLL_SECONDS` to match.

## sync_log.csv (audit history)

```
time,device,from_version,to_version
2026-10-01T14:16:05,PLUTO,2,3
```

One line is appended only when a laptop actually **receives** an update (not for "up to date" checks). Use it for history, such as when a laptop picked up a given change. It is append-only and the server never trims it.

## How laptops stay in sync

- **Nudge (fast):** on each change the server broadcasts a small UDP message `{"type": "patients_changed", "version": N}` on port 5001. A laptop running `sender.py --sync` hears it and syncs immediately.
- **Poll (reliable):** every 60 s the laptop syncs regardless. This catches missed nudges and laptops that were off or asleep.
- The laptop stores its copy at `C:\PLUTO\Data\patients.json` containing only its own patients, with the global `version`.

Nudges are best effort. They need the laptops on the same subnet, a router that allows broadcasts, and the Windows firewall open for UDP 5001. Without them the 60 s poll still works.

## Uploaded session data

Laptops upload `sessions.csv` and `configdata.csv` whole. The server picks the folder from the file's content:

| File | Patient ID read from |
|---|---|
| `sessions.csv` | The `:User:` header line |
| `configdata.csv` | The `HomerID` column (rejected if it holds several different IDs) |

Saved as `<UserId>\<Device>\<filename>`. An existing file is copied to `backup\` with a timestamp before being replaced. Files with no user header (such as raw trial data) go to `<Device>\`.

## Is this patient in use? (presence)

Each time a `sessions.csv` arrives the server records `{patient: {device, last_upload, ip}}` in `presence.json`. A patient counts as **in use** while the last upload is newer than `ACTIVE_WINDOW_SECONDS` (300 s, so a few missed one-minute uploads are tolerated).

| Request (same length-prefixed JSON as `sync`) | Reply |
|---|---|
| `{"action":"check_user","device_id":"PLUTO01","user_id":"118"}` | `in_use`, `in_use_by` `{device, seconds_ago}`, `own_session`, `window_seconds` |
| `{"action":"release","device_id":"MARS01","user_id":"118"}` | `released` (only the laptop that holds the patient can release) |

A laptop is never blocked by its own session. `sender.py --check 118` and `--release 118` do the same from the command line, and `check_patient_in_use()` / `release_patient()` can be called from the training software.

**The server cannot stop a laptop by itself.** The training software must call `check_user` before it logs a patient in, refuse (or warn) when `in_use` is true, and call `release` when the session ends. The dashboard only shows the "In session now" badge.

## Known limits

- A device ID must be on the server's allowed list to sync or upload.
- Device IDs have to match exactly (the server upper-cases the incoming one).
- Laptops are identified by one device ID, which also decides which patients they get. A separate laptop identity and a list of attached training devices is a planned change.
- There is no authentication beyond the allowed-device list.
- Side in `patients.json` is not compared with `TrainingSide` in `configdata.csv`.
