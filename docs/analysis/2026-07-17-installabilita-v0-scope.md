---
summary: "Scope e proof macOS per l'installabilita v0 con Next standalone, Node 24 incorporato e launcher locale."
read_when:
  - "Valutando WUL-455 o il primo artefatto MediFlow avviabile senza terminale."
  - "Confrontando bundle Node, Tauri con sidecar Node ed Electron per il packaging tri-OS."
---

# Installabilita v0: scope e proof macOS

Data: 2026-07-17

Issue: `WUL-455`

Stato: `SECONDARY`, proof consegnata su macOS arm64

## Decisione

Per il v0 si adotta un **bundle Next standalone con Node 24 incorporato e
launcher sottile per sistema operativo**.

Questa scelta consegna subito la proprieta da provare: su macOS un operatore puo
aprire `MediFlow.app`, il launcher avvia il server esclusivamente su loopback e
apre l'interfaccia nel browser, senza richiedere Node o comandi nel terminale
sulla macchina di esecuzione.

Tauri con sidecar Node resta il candidato da rivalutare quando servira una shell
desktop tri-OS con ciclo di vita, firma, installer e aggiornamenti governati.
Electron non e raccomandato per questa stazione intermedia.

## Decision frame

| Campo | Perimetro |
| --- | --- |
| Risultato | Proof macOS avviabile con doppio click e server locale funzionante |
| Setting | Build locale su macOS arm64 con Node 24.18.0 |
| Orizzonte | Stazione intermedia prima di una app nativa tri-OS |
| Vincoli | Next standalone, `better-sqlite3`, Node 24, local-first, host keyless invariato |
| Fuori scope | Firma, notarizzazione, auto-update, installer Windows/Linux, modifiche al runtime clinico |
| Stop rule | Non promuovere la proof a distribuzione finche firma, notarizzazione e prova su macchina pulita non sono verdi |

## Verifica-prima sul debito

Il lavoro non era gia chiuso alla base `d09c949a3`.

- `next.config.ts` produce gia `output: "standalone"`.
- `scripts/build-apple-macos-app.sh` include gia il WebRuntime nella app nativa,
  ma dichiara esplicitamente che Node non e incorporato.
- `HomeBaseRuntimeSupervisor` cerca un Node compatibile nel sistema, in Homebrew,
  nvm o fnm. Questo non soddisfa l'avvio su una macchina senza Node.
- Non esisteva uno script dedicato a `WUL-455` e non esisteva una proof che
  incorporasse insieme Node 24, WebRuntime e launcher browser.

La proof aggiunta resta separata dal bundle nativo Apple esistente. Non cambia
il suo supervisor e non anticipa la decisione sulla shell desktop finale.

## Opzioni valutate

### Matrice

| Criterio | Next standalone + Node + launcher | Tauri + sidecar Node | Electron |
| --- | --- | --- | --- |
| Peso artefatto | **Medio**. Proof arm64 misurata: 191 MB su disco, di cui 116 MB Node e 75 MB WebRuntime | **Presumibilmente medio**, ma non misurato. Aggiunge shell Rust/WebView e mantiene Node come sidecar | **Presumibilmente alto**, ma non misurato. Include il runtime Electron con Chromium e Node |
| Moduli nativi | Usa lo stesso Node e la stessa ABI con cui e stato costruito `better-sqlite3` | Il sidecar puo usare un Node dedicato con la stessa ABI; resta necessario un artefatto per OS e architettura | Caricare `better-sqlite3` nel processo Electron introduce il suo ABI; usare un sidecar Node evita questo accoppiamento ma duplica parte del runtime |
| Firma e notarizzazione future | Struttura `.app` convenzionale, ma pipeline e nested signing non implementati | Tooling di bundle, firma e notarizzazione gia previsto dal framework | Tooling di packaging, firma e notarizzazione disponibile tramite Electron Forge |
| Aggiornamenti | Nessun updater nel v0; servirebbe una soluzione dedicata | Plugin updater disponibile, con firme obbligatorie per gli update | `autoUpdater` disponibile su macOS e Windows; Linux richiede una strategia separata |
| Riuso su tre OS | Buono per WebRuntime e contratto Node; servono launcher e build native per ogni OS | Buono per una shell unica tri-OS, con sidecar specifici per target | Buono per una shell unica tri-OS, al costo del runtime piu ampio |
| Aderenza ADR 0068 | Alta: mantiene Node 24, ABI esplicita, launcher sottili e build per OS | Compatibile, ma aggiunge ora Rust, WebView e un nuovo boundary di processo | Compatibile in astratto, ma aggiunge un secondo runtime desktop prima che sia necessario |
| Costo di adozione nel v0 | Basso: nessuna dipendenza nuova e nessuna modifica applicativa | Medio-alto: nuovo progetto, toolchain Rust, policy sidecar e lifecycle | Alto: nuove dipendenze, processo main/preload, hardening renderer e packaging |

### Evidenza esterna usata per il confronto

- Tauri documenta i binari esterni come `sidecar`, incluso Node, per evitare
  prerequisiti sulla macchina utente:
  [Embedding External Binaries](https://v2.tauri.app/develop/sidecar/).
- Tauri offre bundle specifici per piattaforma, firma e distribuzione:
  [Distribute](https://v2.tauri.app/distribute/).
- Electron Forge impacchetta l'app insieme al binario Electron e produce
  distributable specifici per OS:
  [Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging).
- Electron richiede una strategia di packaging esterna al core e raccomanda la
  firma per la distribuzione:
  [Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview).

Le classificazioni di peso per Tauri ed Electron sono qualitative. Non sono
state costruite proof equivalenti, quindi il documento non attribuisce numeri
non misurati a queste due opzioni.

## Raccomandazione motivata

Il bundle diretto e la scelta minima che separa il problema di installabilita
dal problema della futura shell desktop:

1. riusa il build Next standalone gia verificato dal repository;
2. conserva il contratto Node 24 e ABI 137 gia applicato a installazione, build
   e avvio;
3. incorpora il Node usato per costruire `better-sqlite3`, evitando dipendenze
   dal `PATH` della macchina di esecuzione;
4. non introduce dipendenze, toolchain o boundary applicativi nuovi;
5. lascia verificabili peso, contenuto e comando di avvio.

Tauri va rivalutato quando almeno due di questi requisiti diventano attuali:

- finestra desktop unica invece del browser;
- lifecycle server con stop, restart e diagnostica visibile;
- installer firmati su macOS, Windows e Linux;
- aggiornamenti verificati;
- integrazioni di sistema condivise tra piu OS.

Electron va rivalutato solo se una WebView di sistema non offre compatibilita
sufficiente e il costo di incorporare Chromium e accettato dopo una misura
comparabile.

## Proof macOS

### File sorgente

- `scripts/build-installability-v0-macos.sh`: verifica Node e
  `better-sqlite3`, costruisce Next standalone, incorpora Node e assembla la
  `.app`.
- `scripts/installability-v0-macos-launcher.sh`: entrypoint incluso nel bundle;
  avvia il server, attende una risposta HTTP e apre il browser.

### Layout prodotto

```text
MediFlow.app/
└── Contents/
    ├── Info.plist
    ├── MacOS/
    │   └── MediFlow
    └── Resources/
        ├── Node/
        │   ├── LICENSE
        │   └── bin/node
        └── WebRuntime/
            ├── server.js
            ├── mediflow-runtime-contract.json
            ├── node_modules/
            ├── public/
            └── .next/static/
```

Il launcher:

- usa soltanto il Node dentro il bundle;
- usa `127.0.0.1`, con porta `3000` di default;
- conserva i dati in `~/Library/Application Support/MediFlow` salvo override;
- scrive PID e log locali fuori dal bundle;
- non include token, chiavi, database o altri dati runtime nell'artefatto;
- rifiuta una porta gia occupata da un processo non registrato dalla proof.

Il launcher non modifica il codice applicativo o i contratti dati. Il boundary
host keyless del runtime resta quello esistente.

## Come costruire

Da una checkout pulita su macOS:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm ci
./scripts/build-installability-v0-macos.sh
```

Risultato atteso:

```text
tmp-installability-v0/MediFlow.app
```

Per riusare una `.next/standalone` gia costruita e verificata:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
MEDIFLOW_INSTALL_SKIP_WEB_BUILD=1 ./scripts/build-installability-v0-macos.sh
```

Il build fallisce se Node non e 24, se piattaforma o architettura non sono
supportate, se manca `server.js`, se il contratto ABI non coincide o se
`better-sqlite3` non si carica dal bundle standalone.

## Come provare

### Prova manuale senza terminale sulla macchina di esecuzione

1. Aprire `tmp-installability-v0` nel Finder.
2. Fare doppio click su `MediFlow.app`.
3. Attendere l'apertura del browser su `http://127.0.0.1:3000/`.
4. Verificare che compaia la schermata iniziale MediFlow.

La proof non e firmata o notarizzata. Questa procedura e valida per il bundle
costruito localmente, non costituisce un percorso di distribuzione a terzi.

### Prova riproducibile con dati sintetici

```bash
APP="$PWD/tmp-installability-v0/MediFlow.app"
PROOF_DATA="$PWD/tmp-installability-v0-proof-data"
PROOF_PORT=43155

MEDIFLOW_DATA_DIR="$PROOF_DATA" \
MEDIFLOW_INSTALL_PORT="$PROOF_PORT" \
MEDIFLOW_INSTALL_SKIP_OPEN=1 \
"$APP/Contents/MacOS/MediFlow"

curl --fail --show-error "http://127.0.0.1:$PROOF_PORT/"
curl --fail --show-error "http://127.0.0.1:$PROOF_PORT/api/system/revision"
```

Per arrestare il solo processo proof:

```bash
kill "$(tr -dc '0-9' < "$PROOF_DATA/runtime/installability-v0.pid")"
```

### Prova LaunchServices, equivalente al doppio click

```bash
export MEDIFLOW_DATA_DIR="$PWD/tmp-installability-v0-open-proof-data"
export MEDIFLOW_INSTALL_PORT=43156
export MEDIFLOW_INSTALL_SKIP_OPEN=1
open -n "$PWD/tmp-installability-v0/MediFlow.app"
curl --fail --show-error "http://127.0.0.1:43156/"
```

## Evidenza reale del 2026-07-17

Ambiente:

```text
Node v24.18.0
ABI 137
macOS arm64
base d09c949a35b1326a7528bd6d24f4bc96bceaf845
```

Build e assemblaggio:

```text
[node-runtime] PASS Node 24.18.0, ABI 137, better-sqlite3 load.
check:standalone-runtime-bundle passed (Node 24.18.0, ABI 137)
[installabilita-v0] COMPLETATO
Artefatto: .../tmp-installability-v0/MediFlow.app
Runtime: v24.18.0, darwin/arm64
191M    .../tmp-installability-v0/MediFlow.app
```

Avvio diretto dell'entrypoint incluso:

```text
[installabilita-v0] server pronto: http://127.0.0.1:43155/ (200)
HTTP/1.1 200 OK
home body: 12475 byte
```

Endpoint di revisione:

```json
{"revision":"d09c949a35b1","sourceFingerprint":"spike/installabilita-v0@d09c949a35b1:3d724f74c692","fingerprint":"spike/installabilita-v0@d09c949a35b1:3d724f74c692"}
```

Avvio tramite LaunchServices:

```text
launchservices HTTP status: 200
```

Dimensioni osservate con `du -sh`:

```text
116M    Contents/Resources/Node
75M     Contents/Resources/WebRuntime
191M    MediFlow.app
```

## Non provato e rischi residui

- Firma, notarizzazione, Gatekeeper dopo download e distribuzione tramite DMG.
- Avvio su un Mac pulito senza toolchain di sviluppo.
- Build o avvio x86_64 e bundle universale macOS.
- Build e installer Windows o Linux.
- Auto-update, rollback e migrazione tra versioni.
- Arresto e riavvio tramite UI, recupero dopo crash e rotazione dei log.
- Diagnostica visibile all'operatore se l'avvio fallisce prima di aprire il browser.
- Compatibilita con porta `3000` occupata da un'altra istanza MediFlow gestita da
  un launcher diverso.
- Misure comparabili di peso e startup per Tauri ed Electron.
- Licenze e notice completi per una distribuzione pubblica. La proof copia la
  licenza Node disponibile nella toolchain di build, ma non sostituisce una
  revisione distributiva completa.

Questi punti bloccano la promozione a installer distribuibile, non la validita
della proof locale macOS richiesta da `WUL-455`.
