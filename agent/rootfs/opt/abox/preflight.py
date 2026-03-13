#!/usr/bin/env python3
"""Pre-flight validation for s6 service run scripts.

Usage from bash run scripts:
    python3 /opt/abox/preflight.py --service svc-relay --env ABOX_CALLBACK_URL --file /home/agent/.relay_env

Checks all requirements. On failure: emits structured JSON via abox_logging
and exits 1. The bash wrapper catches the non-zero exit and does ``exit 0``
so s6 won't restart the service. On success: exits 0 silently.
"""

import argparse
import os
import sys

# abox_logging lives in /opt/abox/ alongside this file
sys.path.insert(0, os.path.dirname(__file__))
from abox_logging import setup

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", required=True, help="Service name for log context")
    parser.add_argument("--env", action="append", default=[], help="Required env var (repeatable)")
    parser.add_argument("--file", action="append", default=[], help="Required file path (repeatable)")
    args = parser.parse_args()

    log = setup(args.service)
    failures = []

    for var in args.env:
        if not os.environ.get(var):
            failures.append(("missing_env", var))

    for path in args.file:
        if not os.path.exists(path):
            failures.append(("missing_file", path))

    if failures:
        for reason, detail in failures:
            log.error("preflight_failed", extra={"reason": reason, "detail": detail})
        sys.exit(1)


if __name__ == "__main__":
    main()
