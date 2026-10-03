"""Tests for the "is this patient in use?" feature.

    python -m unittest localserver/test_presence.py        (from the project root)
    python -m unittest test_presence                       (from this folder)

They use a temporary data folder, never D:\\NeuroDashData.
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import patients_store as ps   # noqa: E402
import s2                     # noqa: E402
import sender                 # noqa: E402
import threading              # noqa: E402


class FakeConnection:
    """Captures what the server sends, in the length-prefixed JSON format the laptops read."""

    def __init__(self):
        self.sent = b""

    def sendall(self, data):
        self.sent += data

    def reply(self):
        length = int.from_bytes(self.sent[:4], "big")
        return json.loads(self.sent[4:4 + length].decode("utf-8"))


class PresenceTests(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.original = ps.PRESENCE_FILE
        ps.PRESENCE_FILE = Path(self.tmp.name) / "presence.json"
        self.addCleanup(lambda: setattr(ps, "PRESENCE_FILE", self.original))
        ps.NUDGE_ENABLED = False  # tests must not broadcast on the real network

    def ask(self, action, device, user, client=None):
        conn = FakeConnection()
        header = {"user_id": user}
        if client:
            header["client_id"] = client
        s2.handle_presence(conn, device, header, action)
        return conn.reply()

    # ---- patients_store ------------------------------------------------------------------

    def test_free_when_nobody_has_uploaded(self):
        self.assertIsNone(ps.presence_for("118"))

    def test_in_use_right_after_an_upload(self):
        ps.record_presence("118", "MARS01", "10.0.0.5")
        who = ps.presence_for("118")
        self.assertEqual(who["device"], "MARS01")
        self.assertLessEqual(who["seconds_ago"], 2)

    def test_free_again_after_the_idle_window(self):
        long_ago = datetime.now() - timedelta(seconds=ps.ACTIVE_WINDOW_SECONDS + 30)
        ps.record_presence("118", "MARS01", at=long_ago)
        self.assertIsNone(ps.presence_for("118"))

    def test_still_in_use_just_inside_the_window(self):
        recent = datetime.now() - timedelta(seconds=ps.ACTIVE_WINDOW_SECONDS - 30)
        ps.record_presence("118", "MARS01", at=recent)
        self.assertIsNotNone(ps.presence_for("118"))

    def test_each_patient_is_independent(self):
        ps.record_presence("118", "MARS01")
        self.assertIsNotNone(ps.presence_for("118"))
        self.assertIsNone(ps.presence_for("113"))

    def test_the_latest_upload_wins(self):
        ps.record_presence("118", "MARS01")
        ps.record_presence("118", "PLUTO01")
        self.assertEqual(ps.presence_for("118")["device"], "PLUTO01")

    def test_old_entries_are_forgotten(self):
        stale = datetime.now() - timedelta(seconds=ps.PRESENCE_KEEP_SECONDS + 60)
        ps.record_presence("old", "MARS01", at=stale)
        ps.record_presence("new", "PLUTO01")
        data = json.loads(ps.PRESENCE_FILE.read_text())
        self.assertEqual(list(data), ["new"])

    def test_clear_only_by_the_holder(self):
        ps.record_presence("118", "MARS01")
        self.assertFalse(ps.clear_presence("118", "PLUTO01"))
        self.assertIsNotNone(ps.presence_for("118"))
        self.assertTrue(ps.clear_presence("118", "MARS01"))
        self.assertIsNone(ps.presence_for("118"))
        self.assertFalse(ps.clear_presence("118", "MARS01"))

    def test_a_corrupt_presence_file_is_reported_not_silently_overwritten(self):
        ps.PRESENCE_FILE.write_text("{ not json")
        with self.assertRaises(ValueError):
            ps.presence_for("118")

    # ---- the check_user / release requests a laptop sends ---------------------------------

    def test_check_reports_free(self):
        r = self.ask("check_user", "PLUTO01", "118")
        self.assertTrue(r["success"])
        self.assertFalse(r["in_use"])
        self.assertIsNone(r["in_use_by"])
        self.assertEqual(r["window_seconds"], ps.ACTIVE_WINDOW_SECONDS)

    def test_check_tells_another_laptop_the_patient_is_in_use(self):
        ps.record_presence("118", "MARS01")
        r = self.ask("check_user", "PLUTO01", "118")
        self.assertTrue(r["in_use"])
        self.assertFalse(r["own_session"])
        self.assertEqual(r["in_use_by"]["device"], "MARS01")
        self.assertIn("seconds_ago", r["in_use_by"])

    def test_a_laptop_is_never_blocked_by_its_own_session(self):
        ps.record_presence("118", "MARS01")
        r = self.ask("check_user", "MARS01", "118")
        self.assertFalse(r["in_use"])
        self.assertTrue(r["own_session"])

    def test_check_is_free_once_the_session_has_gone_quiet(self):
        ps.record_presence("118", "MARS01", at=datetime.now() - timedelta(seconds=ps.ACTIVE_WINDOW_SECONDS + 5))
        self.assertFalse(self.ask("check_user", "PLUTO01", "118")["in_use"])

    def test_release_frees_the_patient_immediately_for_everyone(self):
        ps.record_presence("118", "MARS01")
        self.assertTrue(self.ask("release", "MARS01", "118")["released"])
        self.assertFalse(self.ask("check_user", "PLUTO01", "118")["in_use"])

    def test_another_laptop_cannot_release_someone_elses_session(self):
        ps.record_presence("118", "MARS01")
        self.assertFalse(self.ask("release", "PLUTO01", "118")["released"])
        self.assertTrue(self.ask("check_user", "PLUTO01", "118")["in_use"])

    def test_user_id_is_required_and_cleaned(self):
        conn = FakeConnection()
        s2.handle_presence(conn, "PLUTO01", {"user_id": "  "}, "check_user")
        self.assertFalse(conn.reply()["success"])

        ps.record_presence("118", "MARS01")
        # path-ish input is reduced to a safe id, so it can never look up anything else
        self.assertEqual(self.ask("check_user", "PLUTO01", "1/1\\8")["user_id"], "118")


class ClaimTests(PresenceTests):
    """claim_user: the login-time lock. (Inherits the helpers; the parent's tests are not repeated.)"""

    def run(self, result=None):
        # Only the tests defined here, not the inherited ones.
        if not self._testMethodName.startswith("test_claim"):
            return None
        return super().run(result)

    def test_claim_locks_a_free_patient_straight_away(self):
        r = self.ask("claim_user", "MARS01", "118")
        self.assertTrue(r["success"])
        self.assertTrue(r["claimed"])
        self.assertIsNone(r["in_use_by"])
        # no upload has happened yet, but other laptops already see the patient as in use
        self.assertTrue(self.ask("check_user", "PLUTO01", "118")["in_use"])
        self.assertEqual(ps.presence_for("118")["device"], "MARS01")

    def test_claim_is_refused_while_another_laptop_holds_the_patient(self):
        self.ask("claim_user", "MARS01", "118")
        r = self.ask("claim_user", "PLUTO01", "118")
        self.assertFalse(r["claimed"])
        self.assertEqual(r["in_use_by"]["device"], "MARS01")
        self.assertEqual(ps.presence_for("118")["device"], "MARS01")  # the first hold is untouched

    def test_claim_by_the_holder_just_renews(self):
        old = datetime.now() - timedelta(seconds=ps.ACTIVE_WINDOW_SECONDS - 5)
        ps.record_presence("118", "MARS01", at=old)
        self.assertTrue(self.ask("claim_user", "MARS01", "118")["claimed"])
        self.assertLessEqual(ps.presence_for("118")["seconds_ago"], 2)

    def test_claim_works_again_once_the_hold_has_lapsed(self):
        ps.record_presence("118", "MARS01", at=datetime.now() - timedelta(seconds=ps.ACTIVE_WINDOW_SECONDS + 5))
        r = self.ask("claim_user", "PLUTO01", "118")
        self.assertTrue(r["claimed"])
        self.assertEqual(ps.presence_for("118")["device"], "PLUTO01")

    def test_claim_works_after_release(self):
        self.ask("claim_user", "MARS01", "118")
        self.ask("release", "MARS01", "118")
        self.assertTrue(self.ask("claim_user", "PLUTO01", "118")["claimed"])

    def test_claim_needs_a_user_id_and_cleans_it(self):
        conn = FakeConnection()
        s2.handle_presence(conn, "MARS01", {"user_id": ""}, "claim_user")
        self.assertFalse(conn.reply()["success"])
        self.assertEqual(self.ask("claim_user", "MARS01", "1/1\\8")["user_id"], "118")

    def test_claim_is_independent_per_patient(self):
        self.ask("claim_user", "MARS01", "118")
        self.assertTrue(self.ask("claim_user", "PLUTO01", "113")["claimed"])


class LaptopIdentityTests(PresenceTests):
    """Two laptops can both be "MARS": the laptop's own client_id is what tells them apart."""

    def run(self, result=None):
        if not self._testMethodName.startswith("test_laptop"):
            return None
        return super().run(result)

    def test_laptop_two_laptops_of_the_same_device_type_cannot_share_a_patient(self):
        self.assertTrue(self.ask("claim_user", "MARS", "118", "LAPTOP-A")["claimed"])
        r = self.ask("claim_user", "MARS", "118", "LAPTOP-B")
        self.assertFalse(r["claimed"])
        self.assertEqual(r["in_use_by"]["client"], "LAPTOP-A")
        self.assertTrue(self.ask("check_user", "MARS", "118", "LAPTOP-B")["in_use"])

    def test_laptop_the_holder_can_renew_and_check_without_being_blocked(self):
        self.ask("claim_user", "MARS", "118", "LAPTOP-A")
        self.assertTrue(self.ask("claim_user", "MARS", "118", "LAPTOP-A")["claimed"])
        r = self.ask("check_user", "MARS", "118", "LAPTOP-A")
        self.assertFalse(r["in_use"])
        self.assertTrue(r["own_session"])

    def test_laptop_only_the_holder_can_release(self):
        self.ask("claim_user", "MARS", "118", "LAPTOP-A")
        self.assertFalse(self.ask("release", "MARS", "118", "LAPTOP-B")["released"])
        self.assertTrue(self.ask("check_user", "MARS", "118", "LAPTOP-B")["in_use"])
        self.assertTrue(self.ask("release", "MARS", "118", "LAPTOP-A")["released"])
        self.assertTrue(self.ask("claim_user", "MARS", "118", "LAPTOP-B")["claimed"])

    def test_laptop_an_upload_from_an_older_sender_keeps_the_laptop_identity(self):
        self.ask("claim_user", "MARS", "118", "LAPTOP-A")
        ps.record_presence("118", "MARS")  # an upload with no client_id
        self.assertEqual(ps.presence_for("118")["client"], "LAPTOP-A")
        self.assertFalse(self.ask("claim_user", "MARS", "118", "LAPTOP-B")["claimed"])

    def test_laptop_without_client_ids_falls_back_to_the_device_name(self):
        ps.record_presence("118", "MARS")
        self.assertTrue(self.ask("claim_user", "MARS", "118")["claimed"])  # same device name: treated as the same laptop
        self.assertFalse(self.ask("claim_user", "PLUTO", "118")["claimed"])

    def test_laptop_many_laptops_claiming_at_once_get_exactly_one_winner(self):
        wins = []

        def claim(i):
            ok, _ = ps.claim_presence("118", "MARS", client_id=f"LAPTOP-{i}")
            wins.append(ok)

        threads = [threading.Thread(target=claim, args=(i,)) for i in range(40)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sum(wins), 1)

    def test_laptop_the_window_comes_from_the_environment(self):
        import importlib, os
        os.environ["ACTIVE_WINDOW_SECONDS"] = "90"
        try:
            self.assertEqual(importlib.reload(ps).ACTIVE_WINDOW_SECONDS, 90)
        finally:
            del os.environ["ACTIVE_WINDOW_SECONDS"]
            importlib.reload(ps)
            ps.PRESENCE_FILE = Path(self.tmp.name) / "presence.json"


class HeartbeatTests(unittest.TestCase):
    """The sender keeps telling the server it is still playing; these use a fake server."""

    def setUp(self):
        self.calls = []
        self.replies = []
        self.original = sender._ask_server

        def fake(action, user_id):
            self.calls.append((action, user_id))
            return self.replies.pop(0) if self.replies else {"success": True, "claimed": True, "released": True}

        sender._ask_server = fake
        self.addCleanup(lambda: setattr(sender, "_ask_server", self.original))

    def test_hold_patient_claims_renews_while_held_and_releases(self):
        with sender.hold_patient("118", interval=0.02):
            import time
            time.sleep(0.15)
        actions = [a for a, _ in self.calls]
        self.assertEqual(actions[0], "claim_user")
        self.assertGreaterEqual(actions.count("claim_user"), 3)  # the first claim plus several renewals
        self.assertEqual(actions[-1], "release")

    def test_hold_patient_refuses_to_start_when_another_laptop_has_the_patient(self):
        self.replies = [{"success": True, "claimed": False, "in_use_by": {"device": "PLUTO", "seconds_ago": 4}}]
        with self.assertRaises(sender.PatientInUse) as ctx:
            with sender.hold_patient("118", interval=0.02):
                self.fail("must not start")
        self.assertEqual(ctx.exception.holder["device"], "PLUTO")
        self.assertNotIn("release", [a for a, _ in self.calls])  # never held, nothing to release

    def test_hold_patient_reports_when_the_patient_is_taken_over_mid_session(self):
        lost = []
        self.replies = [{"success": True, "claimed": True}, {"success": True, "claimed": False, "in_use_by": {"device": "MARS", "client": "OTHER"}}]
        with sender.hold_patient("118", on_lost=lost.append, interval=0.02) as hold:
            import time
            time.sleep(0.15)
            self.assertEqual(hold.lost["client"], "OTHER")
        self.assertEqual(lost[0]["client"], "OTHER")

    def test_an_unreachable_server_does_not_end_the_hold(self):
        # None = could not reach the server: keep playing and keep trying
        self.replies = [{"success": True, "claimed": True}, None, None]
        with sender.hold_patient("118", interval=0.02) as hold:
            import time
            time.sleep(0.15)
            self.assertIsNone(hold.lost)

    def test_hold_session_exit_codes(self):
        stop = threading.Event()
        threading.Timer(0.1, stop.set).start()
        self.assertEqual(sender.hold_session("118", interval=0.02, stop=stop), 0)
        self.assertEqual(self.calls[-1][0], "release")

        self.calls.clear()
        self.replies = [{"success": True, "claimed": False, "in_use_by": {"device": "PLUTO", "seconds_ago": 1}}]
        self.assertEqual(sender.hold_session("118", interval=0.02, stop=threading.Event()), 2)

        self.replies = [{"success": True, "claimed": True}, {"success": True, "claimed": False, "in_use_by": {"device": "MARS"}}]
        self.assertEqual(sender.hold_session("118", interval=0.02, stop=threading.Event()), 3)


if __name__ == "__main__":
    unittest.main()
