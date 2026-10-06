"""Tests for sending and receiving robotic assessments.

    python -m unittest test_assessment          (from this folder)

They use a temporary data folder and a loopback server, never D:\\NeuroDashData. The sample files are real PLUTO and MARS
assessments (tests/fixtures/assessment, without the 20 MB of raw trial data).
"""

import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import assessment_receive as receive  # noqa: E402
import assessment_send as send        # noqa: E402
import embed_assessment               # noqa: E402
import patients_store                 # noqa: E402
import s2                             # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "assessment"


def make_patient_folder(root, patient="AG10001", device="PLUTO", locked=True, timepoint="A0", limb="right"):
    """<root>/<patient>/<limb>/<TP>/ filled with a real sample, plus <patient>/<TP>.locked."""

    patient_dir = Path(root) / patient
    target = patient_dir / limb / timepoint
    shutil.copytree(FIXTURES / ("pluto" if device == "PLUTO" else "mars"), target)

    # a raw trial file, which is never sent by default
    (target / "ai37220_right_FPS_AROM_raw-20260917_143115.csv").write_text("systime,angle\n1,2\n", encoding="utf-8")

    if locked:
        shutil.copy(FIXTURES / "A0.locked", patient_dir / f"{timepoint}.locked")

    return patient_dir


class LoopbackServer:
    """The real s2.handle_device behind a loopback socket, saving into a temporary data folder."""

    def __init__(self, data_folder):
        self.data_folder = Path(data_folder)
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(5)
        self.address = self.sock.getsockname()
        self.running = True
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def loop(self):
        self.sock.settimeout(0.2)

        while self.running:
            try:
                connection, address = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return

            connection.settimeout(10)
            threading.Thread(target=s2.handle_device, args=(connection, address), daemon=True).start()

    def close(self):
        self.running = False
        self.sock.close()


class AssessmentTestCase(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.laptop = Path(self.tmp.name) / "laptop"
        self.data = Path(self.tmp.name) / "server"
        self.data.mkdir()
        self.state = Path(self.tmp.name) / "sent.json"

        self.original_folder = s2.DATA_FOLDER
        s2.DATA_FOLDER = self.data
        self.addCleanup(lambda: setattr(s2, "DATA_FOLDER", self.original_folder))
        patients_store.NUDGE_ENABLED = False

        self.server = LoopbackServer(self.data)
        self.addCleanup(self.server.close)

    def run_sender(self, device="PLUTO", **options):
        quiet = []
        return send.send_new_assessments(
            self.laptop, self.state, self.server.address, device, "TEST-LAPTOP", log=quiet.append, **options
        )

    def stored(self, patient="AG10001", device="PLUTO", limb="right", timepoint="A0"):
        return receive.package_folder(self.data, patient, device, limb, timepoint)


class FindingAndPackaging(AssessmentTestCase):

    def test_only_finished_timepoints_are_found(self):
        make_patient_folder(self.laptop, "DONE", locked=True)
        make_patient_folder(self.laptop, "BUSY", locked=False)

        self.assertEqual([a["patient"] for a in send.find_assessments(self.laptop)], ["DONE"])
        self.assertEqual({a["patient"] for a in send.find_assessments(self.laptop, require_lock=False)}, {"DONE", "BUSY"})

    def test_a_lock_beside_the_timepoint_or_inside_it_counts_too(self):
        folder = make_patient_folder(self.laptop, "P1", locked=False)
        (folder / "right" / "A0" / "a0.LOCKED").write_text("Locked on 2026-07-07 12:30:55")
        self.assertEqual(len(send.find_assessments(self.laptop)), 1)

    def test_raw_trial_files_are_left_out_unless_asked_for(self):
        make_patient_folder(self.laptop)
        a = send.find_assessments(self.laptop)[0]
        names = [n for n, _ in send.assessment_files(a)]
        self.assertFalse(any("raw" in n for n in names))
        self.assertIn("A0.locked", names)
        self.assertIn("ai37220_right_A0_details.json", names)
        self.assertTrue(any("raw" in n for n, _ in send.assessment_files(a, include_raw=True)))

    def test_the_fingerprint_changes_exactly_when_the_data_does(self):
        folder = make_patient_folder(self.laptop)
        a = send.find_assessments(self.laptop)[0]
        before = send.assessment_fingerprint(send.assessment_files(a))
        self.assertEqual(before, send.assessment_fingerprint(send.assessment_files(a)))

        (folder / "right" / "A0" / "ai37220_right_A0_protocol.csv").write_text("changed", encoding="utf-8")
        self.assertNotEqual(before, send.assessment_fingerprint(send.assessment_files(a)))

    def test_a_changed_raw_file_does_not_count_when_raw_is_not_sent(self):
        folder = make_patient_folder(self.laptop)
        a = send.find_assessments(self.laptop)[0]
        before = send.assessment_fingerprint(send.assessment_files(a))
        (folder / "right" / "A0" / "ai37220_right_FPS_AROM_raw-20260917_143115.csv").write_text("more,raw\n", encoding="utf-8")
        self.assertEqual(before, send.assessment_fingerprint(send.assessment_files(a)))

    def test_the_senders_carry_exactly_the_code_in_assessment_send(self):
        block = embed_assessment.canonical_block()

        for sender in embed_assessment.SENDERS:
            self.assertEqual(embed_assessment.embedded_block(sender), block, f"{sender} is out of date: run embed_assessment.py")


class SendingToTheServer(AssessmentTestCase):

    def test_a_finished_assessment_is_sent_and_stored_for_the_dashboard(self):
        make_patient_folder(self.laptop)
        result = self.run_sender()

        self.assertEqual(result["sent"], ["AG10001 right A0"])
        folder = self.stored()
        self.assertTrue((folder / "ai37220_right_A0_details.json").exists())
        self.assertTrue((folder / "A0.locked").exists())
        self.assertFalse(list(folder.rglob("*raw*")))  # the raw stream stayed on the laptop
        self.assertEqual(receive.stored_fingerprint(folder), send.assessment_fingerprint(send.assessment_files(send.find_assessments(self.laptop)[0])))

    def test_nothing_is_sent_again_while_nothing_changed(self):
        make_patient_folder(self.laptop)
        self.run_sender()
        again = self.run_sender()
        self.assertEqual((again["sent"], again["unchanged"], again["skipped"]), ([], [], 1))

    def test_unfinished_assessments_are_not_sent(self):
        make_patient_folder(self.laptop, locked=False)
        self.assertEqual(self.run_sender()["sent"], [])
        self.assertFalse((self.data / "AG10001").exists())

    def test_new_data_in_a_sent_timepoint_is_sent_again_and_the_old_copy_kept(self):
        folder = make_patient_folder(self.laptop)
        self.run_sender()
        (folder / "right" / "A0" / "ai37220_right_A0_protocol.csv").write_text("session,mechanism\nnew,FPS\n", encoding="utf-8")

        self.assertEqual(self.run_sender()["sent"], ["AG10001 right A0"])
        self.assertIn("new,FPS", (self.stored() / "ai37220_right_A0_protocol.csv").read_text(encoding="utf-8"))
        self.assertEqual(len(list((self.stored().parent / "_backup").iterdir())), 1)

    def test_a_laptop_that_lost_its_memory_does_not_resend_what_the_server_already_has(self):
        make_patient_folder(self.laptop)
        self.run_sender()
        self.state.unlink()

        again = self.run_sender()
        self.assertEqual((again["sent"], again["unchanged"]), ([], ["AG10001 right A0"]))  # only the fingerprint travelled

    def test_each_timepoint_and_limb_is_its_own_package(self):
        make_patient_folder(self.laptop, timepoint="A0")
        patient = make_patient_folder(self.laptop, timepoint="A1")
        shutil.copytree(patient / "right" / "A1", patient / "left" / "A1")

        result = self.run_sender()
        self.assertEqual(sorted(result["sent"]), ["AG10001 left A1", "AG10001 right A0", "AG10001 right A1"])
        self.assertTrue(self.stored(timepoint="A1", limb="left").exists())

    def test_a_mars_assessment_is_sent_the_same_way(self):
        make_patient_folder(self.laptop, patient="AG20001", device="MARS")
        self.assertEqual(self.run_sender(device="MARS")["sent"], ["AG20001 right A0"])
        self.assertTrue((self.stored("AG20001", "MARS") / "session1" / "ml-rom.csv").exists())

    def test_an_unreachable_server_is_reported_and_retried_next_time(self):
        make_patient_folder(self.laptop)
        self.server.close()
        result = send.send_new_assessments(self.laptop, self.state, self.server.address, "PLUTO", "L", log=lambda *_: None)
        self.assertEqual(result["failed"], ["AG10001 right A0"])
        self.assertFalse(self.state.exists())  # nothing was remembered as sent

    def test_a_missing_assessment_folder_is_not_an_error(self):
        result = send.send_new_assessments(Path(self.tmp.name) / "nowhere", self.state, self.server.address, "PLUTO", "L", log=lambda *_: None)
        self.assertEqual(result, {"sent": [], "unchanged": [], "skipped": 0, "failed": []})


class ServerRefusals(AssessmentTestCase):

    def ask(self, **over):
        header = {"action": "assessment", "device_id": "PLUTO", "client_id": "X", "patient_id": "AG1", "limb": "right",
                  "timepoint": "A0", "fingerprint": "a" * 64, "file_size": 100}
        header.update(over)
        data = json.dumps(header).encode("utf-8")

        with socket.create_connection(self.server.address, timeout=5) as c:
            c.sendall(len(data).to_bytes(4, "big") + data)
            size = int.from_bytes(c.recv(4), "big")
            return json.loads(c.recv(size).decode("utf-8"))

    def test_the_header_is_checked(self):
        for bad in ({"limb": "middle"}, {"timepoint": "Z"}, {"timepoint": "../A0"}, {"fingerprint": "xyz"}, {"file_size": 0}, {"file_size": 10**10}, {"patient_id": "///"}):
            reply = self.ask(**bad)
            self.assertFalse(reply["success"], bad)

    def test_an_unknown_device_is_refused(self):
        self.assertFalse(self.ask(device_id="TOASTER")["success"])

    def test_a_good_header_is_asked_for_the_package(self):
        self.assertEqual(self.ask(), {"success": True, "send": True})
        time.sleep(0.4)  # the server notices the laptop hung up and removes its partial file

    def test_the_patient_folder_name_cannot_escape_the_data_folder(self):
        folder = receive.package_folder(self.data, receive.clean_id("../../etc"), "PLUTO", "right", "A0")
        self.assertEqual(self.data.resolve(), folder.resolve().parents[2])


class SafeUnpacking(unittest.TestCase):

    def zipped(self, names):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "p.zip"

        with zipfile.ZipFile(path, "w") as archive:
            for name in names:
                archive.writestr(name, "x")

        return path, Path(tmp.name) / "out"

    def test_paths_that_escape_are_refused(self):
        for name in ("../evil.csv", "a/../../evil.csv", "/abs.csv", "C:/win.csv"):
            path, out = self.zipped([name])
            with self.assertRaises(receive.AssessmentError, msg=name):
                receive.safe_extract(path, out)

    def test_only_assessment_file_types_are_accepted(self):
        path, out = self.zipped(["run.exe"])
        with self.assertRaises(receive.AssessmentError):
            receive.safe_extract(path, out)

    def test_a_good_package_is_unpacked_with_its_folders_and_the_servers_fingerprint_is_not_overwritten(self):
        path, out = self.zipped(["details.json", "session1/ml-rom.csv", ".fingerprint"])
        receive.safe_extract(path, out)
        self.assertTrue((out / "session1" / "ml-rom.csv").exists())
        self.assertFalse((out / ".fingerprint").exists())

    def test_an_empty_package_is_refused(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "e.zip"
        zipfile.ZipFile(path, "w").close()

        with self.assertRaises(receive.AssessmentError):
            receive.install(path, tmp.name, "P", "PLUTO", "right", "A0", "a" * 64, tmp.name)


if __name__ == "__main__":
    unittest.main()
