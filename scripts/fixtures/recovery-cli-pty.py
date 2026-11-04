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
    # Su Linux la lettura dà EIO appena il figlio chiude il terminale, prima che il processo sia
    # raccolto: si aspetta l'uscita fino alla scadenza invece di leggere subito lo stato.
    try:
        child.wait(timeout=max(0.0, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        child.kill()
        raise RuntimeError('CLI recovery timeout')
    sys.stdout.write(output.decode())
    sys.exit(child.wait())
finally:
    if child.poll() is None:
        child.kill()
    child.wait()
    os.close(master)
