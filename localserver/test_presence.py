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

    def ask(self, action, device, user):
        conn = FakeConnection()
        s2.handle_presence(conn, device, {"user_id": user}, action)
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


if __name__ == "__main__":
    unittest.main()
