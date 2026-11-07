from pathlib import Path
import shutil, subprocess, base64
root = Path(__file__).resolve().parents[3]
scratch = Path('/Volumes/Vision/mf-ui-identita-20261107-scratch/apple')
project = scratch / 'capture-project'
project.mkdir(exist_ok=True)
for name in ['Sources', 'Assets.xcassets']:
    shutil.copytree(root/'native/MediFlowAppleApp'/name, project/name, dirs_exist_ok=True)
(project/'Tests').mkdir(exist_ok=True)
config = scratch/'launch.json'
launch = config.read_bytes() if config.exists() else b'{}'
source = Path(__file__).with_name('CaptureTests.swift').read_text().replace('__LAUNCH_BASE64__', base64.b64encode(launch).decode())
(project/'Tests/CaptureTests.swift').write_text(source)
spec = (root/'native/MediFlowAppleApp/project.yml').read_text()
spec = spec.replace('path: ../MediFlowMac', f'path: {root}/native/MediFlowMac')
spec = spec.replace('path: Tests/MediFlowMobileAppUITests', 'path: Tests')
(project/'project.yml').write_text(spec)
subprocess.run(['xcodegen','generate'],cwd=project,check=True)
