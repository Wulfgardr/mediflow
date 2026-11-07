# Banco UI sintetico

Eseguire dal worktree con Node v24.22.0. Tutti i dati sono inventati.

```sh
npm ci --cache /Volumes/Vision/mf-ui-identita-20261107-scratch/npm-cache
npm run prepare:dependencies
node scripts/ui-identita/banco.mjs start
node scripts/ui-identita/banco.mjs status
node scripts/ui-identita/banco.mjs pair ios
node scripts/ui-identita/banco.mjs stop
```

La configurazione npm del repository disabilita gli script di installazione: la preparazione esplicita verifica ed installa il binding SQLite previsto dal contratto. `node_modules` è una directory reale nel worktree.

Vision è exFAT: i permessi SQLite richiesti dal prodotto necessitano del contenitore APFS nello scratch. Il volume deve essere già montato su `/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs`. Il contenitore esistente è `storage.sparsebundle`, nello stesso scratch. Non ricrearlo se contiene il banco. Per rimontarlo:

```sh
hdiutil attach -nomount /Volumes/Vision/mf-ui-identita-20261107-scratch/storage.sparsebundle
# Individuare il volume MFUISynthetic nell'output di diskutil list.
# Montare quel volume, sostituendo diskNs1 con il suo identificativo corrente:
/sbin/mount_apfs -o nobrowse /dev/diskNs1 /Volumes/Vision/mf-ui-identita-20261107-scratch/apfs
```

Next usa `dev --webpack`: permette di compilare le sole pagine necessarie alla misura. La build è su APFS, raggiunta da un collegamento sotto `node_modules/.cache/`. NODE_PATH mantiene risolvibili i moduli esterni. Non è una prova di build production. L'avvio rimuove da tsconfig soltanto gli include generati da Next per questa build.

La data dir predefinita è `scratch/apfs/banco`. `MEDIFLOW_DATA_DIR` può selezionare un'altra directory sotto lo scratch. Il banco rifiuta percorsi esterni ed archivi senza il marcatore `SYNTHETIC_ONLY`. Le porte predefinite 3100 e 3543 devono essere libere oppure possedute dal banco. `MF_BANCO_HTTP_PORT` e `MF_BANCO_TLS_PORT` selezionano porte diverse, conservate nello stato. Ogni archivio usa una propria build sotto la data dir, con un collegamento distinto per porta HTTP. Stop arresta i gruppi di processi registrati nel suo stato.

Operatore `performance-baseline`, PIN pubblico `314159`. Quaranta pazienti di baseline e due pazienti di riferimento. Maria Rossi Sintetica ha quattro voci, due diagnosi, due terapie e l'allergia nelle note cliniche: il modello paziente corrente non ha un campo dedicato per le allergie. Le voci sono state create dopo login ed apertura della chiave tramite PIN, usando le API Web con cifratura come nel client. Il diario di Paolo Vuoto Sintetico è vuoto.

`pair ios|ipados|macos|windows|linux` conferma il pairing e stampa JSON con URL HTTPS, impronta SHA-256 del certificato DER, identificativo e token, credenziali sintetiche ed esito della lettura della scheda. Per GPUI usare `gpuiIdentifier` e `gpuiPairingCode`. La verifica integrata della scheda usa HTTP loopback, il trasporto HTTPS è verificato separatamente. I JSON restano nella data dir.

Per le catture:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs/playwright npx playwright test -c scripts/ui-identita/playwright.config.ts web-capture
```

La configurazione impone sandbox e rete loopback tramite la fixture del repository. Quattro combinazioni: giorno/grafite, 1440/390, altezza 960. Le catture 01–07 mostrano il viewport. La nuova voce resta digitata senza salvataggio clinico. Lo stato di errore deriva dalla richiesta API della scheda interrotta con connectionrefused nell'harness. Il messaggio è prodotto dalla UI reale, senza risposte o testi sostitutivi. Le evidenze sono in `~/Antigravity/mf-ui-identita-20261107/web/`. I log nello scratch. Il banco resta in esecuzione dopo le catture.

Per un banco indipendente, usare le stesse variabili all'avvio, nelle prove ed all'arresto:

```sh
export MEDIFLOW_DATA_DIR=/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs/web-identita/banco
export MF_BANCO_HTTP_PORT=3110 MF_BANCO_TLS_PORT=3553
export MF_BANCO_ARTIFACTS=/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs/web-identita/prove
export MF_BANCO_CAPTURES=/Users/leonardopegollo/Antigravity/mf-ui-identita-20261107/giri/web-identita/dopo
node scripts/ui-identita/banco.mjs start
PLAYWRIGHT_BROWSERS_PATH=/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs/playwright npx playwright test -c scripts/ui-identita/playwright.config.ts
node scripts/ui-identita/banco.mjs stop
```

`web-regression.spec.ts` verifica errore e ripetizione, area di scrittura compatta, densità a 1440×900, data e ora nel margine del diario, autore esplicito, scrittura dalla scheda e sezioni delle Impostazioni. Le catture conservano invece l'altezza iniziale di 960 px.
