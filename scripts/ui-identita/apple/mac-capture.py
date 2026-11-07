from pathlib import Path
import subprocess, os, json, signal, time
scratch=Path('/Volumes/Vision/mf-ui-identita-20261107-scratch/apple')
app=scratch/'MacDerivedData/Build/Products/Debug/MediFlow.app'
cmd=['open','-n',str(app),'--env','MEDIFLOW_APPLE_DEV_SKIP_KEYCHAIN=1','--env','MEDIFLOW_HOMEBASE_SERVER_URL=https://127.0.0.1:9','--env','MEDIFLOW_HOMEBASE_AUTOLOGIN=0','--env','MEDIFLOW_HOMEBASE_AUTOLOAD_PATIENTS=0']
subprocess.run(cmd,check=True)
time.sleep(3)
result=subprocess.run(['pgrep','-f','^'+str(app/'Contents/MacOS/MediFlow')],capture_output=True,text=True)
if not result.stdout.strip(): raise SystemExit('Processo Mac non trovato')
pid=result.stdout.strip().splitlines()[0]
try:
    result=subprocess.run(['swift','-module-cache-path',str(scratch/'swift-module-cache'),'scripts/ui-identita/apple/windows.swift',pid],capture_output=True,text=True,check=True)
    (scratch/'mac-windows.json').write_text(result.stdout)
    windows=json.loads(result.stdout)
    command=['screencapture','-x']
    if windows: command += ['-l',str(windows[0]['kCGWindowNumber'])]
    command += [str(scratch/'mac-lock-attempt.png')]
    result=subprocess.run(command,capture_output=True,text=True)
    (scratch/'mac-capture.log').write_text(f'PID {pid}\n{command}\nexit {result.returncode}\n{result.stdout}{result.stderr}')
finally: os.kill(int(pid),signal.SIGTERM)
