import os
import pathlib
import signal
import subprocess
import tempfile
import time

root = pathlib.Path.cwd()
output = pathlib.Path(tempfile.mkdtemp(prefix='client-crash-', dir=os.environ['MF_CRASH_OUTPUT']))
print(f'Evidence: {output}', flush=True)
scenario = os.environ.get('MEDIFLOW_CHAT_WITHDRAW_SCENARIO')
assert scenario in ('crash-lost', 'crash-retired', 'crash-denied'), 'choose an explicit synthetic crash scenario'
env = os.environ | {'MEDIFLOW_DATA_DIR': str(output)}
for name, filename in {
    'CONFIG': 'config.json', 'PIN_BARRIER': 'pin-pending', 'PIN_RELEASE': 'pin-release',
    'REVOKE_RESULT': 'revoke.json', 'RESULT': 'effects.json', 'KILL_READY': 'kill-ready',
    'COMMAND': 'command-id', 'OBSERVED': 'observed.json',
}.items():
    env['REVIEW_' + name] = str(output / filename)
node = os.environ.get('MF_NODE_BINARY', 'node')
assert subprocess.check_output([node, '--version'], text=True).strip() == 'v24.18.0'
binary = os.environ['MF_CRASH_BINARY']


def wait(path, process, timeout=40):
    deadline = time.monotonic() + timeout
    while not pathlib.Path(path).exists():
        if process.poll() is not None:
            raise RuntimeError(f'process exited {process.returncode}; see {output}')
        if time.monotonic() > deadline:
            raise RuntimeError('timeout waiting for ' + path)
        time.sleep(.01)


children = []
with (output / 'host.log').open('x') as host_log, (output / 'client-before-crash.log').open('x') as first_log, (output / 'client-reopened.log').open('x') as second_log:
    host = subprocess.Popen([node, '--import', './scripts/register-strip-types-loader.mjs', 'scripts/chat-therapy-withdraw-host.ts'], env=env, stdout=host_log, stderr=subprocess.STDOUT)
    children.append(host)
    try:
        wait(env['REVIEW_CONFIG'], host)
        arguments = [binary, 'crash_recovery_retains_reference_and_true_outcome', '--ignored', '--nocapture']
        first = subprocess.Popen(arguments, env=env | {'REVIEW_PHASE': 'send'}, stdout=first_log, stderr=subprocess.STDOUT)
        children.append(first)
        wait(env['REVIEW_KILL_READY'], first)
        first.kill()
        assert first.wait() == -signal.SIGKILL
        print('first client killed: SIGKILL', flush=True)
        second = subprocess.run(arguments, env=env | {'REVIEW_PHASE': 'recover'}, stdout=second_log, stderr=subprocess.STDOUT, timeout=40)
        if second.returncode:
            raise RuntimeError(f'recovery assertion failed; see {output}')
        print((output / 'observed.json').read_text(), flush=True)
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=4)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
