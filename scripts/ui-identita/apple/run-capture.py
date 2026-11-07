from pathlib import Path
import subprocess, sys, re, os, time

scratch = Path(os.environ.get('MEDIFLOW_UI_APPLE_SCRATCH', '/Volumes/Vision/mf-ui-identita-20261107-scratch/apple'))
out = Path(os.environ.get('MEDIFLOW_UI_CAPTURE_OUTPUT', '/Users/leonardopegollo/Antigravity/mf-ui-identita-20261107'))
device, udid = sys.argv[1:]
result = scratch / f'{device}-{time.strftime("%Y%m%d-%H%M%S")}.xcresult'
cmd = ['xcodebuild', '-project', str(scratch/'capture-project/MediFlowAppleApp.xcodeproj'), '-scheme', 'MediFlowMobileApp', '-configuration', 'Debug', '-destination', f'platform=iOS Simulator,id={udid}', '-derivedDataPath', str(scratch/'CaptureDerivedData'), '-clonedSourcePackagesDirPath', str(scratch/'packages'), '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1', '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '900', '-maximum-test-execution-time-allowance', '1000', '-resultBundlePath', str(result), 'CODE_SIGNING_ALLOWED=NO', 'test']
(out/device).mkdir(parents=True, exist_ok=True)
with (scratch/f'{device}-test.log').open('w') as log:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in proc.stdout:
        log.write(line); log.flush()
        appearance = re.search(r'APPEARANCE (light|dark)', line)
        if appearance:
            subprocess.run(['xcrun', 'simctl', 'ui', udid, 'appearance', appearance[1]], check=True, timeout=40)
        marker = re.search(r'CAPTURE_READY ([\w-]+)', line)
        if marker:
            name = marker[1]
            print(f'{device}: {name}', flush=True)
            subprocess.run(['xcrun', 'simctl', 'bootstatus', udid, '-b'], check=True, timeout=180)
            for attempt in range(2):
                try:
                    snap = subprocess.run(['xcrun', 'simctl', 'io', udid, 'screenshot', str(out/device/f'{name}.png')], capture_output=True, text=True, timeout=40)
                    log.write(snap.stdout+snap.stderr); log.flush()
                    if snap.returncode == 0: break
                except subprocess.TimeoutExpired:
                    log.write('simctl screenshot timeout\n'); log.flush()
            else:
                proc.terminate()
                raise SystemExit('Cattura fallita: '+name)
        elif 'error:' in line or 'Test Case' in line or '** TEST' in line:
            print(line.strip(), flush=True)
    status = proc.wait()
(scratch/f'{device}-exit-code.txt').write_text(str(status)+'\n')
raise SystemExit(status)
