import json, os, pty, select, subprocess, sys, time
config = json.loads(sys.stdin.read())
master, slave = pty.openpty()
child = subprocess.Popen(config['command'], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
output = b''
sent = False
deadline = time.monotonic() + 60
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], .1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            if not sent and b'Chiave di recupero (non visibile): ' in output:
                os.write(master, (config['key'] + '\n').encode())
                sent = True
        if child.poll() is not None:
            break
    if child.poll() is None:
        child.kill()
        raise RuntimeError('CLI recovery timeout')
    sys.stdout.write(output.decode())
    sys.exit(child.wait())
finally:
    if child.poll() is None:
        child.kill()
    child.wait()
    os.close(master)
