# Prima verticale paziente Rust / GPUI

**Verbale storico della demo in memoria.** Il comando normale ora apre il
[client collegato](./2026-10-17-rust-gpui-connected-client.md); la demo qui
descritta resta disponibile con `--demo`. I conteggi, le immagini e i limiti
di questa prima prova non sono stati attribuiti alla nuova implementazione.

Data: 17 ottobre 2026. Refs [WUL-706](https://linear.app/wulfgardr/issue/WUL-706),
[WUL-714](https://linear.app/wulfgardr/issue/WUL-714),
[WUL-574](https://linear.app/wulfgardr/issue/WUL-574).

Base MediFlow: `3d4e5f0ffff8367c5be0bb73c62665b7e2eab1af`, dopo la release
sorgente 0.9.0 e la pulizia PR #557. Questo verbale si riferisce ai sorgenti
e alle prove aggiunti dalla PR che lo contiene; non rinnova le qualifiche
della release o le prove native precedenti.

## Risultato e scelta

È disponibile un [workspace avviabile](../../experiments/gpui-patient-pilot/README.md)
con un client Rust indipendente dalla UI e una finestra GPUI che esegue
elenco, ricerca, scheda paziente, note, revisione, conferma e rilettura.
Il servizio di prova possiede cinque fixture inventate, soltanto in memoria.
Le modifiche non sopravvivono alla chiusura dell'applicazione.

Questa tranche sostituisce lo studio del solo codec con una prova del lavoro
utente della verticale selezionata. Conserva l'esperimento codec precedente
nel proprio namespace. Per rendere concreto il confine successivo, aggiunge
anche la [caratterizzazione cifrata continua](./2026-10-17-patient-notes-pilot.md)
di scheda e note sui due ingressi HTTP correnti, che mancava a WUL-574.

La scelta di questa tranche è **portare in Rust lo stato del client**, mantenendo
trasporto e autorità clinica separati. Il client non possiede SQLite, chiavi,
cifratura, permessi o audit. Il writer TypeScript corrente continua a essere
quello esercitato dalla prova HTTP. [ADR 0137](../adr/0137-rust-boundary-pilot-proposal.md)
resta Proposed: il pilota non sceglie il futuro confine IPC/FFI.

## Comportamenti portati in Rust

| Caso | Comportamento verificato |
| --- | --- |
| Selezione e richieste tardive | La risposta deve appartenere alla stessa istanza di workspace, richiesta e paziente. Cambiare selezione o ricreare la finestra non rende attuale una risposta precedente. |
| Bozza e revisione | Una modifica invalida la revisione precedente. Il cambio scheda non scarta lavoro pendente. Solo una bozza cambiata e rivista può produrre un comando. |
| Doppio invio | Una seconda conferma mentre la richiesta è in corso viene respinta. |
| Risposta positiva | L'ack avvia una lettura distinta. «Registrata» richiede la versione successiva esatta e le note confermate. |
| Conflitto o esito incerto | La bozza resta visibile/copiabile. Non parte un retry né una scrittura tramite un'implementazione alternativa. Scarto/rilettura sono espliciti. |
| Identità e numeri del contratto | ID nel percorso, body notes-only `{version, notes}`, numeri positivi entro il limite degli interi sicuri JavaScript. |
| Contenuto | Note nullable, accenti, emoji e limiti in unità UTF-16. Il limite dell'editor delimita il pilota e non modifica il writer HTTP. |
| Dati nascosti | Selezione, bozza e ticket vengono invalidati; le scorciatoie ordinarie non riaprono i dati. È un controllo logico della demo. |

La UI riusa i token **Punto d'inchiostro**, Newsreader e IBM Plex Mono già nel
repository. Comprende Giorno/Grafite, focus, controlli con ruoli e nomi
accessibili, copia esplicita e un editor multilinea. La fixture archiviata
è consultabile nella demo; questo non definisce una nuova policy di dominio.

## Prove locali

Ambiente: Linux x86_64, Rust **1.98.1**, Node **24.19.0**, dipendenze dal
lockfile, build GPUI `dev` senza debug info. Le dipendenze sono state
scaricate prima delle esecuzioni Cargo con `--offline`.

| Verifica | Esito |
| --- | --- |
| `cargo test --workspace --all-targets --locked` | **27 pass, 0 fail, 0 ignored**: 20 client, 3 servizio sintetico, 4 input Unicode/composizione. |
| `cargo build --locked -p mediflow-gpui-patient-pilot` | PASS su Linux, binario realmente avviato. |
| `cargo fmt --all --check` | PASS. |
| `cargo clippy --workspace --all-targets --locked -- -Dwarnings` | PASS senza esclusioni aggiunte. |
| Test cifrato note Web/API v1 | **1 pass, 0 fail, 0 skip** con SQLite sintetico reale; [comando e osservazioni](./2026-10-17-patient-notes-pilot.md). |
| Test del selettore/collegamento CI | **28/28 pass**, inclusi dieci casi di alterazione dei manifest/comandi. |
| Inventario test repository | **COMPLETE**: 1.043 file, 1.014 selezionati, 29 esclusioni preesistenti; nessuna esclusione nuova. |
| `npm run lint`, `npm run typecheck`, `npm run check:claims` | PASS. |
| `git diff --check` | PASS. |

I comandi Cargo partono da `experiments/gpui-patient-pilot`; il
[README](../../experiments/gpui-patient-pilot/README.md) contiene i comandi completi
e i prerequisiti. La CI usa lo stesso comando con `--manifest-path` dalla
radice del repository.

### Finestra realmente eseguita

La finestra è stata avviata su un display **X11/Xvfb 1440×1000** in questo
container, con Mesa e rendering software, dimensione iniziale **1200×840**.
Mouse e tastiera sono stati inviati al processo reale con `xdotool`; le
schermate sono catture della finestra GPUI, senza ricostruzione grafica.
L'avvio non richiede il server Node del prodotto.

È stato osservato il percorso scheda → modifica multilinea → revisione
con testo precedente e nuovo → conferma → rilettura → «Registrata».
Una sola pressione di Ctrl+Invio apre la revisione. La prova del contenuto
di questa UI resta sintetica e non è un test di un archivio clinico collegato.

Sono stati verificati anche il passaggio Giorno/Grafite, il blocco della
conferma mentre è aperta la richiesta di scarto e il blocco della navigazione
Alt+freccia dopo «Nascondi dati». Le
[schermate della revisione](../../experiments/gpui-patient-pilot/evidence/linux-review.png)
e [del salvataggio Grafite](../../experiments/gpui-patient-pilot/evidence/linux-saved-grafite.png)
e il [record con digest](../../experiments/gpui-patient-pilot/evidence/local-verification.json)
identificano il codice e il binario locale osservato. Una correzione visiva
conserva il contrasto dell'indicazione di bozza anche nella richiesta di scarto.

La review indipendente ha individuato e fatto correggere quattro classi di
difetto: correlazione fra workspace ricreati, commit IME identico al preedit,
highlight Unicode sovrapposti e azioni da tastiera durante dati nascosti o
richiesta di scarto. Le regressioni usano gli helper dell'editor effettivo;
le guardie UI sono state riesaminate sul sorgente. Non restano finding
bloccanti nel perimetro di quella review. Non si tratta di un audit generale
del prodotto o delle dipendenze GPUI.

## Pin upstream e costo introdotto

GPUI e `gpui_platform` sono fissati allo stesso commit
[`56934ec0560bce8929025497411de7f5322fb6ca`](https://github.com/zed-industries/zed/tree/56934ec0560bce8929025497411de7f5322fb6ca).
Il [toolchain upstream](https://github.com/zed-industries/zed/blob/56934ec0560bce8929025497411de7f5322fb6ca/rust-toolchain.toml)
richiede Rust 1.98.1. La UI usa l'ingresso `gpui_platform::application()` di
questo pin: il numero di versione `gpui 0.2.2` non basta per scegliere API
o documentazione compatibili.

Il manifest e il lockfile fissano anche le patch Git necessarie del workspace
upstream. Sono dipendenze reali da mantenere: la scelta di Rust non elimina
la toolchain grafica, i backend di sistema o gli aggiornamenti del framework.
Il [README GPUI](https://github.com/zed-industries/zed/blob/56934ec0560bce8929025497411de7f5322fb6ca/crates/gpui/README.md)
e l'[implementazione AccessKit](https://github.com/zed-industries/zed/blob/56934ec0560bce8929025497411de7f5322fb6ca/crates/gpui/src/_accessibility.rs)
del pin sono i riferimenti consultati. La presenza di AccessKit permette di
implementare semantica accessibile; non sostituisce le prove con tecnologie
assistive sulle piattaforme target.

Il codice MediFlow mantiene la licenza del progetto, con attribuzione Apache
per il componente derivato dall'esempio GPUI e licenze dei font conservate.
Non viene importato il crate GPL Zed `ui`. Provenienza e modifiche sono in
`experiments/gpui-patient-pilot/NOTICE`.

## Criteri WUL-714 ancora da decidere o misurare

| Dimensione | Stato di questa tranche |
| --- | --- |
| GPUI Linux | Build, test e finestra X11 eseguiti nel container. Wayland non esercitato. |
| GPUI macOS / Windows | Workflow di compilazione/test aggiunto. L'esito della CI remota è quello del commit nella PR, non un risultato anticipato da questo verbale. |
| Tauri / shell attuale / Swift | Percorsi esistenti e candidati di confronto; nessun nuovo benchmark comparativo eseguito qui. |
| Avvio, RSS, fluidità, energia | Nessuna soglia o superiorità dichiarata. Servono build release, stesso workload, hardware e metodo prima/dopo. |
| Installer, firma, aggiornamento e rollback installato | Non prodotti da questa tranche. Il workspace si avvia dai sorgenti. |
| Accessibilità completa | Ruoli, nomi e focus implementati; screen reader, contrasto assistivo, IME di sistema e scaling ancora da provare per OS. I test IME qui sono regressioni del componente. |
| iPhone / iPad | Nessuna qualifica GPUI. Il lavoro Swift resta il percorso mobile esistente. |
| Dati reali e servizio condiviso | Nessun adapter Rust/HTTP operativo; auth, chiavi, audit, idempotenza e ricevute restano al confine 0.9.1 da accettare. |

Una prossima misura dovrà registrare commit, toolchain, modalità release,
hardware/driver, dataset sintetico comune, numero di ripetizioni e campioni
grezzi. Avvio fino a finestra utilizzabile, picco/steady RSS e dimensione del
pacchetto vanno rilevati separatamente. I tempi di build o gli screenshot
di questa prova non dimostrano un vantaggio rispetto alla shell esistente.

## Prossimo passaggio operativo

1. Riesaminare e accettare in WUL-574 la scelta scheda/note e la nuova baseline.
2. WUL-582 decide il confine applicativo e la disposizione dell'autorità Swift
   opzionale registrata in [C01](../authority-census.md); proseguire la sequenza
   0.9.1 fino alle prove WUL-580 e all'accettazione WUL-573.
3. Collegare il client Rust alla stessa autorità tramite un adapter ammesso,
   poi confrontare la sostituzione di una sola operazione sotto WUL-706/709.
   Trasporto, compatibilità, risposta persa e rollback precedono la rimozione
   dell'implementazione precedente.
4. WUL-714 usa questo stesso percorso per il confronto grafico installato e
   decide l'adozione desktop per piattaforma. WUL-736 conserva il gate Rust.

Per questo workspace il rollback è arrestare il binario ed eliminare il
namespace sperimentale e il workflow. Nessuno schema dati, launcher del
prodotto o writer clinico è stato sostituito.
