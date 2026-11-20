# Collaudo dell’interfaccia da terminale

La CLI avvia una postazione sintetica per ogni esecuzione. Legge un’azione JSON per riga da un file con `--file` oppure da stdin. Ogni riga produce un esito JSON. Inizia con `discover`, leggi il risultato e invia la prossima azione nella stessa sessione. Concludi con EOF. Un’azione fallita chiude la postazione e restituisce codice 1.

## Web

Servono Node 24, le dipendenze npm del repository e Google Chrome aggiornato. Usa una build standalone di MediFlow prodotta da una checkout fidata, con asset statici e manifesto di identità. La cartella indicata da `--out` deve già esistere.

```sh
npm run --silent test:ui:cli -- \
  --build .next/standalone --revision "$(git rev-parse HEAD)" \
  --out "$PROVE" --file e2e/ui-cli/web-091.jsonl
```

[La sequenza della candidata 0.9.1](../e2e/ui-cli/web-091.jsonl) configura e sblocca l’archivio di prova con passphrase e PIN sintetici. Crea Adele Collaudo dalla UI, la cerca e apre la scheda. Aggiunge un documento di testo, attende la conferma di salvataggio, apre l’originale e ne verifica il contenuto. Torna al riepilogo e scrive una bozza. Restringe la vista da 1320 a 390 px, apre **Altro** e usa **In arrivo**. Torna alla bozza, ripristina 1320 px, chiude il compositore e riapre la bozza via tastiera verificando lo stesso testo. Sulla candidata, usa il percorso e lo SHA della relativa build. Le etichette appartengono alla build eseguita. Dopo una variazione della UI, usa `discover` per aggiornare le azioni.

Per guidare il banco dal terminale, ometti `--file` e invia singole righe come queste. Per riprodurre la sequenza via pipe, passa le stesse righe a stdin.

```jsonl
{"op":"discover"}
{"op":"fill","target":{"role":"textbox","name":"Nome e cognome"},"value":"Dottore Sintetico"}
{"op":"expectValue","target":{"role":"textbox","name":"Nome e cognome"},"value":"Dottore Sintetico"}
```

Un target è `{"role":"button","name":"Avanti"}` o `{"label":"Passphrase"}`. Sul Web usa `{"text":"Altro"}` per testo visibile esatto quando il censimento mostra testo senza un nome di ruolo. Ruolo e nome sono quelli del censimento, con corrispondenza esatta. Un array di target restringe il controllo in successione, per esempio una navigazione e poi un link al suo interno. Ogni livello deve identificare un solo controllo. La CLI si arresta sul primo target assente o ambiguo, prima di azionarlo. L’asserzione `hidden` può riuscire anche quando il controllo è assente.

| Azioni | Parametri oltre a `op` |
| --- | --- |
| `resize` | `width` e `height` interi in pixel CSS, rispettivamente 280–3840 e 240–2160. La ricevuta riporta il viewport osservato. |
| `discover` | `target` facoltativo per restringere il censimento |
| `click`, `focus`, `check` | `target` |
| `scroll` | `target`, con `deltaY` opzionale per la rotella in pixel |
| `press` | `key` come `Tab`, `Enter` o `Shift+Tab` e `target` facoltativo |
| `fill`, `select` | `target` e `value`, per `select` è il nome visibile dell’opzione |
| `expect` | `target` e `state` fra `visible`, `hidden`, `focused`, `enabled`, `selected`, `expanded` |
| `expectText`, `expectValue` | `target` e `value`. `expectText` accetta `contains: true` |
| `uploadText` | `target` del selettore file, `file` senza estensione e testo sintetico in `value` |
| `download` | `target` che avvia il download. L’esito registra nome, dimensione e SHA-256 |
| `screenshot` | `file` senza estensione, nella cartella di prova |
| `back` | Cronologia del browser |

La cartella della singola esecuzione contiene `ricevuta.jsonl`, i log e le catture richieste. La prima riga identifica la build verificata, il browser e l’archivio inizialmente vuoto. Le verifiche registrano lo stato osservato. Al termine il banco chiude il suo Chrome effimero e il suo server e rimuove la copia della build, l’archivio di prova e i download.

Il browser usa Chrome sandboxato e può raggiungere soltanto l’origine loopback assegnata al banco. Le azioni passano dai controlli del prodotto, comprese le conferme di primo avvio. Usa esclusivamente dati inventati. La CLI accetta i testi sintetici degli allegati in linea, senza percorsi di file da caricare. I gesti fisici, Touch ID, le operazioni riservate al medico e il collaudo su postazioni personali restano manuali. Il plugin `mediflow-local-ui` conserva il proprio mandato di navigazione.

## Capacità per superficie

| Capacità | Web | Dimostrazione GPUI | Shell GPUI |
| --- | --- | --- | --- |
| Censimento | Albero della pagina | Controlli strumentati della demo | Nodi AccessKit strumentati, conteggi ed esclusioni |
| Target composti, testo visibile esatto | Sì | Ruolo/nome o label singoli | Ruolo/nome o label singoli |
| `resize` nella stessa sessione | Sì | Finestra di test fissa | Sì, callback resize del backend di test |
| Scroll | Porta un controllo in vista o invia una rotella | No | Rotella sui contenuti della scheda e sul vassoio Cambiato, con lettura dello spostamento |
| Testo e tastiera | Tastiera, campi ed esiti via Playwright | Campi della dimostrazione | Editor visibili e non riservati, tab e controlli con focus esposto. Selezione del testo in byte UTF-8. |
| Screenshot, trasferimenti file | Sì | No | No |

## Dimostrazione GPUI nel renderer di test

[Il copione della dimostrazione](../e2e/ui-cli/gpui-demo.jsonl) guida la demo in memoria usando click e tastiera del banco GPUI. Compila il test della revisione da certificare e usa il percorso dell’eseguibile di test riportato da Cargo.

```sh
export MEDIFLOW_UI_CLI_REVISION="$(git rev-parse HEAD)"
cargo +1.98.1 test --locked --manifest-path experiments/gpui-patient-pilot/Cargo.toml \
  -p mediflow-gpui-patient-pilot --bin mediflow-gpui-patient-pilot --no-run

npm run --silent test:ui:cli -- --surface gpui-renderer \
  --build "$BINARIO_TEST_GPUI" --revision "$MEDIFLOW_UI_CLI_REVISION" \
  --out "$PROVE" --file e2e/ui-cli/gpui-demo.jsonl
```

Il censimento riguarda i controlli strumentati della demo che hanno geometria nel frame corrente. Si può guidare per ruolo e nome ciascun controllo censito. Sono disponibili `discover`, `click`, `focus`, `fill`, `press`, `expectValue`, `expectText` con corrispondenza esatta e `expect` con stato `visible` o `focused`. Le azioni disponibili dipendono dal controllo. La ricevuta identifica l’eseguibile di test con lo SHA-256. Il test controlla la bozza attraverso il campo della demo. L’albero AccessKit esposto al sistema, la cattura della finestra installata, i documenti della scheda collegata e i gesti fisici richiedono una prova sulla relativa superficie.

## Shell GPUI con archivio sintetico

`--surface gpui-shell` usa lo stesso binario di test e monta `ClinicalApp`, il vero Shell di MediFlow. Il banco apre la scheda sintetica di Amina Sintetica su un host di test in memoria con 14 voci e una finestra simulata da 1360 × 900. La preparazione iniziale è parte della fixture. Da quel punto il copione usa gli eventi del Shell e l’editor effettivo.

```sh
npm run --silent test:ui:cli -- \
  --surface gpui-shell --build "$BINARIO_TEST_GPUI" \
  --revision "$MEDIFLOW_UI_CLI_REVISION" --out "$PROVE" \
  --file e2e/ui-cli/gpui-shell.jsonl
```

[Il copione del Shell](../e2e/ui-cli/gpui-shell.jsonl) entra in **Documenti**, apre **Sintesi e fonte** e l’**Originale** di un allegato sintetico, poi torna a **Riepilogo** con Invio. Apre **Nuova voce**, compila il campo, seleziona un carattere con Maiusc+Freccia sinistra e ridimensiona la stessa finestra simulata a 640 × 880 e di nuovo a 1360 × 900. Verifica il testo dopo il resize e dopo il ritorno dal diario.

`discover` riporta ruolo, nome, azioni disponibili, geometria utile al puntatore e stato dei controlli osservati nel frame. Per `focus`, `press` e `click` la ricevuta riporta il focus osservabile prima e dopo e lo stato aggiornato del controllo, se ancora presente. Per gli editor espone anche i limiti della selezione in byte UTF-8. Il resize riporta dimensioni precedenti, dimensioni lette dal renderer e identificativo della finestra. Scroll e resize passano rispettivamente dall’evento rotella e dalla callback del backend di test.

Il backend GPUI simulato non attiva l’adattatore AccessKit di sistema. Il banco osserva quindi elementi GPUI effettivamente renderizzati: navigazione condivisa, tab e menu strumentati, comandi delle schede dei documenti, editor di testo e regioni di scorrimento collegate. I nodi senza nome, fuori dalla parte visibile o con un tipo non gestito sono riportati tra le esclusioni osservate. Una vista può contenere altri componenti fuori dal censimento. I ruoli usano la semantica dell’elemento, per esempio **Agenda** è un pulsante con stato selezionato e il titolo della vista è un heading. Il [copione dell’Agenda](../e2e/ui-cli/gpui-agenda.jsonl) usa la navigazione e digita nel campo di ricerca della vista. I campi riservati e quelli di sola lettura non ricevono testo dal banco.

La finestra simulata misura il comportamento del Shell con il client e l’host sintetici. La finestra installata, il suo albero AX di sistema, i gesti fisici e la conferma personale sono superfici distinte. Il backend Web offre anche target composti, screenshot e download.

La prova della soglia compatta usa lo stesso driver Rust. Apre **Altre azioni** con Invio anche quando il pulsante è fuori portata per il puntatore, censisce il menu e aziona **Copia bozza**. Il campo `pointerClipped` segnala i controlli raggiungibili solo con focus e tastiera nel frame corrente.

```sh
cargo +1.98.1 test --locked --manifest-path experiments/gpui-patient-pilot/Cargo.toml \
  -p mediflow-gpui-patient-pilot --bin mediflow-gpui-patient-pilot \
  threshold_recovery_reserves_content_with_larger_text_metrics -- --nocapture
```

Nei percorsi provati il Shell espone la navigazione tra moduli come tab e le azioni di apertura come pulsanti. Il censimento non ha incontrato nodi Link, combobox o listbox. Le voci di menu sono state provate nella soglia compatta. Nel Shell il copione usa pulsanti, tab, titoli, campi di testo e regioni di scorrimento.
