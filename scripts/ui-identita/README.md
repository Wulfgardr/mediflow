# Banco UI sintetico

Eseguire dal worktree con Node v24.22.0. Tutti i dati sono inventati.

```sh
npm ci --cache /Volumes/Vision/mf-ui-identita-20261107-scratch/npm-cache
npm rebuild better-sqlite3 --ignore-scripts=false
node scripts/ui-identita/banco.mjs start
node scripts/ui-identita/banco.mjs status
node scripts/ui-identita/banco.mjs pair ios
node scripts/ui-identita/banco.mjs stop
```

La configurazione npm del repository disabilita gli script di installazione: il rebuild esplicito genera il binding SQLite. `node_modules` è una directory reale nel worktree.

Vision è exFAT: i permessi SQLite richiesti dal prodotto necessitano del contenitore APFS nello scratch. Il volume deve essere già montato su `/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs`. Il contenitore esistente è `storage.sparsebundle`, nello stesso scratch. Non ricrearlo se contiene il banco. Per rimontarlo:

```sh
hdiutil attach -nomount /Volumes/Vision/mf-ui-identita-20261107-scratch/storage.sparsebundle
# Individuare il volume MFUISynthetic nell'output di diskutil list.
# Montare quel volume, sostituendo diskNs1 con il suo identificativo corrente:
/sbin/mount_apfs -o nobrowse /dev/diskNs1 /Volumes/Vision/mf-ui-identita-20261107-scratch/apfs
```

Next usa `dev --webpack`: permette di compilare le sole pagine necessarie alla misura. La build è su APFS, raggiunta da un collegamento sotto `node_modules/.cache/`. NODE_PATH mantiene risolvibili i moduli esterni. Non è una prova di build production. L'avvio rimuove da tsconfig soltanto gli include generati da Next per questa build.

La data dir predefinita è `scratch/apfs/banco`. `MEDIFLOW_DATA_DIR` può selezionare un'altra directory sotto lo scratch. Il banco rifiuta percorsi esterni ed archivi senza il marcatore `SYNTHETIC_ONLY`. `MF_BANCO_HTTP_PORT` e `MF_BANCO_TLS_PORT` configurano le porte (default 3100 e 3543), che devono essere libere oppure possedute dal banco. Stop arresta i gruppi di processi registrati nel suo stato.

Operatore `performance-baseline`, PIN pubblico `314159`. Quaranta pazienti di baseline e due pazienti di riferimento. Maria Rossi Sintetica ha quattro voci, due diagnosi, due terapie e l'allergia ad amoxicillina nel campo strutturato cifrato `allergies`, senza ripeterla nelle note cliniche. Ogni nuova voce di riferimento verifica il nome restituito dal server (`Benchmark sintetico`, displayName di `performance-baseline`). Le fixture già presenti rimangono storiche, senza backfill del nome. Le voci sono state create dopo login ed apertura della chiave tramite PIN, usando le API Web con cifratura come nel client. Il diario di Paolo Vuoto Sintetico è vuoto.

`pair ios|ipados|macos|windows|linux` conferma il pairing e stampa JSON con URL HTTPS, impronta SHA-256 del certificato DER, identificativo e token, credenziali sintetiche ed esito della lettura della scheda. Per GPUI usare `gpuiIdentifier` e `gpuiPairingCode`. La verifica integrata della scheda usa HTTP loopback, il trasporto HTTPS è verificato separatamente. I JSON restano nella data dir.

Per le catture:

```sh
PLAYWRIGHT_BROWSERS_PATH=/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/Volumes/Vision/mf-ui-identita-20261107-scratch/apfs/playwright npx playwright test -c scripts/ui-identita/playwright.config.ts
```

La configurazione impone sandbox e rete loopback tramite la fixture del repository. Quattro combinazioni: giorno/grafite, 1440/390, altezza 960. Le catture 01–07 mostrano il viewport. La nuova voce resta digitata senza salvataggio clinico. Lo stato di errore deriva dalla richiesta API della scheda interrotta con connectionrefused nell'harness. Il messaggio è prodotto dalla UI reale, senza risposte o testi sostitutivi. Le evidenze sono in `~/Antigravity/mf-ui-identita-20261107/web/`. I log nello scratch. Il banco resta in esecuzione dopo le catture.

Per una lane isolata, usare una data dir e porte proprie, per esempio
`MEDIFLOW_DATA_DIR=.../apfs/allergie MF_BANCO_HTTP_PORT=3120 MF_BANCO_TLS_PORT=3563`.
La build Next resta nella data dir della lane. Le catture accettano
`MF_BANCO_CAPTURE_DIR` per le PNG e `MF_BANCO_RESULTS_DIR` per i risultati Playwright.
Un banco già popolato riceve il campo strutturato con un aggiornamento versionato.

Per le sole catture Web senza interfaccia Parallels, `MF_BANCO_LOCAL_ONLY=1`
limita banco e proxy TLS al loopback. Non verifica connessioni da client remoti.
