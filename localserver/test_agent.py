"""Tests for agent.py (the laptop agent) and for the server's per-laptop patient view.

    python -m unittest test_agent        (from this folder)

No network and no real data folder: server requests are faked, files live in a temporary folder.
"""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import agent as agent_mod        # noqa: E402
import agent_client as nd        # noqa: E402
import patients_store as ps      # noqa: E402
import s2                        # noqa: E402
import sender                    # noqa: E402
import sender_rapberryPI as pi   # noqa: E402


class FakeServer:
    """Stands in for the NeuroDash server: records the requests and answers from a script."""

    def __init__(self):
        self.calls = []
        self.holder = None      # who holds the patient: None, or {"device","client","seconds_ago"}
        self.reachable = True

    def ask(self, action, user_id):
        self.calls.append((action, user_id))

        if not self.reachable:
            return None

        if action == "claim_user":
            if self.holder:
                return {"success": True, "claimed": False, "in_use_by": self.holder}
            return {"success": True, "claimed": True, "in_use_by": None}

        if action == "check_user":
            return {"success": True, "in_use": bool(self.holder), "in_use_by": self.holder}

        return {"success": True, "released": True}

    def actions(self):
        return [a for a, _ in self.calls]


def make_agent(server, **kw):
    kw.setdefault("sync", lambda: None)
    kw.setdefault("run", lambda fn: fn())   # run "background" work inline so the tests are deterministic
    kw.setdefault("debounce", 0)
    return agent_mod.Agent(ask=server.ask, **kw)


class LockTests(unittest.TestCase):

    def setUp(self):
        self.server = FakeServer()
        self.syncs = []
        self.agent = make_agent(self.server, sync=lambda: self.syncs.append(1))
        self.addCleanup(self.agent.shutdown)

    def test_start_claims_the_patient_once_and_does_not_poll(self):
        ok, holder = self.agent.start_session("118")
        self.assertEqual((ok, holder), (True, None))
        self.assertEqual(self.agent.patient, "118")
        time.sleep(0.2)  # nothing happens on a timer
        self.assertEqual(self.server.actions(), ["claim_user"])

    def test_start_is_refused_when_another_laptop_holds_the_patient(self):
        self.server.holder = {"device": "PLUTO", "client": "LAPTOP-B", "seconds_ago": 5}
        ok, holder = self.agent.start_session("118")
        self.assertFalse(ok)
        self.assertEqual(holder["client"], "LAPTOP-B")
        self.assertIsNone(self.agent.patient)

    def test_stop_releases_and_refreshes_the_list(self):
        self.agent.start_session("118")
        before = len(self.syncs)
        self.assertEqual(self.agent.stop_session(), "118")
        self.assertEqual(self.server.actions()[-1], "release")
        self.assertEqual(len(self.syncs), before + 1)
        self.assertIsNone(self.agent.stop_session())  # nothing held now

    def test_starting_another_patient_lets_go_of_the_previous_one(self):
        self.agent.start_session("118")
        self.agent.start_session("119")
        self.assertIn(("release", "118"), self.server.calls)
        self.assertEqual(self.agent.patient, "119")

    def test_a_trial_end_renews_the_claim_and_refreshes_the_list_once(self):
        self.agent.start_session("118")
        claims, syncs = self.server.actions().count("claim_user"), len(self.syncs)
        status = self.agent.trial_ended()
        self.assertEqual(self.server.actions().count("claim_user"), claims + 1)
        self.assertEqual(len(self.syncs), syncs + 1)
        self.assertIsNone(status["lost"])
        self.assertIsNotNone(status["last_trial"])

    def test_a_trial_end_with_no_patient_held_only_refreshes_the_list(self):
        self.agent.trial_ended()
        self.assertEqual(self.server.actions(), [])
        self.assertEqual(len(self.syncs), 1)

    def test_losing_the_patient_to_another_laptop_is_found_at_the_next_trial_end(self):
        self.agent.start_session("118")
        self.server.holder = {"device": "MARS", "client": "OTHER", "seconds_ago": 1}  # taken over while this one was offline
        self.assertIsNone(self.agent.status()["lost"])  # nothing was checked yet: no timer
        self.assertEqual(self.agent.trial_ended()["lost"]["client"], "OTHER")

    def test_an_unreachable_server_never_stops_therapy_and_the_next_trial_end_tries_again(self):
        self.server.reachable = False
        ok, _ = self.agent.start_session("118")
        self.assertTrue(ok)
        self.assertFalse(self.agent.status()["server_reachable"])
        self.server.reachable = True
        status = self.agent.trial_ended()
        self.assertTrue(status["server_reachable"])
        self.assertIsNone(status["lost"])

    def test_the_same_trial_reported_by_the_file_and_the_software_counts_once(self):
        agent = make_agent(self.server, sync=lambda: self.syncs.append(1), debounce=5)
        self.addCleanup(agent.shutdown)
        agent.start_session("118")
        claims = self.server.actions().count("claim_user")
        agent.trial_ended()
        agent.trial_ended()
        self.assertEqual(self.server.actions().count("claim_user"), claims + 1)

    def test_check_only_asks(self):
        self.server.holder = {"device": "PLUTO", "seconds_ago": 3}
        busy, holder = self.agent.check("118")
        self.assertTrue(busy)
        self.assertEqual(self.server.actions(), ["check_user"])

    def test_a_slow_sync_never_delays_start(self):
        slow = threading.Event()
        agent = agent_mod.Agent(ask=self.server.ask, sync=lambda: slow.wait(2), debounce=0)  # real background thread
        self.addCleanup(lambda: (slow.set(), agent.shutdown()))
        t0 = time.time()
        agent.start_session("118")
        self.assertLess(time.time() - t0, 0.5)


class SessionsFileWatchTests(unittest.TestCase):
    """A trial ending is seen as sessions.csv changing: a local file check, no network."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.file = Path(self.tmp.name) / "sessions.csv"
        self.server = FakeServer()
        self.syncs = []
        self.agent = make_agent(self.server, sync=lambda: self.syncs.append(1), sessions_file=lambda: self.file)
        self.addCleanup(self.agent.shutdown)

    def touch(self, text, mtime):
        self.file.write_text(text)
        os.utime(self.file, (mtime, mtime))

    def test_the_first_look_only_records_and_a_change_is_a_trial_end(self):
        self.touch("a", 1000)
        self.assertFalse(self.agent.check_sessions_file())
        self.assertFalse(self.agent.check_sessions_file())  # unchanged: nothing happens
        self.agent.start_session("118")
        claims = self.server.actions().count("claim_user")
        self.touch("ab", 1060)
        self.assertTrue(self.agent.check_sessions_file())
        self.assertEqual(self.server.actions().count("claim_user"), claims + 1)
        self.assertFalse(self.agent.check_sessions_file())  # the same change is not reported again

    def test_a_file_that_appears_after_the_agent_started_counts(self):
        self.assertFalse(self.agent.check_sessions_file())  # does not exist yet
        self.touch("first trial", 1000)
        self.assertTrue(self.agent.check_sessions_file())

    def test_a_missing_file_is_not_an_error(self):
        self.assertFalse(self.agent.check_sessions_file())
        self.assertFalse(make_agent(FakeServer(), sessions_file=lambda: None).check_sessions_file())


class LocalHttpTests(unittest.TestCase):
    """The interface the training software calls, over a real local HTTP server."""

    def setUp(self):
        self.server = FakeServer()
        self.agent = make_agent(self.server)
        self.http = agent_mod.make_http_server(self.agent, port=0)
        self.base = f"http://127.0.0.1:{self.http.server_address[1]}"
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)
        self.addCleanup(self.agent.shutdown)

    def call(self, path, method="GET", body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_start_then_status_then_stop(self):
        self.assertEqual(self.call("/start?patient=118")[0], 200)
        status = self.call("/status")[1]
        self.assertEqual(status["patient"], "118")
        self.assertIsNone(status["lost"])
        self.assertEqual(self.call("/stop")[1], {"ok": True, "released": "118"})
        self.assertIsNone(self.call("/status")[1]["patient"])

    def test_start_is_409_with_a_message_when_the_patient_is_held_elsewhere(self):
        self.server.holder = {"device": "PLUTO", "client": "LAPTOP-B", "seconds_ago": 12}
        code, body = self.call("/start?patient=118")
        self.assertEqual(code, 409)
        self.assertFalse(body["ok"])
        self.assertEqual(body["in_use_by"]["client"], "LAPTOP-B")
        self.assertIn("118 is being trained on PLUTO", body["message"])
        self.assertIsNone(self.call("/status")[1]["patient"])

    def test_post_with_json_or_form_body_works_like_the_query_string(self):
        self.assertEqual(self.call("/start", "POST", {"patient": "118"})[0], 200)
        self.assertEqual(self.agent.patient, "118")
        self.agent.stop_session()
        req = urllib.request.Request(self.base + "/start", data=b"patient=119", method="POST")
        with urllib.request.urlopen(req, timeout=5) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual(self.agent.patient, "119")

    def test_bad_input_and_unknown_paths(self):
        self.assertEqual(self.call("/start")[0], 400)
        self.assertEqual(self.call("/start?patient=../etc")[0], 400)
        self.assertEqual(self.call("/start?patient=" + "x" * 41)[0], 400)
        self.assertEqual(self.call("/nope")[0], 404)
        self.assertEqual(self.agent.patient, None)

    def test_check_does_not_lock(self):
        self.server.holder = {"device": "PLUTO", "seconds_ago": 3}
        code, body = self.call("/check?patient=118")
        self.assertEqual((code, body["in_use"]), (200, True))
        self.assertNotIn("claim_user", self.server.actions())

    def test_it_only_listens_on_this_computer(self):
        self.assertEqual(self.http.server_address[0], "127.0.0.1")

    def test_trial_ended_renews_and_reports_if_the_patient_was_lost(self):
        self.call("/start?patient=118")
        self.assertIsNone(self.call("/trial-ended")[1]["lost"])
        self.server.holder = {"device": "MARS", "client": "OTHER", "seconds_ago": 1}
        code, body = self.call("/trial-ended", "POST")
        self.assertEqual((code, body["ok"], body["lost"]["client"]), (200, True, "OTHER"))
        self.assertEqual(self.call("/status")[1]["lost"]["client"], "OTHER")
        self.assertEqual(self.call("/ping")[0], 200)  # alias


class ClientHelperTests(unittest.TestCase):
    """agent_client.py: what the training software imports."""

    def setUp(self):
        self.server = FakeServer()
        self.agent = make_agent(self.server)
        self.http = agent_mod.make_http_server(self.agent, port=0)
        self.base = f"http://127.0.0.1:{self.http.server_address[1]}"
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)
        self.addCleanup(self.agent.shutdown)

    def test_start_and_stop(self):
        self.assertTrue(nd.start("118", self.base)["ok"])
        self.assertEqual(nd.status(self.base)["patient"], "118")
        nd.stop(self.base)
        self.assertIsNone(nd.status(self.base)["patient"])

    def test_start_raises_patient_busy_with_a_message_when_held_elsewhere(self):
        self.server.holder = {"device": "PLUTO", "client": "LAPTOP-B", "seconds_ago": 7}
        with self.assertRaises(nd.PatientBusy) as ctx:
            nd.start("118", self.base)
        self.assertIn("118 is being trained on PLUTO", ctx.exception.message)
        self.assertEqual(ctx.exception.holder["client"], "LAPTOP-B")

    def test_trial_ended_reports_a_lost_patient(self):
        nd.start("118", self.base)
        self.assertIsNone(nd.trial_ended(self.base)["lost"])
        self.server.holder = {"device": "MARS", "client": "OTHER", "seconds_ago": 1}
        self.assertEqual(nd.trial_ended(self.base)["lost"]["client"], "OTHER")

    def test_the_agent_not_running_never_blocks_a_session(self):
        dead = "http://127.0.0.1:1"  # nothing listens here
        self.assertEqual(nd.trial_ended(dead), {})
        self.assertEqual(nd.start("118", dead), {"ok": True, "agent": False})
        self.assertEqual(nd.stop(dead), {})
        self.assertEqual(nd.status(dead), {})

    def test_session_block_releases_even_after_a_crash(self):
        with self.assertRaises(RuntimeError):
            with nd.session("118", self.base):
                self.assertEqual(self.agent.patient, "118")
                raise RuntimeError("the game crashed")
        self.assertIsNone(self.agent.patient)

    def test_session_block_refuses_when_busy_and_holds_nothing(self):
        self.server.holder = {"device": "PLUTO", "seconds_ago": 1}
        with self.assertRaises(nd.PatientBusy):
            with nd.session("118", self.base):
                self.fail("must not start")
        self.assertIsNone(self.agent.patient)

    def test_is_busy_only_asks(self):
        self.server.holder = {"device": "PLUTO", "seconds_ago": 1}
        self.assertEqual(nd.is_busy("118", self.base)[0], True)
        self.assertNotIn("claim_user", self.server.actions())


class PatientViewTests(unittest.TestCase):
    """The server shows each laptop only the patients that are not being trained on another laptop."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        saved = (ps.PATIENTS_FILE, ps.DEVICES_FILE, ps.SYNC_LOG, ps.PRESENCE_FILE, ps.NUDGE_ENABLED)
        folder = Path(self.tmp.name)
        ps.PATIENTS_FILE, ps.DEVICES_FILE, ps.SYNC_LOG, ps.PRESENCE_FILE = folder / "patients.json", folder / "devices.json", folder / "sync_log.csv", folder / "presence.json"
        ps.NUDGE_ENABLED = False
        self.addCleanup(lambda: (setattr(ps, "PATIENTS_FILE", saved[0]), setattr(ps, "DEVICES_FILE", saved[1]), setattr(ps, "SYNC_LOG", saved[2]), setattr(ps, "PRESENCE_FILE", saved[3]), setattr(ps, "NUDGE_ENABLED", saved[4])))
        for pid in ("118", "119"):
            ps.upsert_patient(pid, devices=["MARS"])

    def sync(self, client, view=None, version=None):
        class Conn:
            sent = b""

            def sendall(self, b):
                self.sent += b

        header = {"device_id": "MARS", "client_id": client, "patients_version": version if version is not None else ps.load_patients()["version"]}
        if view is not None:
            header["view"] = view
        conn = Conn()
        s2.handle_sync(conn, ("127.0.0.1", 1), "MARS", header)
        length = int.from_bytes(conn.sent[:4], "big")
        return json.loads(conn.sent[4:4 + length])

    def ids(self, reply):
        return sorted(p["user_id"] for p in reply.get("patients", []))

    def test_a_patient_held_by_another_laptop_is_not_offered_but_the_holder_still_sees_them(self):
        ps.claim_presence("118", "MARS", client_id="LAPTOP-A")
        self.assertEqual(self.ids(self.sync("LAPTOP-B", view="", version=0)), ["119"])
        self.assertEqual(self.ids(self.sync("LAPTOP-A", view="", version=0)), ["118", "119"])

    def test_the_laptop_is_told_to_refresh_when_a_patient_is_taken_or_freed_even_though_the_version_is_the_same(self):
        first = self.sync("LAPTOP-B", view="", version=0)
        view_free, version = first["view"], first["version"]
        self.assertTrue(self.sync("LAPTOP-B", view=view_free, version=version)["up_to_date"])

        ps.claim_presence("118", "MARS", client_id="LAPTOP-A")
        taken = self.sync("LAPTOP-B", view=view_free, version=version)
        self.assertFalse(taken["up_to_date"])
        self.assertEqual((taken["version"], self.ids(taken)), (version, ["119"]))  # patients.json's version did not move

        self.assertTrue(self.sync("LAPTOP-B", view=taken["view"], version=version)["up_to_date"])
        ps.clear_presence("118", "MARS", "LAPTOP-A")
        freed = self.sync("LAPTOP-B", view=taken["view"], version=version)
        self.assertEqual(self.ids(freed), ["118", "119"])

    def test_patients_json_itself_is_not_touched_by_any_of_this(self):
        before = ps.PATIENTS_FILE.read_text()
        ps.claim_presence("118", "MARS", client_id="LAPTOP-A")
        self.sync("LAPTOP-B", view="", version=0)
        ps.clear_presence("118", "MARS", "LAPTOP-A")
        self.assertEqual(ps.PATIENTS_FILE.read_text(), before)

    def test_an_older_sender_without_a_view_gets_the_plain_list(self):
        ps.claim_presence("118", "MARS", client_id="LAPTOP-A")
        legacy = self.sync("LAPTOP-B", version=0)  # no "view" in the request
        self.assertEqual(self.ids(legacy), ["118", "119"])

    def test_a_lapsed_hold_no_longer_hides_the_patient(self):
        from datetime import datetime, timedelta
        ps.record_presence("118", "MARS", client_id="LAPTOP-A", at=datetime.now() - timedelta(seconds=ps.ACTIVE_WINDOW_SECONDS + 10))
        self.assertEqual(self.ids(self.sync("LAPTOP-B", view="", version=0)), ["118", "119"])


class RaspberryPiTests(unittest.TestCase):
    """sender_rapberryPI.py speaks the server's current protocol, and agent.py can run on top of it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "patients"
        self.root.mkdir()
        saved = (pi.ROOT_DIR, pi.PATIENTS_FILE, pi.server_request)
        pi.ROOT_DIR, pi.PATIENTS_FILE = self.root, Path(self.tmp.name) / "patients.json"
        self.requests = []
        self.reply = {"success": True, "claimed": True, "in_use_by": None}
        self.error = None

        def fake(header, timeout=30):
            self.requests.append(header)
            if self.error:
                raise self.error
            return self.reply

        pi.server_request = fake
        self.addCleanup(lambda: (setattr(pi, "ROOT_DIR", saved[0]), setattr(pi, "PATIENTS_FILE", saved[1]), setattr(pi, "server_request", saved[2])))

    def test_claim_uses_the_servers_claim_user_with_the_pis_own_id(self):
        self.assertEqual(pi.claim_patient("118"), (True, ""))
        self.assertEqual(self.requests[0]["action"], "claim_user")
        self.assertEqual(self.requests[0]["client_id"], pi.CLIENT_ID)
        self.assertEqual((self.requests[0]["device_id"], self.requests[0]["user_id"]), (pi.DEVICE_ID, "118"))

    def test_claim_refused_says_who_has_the_patient(self):
        self.reply = {"success": True, "claimed": False, "in_use_by": {"device": "PLUTO", "client": "PI-B", "seconds_ago": 4}}
        ok, message = pi.claim_patient("118")
        self.assertFalse(ok)
        self.assertIn("118 is being trained on PLUTO (laptop PI-B)", message)

    def test_claim_with_an_unreachable_server_keeps_the_pis_existing_behaviour(self):
        self.error = OSError("no route")
        ok, message = pi.claim_patient("118")
        self.assertFalse(ok)
        self.assertTrue(message.startswith("Cannot reach"))  # --login exits 3 on this, as before

    def test_release_and_check_use_the_servers_actions(self):
        pi.release_patient("118")
        pi._ask_server("check_user", "118")
        self.assertEqual([r["action"] for r in self.requests], ["release", "check_user"])
        self.assertTrue(all(r["client_id"] == pi.CLIENT_ID for r in self.requests))

    def test_sync_sends_the_view_and_keeps_the_one_it_is_given(self):
        self.reply = {"success": True, "up_to_date": False, "version": 7, "updated_at": "x", "patients": [{"user_id": "119"}], "view": "abc123"}
        pi.sync_patients()
        self.assertEqual(self.requests[0]["client_id"], pi.CLIENT_ID)
        self.assertEqual(self.requests[0]["view"], "")  # nothing held yet
        self.assertEqual(pi.local_view(), "abc123")
        self.reply = {"success": True, "up_to_date": True, "version": 7}
        pi.sync_patients()
        self.assertEqual(self.requests[1]["view"], "abc123")  # sent back, so the server can tell the list is current

    def test_the_agent_can_find_the_held_patients_sessions_file(self):
        (self.root / "AG1").mkdir()
        (self.root / "AG1" / "sessions.csv").write_text("a")
        self.assertEqual(pi.sessions_file_for("AG1"), self.root / "AG1" / "sessions.csv")
        self.assertIsNone(pi.sessions_file_for(None))
        self.assertEqual(pi._load_csv_files()[0], self.root / "AG1" / "sessions.csv")

    def test_agent_loads_the_pi_module_and_it_has_everything_the_agent_needs(self):
        module = agent_mod.load_sender("sender_rapberryPI")
        for name in ("DEVICE_ID", "CLIENT_ID", "PatientInUse", "_ask_server", "sync_patients", "listen_for_nudge", "sessions_file_for"):
            self.assertTrue(hasattr(module, name), name)

    def test_a_pi_needs_only_two_files_the_agent_finds_the_pi_sender_on_its_own(self):
        import shutil
        import subprocess
        here = Path(__file__).parent
        with tempfile.TemporaryDirectory() as folder:
            for name in ("agent.py", "sender_rapberryPI.py"):  # what you copy to a Pi: no sender.py, no launcher
                shutil.copy(here / name, folder)
            out = subprocess.run([sys.executable, "-c", "import agent; print(agent.sender.__name__)"], cwd=folder, capture_output=True, text=True, timeout=30)
        self.assertEqual(out.stdout.strip(), "sender_rapberryPI", out.stderr)

    def test_a_laptop_with_both_files_uses_sender_py_unless_told_otherwise(self):
        import subprocess
        here = Path(__file__).parent
        default = subprocess.run([sys.executable, "-c", "import agent; print(agent.sender.__name__)"], cwd=here, capture_output=True, text=True, timeout=30)
        forced = subprocess.run([sys.executable, "-c", "import sys; sys.argv = ['agent.py', '--sender', 'sender_rapberryPI']; import agent; print(agent.sender.__name__)"], cwd=here, capture_output=True, text=True, timeout=30)
        self.assertEqual(default.stdout.strip(), "sender", default.stderr)
        self.assertEqual(forced.stdout.strip(), "sender_rapberryPI", forced.stderr)

    def test_the_agent_on_a_pi_watches_only_the_held_patients_file(self):
        for pid in ("AG1", "AG2"):
            (self.root / pid).mkdir()
            (self.root / pid / "sessions.csv").write_text("a")
        saved = agent_mod.sender
        agent_mod.sender = pi
        self.addCleanup(lambda: setattr(agent_mod, "sender", saved))
        server = FakeServer()
        agent = agent_mod.Agent(ask=server.ask, sync=lambda: None, run=lambda fn: fn(), debounce=0)
        self.addCleanup(agent.shutdown)

        self.assertFalse(agent.check_sessions_file())  # nobody held: nothing to watch
        agent.start_session("AG1")
        claims = server.actions().count("claim_user")
        self.assertFalse(agent.check_sessions_file())  # first look at AG1's file only records it
        (self.root / "AG2" / "sessions.csv").write_text("another patient's trial")  # not the held patient
        self.assertFalse(agent.check_sessions_file())
        (self.root / "AG1" / "sessions.csv").write_text("a trial ended")
        os.utime(self.root / "AG1" / "sessions.csv", (2_000_000_000, 2_000_000_000))
        self.assertTrue(agent.check_sessions_file())
        self.assertEqual(server.actions().count("claim_user"), claims + 1)


if __name__ == "__main__":
    unittest.main()
