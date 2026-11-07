#!/usr/bin/env python3
import datetime
import json
import pathlib
import subprocess
import os

root = pathlib.Path('/Users/leonardopegollo/Antigravity/mf-ui-identita-20261107')
results = []
env = dict(os.environ, DEVELOPER_DIR='/Applications/Xcode-beta.app/Contents/Developer',
           SWIFT_MODULECACHE_PATH='/Volumes/Vision/mf-ui-identita-20261107-scratch/gpui/swift-cache',
           CLANG_MODULE_CACHE_PATH='/Volumes/Vision/mf-ui-identita-20261107-scratch/gpui/clang-cache')
with (root / 'gpui-macos/windows.json').open('w') as out, (root / 'gpui-macos/windows-stderr.log').open('w') as err:
    subprocess.run(['/Applications/Xcode-beta.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift',
                    str(pathlib.Path(__file__).with_name('windows.swift'))],
                   env=env, stdout=out, stderr=err, check=True, timeout=45)
windows = json.loads((root / 'gpui-macos/windows.json').read_text())['windows']
window_id = next((str(w['kCGWindowNumber']) for w in windows
                  if w.get('kCGWindowOwnerName') == 'loginwindow'
                  and w.get('kCGWindowIsOnscreen')
                  and w.get('kCGWindowBounds', {}).get('Width', 0) < 10000), None)
commands = [
    ['git', 'rev-parse', 'HEAD'],
    ['prlctl', 'list', '-a'],
    ['git', 'status', '--short', '--untracked-files=all'],
    ['/Volumes/Xcode Development/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/metal', '--version'],
]
if window_id:
    commands.append(['screencapture', '-x', '-l', window_id, str(root / 'gpui-macos/lock-attempt.png')])
for argv in commands:
    result = subprocess.run(argv, capture_output=True, text=True, timeout=30)
    results.append(dict(argv=argv, exit=result.returncode, stdout=result.stdout, stderr=result.stderr))
evidence = dict(at=datetime.datetime.now().astimezone().isoformat(), results=results,
                banco_present=(root / 'BANCO.md').exists(), build_exit=101,
                build_log='build.log', binary_present=pathlib.Path(
                    '/Volumes/Vision/mf-ui-identita-20261107-scratch/gpui/target/debug/mediflow-gpui-patient-pilot').exists())
(root / 'gpui-macos/final-evidence.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
(root / 'gpui-windows/parallels-attempts.json').write_bytes((root / 'gpui-linux/parallels-attempts.json').read_bytes())
commit = results[0]['stdout'].strip()
screens = ['elenco', 'scheda', 'diario', 'nuova-voce', 'impostazioni', 'vuoto', 'errore']
for surface in ['windows', 'linux', 'macos']:
    reason = ('Avvio, exec e capture rifiutati da prlctl: richiede edizione Pro o Business; '
              'apertura del file VM tramite Parallels non avvia il guest; GUI inaccessibile (cgWindowNotFound).'
              if surface != 'macos' else
              'Build exit 101: Metal Toolchain mancante. Binary corrente non prodotto, avvio impossibile. '
              'Host screenLocked=true; screencapture della finestra loginwindow fallisce: could not create image from window.')
    lines = [f'# GPUI {surface}: catture non ottenute', '',
             f'Data: {evidence["at"]}. Commit host: `{commit}`.', '',
             'Commit guest: non verificabile.' if surface != 'macos' else 'Build eseguita sul commit host sopra indicato; non riuscita.', '',
             reason, '', 'Dimensioni finestra applicativa: non misurabili; nessuna cattura valida. '
             'Il banco BANCO.md non è presente al controllo finale. Accesso PIN, pairing e demo non eseguiti. '
             'Non è stato osservato un errore di accesso del client collegato: il ripiego demo non viene quindi attribuito.', '',
             '| File previsto | Esito | Dimensioni |', '|---|---|---|']
    for theme in ['giorno', 'grafite']:
        for i, screen in enumerate(screens, 1):
            lines.append(f'| {i:02d}-{screen}-{theme}.png | Mancante: blocco descritto sopra | non disponibili |')
    lines += ['', 'Evidenze: `parallels-attempts.json` (Windows/Linux); '
              '`build.log`, `windows.json`, `final-evidence.json`, `capture-attempt.log` (macOS).', '',
              'Nessuna immagine storica riutilizzata come prova corrente. Nessun commit, push o PR.']
    (root / f'gpui-{surface}/INDICE.md').write_text('\n'.join(lines) + '\n')
print(json.dumps({k: evidence[k] for k in ['at', 'banco_present', 'build_exit', 'binary_present']}))
