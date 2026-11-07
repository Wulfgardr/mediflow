from pathlib import Path
import json, subprocess, sys, os
scratch=Path(os.environ.get('MEDIFLOW_UI_APPLE_SCRATCH', '/Volumes/Vision/mf-ui-identita-20261107-scratch/apple'))
banco=Path('/Users/leonardopegollo/Antigravity/mf-ui-identita-20261107/BANCO.md')
if not banco.exists(): raise SystemExit('BANCO.md assente: attendo la lane proprietaria del banco')
paired=json.loads(subprocess.check_output(['node','scripts/ui-identita/banco.mjs','pair',sys.argv[1] if len(sys.argv)>1 else 'ios'],text=True, cwd=os.environ.get('MEDIFLOW_UI_BANCO_WORKTREE', str(Path(__file__).resolve().parents[3]))))
(scratch/f'pair-{paired["platform"]}.json').write_text(json.dumps(paired,indent=2))
keys={'SERVER_URL':'loopbackURL','TLS_PIN':'tlsPin','PAIRED_CLIENT_ID':'pairedClientId','PAIRED_CLIENT_TOKEN':'pairedClientToken','USERNAME':'username','OPERATOR_PIN':'operatorPin','AMBULATORY_ID':'ambulatoryId'}
env={f'MEDIFLOW_HOMEBASE_{key}':paired[value] for key,value in keys.items()}
env.update(MEDIFLOW_HOMEBASE_AUTOLOGIN='1',MEDIFLOW_HOMEBASE_AUTOLOAD_PATIENTS='1',MEDIFLOW_APPLE_DEV_SKIP_KEYCHAIN='1')
(scratch/'launch.json').write_text(json.dumps(env,indent=2))
print('Configurazione sintetica pronta; patientDetailStatus:',paired.get('patientDetailStatus'))
