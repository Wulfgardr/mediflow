# G-1a.1: contratto porte e lifecycle GPUI

Base: `18c0a179bd98a8c53c13b77653aed6fc682f75b4`, 23 ottobre 2026.
Part of WUL-771; riferimento WUL-706.

Il [censimento](./2026-10-23-gpui-census.md), riga G-1a e SEC-2/3,
e il [contratto 0.9.1](../releases/0.9.1-contract.md), sezione G, definiscono
il perimetro. [ADR 0161](../adr/0161-gpui-host-ports-lifecycle.md) conserva
roster, compatibilità e proposta per la decisione 2.

## Risultato

La discovery host dichiara otto porte con revisione, scope e autorità separati.
La fixture JSON del trasporto è confrontata con il produttore host nei test:
una divergenza non può passare silenziosamente. Il nuovo client rifiuta la
negoziazione incompatibile; i vecchi client possono ignorare il campo additivo.
Nessuna nuova route privilegiata, grant, generazione, writer o SQLite nel client.

`RequestContext` ritira le future HTTP e i body in attesa. Sessione, selezione
e richieste figlie di profilo/preferenze AI condividono il lifecycle; i cloni
vecchi restano ritirati e una selezione nuova non rinnova una sessione revocata.
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
- **Falsificazione:** togliere il controllo di revisione, di scope, il ramo di
  cancellazione della future o il ritiro su `ARCHIVE_REPLACED` rende rossa la
  rispettiva prova, per una violazione semantica. Ripristinati i sorgenti,
  i 104 test del trasporto tornano verdi nella copia isolata dei mutanti.
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
