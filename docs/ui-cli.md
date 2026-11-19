# Collaudo dell’interfaccia da terminale

La CLI avvia una postazione sintetica per ogni esecuzione. Legge un’azione JSON per riga da un file con `--file` oppure da stdin. Ogni riga produce un esito JSON. Inizia con `discover`, leggi il risultato e invia la prossima azione nella stessa sessione. Concludi con EOF. Un’azione fallita chiude la postazione e restituisce codice 1.

## Web

Servono Node 24, le dipendenze npm del repository e Google Chrome aggiornato. Usa una build standalone di MediFlow prodotta da una checkout fidata, con asset statici e manifesto di identità. La cartella indicata da `--out` deve già esistere.

```sh
npm run --silent test:ui:cli -- \
  --build .next/standalone --revision "$(git rev-parse HEAD)" \
  --out "$PROVE" --file e2e/ui-cli/web-091.jsonl
```

[La sequenza della candidata 0.9.1](../e2e/ui-cli/web-091.jsonl) configura e sblocca l’archivio di prova con passphrase e PIN sintetici. Crea Adele Collaudo dalla UI, la cerca e apre la scheda. Aggiunge un documento di testo, attende la conferma di salvataggio, apre l’originale e ne verifica il contenuto. Torna al riepilogo, scrive una bozza, chiude il compositore e riapre la bozza via tastiera verificando lo stesso testo. Sulla candidata, usa il percorso e lo SHA della relativa build. Le etichette appartengono alla build eseguita. Dopo una variazione della UI, usa `discover` per aggiornare le azioni.

Per guidare il banco dal terminale, ometti `--file` e invia singole righe come queste. Per riprodurre la sequenza via pipe, passa le stesse righe a stdin.

```jsonl
{"op":"discover"}
{"op":"fill","target":{"role":"textbox","name":"Nome e cognome"},"value":"Dottore Sintetico"}
{"op":"expectValue","target":{"role":"textbox","name":"Nome e cognome"},"value":"Dottore Sintetico"}
```

Un target è `{"role":"button","name":"Avanti"}` o `{"label":"Passphrase"}`. Ruolo e nome sono quelli del censimento, con corrispondenza esatta. Un array di target restringe il controllo in successione, per esempio una navigazione e poi un link al suo interno. Ogni livello deve identificare un solo controllo. La CLI si arresta sul primo target assente o ambiguo, prima di azionarlo. L’asserzione `hidden` può riuscire anche quando il controllo è assente.

| Azioni | Parametri oltre a `op` |
| --- | --- |
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

[Il copione del Shell](../e2e/ui-cli/gpui-shell.jsonl) scopre i moduli della scheda, passa a **Documenti**, rientra in **Riepilogo** con Invio e verifica la tab selezionata. Poi aziona **Nuova voce**, compila **Testo della voce**, apre **Tutto il diario**, misura lo scroll del vassoio, aziona **Torna alla bozza** e verifica il testo ritrovato. Il censimento ricava ruolo, nome e geometria dai controlli osservati durante il render e riporta le azioni supportate accanto a ciascun controllo. Se l’etichetta cambia, usa `discover` sul nuovo binario di test prima di aggiornare il copione. Il banco mostra i conteggi per ruolo e le esclusioni del frame osservato. Le righe indicano le azioni AccessKit dichiarate dal controllo e quelle che la CLI può inviare attraverso il banco di input. I target composti, screenshot e download sono disponibili sul backend Web. La prova del Shell usa il client e i normali eventi GPUI su una fixture del protocollo locale in memoria. L’AccessKit della finestra installata, i gesti fisici e le conferme personali restano verifiche separate.
