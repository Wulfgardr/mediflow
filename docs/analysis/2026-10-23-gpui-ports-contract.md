# G-1a.1: contratto porte e lifecycle GPUI

Base: `18c0a179bd98a8c53c13b77653aed6fc682f75b4`, 23 ottobre 2026.
Part of WUL-771; riferimento WUL-706.

Il [censimento](./2026-10-23-gpui-census.md), riga G-1a e SEC-2/3,
e il [contratto 0.9.1](../releases/0.9.1-contract.md), sezione G, definiscono
il perimetro. [ADR 0161](../adr/0161-gpui-host-ports-lifecycle.md) conserva
roster, compatibilità e decisione 2 approvata da Leonardo il 23 ottobre.

## Risultato

La discovery host dichiara otto porte con revisione, scope e autorità separati.
La fixture JSON del trasporto è confrontata con il produttore host nei test:
una divergenza non può passare silenziosamente. Il nuovo client rifiuta la
negoziazione incompatibile; i vecchi client possono ignorare il campo additivo.
Nessuna nuova route privilegiata, grant, generazione, writer o SQLite nel client.

`RequestContext` ritira le future HTTP e i body in attesa. I contesti workspace,
profilo paziente e preferenze AI seguono la selezione; il profilo account segue
invece la sessione operatore. Condividono la radice di revoca della sessione:
i cloni workspace vecchi restano ritirati e una selezione nuova non rinnova
una sessione revocata.
Il ritiro conserva il segnale di sostituzione archivio distinto da un
normale conflitto di versione. Una mutazione avviata e poi cancellata rimane indeterminata.

La shell acquisisce la sessione dopo il cambio di contesto. Le transizioni
interne di conferma e riconciliazione delle scale conservano invece il loro
intento sigillato. L'arrivo di `ARCHIVE_REPLACED` revoca la sessione e le
richieste sorelle anche se un risultato precedente viene scartato dalla UI.

## Prove

Tutti i dati e i server delle prove sono sintetici, su loopback. Rust 1.98.1,
pin GPUI `56934ec0560bce8929025497411de7f5322fb6ca`, target locale privato.
Nessun archivio clinico reale o installazione primaria utilizzati come fixture.

- **Base rossa:** 98 test trasporto passano; tre falliscono perché il contratto
  incompatibile viene accettato, il lock attende ancora il server e il restore
  non revoca le richieste sorelle. La variante di scope sulla base fallisce
  anch'essa sull'accettazione errata. Il nuovo test host fallisce perché il
  roster è assente.
- **Fix:** 281 test Rust passano: 152 app, 24 client/flow, 104 trasporto e
  un probe. Comprendono i percorsi GPUI collegati delle note e delle scale.
  Le prove di cancellazione osservano il socket chiuso prima della risposta
  del server, sia prima degli header sia durante il body. Il cambio selezione
  preserva il contesto nuovo; la mutazione pendente è indeterminata e non ritentata.
- **Falsificazione iniziale:** le prove di scope, cancellazione della future e
  ritiro su `ARCHIVE_REPLACED` hanno evidenza rossa. La precedente affermazione
  sulla revisione non era sostenuta dal log: quel mutante passava, perché la
  fixture aveva anche un roster incompleto. La nuova prova isolata della
  revisione è riportata sotto.
- **Host mirato:** 18 test verdi su discovery, contratto e assenza di grant
  paired impliciti. Inventario/fixture del selettore: 24 test verdi.
- **Altri gate:** Clippy workspace con `-D warnings`, fmt, lint, typecheck,
  `test:inventory-browser`, never-regress, claims, OpenAPI drift e inventario
  dei test. OpenAPI passa a 1.43.0 per il campo additivo `hostPorts`.
  Il gate formale delle terapie non ha input coperti modificati: nessuna
  nuova prova formale della cancellazione viene dichiarata.

Comandi Rust dalla directory `experiments/gpui-patient-pilot`, con target
privato e toolchain del file `rust-toolchain.toml`:

```sh
cargo test --locked --offline --workspace --all-targets --features gpui_platform/runtime_shaders
cargo clippy --locked --offline --workspace --all-targets --features gpui_platform/runtime_shaders -- -D warnings
cargo fmt --all --check
```

## Correzioni della review del 23 ottobre

La riproduzione di Astra, con GET account pendente e barriera sul server,
fallisce su `b076f267e` con `workspace epoch cancelled an account-authority read`.
È ora inclusa nei test GPUI, insieme alla PUT pendente. Entrambe usano il
contesto della shell per il login, così il cambio workspace ritira anche la
selezione iniziale senza interrompere il profilo account. Il trasporto crea
un contesto account con la stessa radice di revoca, indipendente dalle selezioni
workspace. Il runner conserva la propria generazione account.

La suite finale passa **285 test Rust**: 154 app, 24 client, 106 trasporto e
un probe. La nuova prova di revoca verifica GET e PUT account dopo il cambio
workspace, sia per lock sia per ritiro dell’archivio: il socket si chiude prima
del rilascio del server; una PUT già avviata resta indeterminata. Le prove
esistenti della risposta host `ARCHIVE_REPLACED` continuano a passare.

I test della revisione radice e dello scope partono ora dal roster completo,
modificando una sola dimensione. In copia isolata, sostituire il confronto
`value["revision"] != 1` con `value.get("revision").is_none()` rende rosse
sia la nuova prova diretta sia la discovery su loopback. Il controllo di
presenza rimane: il mutante ammette la revisione 99 di un roster valido.
Anche ricollegare il contesto account al workspace rende rosse le due
sonde GPUI. Ripristinati i sorgenti nella copia isolata, tutte queste prove
tornano verdi.

Prima del push: fmt e Clippy workspace con `-D warnings`, 18 test host,
lint, typecheck, never-regress, claims, OpenAPI drift e inventario test verdi.
Il gate formale terapie passa, senza estendere la sua copertura al lifecycle.
La build locale riproduce ancora il blocco di metadata descritto sotto;
l’intera suite JavaScript non viene rieseguita in questa correzione Rust.

ADR 0161 registra la decisione 2, opzione 1, già approvata da Leonardo e
comunicata sulla PR. Il round 2 ha confermato questi tre punti e richiesto
la correzione del P1 descritta sotto.

## Correzioni del round 2

Il runner account ora consuma `retires_session()` e il motivo conservato dalla
sessione, come il runner comune. GET e PUT del profilo che rilevano
`ARCHIVE_REPLACED` o una generazione diversa disconnettono la shell e rimuovono
selezione, cache e bozze non salvabili. I callback della generazione account
precedente vengono scartati e i cloni della sessione non inviano altre richieste.
Questo corregge l’incoerenza introdotta da G-1a.1, senza chiudere tutta SEC-3.

Le quattro sonde comparative di Astra sono state ripetute su `b64fbcd80`:
**4/4 rosse** con trasporto ritirato e shell ancora con sessione, selezione e
snapshot account. I test permanenti derivano da quelle sonde e aggiungono
cache paziente, bozza account, editor note ancora referenziato, autorità di
scrittura, callback tardivo e tentativi GET/PUT con il clone ritirato.
Una quinta prova conserva il ritiro reale da HTTP e presenta al runner un
risultato `Indeterminate`, per esercitare separatamente il motivo registrato
nella sessione. Tutte e cinque sono rosse prima del fix e verdi dopo.

`NetworkCapabilitiesResponse` richiede ora `hostPorts` in OpenAPI e TypeScript;
la fixture discovery dichiara il roster corrente e il protocollo 1.14.0. Il
produttore host già emette il campo. Il test dello schema accetta la risposta
completa e respinge quella con il solo `hostPorts` rimosso; prima del fix
quest’ultima era erroneamente valida. Una discovery HTTP senza il campo viene
respinta dal client con `UnsupportedProtocol` e non abilita la scrittura.
Il passaggio a campo obbligatorio è registrato esplicitamente nella policy
OpenAPI per WUL-771; il guard resta attivo.

Suite finale: **291 test Rust verdi**, 159 app, 24 client, 107 trasporto e
un probe, dopo pulizia dei tre package sul target privato; **19 test host verdi**.
Verdi anche fmt, Clippy workspace `-D warnings`, lint, typecheck, never-regress,
claims, OpenAPI drift, inventario test, browser inventory e gate formale terapie.
Quest’ultimo non prova il lifecycle account. L’estensione iniziale della fixture
condivideva lo status HTTP tra GET e PUT, facendo fallire la rilettura dopo un
conflitto; i due status sono ora separati e la prova esistente torna verde.

Falsificazioni in copia isolata: ripristinare il vecchio controllo
`is_auth_failure()` rende rosse le cinque regressioni; togliere soltanto il
fallback a `retirement_error()` rende rossa la prova indeterminata. Ammettere
una discovery senza `hostPorts` rende rossa la prova HTTP; rimuovere il campo
da `required` rende rossa la prova dello schema. Ripristino verde in ogni caso.
I mutanti non sono stati applicati al worktree di consegna.

**Nessun merge: serve il round 3 indipendente di Astra.** SEC-2 e la matrice
completa SEC-3 restano G-1a.2; il runner account dopo ritiro archivio è corretto
in questa tranche. Build e suite JavaScript completa non rieseguite nel round 2;
i risultati precedenti restano distinti sotto.

## Errori finali già presenti sulla base

`npm run test:unit`: 7.766 test, 7.749 passati, 3 falliti, 14 saltati.
I tre test falliti sono in `lib/chatgpt-execution/execution-mac.test.ts`:

- `pinned complete source, receipts and 24 C1 comparisons validate only the fixed projection`;
- `source truncation, wrong receipt and unknown or invalid typed inputs are rejected`;
- `native source pin is over the complete delivered C bytes, never a caller helper digest`.

Mancano `MEDIFLOW_MAC_PUBLIC_SOURCE_DIR`, `MEDIFLOW_MAC_C1_RECEIPT` e
`MEDIFLOW_MAC_NATIVE_SOURCE`: non sono stati inventati o sostituiti i sorgenti
congelati. Gli stessi tre errori sono riprodotti nel worktree isolato della
base `18c0a179b`. Tutte le prove host toccate e quelle dell'inventario passano.

`npm run build`: il prebuild si arresta con
`Build input metadata: private file is reachable`, identico sulla base.
Il controllo raggiunge anche la fixture SQLite già tracciata sotto i test
nativi; non è stato indebolito né aggirato per ottenere una build verde.

Un tentativo precedente della suite ha avuto un timeout del test Mini su lock;
la prova mirata sulla base e l'intera esecuzione finale lo superano. Gli errori
del primo setup con dipendenze collegate sono stati risolti usando dipendenze
fisiche nel worktree; non sono classificati come difetti preesistenti.

## Limiti

G-1a.1 non chiude SEC-2/3. Il download controlla il contesto comune, ma la
barriera tra controllo ed effetto, il punto di non ritorno e la matrice di
ritiro di tutti i form/effects restano **G-1a.2**, da eseguire dopo il merge.
G-1a resta incompleta finché entrambe le PR non siano accettate. Non sono
attestate installazione GPUI, prove sul prodotto distribuito o uso clinico.
