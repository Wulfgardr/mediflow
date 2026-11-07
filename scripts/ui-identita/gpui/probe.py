#!/usr/bin/env python3
"""Raccoglie esiti reali di Parallels senza cambiare licenza o configurazione."""
import argparse
import datetime
import json
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("evidence", type=pathlib.Path)
args = parser.parse_args()
args.evidence.mkdir(parents=True, exist_ok=True)
records = []


def run(argv):
    record = {"at": datetime.datetime.now().astimezone().isoformat(), "argv": argv}
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=45)
        record.update(exit=result.returncode, stdout=result.stdout, stderr=result.stderr)
    except subprocess.TimeoutExpired:
        record.update(error="timeout after 45 seconds")
    records.append(record)
    (args.evidence / "parallels-attempts.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n"
    )


run(["git", "rev-parse", "HEAD"])
run(["prlctl", "list", "-a"])
for vm, surface in [("Omarchy", "linux"), ("Windows 11", "windows")]:
    run(["prlctl", "start", vm])
    run(["prlctl", "exec", vm, "whoami"])
    run(["prlctl", "capture", vm, "--file", str(args.evidence / f"{surface}-attempt.png")])
    run(["prlctl", "stop", vm])
run(["prlctl", "list", "-a"])
run(["git", "status", "--short", "--untracked-files=all"])
print(args.evidence / "parallels-attempts.json")
