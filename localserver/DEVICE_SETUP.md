# Setting up a training device

A short checklist for whoever installs NeuroDash on a training device (Raspberry Pi or Windows laptop) and for whoever changes the training software. The full details are in [DASHBOARD_DATA_GUIDE.md](DASHBOARD_DATA_GUIDE.md).

What this gives you: the dashboard knows which patient is training on which device, and **a patient who is training on one device cannot be started on another.**

## 1. Server computer (once, and after every update)

- [ ] Copy the new `s2.py` **and** `patients_store.py`, then restart `s2.py`. Without this the lock fails with "Server closed the connection".
- [ ] Open **TCP 5000** and **UDP 5001** in its firewall.
- [ ] Use the same `ACTIVE_WINDOW_SECONDS` for `s2.py` (environment variable) and in the web app's `.env`. The default, 900 (15 minutes), suits games of up to 15 minutes. It must be longer than your longest trial.

## 2. Each Raspberry Pi

- [ ] Copy **two files** into one folder: `agent.py` and `sender_rapberryPI.py`. Add `agent_client.py` only if the training software is Python.
- [ ] Edit the top of `sender_rapberryPI.py`: `SERVER_IP`, `DEVICE_ID` (for example `MARS`) and `ROOT_DIR`.
- [ ] Give every Pi a **different hostname**. It is the Pi's id for the lock. (Or set `NEURODASH_CLIENT_ID`.)
- [ ] Open **UDP 5001** if a firewall is on. The Pi must reach the server on TCP 5000.
- [ ] Run `python3 agent.py`. With no `sender.py` in the folder it uses the Pi sender on its own.
- [ ] Start it at boot (systemd service, below).
- [ ] `sender_rapberryPI.py --upload` keeps uploading the CSVs as before.

Systemd service: save as `/etc/systemd/system/neurodash-agent.service`, then `sudo systemctl enable --now neurodash-agent`.

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

## 3. Each Windows gaming laptop

- [ ] Copy **two files** into one folder: `agent.py` and `sender.py`.
- [ ] Edit `SERVER_IP` and `DEVICE_ID` in `sender.py`. `DEVICE_ID` must be listed in `ALLOWED_DEVICES` in `s2.py`.
- [ ] Give every laptop a **different computer name**. Open **UDP 5001** inbound.
- [ ] Run `python agent.py`.
- [ ] Start it at logon: `schtasks /Create /SC ONLOGON /TN "NeuroDash Agent" /TR "pythonw C:\path\to\agent.py"`
- [ ] `sender.py --upload` keeps uploading as before.

## 4. In the training software (Pi and Windows: the same three calls)

The software talks to the agent **on the same device** at `http://127.0.0.1:5055`.

| When | Call | What to do with the answer |
|---|---|---|
| A patient is selected and starts | `/start?patient=<ID>` | **409:** stay on the login screen and show "User is using another device"; do not load the next scene. **200, or no answer:** go ahead. No answer means the agent is not running, and that never blocks therapy. |
| After each trial (optional) | `/trial-ended` (or read `lost` from `/status`) | If `lost` is filled in, another device took the patient: stop the session. The agent also notices trials by itself when `sessions.csv` changes. |
| The session ends, on logout, and in the exit and crash handler | `/stop` | Frees the patient straight away. |

How to make the calls:

- **Unity (C#):** working copies are in `testdata/`: `login.cs` and `AgentSession.cs`. Decide by `responseCode`, because Unity reports an HTTP 409 as an error. Assign the `statusMessage` text field in the Inspector, or the message cannot appear.
- **Python:** copy `agent_client.py` and use `nd.start(id)` (raises `PatientBusy` on a 409), `nd.trial_ended()` and `nd.stop()`, or `with nd.session(id):`.
- **Anything else:** a plain HTTP GET to those URLs.

## 5. Check that it works

1. On the server console, a lock request shows `Action : claim_user`.
2. On device A: `curl "http://127.0.0.1:5055/start?patient=<ID>"` answers ok.
3. On device B, the same call answers **409**, and the patient disappears from B's patient list within a few seconds.
4. On device A: `curl http://127.0.0.1:5055/stop`. The patient is free again on B straight away.

The dashboard shows a held patient as **In session now** on the patient page, the patient list and Data Sync, and as **In progress** in the therapist's "Sessions today".

## 6. If something does not work

| Symptom | Likely cause |
|---|---|
| "Could not reach the server: Server closed the connection" | The server computer still runs an old `s2.py` / `patients_store.py`. Copy both and restart it. |
| Login goes ahead although the patient is in use | The agent is not running on that device; you tested on the device that holds the patient (its own session is never blocked); the software does not call `/start`; or the game build is old. |
| A patient stays "in session" after the game closed | The software did not call `/stop`. It frees itself after `ACTIVE_WINDOW_SECONDS`, or run `sender.py --release <ID>` on the device that held it. |
| A device shows OFFLINE while idle | Expected: the agent only checks in when something happens. Set `NEURODASH_KEEPALIVE_SECONDS=120` for the agent to show it online all day. |
| `Ctrl+C` does not stop `s2.py` | Use the current `s2.py`, or press Ctrl+Break, or end the process: `netstat -ano \| findstr :5000`, then `taskkill /PID <id> /F`. |
