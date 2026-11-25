# ADR 0200: Applicazione Web standard su desktop, launcher sottili per sistema e ritiro delle app desktop native

Date: 2026-11-25
Status: Proposed

Refs: WUL-880
Aggiorna: [ADR 0008](./0008-web-first-with-parity-sweeps.md), [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md), [ADR 0068](./0068-cross-platform-runtime-windows-linux.md), [ADR 0114](./0114-intelligent-host-aip-mcp-isolation.md), [ADR 0143](./0143-strong-unlock-credential.md), [ADR 0185](./0185-rotta-di-mediflow.md), [ADR 0190](./0190-mandato-agenti-e-cassetta-della-visita.md), [ADR 0191](./0191-conferma-da-chat-e-cassetta-senza-finestra.md).
Supera (se accettato): [ADR 0145](./0145-rust-gpui-connected-client.md), [ADR 0169](./0169-gpui-ambulatory-destructive-commands.md), [ADR 0172](./0172-gpui-local-web-session.md), la parte macOS desktop di [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md) e la verifica tri-OS di `MediFlowCore` (ADR 0071).

## Problema e contesto

MediFlow mantiene oggi cinque superfici distinte:

1. applicazione Web locale (Next.js su `127.0.0.1:3000`);
2. client desktop Rust/GPUI (`experiments/gpui-patient-pilot`, 334 file tracciati);
3. applicazione desktop macOS Swift (`MediFlowMacApp` + parte macOS di `MediFlowAppleShared`, 271 + 27 file condivisi con mobile);
4. applicazione mobile iOS e iPadOS (`MediFlowMobileApp`);
5. launcher multipiattaforma (`MediFlow.command`, `MediFlow.cmd`, `MediFlow.sh`, `scripts/mediflow.mjs`).

Le misure raccolte su `main` (`a6f6221fa`, 25 novembre 2026) mostrano uno squilibrio strutturale:

- **Uso reale:** l'unica cartella usata in ambulatorio è il Web locale sul Mac insieme al kit Codex. La finestra macOS Swift non è in uso (già registrato in ADR 0143) e la sua modalità home-base non è mai stata compilata per uso operativo (WUL-937). Il client Rust/GPUI è stato usato solo in collaudi di parità. L'app iOS è installata ma priva di collegamento attivo finché il proxy LAN non viene gestito fuori dall'app Mac.
- **Costo in lavoro e CI:** negli ultimi 30 giorni (dal 26 ottobre 2026, 1.906 commit totali), 414 commit (21,7%) hanno toccato `experiments/gpui-patient-pilot` (101 su 405 negli ultimi 14 giorni, 24,9%). Su GitHub Actions (`gh run list`, finestra di 200 run), `rust-gpui-pilot.yml` è il workflow più lento del repository (47,2 minuti di mediana per PR, 199 run attive su 200, ~44.940 minuti wall-clock proiettati su 30 giorni); `core-tri-os.yml` aggiunge ~2.420 minuti/mese e `apple-native.yml` ~5.890 minuti/mese su runner `macos-15`.
- **Latenza Web:** la baseline di produzione (`docs/analysis/2026-07-17-baseline-performance.json`, Mac16,5 M4 Max) misura 16,7 ms (200 pazienti) e 135,2 ms (2.000 pazienti) per `/api/patients` inclusa decifratura AES-256-GCM lato client, e 57,3 ms per 1.600 voci di diario. La misura dei gesti Web (`docs/design/misura-base/conti.json`, 13 novembre 2026) registra risposte UI peggiori fra 8 ms e 27 ms sui compiti misurati. Resta da acquisire una nuova baseline sul Mac17,10 (M5 Max) con la scheda aggiornata, ma non esiste un limite prestazionale del Web che giustifichi due riscritture desktop parallele.

## Decisione proposta

1. **Una sola applicazione desktop: il Web locale.** L'interfaccia browser locale (`Next.js`) è l'unica applicazione desktop di MediFlow su macOS, Windows e Linux. Ogni sviluppo UI desktop avviene una sola volta sul Web.
2. **Ritiro ordinato delle app desktop native.** Cessano gli sviluppi e i requisiti di parità per `experiments/gpui-patient-pilot` (Rust/GPUI) e per `MediFlowMacApp` (finestra desktop Swift macOS). La rimozione fisica del codice e dei workflow avviene in PR successive, ordinate e reversibili, dopo l'estrazione delle sole componenti non sostituibili dal browser.
3. **Launcher sottile per sistema operativo.** Su macOS, Windows e Linux l'utente avvia MediFlow tramite un piccolo launcher dedicato al sistema. Il launcher non contiene schermate cliniche né duplicazioni di logica di dominio: gestisce avvio e arresto del backend, stato e diagnosi, proxy HTTPS LAN per i dispositivi mobili, backup pianificato, aggiornamento e rollback, e sul solo macOS ospita i piccoli helper firmati che richiedono API di sistema (Touch ID / Secure Enclave).
4. **App iOS e iPadOS confermate.** `MediFlowMobileApp` resta parte del prodotto, collegata all'archivio del computer host tramite `/api/v1/network/*`, proxy HTTPS LAN avviato dal launcher e pairing con QR (WUL-951), senza alcuna dipendenza dall'app desktop macOS.
5. **Intelligenza locale personalizzata per sistema.** Il nucleo funziona senza modelli (ADR 0180). I motori locali restano opzionali e dichiarati per piattaforma: Ollama (tutti e tre i sistemi), OCR Apple Vision su macOS e Tesseract WASM su Windows/Linux (ADR 0198), Whisper locale estratto da GPUI in un servizio autonomo prima della rimozione del pilota Rust, GLiNER2-PII solo dove il sistema garantisce l'isolamento di rete del worker.

## Che cosa resta nel launcher, cosa passa al Web e cosa non ha equivalente fuori macOS

| Capacità | Sede nella nuova architettura | macOS | Windows 11 | Linux |
| --- | --- | --- | --- | --- |
| Cartella clinica, impostazioni, In arrivo, Agenti, Conservazione | **Web locale** | Sì | Sì | Sì |
| Avvio/arresto backend Node 24, verifica ABI, ricevuta esclusiva | **Launcher** (`scripts/mediflow.mjs`) | Sì | Sì (Job Object nativo) | Sì (`.desktop`) |
| Diagnosi problemi e stato servizi (SQLite, porte, proxy, AI, backup) | **Launcher** (pagina Avvio locale + CLI) | Sì | Sì | Sì |
| Proxy HTTPS LAN (`:3443`) per iPhone/iPad (`scripts/local-api-tls-proxy.mjs`) | **Launcher** (opt-in `network-home-base`) | Sì | Sì | Sì |
| Generazione QR di abbinamento monouso (WUL-951) e revoca dispositivi | **Web** (con proxy gestito dal Launcher) | Sì | Sì | Sì |
| Backup pianificato (`lib/backup-scheduler-adapter.ts`) | **Backend + Launcher** | `launchd` | `schtasks` | `systemd` / `cron` |
| Aggiornamento e rollback sicuro del pacchetto | **Launcher** | Sì | Sì | Sì |
| Confinamento processi documentali (ADR 0198) | **Backend + launcher documentale** | Seatbelt | AppContainer | `unshare` + `prlimit` |
| Riquadro conferma visita con Touch ID / Watch / password OS (ADR 0191 §1) | **Helper firmato macOS** (`native/AgentVisitConfirmation/`) | Sì | Assente dichiarato (usa Web «In arrivo») | Assente dichiarato (usa Web «In arrivo») |
| Portachiavi + Secure Enclave per cassetta senza finestra (ADR 0191 §2) | **Servizio firmato macOS** (opzionale, spento di default) | Opzionale | Assente dichiarato (chiave solo in scheda Web, ADR 0143) | Assente dichiarato (chiave solo in scheda Web, ADR 0143) |
| Redazione GLiNER2-PII (`lib/gliner-redaction-runner.ts`) | **Backend Node** | Sì (`sandbox-exec`) | Bloccato finché manca isolamento rete worker | Bloccato finché manca isolamento rete worker |
| Trascrizione locale Whisper (`local_voice`) | **Servizio/binario locale estratto da GPUI** | Sì (dopo estrazione) | Da portare in giro dedicato | Da portare in giro dedicato |

Nessun ripiego debole è ammesso su Windows o Linux: l'assenza di Secure Enclave, Portachiavi biometrico o confinamento GLiNER viene dichiarata apertamente come stato non disponibile, senza file di chiavi in chiaro né disattivazione dei controlli di rete.

## Abbinamento remoto: adozione selettiva dei pattern di T3 Code

Dall'analisi del modello di abbinamento di T3 Code (`pingdotgg/t3code`, `docs/user/remote-access.md`, `04_environment-auth.md`, `05_remote.md`) si fissano i seguenti criteri per l'evoluzione del pairing MediFlow (WUL-951 e giri successivi):

- **Adottare:** QR e link monouso a scadenza breve (5 minuti già in WUL-951) mai rileggibili in chiaro dopo l'emissione; scadenza automatica dei dispositivi inattivi da 30 giorni; revoca immediata dall'host; multi-rotta ordinata per lo stesso computer (LAN + VPN privata come Tailscale) senza mai ripiegare su loopback e senza mai consentire downgrade da HTTPS a HTTP; controllo dell'identità/certificato dell'host prima di inviare credenziali; scope solo in restrizione (narrowing-only) e legame del token a chiave residente nel dispositivo.
- **Escludere per dati sanitari (PHI):** relay cloud gestito da terzi (equivalente di T3 Connect); accesso automatico di nuovi dispositivi tramite un account cloud condiviso senza conferma esplicita; esecuzione remota di shell o script sull'host clinico.

## Conseguenze sugli ADR esistenti

| ADR | Effetto |
| --- | --- |
| **ADR 0008** (Web-first con parity sweep macOS) | Aggiornato: il Web resta unica superficie desktop; i parity sweep macOS desktop cessano. |
| **ADR 0048** (Apple shared client e home-base) | Aggiornato: resta valido per iOS/iPadOS (`MediFlowCore`, `MediFlowAppleShared` mobile, `/api/v1/network/*`, cache cifrata 24h, emendamento WUL-951 QR). La parte `MediFlowMacApp` come runtime host packaged è sostituita dal launcher + `scripts/local-api-tls-proxy.mjs`. |
| **ADR 0068** (Runtime cross-platform Win/Linux) | Confermato e promosso a modello unico desktop su tutti e tre i sistemi, incluso macOS. |
| **ADR 0114** (Isolamento AIP/MCP) | Aggiornato: il confine di processo separato (Supervisor Node IPC + MCP `stdio`) resta invariato; l'eventuale bundle firmato macOS per `SMAppService`/XPC, se mai implementato, appartiene al launcher macOS e non a una UI desktop Swift. |
| **ADR 0143** (Credenziale forte v3) | Invariato nella crittografia e nei vettori dorati (`crypto-golden-vectors.v3.json`), che restano condivisi fra Web e iOS/iPadOS. |
| **ADR 0145, 0169, 0172** (Client Rust/GPUI) | Superati (archivio storico). I comandi host già introdotti nel backend Node restano se usati dal Web o vengono rimossi solo con PR dedicate. |
| **ADR 0185** (Rotta di MediFlow) | Aggiornato nella sezione «Superfici»: il Web (con launcher sottile per sistema) è la sola superficie desktop; restano iOS e iPadOS; GPUI esce anche dalla ricerca attiva. |
| **ADR 0190 e 0191** (Mandato agenti, conferma Codex, cassetta) | Confermati nel modello di sicurezza. Il riquadro di conferma di ADR 0191 §1 usa già `native/AgentVisitConfirmation/` (indipendente dall'app Mac); l'eventuale servizio ADR 0191 §2 resta un piccolo componente firmato opzionale del launcher macOS. |

## Conseguenze sul contratto della 0.9.1

L'accettazione di questo ADR richiede un emendamento esplicito di `docs/releases/0.9.1-contract.md`:

| Issue / Unità 0.9.1 | Stato proposto | Motivazione |
| --- | --- | --- |
| **Unità G-0..G-9 (GPUI)** | **Esce dal contratto 0.9.1** | Il client GPUI viene ritirato; nessun blocco release o seduta Q-7 su GPUI. |
| **WUL-894** (Redesign Web e GPUI) | **Cambia perimetro (solo Web)** | Resta obbligatoria la metà Web (PR #1094 e sistema interfaccia); la metà GPUI esce. |
| **WUL-841** (Installare, aggiornare e rollback su 3 OS) | **Resta (solo Web + Launcher)** | Si applica al pacchetto Web standalone e ai tre launcher (`MediFlow.command`, `.cmd`, `.sh`), non a tre app desktop native. |
| **WUL-895** (Avvio Windows) | **Resta (Launcher Windows)** | Riguarda il launcher Web su Windows e il bootstrap Win32 (`scripts/windows-launcher-bootstrap/`). |
| **WUL-902** (Sicurezza su Windows e Linux) | **Resta (Web + Launcher + worker PDF)** | Copre sessione Web (ADR 0199), isolamento worker PDF (ADR 0198) e limiti dichiarati su Win/Linux. |
| **WUL-954** (Colori nelle app Apple) | **Cambia perimetro (solo iOS/iPadOS)** | Si applica a `MediFlowMobileApp`; cade la verifica su `MediFlowMacApp`. |
| **WUL-777** (Accesso v3 nei client Apple) | **Resta (solo iOS/iPadOS)** | Necessaria affinché iPhone e iPad aprano archivi con passphrase v3. |
| **WUL-951** (Abbinamento con QR) | **Resta (Web + Launcher TLS + iOS/iPadOS)** | Già implementato su Web e client Apple; si appoggia al proxy LAN del launcher. |
| **WUL-937** (iPhone vede l'archivio tramite Mac) | **Cambia implementazione (via Launcher TLS)** | Non richiede più la compilazione di `MediFlowMacApp` home-base: usa `scripts/local-api-tls-proxy.mjs` avviato dal launcher. |
| **WUL-936** (Lavoro da remoto con Mac bloccato) | **Resta (perimetro chiarito)** | Verifica l'accesso iPhone/iPad (decifratura sul telefono) e il deposito agenti con Mac bloccato ma sveglio, e conferma il blocco della cassetta ADR 0191 §2. |
| **WUL-803** (Canale chat GPUI, lane Mythos) | **Solo citata (fuori da questa lane)** | La lane Mythos valuterà l'impatto sul canale di ricomposizione nomi senza finestra GPUI. |

## Piano di ritiro ordinato e reversibile

Nessuna rimozione avviene insieme a questo ADR. La sequenza prevista dopo l'accettazione è:

1. Emendamento di `docs/releases/0.9.1-contract.md`.
2. Estrazione di `experiments/gpui-patient-pilot/app/src/local_voice/` in un binario/servizio autonomo verificato da `scripts/prove-ascolto-visita.mjs` (prerequisito bloccante per non perdere Whisper locale).
3. Rimozione dei workflow `.github/workflows/rust-gpui-pilot.yml` e `.github/workflows/core-tri-os.yml` (~47.360 minuti/mese di CI risparmiati).
4. Rimozione di `experiments/gpui-patient-pilot/` (334 file) e relativi script di selezione test, preceduta da tag di archivio Git.
5. Rimozione dello scheme/target `MediFlowMacApp` da `native/MediFlowAppleApp/project.yml` e della gamba macOS da `.github/workflows/apple-native.yml` (~2.000–3.000 minuti/mese risparmiati su `macos-15`), mantenendo `MediFlowMobileApp` e `MediFlowMobileAppUITests`.
6. Rimozione delle view e dei supervisor esclusivamente macOS da `native/MediFlowMac/Sources/MediFlowAppleShared/`, preservando `MediFlowCore`, le view iOS/iPadOS e `native/AgentVisitConfirmation/`.
7. Consolidamento del launcher (`scripts/mediflow.mjs`) con gestione proxy LAN, diagnosi e rollback, e riallineamento di `ARCHITECTURE.md`, `PRODUCT.md` e `SECURITY.md`.

## Limiti e criteri per riaprire

Questa decisione può essere riaperta solo a fronte di evidenze misurate nuove, in uno di questi casi:

1. **Latenza Web insufficiente in ambulatorio:** una misura ripetibile su `Mac17,10` (o hardware target equivalente) con archivio sintetico realistico mostra tempi che impediscono il lavoro clinico e non sono risolvibili nel runtime Web/Next.js.
2. **Blocco strutturale del browser sulle API richieste:** un requisito clinico obbligatorio (es. gestione dispositivi medici locali o accesso hardware) non può essere assolto né dal browser né dal piccolo launcher/helper di sistema.
3. **Richiesta esplicita di un secondo utente/struttura** che giustifichi e finanzi il costo di manutenzione e firma di una app desktop nativa dedicata (coerente con ADR 0185).

Questa proposta non modifica il runtime, lo schema SQLite, i contratti `/api/v1` o i claim di sicurezza e cifratura vigenti.
