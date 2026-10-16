# ADR 0068: Runtime cross-platform su Windows e Linux

Date: 2026-06-18
Status: Accepted

Supersedes: [ADR 0022](./0022-nightly-backup-via-macos-launchd.md) (limitatamente
allo scheduling backup, che da macOS-only diventa cross-platform via adapter).

Related: [ARCHITECTURE.md](../../ARCHITECTURE.md), [README.md](../../README.md),
[ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)

## Problema

`WUL-375` chiede di portare MediFlow da "gira bene su Mac" a installabile,
avviabile e gestibile anche su Windows 11 e Ubuntu, per un utente medico non
tecnico, senza sovrastimare la parita.

## Contesto

Il core e gia in larga parte portabile e verificato:

- `next.config.ts` ha `output: "standalone"`; il `Dockerfile` node:24-alpine
  prova l'esecuzione su Linux.
- `better-sqlite3` 12.x spedisce binari precompilati per win32/darwin/linux.
- `lib/data-dir.ts` ramifica gia `darwin` (`~/Library/Application Support/MediFlow`)
  vs `~/.mediflow`, con override `MEDIFLOW_DATA_DIR`.
- La cifratura clinica e lato client (WebCrypto), quindi neutra rispetto all'OS.

La superficie solo-Mac e concentrata in: launcher (`.command` bash con
`lsof`/`pgrep`/`open`/`shasum`), lane AI MLX+PM2 (Apple Silicon), fallback OCR
Apple Vision (gia gated da `process.platform`), scheduling backup via `launchd`.

## Opzioni di packaging

1. App desktop nativa (Electron o Tauri) con installer `.exe`/`.dmg`/`.AppImage`.
2. Docker Compose come unico metodo di esecuzione cross-platform.
3. Web app locale Next.js avviata con npm + launcher one-click sottili per OS,
   con un helper Node condiviso per la logica fragile (porta, hash, browser).

## Trade-off

- Opzione 1:
  - Pro: massima esperienza one-click per il medico, nessun terminale.
  - Contro: sforzo elevato, nuova superficie di manutenzione/firma su tre OS,
    si sovrappone alla direzione Apple home-base. Eccessivo per questo obiettivo.
- Opzione 2:
  - Pro: ambiente identico ovunque, Dockerfile gia presente.
  - Contro: Docker Desktop e oneroso per un utente non tecnico; lo storage dati
    locale (file SQLite) e il primario, non un volume container.
- Opzione 3:
  - Pro: il core resta invariato e a basso rischio; esperienza "doppio click e
    parte" su ogni OS; riusa `lib/data-dir.ts` e i prebuild esistenti.
  - Contro: servono comunque file di launcher per OS, ma sottili.

## Decisione

Adottiamo l'opzione 3.

- La web app locale Next.js avviata con npm resta il runtime primario su tutte
  le piattaforme.
- Tre launcher sottili: `Start_MediFlow.command` (macOS, esistente),
  `Start-MediFlow.ps1` (Windows), `scripts/start-mediflow.sh` (Linux).
- La logica condivisa (rilevamento porta, hash worktree, apertura browser, check
  Node) vive in `scripts/launcher-helpers.mjs`, richiamato da tutti i launcher.
- `.nvmrc`, `package.json#engines`, `.npmrc`, Docker e CI convergono su Node
  24.x. Installazione, build, start e launcher falliscono prima dell'avvio se
  Node o il binding nativo `better-sqlite3` non rispettano il contratto.
- La build standalone registra major e ABI Node nel bundle. Il supervisor
  macOS sceglie solo un eseguibile compatibile con quel manifest, anche quando
  nel sistema e installato un Node generico piu recente.
- Lo scheduling del backup passa dietro un `SchedulerAdapter`
  (`lib/backup-scheduler-adapter.ts`): `launchd` su macOS, Task Scheduler via
  `schtasks` su Windows, `systemd-timer` (fallback `cron`) su Linux. Il runner
  `scripts/run-scheduled-backup.mjs` resta invariato e OS-agnostico.
- Electron/Tauri restano un'opzione futura da valutare in un ADR separato, non
  in questa milestone.

## Confini onesti

- Apple Vision OCR e l'inferenza MLX restano enhancement opzionali Apple Silicon,
  inquadrati come degradazione graziosa verso Ollama (runtime AI/OCR primario
  cross-platform), non come regressioni.
- Nessun claim di parita OCR certificata su Windows/Linux dove non esiste.
- Gli endpoint MLX e backup-scheduler ritornano un errore strutturato 501/400
  fuori piattaforma, mai un 500 criptico o un crash.
- Nessuna modifica ai claim zero-knowledge (congelati sotto `WUL-342`/`WUL-354`).

## Conseguenze

- Positivo: `npm ci && npm run build && npm start` resta l'unico flusso runtime,
  verificabile su tre OS via la CI matrix (`.github/workflows/cross-platform.yml`).
- Positivo: il backup automatico non e piu solo-macOS.
- Negativo: tre file di launcher da mantenere (mitigato dall'helper condiviso).
- Negativo: il runtime supportato e intenzionalmente ristretto a Node 24.x;
  aggiornare Node richiede un cambiamento coordinato del contratto e una nuova
  verifica cross-platform del binding nativo.

## First Thin Slice

1. Toolchain Node documentato + helper launcher condiviso + launcher Windows/Linux.
2. `SchedulerAdapter` con refactor macOS invariato, poi Windows e Linux.
3. CI matrix windows/ubuntu/macos su install, build, boot.
4. Matrice di supporto per piattaforma nel README.

## Emendamento 2026-10: avvio unico

Decisione del 15 ottobre 2026. Gli ingressi utente diventano
`MediFlow.command`, `MediFlow.cmd` e `MediFlow.sh` nella radice. Selezionano
Node 24 senza richiedere dipendenze già presenti; il controllo ABI avviene
nel lanciatore condiviso `scripts/mediflow.mjs`. I precedenti tre ingressi
vengono rimossi. `Launch_MediFlowMac.command` resta uno strumento interno
per la preparazione nativa, senza compilazione implicita dal nuovo ingresso.

Il lanciatore serve Avvio solo su `127.0.0.1`, su porta libera, con un segreto
casuale nel percorso. Host e Origin sono verificati; solo POST JSON dalla
stessa origine può avviare, installare dipendenze o arrestare. La pagina non
legge dati clinici, non rimuove autenticazione, grant, audit o kill switch.
Lo standard output dell'accesso per agenti resta riservato al protocollo.

La produzione usa `verifySourceRuntime`: ledger, Node/ABI, piattaforma,
architettura e identità della build restano obbligatori. Una build mancante
o di altra revisione richiede `npm run build`; il lanciatore non ritenta una
build fallita nella stessa sessione. Con sorgenti modificati non costruisce
la produzione, ma offre sviluppo come scelta esplicita, mai ricordata.
Non aggiorna Git né scarica servizi opzionali. Solo `npm ci`, confermato
dall'operatore, può scaricare le dipendenze dal registro configurato.

La preferenza (solo scelta e versione dello schema) viene sostituita
atomicamente in `launcher-preferences.json` nella cartella dati; il fallback
è `~/.mediflow-launcher.json` quando la destinazione predefinita non è
scrivibile. Un override dati esplicito non risolvibile blocca l'avvio.
Una directory di possesso esclusivo per percorso sorgente contiene PID,
cartella e indirizzo del lanciatore. Un secondo avvio riusa questa ricevuta
solo con proprietario vivo e fingerprint corretto. Un listener privo di
ricevuta non viene adottato. Non si arrestano PID trovati sulla rete.

Arresta e Ctrl+C chiudono i figli posseduti e la pagina Avvio. Il runtime
sorgente accetta anche un messaggio di arresto sul canale IPC del proprio
padre; questo permette il drain del Supervisor su Windows prima dell'eventuale
terminazione forzata. Non aggiunge un endpoint clinico o un'autorità agente.
Ollama, facoltativo e condiviso, mantiene il ciclo di vita indipendente.

Senza display o browser si usa un menu testuale; senza TTY serve `--scelta`.
Su Linux un comando esplicito installa `mediflow.desktop` con percorso e
icona locali. Il lanciatore non distribuisce Node, installer o nuove app
native Windows/Linux. La CI su tre sistemi prova il lanciatore Node, la prima
build, il fingerprint HTTP, il riuso della cartella e l'arresto. Il doppio clic
nei file manager e le tecnologie assistive richiedono prove proprie.
