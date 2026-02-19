#!/usr/bin/env python3
"""Native messaging host for Agentobox theme bridge.

Reads /tmp/abox-theme.json when the Firefox extension requests it,
returns the tokens over the native messaging protocol (length-prefixed JSON).
"""

import json
import struct
import sys

THEME_PATH = "/tmp/abox-theme.json"


def read_message():
    raw = sys.stdin.buffer.read(4)
    if not raw or len(raw) < 4:
        return None
    length = struct.unpack("=I", raw)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data)


def send_message(msg):
    encoded = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


while True:
    msg = read_message()
    if msg is None:
        break
    if msg.get("cmd") == "read":
        try:
            with open(THEME_PATH) as f:
                tokens = json.load(f)
            send_message({"tokens": tokens})
        except Exception:
            send_message({"tokens": None})
