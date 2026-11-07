from pathlib import Path
import subprocess, struct, sys
scratch = Path('/Volumes/Vision/mf-ui-identita-20261107-scratch/apple')
out = Path('/Users/leonardopegollo/Antigravity/mf-ui-identita-20261107')
sha = subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
names=['01-elenco','02-scheda','03-diario','04-nuova-voce','05-impostazioni','06-vuoto','07-errore']
missing = 0
for device in sys.argv[1:] or ['ios-iphone','ios-ipad']:
    rows=['# Catture Apple','',f'Codice: `{sha}`. App Debug, banco sintetico BANCO.md. Navigazione XCUITest nella copia scratch; PNG originali da `simctl io screenshot`, senza elaborazione.','', 'Paziente: Rossi Sintetica Maria; stato vuoto: Vuoto Sintetico Paolo. Titolo della bozza digitato, corpo vuoto, nessun salvataggio. Errore: PIN volutamente errato. iPad in orizzontale.','', '| File | Dimensioni | Metodo o motivo |','|---|---|---|']
    for scene in names:
        for theme in ['giorno','grafite']:
            file=out/device/f'{scene}-{theme}.png'
            if file.exists():
                with file.open('rb') as f: f.seek(16); w,h=struct.unpack('>II',f.read(8))
                rows.append(f'| [{file.name}]({file.name}) | {w} × {h} px | simctl dopo segnale XCUITest; tema {theme}. |')
            else:
                missing += 1
                rows.append(f'| {file.name} | — | Mancante: vedere {device}-test.log nello scratch Apple. |')
    rows.extend(['',f'Log: `{scratch}/{device}-test.log`; risultato del test: `{scratch}/{device}-exit-code.txt`.'])
    (out/device/'INDICE.md').write_text('\n'.join(rows)+'\n')
raise SystemExit(1 if missing else 0)
