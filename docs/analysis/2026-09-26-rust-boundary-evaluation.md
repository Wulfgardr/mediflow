---
summary: "Preparazione WUL-706: prerequisiti, prova isolata del codec Rust e confronto GPUI, Tauri/WRY e SwiftUI."
read_when:
  - "Valutando il primo confine Rust dopo il pilota condiviso 0.9.1."
  - "Distinguendo prove di protocollo, integrazione del nucleo e scelta della shell."
---

# Rust e GPUI: preparazione verificabile, 26 settembre 2026

Stato: candidato locale. [ADR 0137](../adr/0137-rust-boundary-pilot-proposal.md)
è **Proposed**, non Accepted. La conclusione di questa preparazione è
**KEEP del runtime e delle UI correnti**, con un esperimento Rust circoscritto
da conservare come materiale di confronto. Nessuna issue è chiusa o modificata.

## Provenienza e responsabilità

Il worktree dedicato è `/Users/leonardopegollo/.codex/worktrees/94d6/medical-record-app`,
branch `codex/WUL-706-rust-boundary-20260926`, base
`6c212221a98f9b8e45cc1d243226d0adb41770bd`. La lettura di Linear è del
26 settembre 2026; lo snapshot originale è in
`tmp-rust-evaluation/evidence/linear-snapshot.json` (locale, escluso da Git).
Il [registro incrementale](https://linear.app/wulfgardr/document/mediflow-incremental-release-ledger-090-to-10-ee0392f27b72)
e le intestazioni correnti dei ticket prevalgono sulle collocazioni storiche
1.0 ancora presenti nei loro corpi. Lo stato Backlog non dimostra assenza di
lavoro locale.

| Owner | Perimetro e stato osservato |
| --- | --- |
| Task «Completa 0.8.6 e avvia 0.9.0» | Worktree `mediflow-090-start-20260926`, base uguale a questa. Possiede 717/705/718/719/720/729, scritture cliniche e consolidamento. Ha consegnato una tranche locale, non WUL-735 o tutta la 0.9.0 |
| Task «Prepara aspetti per MediFlow 0.9.x» | Worktree `mediflow-09x-independent-20260926`, base uguale, candidati sintetici 738–745/747 non ancora integrati nel prodotto |
| Questo task | Proposta Rust 706–710/716/736, esperimento codec, valutazione GPUI. Nessuna proprietà dei servizi clinici o dei prototipi altrui |
| Task «MediFlow — Chief of Staff» | Supervisione comune, contratti e priorità; integrazione degli indici condivisi al loro owner |

Gli altri worktree hanno delta non committati. `evidence/baseline.json` conserva
HEAD, stato, hash del diff tracciato e dei file nuovi al momento della lettura.
Non confrontiamo i loro test con questa base come se avessero gli stessi byte.
La patch congelata del core, comunicata dal coordinatore, ha SHA256
`d8e7abeb278b2e3214998195856d0d18709e436786f2abce8469fffb9ef6ed87`;
è una candidata altrui, non una modifica assorbita qui. I risultati della sua
suite restano responsabilità e prove del task di origine.

## Prerequisiti e cosa può procedere

Il coordinatore ha confermato esplicitamente che WUL-735/573/580 sono aperti
e che il pilota WUL-574 non è selezionato. La mappa e il censimento esistenti
vengono riusati, senza avviare un secondo censimento repository-wide.

| Issue | Obbligo prima dell'integrazione | Esito qui |
| --- | --- | --- |
| [WUL-705](https://linear.app/wulfgardr/issue/WUL-705), [715](https://linear.app/wulfgardr/issue/WUL-715), [735](https://linear.app/wulfgardr/issue/WUL-735) | Censimento, workload e consolidamento accettati con identità precisa | Candidati locali esistono; nessuna accettazione globale inferita |
| [WUL-574](https://linear.app/wulfgardr/issue/WUL-574) → [573](https://linear.app/wulfgardr/issue/WUL-573)/[580](https://linear.app/wulfgardr/issue/WUL-580) | Operazione reversibile, autorità, scrittura/audit/idempotenza/ricevuta, recupero e contratti estratti | Pilota da selezionare; niente implementazione Rust del dato |
| [WUL-706](https://linear.app/wulfgardr/issue/WUL-706) | Confine e IPC/FFI motivati sui costi reali | ADR proposto; codec esistente usato come prova limitata |
| [WUL-707](https://linear.app/wulfgardr/issue/WUL-707) | Primitive necessarie al pilota, vettori, custodia e benefici | Nessun port di crypto, chiavi, grant o policy |
| [WUL-708](https://linear.app/wulfgardr/issue/WUL-708) | Riutilizzo semantiche [WUL-727](https://linear.app/wulfgardr/issue/WUL-727), veri processi e cleanup | Il processo codec non è un supervisore né una prova di parent-death/descendant cleanup |
| [WUL-709](https://linear.app/wulfgardr/issue/WUL-709) | Una verticale sullo stesso SQLite con transazione e writer unici | Nessun SQLite aperto dall'esperimento |
| [WUL-710](https://linear.app/wulfgardr/issue/WUL-710), [716](https://linear.app/wulfgardr/issue/WUL-716) | Adapter sottili per il solo servizio migrato | Nessun adapter di produzione modificato |
| [WUL-736](https://linear.app/wulfgardr/issue/WUL-736) | Accettazione integrata, artefatto, beneficio e rollback | Non soddisfatta da un microbenchmark |
| [WUL-713](https://linear.app/wulfgardr/issue/WUL-713) | Valutazione WASM facoltativa su hotspot reale | KEEP; nessun hotspot browser accettato o benchmark browser disponibile |
| [WUL-714](https://linear.app/wulfgardr/issue/WUL-714), [711](https://linear.app/wulfgardr/issue/WUL-711), [589](https://linear.app/wulfgardr/issue/WUL-589), [632](https://linear.app/wulfgardr/issue/WUL-632) | Shell e distribuzione 0.9.6, Swift preservato su Apple salvo altra decisione | Ricerca GPUI separata; nessun cambio roadmap o piattaforma dichiarata |

La selezione provvisoria riguarda quindi **il codec**, non il pilota clinico.
Si è preferito un contratto già presente nella base a una nuova regola presa
dai prototipi futuri. La fixture di coorte WUL-747 proposta dall'altro task
resta riusabile per un successivo confronto puro, ma non è stata copiata né
portata qui: non occorre aggiungere un secondo problema a questo esperimento.

## IPC e FFI: cosa sostiene la proposta

Per desktop/headless proponiamo di valutare per primo un processo con canale
privato ereditato: consente di separare il crash dal client, al prezzo di copie,
serializzazione e lifecycle. È un giudizio architetturale condizionato, non un
vantaggio prestazionale dimostrato. La documentazione Rust avverte dei deadlock
quando pipe e letture/scritture non sono coordinate; la cancellazione e i
discendenti richiedono prove ulteriori rispetto a `spawn` o `kill`.
[Rust process](https://doc.rust-lang.org/std/process/index.html).

FFI può essere utile per il lifecycle Apple/mobile ma condivide il processo e
richiede disciplina su panic, buffer, thread e callback. UniFFI genera binding;
non risolve la distribuzione. Stringhe e record attraversano `RustBuffer`, con
serializzazione propria: non assumiamo FFI uguale a zero copie.
[UniFFI](https://mozilla.github.io/uniffi-rs/latest/),
[conversioni e serializzazione](https://mozilla.github.io/uniffi-rs/latest/internals/lifting_and_lowering.html).
Non è stato costruito un addon Node o un binding Swift: il confronto quantitativo
IPC/FFI sull'operazione reale resta aperto.

## GPUI e alternative

La direzione storica Rust/GPUI del 14 settembre teneva aperta la scelta della UI;
la memoria è orientamento, non decisione attuale. I documenti locali confermano
opzioni distinte: [ADR 0068](../adr/0068-cross-platform-runtime-windows-linux.md)
mantiene il runtime Node e shell sottili; [ADR 0071](../adr/0071-tri-os-reversed-flow-shared-core.md)
accetta una direzione nativa, ma condiziona la raccomandazione del linguaggio a
prove. Il [confronto packaging di luglio](./2026-07-17-installabilita-v0-scope.md)
tratta Tauri con sidecar come candidato successivo. Nessuno di questi documenti
prova che GPUI sia stato adottato.

GPUI è un framework UI Rust disegnato dalla GPU, non un prerequisito del nucleo.
Il [README fissato al commit `933d8d93819c749a607e561883855a9b95c79cea`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/gpui/README.md)
(25 settembre) dichiara macOS, Linux/FreeBSD e Windows, stato pre-1.0 e API ancora
soggette a cambiamenti. Non ne deriva supporto mobile o qualifica MediFlow.

| Criterio | GPUI | Tauri 2 / WRY | SwiftUI |
| --- | --- | --- | --- |
| Target dichiarati dal framework | macOS, Linux/FreeBSD, Windows nel README esaminato | Desktop e target mobili dichiarati dal progetto, con motori WebView diversi | Piattaforme Apple; nessuna qualifica Windows/Linux dedotta dal linguaggio Swift |
| Licenze da verificare sull'artefatto | Crate Apache-2.0; grafo risolto da controllare | Tauri dichiara MIT o MIT/Apache-2.0 dove applicabile; WRY ha proprie licenze | Framework e SDK Apple soggetti ai relativi termini; non confonderli con la licenza del compilatore Swift |
| Riuso MediFlow | Richiederebbe riscrivere la UI React e riprovare le interazioni | Può riusare la UI web dentro una WebView; resta il costo della shell e del sidecar Node | Conserva il lavoro Apple già presente |
| Accessibilità | Main include AccessKit ed esempio a11y; prove dei controlli clinici assenti | Semantica HTML e WebView di sistema; accessibilità del prodotto da verificare per OS | Supporto dei controlli standard Apple e modificatori; percorso reale comunque da provare |
| Integrazioni | Servizi di piattaforma ed esempi; bridge Apple e custodia da progettare | Plugin e capabilities; WRY è il componente WebView, non tutto il prodotto Tauri | Accesso diretto alle API Apple; non è una UI Windows/Linux |
| Distribuzione | Updater e packaging di Zed non sono automaticamente componenti di ogni app GPUI | Tooling di bundle/firma e plugin updater disponibili; sidecar per target | Firma, notarizzazione e lifecycle da qualificare nell'app MediFlow |
| Manutenzione | Nuovo toolkit, API pre-1.0, componenti e test da mantenere | Nuovo confine shell/WebView con differenze fra motori e target | Meno cambiamenti Apple, ma copertura limitata a quell'ecosistema |
| Prestazioni | Nessuna misura comparabile MediFlow acquisita | Nessuna misura comparabile acquisita | Nessuna misura comparabile acquisita |

Fonti della tabella: [GPUI](https://gpui.rs/),
[architettura Tauri](https://v2.tauri.app/concept/architecture/),
[processi e WebView](https://v2.tauri.app/concept/process-model/),
[sidecar](https://v2.tauri.app/develop/sidecar/),
[distribuzione](https://v2.tauri.app/distribute/),
[updater con firme](https://v2.tauri.app/plugin/updater/),
[accessibilità SwiftUI](https://developer.apple.com/documentation/swiftui/accessibility-fundamentals).
Per target e licenze: [Tauri README](https://github.com/tauri-apps/tauri/blob/dev/README.md),
[WRY README](https://github.com/tauri-apps/wry/blob/dev/README.md),
[accordo Apple](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).
Le voci sul riuso e sul costo sono inferenze dal codice MediFlow e dalle
architetture, non misure dei framework.

**Versioni GPUI:** il [manifest al commit esaminato](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/gpui/Cargo.toml)
riporta `0.2.2` e include AccessKit. Il
[manifest della crate 0.2.2 pubblicata](https://docs.rs/crate/gpui/0.2.2/source/Cargo.toml)
non contiene AccessKit; i [metadati VCS](https://docs.rs/crate/gpui/0.2.2/source/.cargo_vcs_info.json)
indicano `69e2130295c2649963eb639fc70b4f2ee8ea1624` e `dirty: true`.
Il numero di versione da solo non identifica quelle capacità.

**Licenze:** il manifest GPUI dichiara Apache-2.0; l'editor Zed ha una licenza
distinta. La segnalazione aperta [#55470](https://github.com/zed-industries/zed/issues/55470)
non basta a dimostrare una dipendenza GPL nel commit esaminato: lungo il percorso
`gpui → sum_tree → ztracing`, i manifest di
[ztracing](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/ztracing/Cargo.toml),
`zlog` e `ztracing_macro` dichiarano ora Apache-2.0. Non è un audit completo
del grafo dipendenze né un parere legale. Prima di distribuire va controllato
il grafo risolto della revisione realmente usata.

**Raccomandazione:** KEEP per le UI attuali. Un eventuale esperimento GPUI
successivo dovrà confrontare un vero percorso sintetico di lavoro con tastiera,
focus, input italiano, IME, selezione/copia, VoiceOver/NVDA/AT-SPI ove pertinenti,
dialoghi, stampa, recovery e update sul target nominato. La disponibilità di
AccessKit o una demo grafica non provano questi comportamenti. Per Windows/Linux,
Tauri/WRY resta il confronto con maggiore riuso previsto dalla roadmap; Swift
resta su Apple. Non stiamo modificando quella decisione.

## Esperimento e risultati

**Preparazione locale completata alle 09:34, dopo l'autorizzazione ricevuta.**
Il candidato in `experiments/rust-boundary/` contiene crate, lockfile, runner
e [risultati con hash e metadati](../../experiments/rust-boundary/results/2026-09-26-macos-arm64.json).
Il sorgente TypeScript originale è rimasto identico, SHA256
`d056ce6dcd56862a5c300952a9e75fe744f374c8e34fe135dd1d026baeb1a8b9`.
Il runner lo importa direttamente come riferimento, senza ricopiarne il decoder.

Sul candidato di **questo worktree** passano 3 test Rust, 7 test originali
TypeScript e 313 vettori differenziali: 41 accettati e 272 rifiutati, comprese
256 mutazioni riproducibili con seed 706. Sono provate le sette forme di frame,
enum, limiti numerici, chiavi duplicate/extra/riordinate, forme non canoniche,
limiti degli identificativi e BOM iniziale. L'oracolo conserva il BOM perché
sia il decoder originale a rifiutarlo; la conversione UTF-8 non normalizza
l'input. Altre quattro prove verificano solo il processo Rust: UTF-8 invalido,
header incompleto, payload incompleto e lunghezza dichiarata di 4097 byte.
È conformità sul campione, non una dimostrazione esaustiva né una qualifica
dell'encoder di oggetti JavaScript o dei controlli di autorità.

Le tre esecuzioni finali usano gli stessi byte su Apple M4 Max, 36 GiB RAM,
macOS 27.2 build 26B5091g, arm64, Node 24.21.0 e Rust/Cargo 1.98.1. Altri
carichi del sistema non sono controllati. Il workload cicla sette frame da
131 a 598 byte. Il framing è lo stesso per i due processi figli: lunghezza
LE u32, JSON e una sola richiesta pendente. Gli ordini Node/Rust si alternano.

| Percorso misurato | Campioni per esecuzione, dopo warm-up | Intervallo delle mediane, ms | Intervallo dei p95, ms |
| --- | --- | --- | --- |
| TypeScript nel processo corrente | 5600, scartati 1400 | 0,00150–0,00154 | 0,00363–0,00371 |
| Node con pipe già aperta | 1000, scartati 200 | 0,02367–0,02796 | 0,04000–0,06533 |
| Rust con pipe già aperta | 1000, scartati 200 | 0,01658–0,01988 | 0,02688–0,03713 |
| Nuovo Node, un frame e uscita | 12, nessuno scartato | 83,46–84,35 | 85,37–93,60 |
| Nuovo Rust, un frame e uscita | 12, nessuno scartato | 2,000–2,043 | 2,227–2,412 |

Gli intervalli riassumono tre esecuzioni, non sono intervalli di confidenza.
I JSON conservano anche minimo, massimo, media e deviazione standard. Rust
riduce il tempo rispetto al figlio Node in questa prova, ma aggiungere IPC al
codec oggi locale costa più dell'esecuzione TypeScript nel processo corrente.
Questo sostiene **KEEP** per il percorso attuale, non una graduatoria fra
linguaggi. La misura di avvio Node include il caricamento e la trasformazione
del modulo TypeScript; Rust è un binario release ottimizzato. Nessuno dei due
numeri descrive l'avvio di MediFlow.

Il binario locale pesa 575.296 byte, SHA256
`c7ccdb0891b9b94b4872dce14c49a29d2fa694c986f8d311e8b6724f0291b2f8`.
La build release ha exit code 0, ma segnala che `rust-objcopy` non ha completato
la rimozione dei simboli perché manca `libLLVM.dylib` nel toolchain locale.
Il binario è stato eseguito con successo; il peso non descrive un pacchetto
distribuibile, firmato o ottimizzato definitivamente. Sono risolte cinque crate
esterne attive: `serde_json 1.0.145`, `itoa 1.0.18`, `memchr 2.8.3`, `ryu 1.0.23`
e `serde_core 1.0.229`; il lockfile conserva anche dipendenze opzionali non attive.
`forbid(unsafe_code)` riguarda il codice della prova, non qualifica le dipendenze.

Rust è installato soltanto sotto `tmp-rust-evaluation/toolchain/install`.
I tre componenti ufficiali sono verificati contro i digest del manifesto del
3 settembre, conservati nei metadati. La directory temporanea occupa circa
955 MiB inclusi download, estrazione e installazione; non è peso dell'app.
Il precedente checkpoint parziale e le prime misure rimangono nell'evidenza
locale; i tre run finali includono il controllo BOM aggiunto al runner.

Comandi eseguiti dalla root, con la toolchain locale nel `PATH`:

```sh
cargo test --offline --locked --manifest-path experiments/rust-boundary/Cargo.toml
cargo build --offline --locked --release --manifest-path experiments/rust-boundary/Cargo.toml
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  experiments/rust-boundary/compare.mjs \
  tmp-rust-evaluation/target/release/mediflow-rust-boundary-experiment \
  tmp-rust-evaluation/evidence/codec-final-1.json
```

`CARGO_TARGET_DIR` era `tmp-rust-evaluation/target` sotto questo worktree;
`CARGO_HOME` riusava la cache preparata nel clone temporaneo del collaboratore.
Per riprodurre altrove, scegliere directory temporanee proprie e popolare prima
la cache dal lockfile: `--offline` richiede quelle dipendenze già disponibili.
I due run successivi cambiano solo il nome del JSON di uscita. Non è richiesto
un aggiornamento globale della toolchain.

Passano anche `check:claims` (722 file, zero segnalazioni), `check:never-regress`,
il controllo sintattico del runner, `git diff --check` e i link locali dei nuovi
documenti. Il primo tentativo del guard non trovava TypeScript; è stato
rieseguito riusando localmente la stessa versione 5.9.3 del lockfile. Lint,
build e suite applicativa completa non eseguiti: nessun codice del prodotto è
modificato e il worktree non ha tutte le dipendenze Node. Questa consegna locale
non attesta quindi la Definition of Done di una futura PR d'integrazione.

I figli diretti della prova terminano con exit code 0; i codec non creano
discendenti. Non sono prove di parent death o supervisione WUL-708. Restano
non misurati RSS, CPU, FFI, query SQLite, UI, target Windows/Linux e artefatto
installato. Nessuna soglia C02 o accettazione WUL-736 deriva da questi numeri.

## Condizioni per il seguito

Il materiale integrabile come preparazione è il dossier, l'ADR Proposed e
l'esperimento non importato dalla produzione, dopo review del diff. Gli indici
contengono soltanto aggiunte, da riconciliare dall'owner comune. Non è pronto
per il runtime alcun pezzo di autorità, supervisione o accesso dati Rust.

Per la verticale reale servono: acceptance 735/573/580, operazione selezionata,
workload e soglie C02, owner della connessione e transazione, protocollo
congelato, prova storage/processi/rollback e review indipendente. Il percorso
e le condizioni di arresto sono nell'ADR. Il reset d'uso interrompe nuovo
sviluppo quando viene **osservato**; il checkpoint delle 09:00 italiane non è
stato scambiato per un orario di reset noto.
