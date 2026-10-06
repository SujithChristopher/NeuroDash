"""Copies the assessment sender code from assessment_send.py into sender.py and sender_rapberryPI.py.

    python embed_assessment.py          (from this folder)

Each sender must stay a single file that works on its own, so the code is embedded instead of imported. The block between
"# --- BEGIN assessment sender" and "# --- END assessment sender ---" is replaced; on the first run it is inserted just before
the  if __name__ == "__main__":  line.
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SENDERS = ["sender.py", "sender_rapberryPI.py"]
BLOCK = re.compile(r"# --- BEGIN assessment sender.*?# --- END assessment sender ---\n", re.DOTALL)


def canonical_block():
    text = (HERE / "assessment_send.py").read_text(encoding="utf-8").replace("\r\n", "\n")
    match = BLOCK.search(text)

    if not match:
        raise SystemExit("assessment_send.py has no BEGIN/END markers.")

    return match.group(0)


def embedded_block(path):
    text = (HERE / path).read_text(encoding="utf-8").replace("\r\n", "\n")
    match = BLOCK.search(text)
    return match.group(0) if match else None


def embed(path, block):
    file = HERE / path
    raw = file.read_text(encoding="utf-8")
    crlf = "\r\n" in raw
    text = raw.replace("\r\n", "\n")

    if BLOCK.search(text):
        text = BLOCK.sub(lambda _: block, text, count=1)
    else:
        marker = 'if __name__ == "__main__":'

        if marker not in text:
            raise SystemExit(f"{path} has no main block to insert before.")

        text = text.replace(marker, block + "\n\n" + marker, 1)

    file.write_text(text.replace("\n", "\r\n") if crlf else text, encoding="utf-8", newline="")


if __name__ == "__main__":
    block = canonical_block()

    for sender in SENDERS:
        embed(sender, block)
        print(f"{sender}: assessment sender code updated")

    sys.exit(0)
