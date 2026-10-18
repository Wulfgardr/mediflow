#!/usr/bin/env python3
"""Run an unchanged command; reap only its already-terminated adopted children."""
import ctypes
import datetime
import json
import os
import pathlib
import subprocess
import sys
import time

receipt_path, *command = sys.argv[1:]
if not command:
    raise SystemExit('usage: run-with-subreaper.py RECEIPT COMMAND [ARG ...]')
libc = ctypes.CDLL(None, use_errno=True)
# /usr/include/linux/prctl.h: PR_SET_CHILD_SUBREAPER = 36.
if libc.prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER')
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
process = subprocess.Popen(command)
reaped = []

def collect_terminated():
    # waitpid(-1) is restricted by the kernel to this process's children.
    # Without WUNTRACED/WCONTINUED, a nonzero result is a terminated child.
    while True:
        try:
            pid, status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return False
        if pid == 0:
            return True  # At least one owned child is still running.
        if pid == process.pid:
            process.returncode = os.waitstatus_to_exitcode(status)
        else:
            reaped.append({'pid': pid, 'waitStatus': status,
                           'exitCode': os.waitstatus_to_exitcode(status)})

while process.returncode is None:
    collect_terminated()
    time.sleep(0.005)
remaining = collect_terminated()
receipt = {'schemaVersion': 1, 'runId': 'r08ef12a', 'command': command,
           'startedAt': started, 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'commandExitCode': process.returncode, 'signalsSentByWrapper': 0,
           'reapedAdoptedChildren': reaped, 'hasRemainingOwnedChildren': remaining}
pathlib.Path(receipt_path).write_text(json.dumps(receipt, indent=2) + '\n')
sys.exit(process.returncode)
