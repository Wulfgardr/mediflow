# Bundle locale MediFlow GPUI

Il client GPUI non aveva un bundle ricostruibile dal repository. Lo script
`../scripts/bundle-macos.sh` produce un candidato locale firmato ad-hoc,
con manifest esterno del payload dopo la firma. Non installa e non aggiorna
applicazioni. Non incorpora host, Node o archivio clinico: l'host MediFlow
deve essere già operativo, avviato dal normale launcher Web/headless.

Le decisioni provvisorie di identità, composizione, fiducia, destinazione
futura, icona e aggiornamento stanno in `macos.json`. Le sole modalità
implementate sono client collegato e firma ad-hoc. Cambiare quelle stringhe
non implementa una distribuzione autonoma o una diversa firma.

## Creazione

Servono macOS su Apple Silicon, Python 3.11+, la toolchain Rust fissata nel
workspace, Xcode con compilatore Metal e dipendenze Cargo già disponibili
localmente. Il comando usa `--locked --offline`, release, tre job di default
e incremental disattivato. La checkout deve essere pulita; target e staging
devono essere esterni, separati e fuori da Applications. Lo staging deve
essere assente: un risultato precedente non viene sovrascritto.

```bash
export PATH="$HOME/.cargo/bin:$PATH"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
experiments/gpui-patient-pilot/scripts/bundle-macos.sh \
  --target-dir "$HOME/Antigravity/mf-build-g9/target" \
  --staging "$HOME/Antigravity/mf-build-g9/staging/candidato-1"
```

Il nome visibile è quello della configurazione. La versione viene da
`workspace.package.version`, non dalla release Web. Il build number usa
i primi 24 bit dello SHA, convertiti in tre componenti numeriche compatibili
con Info.plist (`1 + n/10000`, `(n/100)%100`, `n%100`, divisioni intere).
Questo numero breve può collidere: l'identità autorevole resta lo SHA
completo in Info.plist, `Resources/build.json` e `manifest.json`.

La build rifiuta `runtime_shaders` e verifica che una libreria Metal
precompilata sia contenuta nei byte dell'eseguibile. Verifica inoltre che
le dipendenze dinamiche siano esclusivamente librerie Apple di sistema.
L'icona viene dal brand Mac esistente, letto senza modificarlo. Font e SVG
restano incorporati dal codice del client. I due marchi vengono decodificati
prima del primo paint: il renderer riceve un `RenderImage` pronto, senza
attendere il caricamento asincrono di `Image`. Il packaging richiede i byte
di entrambi gli SVG nell'eseguibile copiato e ne verifica la decodifica,
compreso il cerchio d'inchiostro, prima e dopo la firma:

```bash
"/percorso/MediFlow GPUI.app/Contents/MacOS/mediflow-gpui-patient-pilot" --verify-bundled-assets
```

Il comando non apre finestre, non accede all'archivio e usa gli stessi byte
e la stessa cache decodificata del marchio dell'interfaccia. L'inventario
`embedded_brand_assets` nel manifest conserva nomi, dimensioni e SHA-256;
un marchio assente dall'eseguibile impedisce la creazione del manifest.

Il bundle include licenze e inventario del grafo Cargo macOS bloccato,
comprensivo in via prudenziale delle dipendenze di build/test, licenze Rust,
font e Lucide/Feather. I testi mancanti nei pacchetti Cargo sono versionati
in `licenses/`, con origine e SHA-256 in `licenses/sources.json`; la build
non li scarica. Per quattro pacchetti che omettono un file di licenza
(`block`, `objc_exception`, `seahash`, `simd_helpers`) sono inclusi il testo
di permesso MIT e le dichiarazioni originali di licenza/autori dei metadati
Cargo, senza inventare anni o titolari di copyright. Il supplemento
Pathfinder Apache proviene dal repository upstream identificato nell'indice.
Una dipendenza priva di testo o un supplemento alterato fermano la creazione.

`verification.json` conserva firma e valutazione Gatekeeper. Lo script
richiede `codesign --verify --deep --strict` riuscito e firma `adhoc` senza
TeamIdentifier. Il rifiuto `spctl` è atteso e viene registrato: questo
candidato non è Developer ID, notarizzato o ammesso alla distribuzione
pubblica. Il minimo macOS nei metadati riflette il deployment target del
binario, non una qualifica su altri Mac. Il target 0.9.1 resta il Mac U0.

## Ripetibilità e prova di avvio

Eseguire due creazioni dallo stesso SHA, stessa checkout, stessa toolchain
e cache di dipendenze. Confrontare i due `manifest.json` byte per byte:
non sono esclusi campi o file firmati. Log, percorsi assoluti di verifica,
date del filesystem e ricevute Gatekeeper rimangono fuori dal manifest.
Per forzare anche il relink dell'app fra le due build si può eseguire
`cargo clean --release -p mediflow-gpui-patient-pilot` dal workspace,
con `CARGO_TARGET_DIR` impostato esclusivamente al target privato del run.
Questa prova non stabilisce riproducibilità fra checkout o toolchain diverse.

Avviare il bundle con LaunchServices su un host sintetico loopback e una
cartella privata esplicita per le preferenze:

```bash
open -n "$HOME/Antigravity/mf-build-g9/staging/candidato-1/MediFlow GPUI.app" \
  --args --server http://127.0.0.1:3100 --state-directory /percorso/privato/gpui
```

Senza argomenti il client apre la connessione ordinaria e chiede l'host.
Nessun endpoint o segreto viene incorporato dal packaging. Pairing, login,
preferenze e autorità clinica conservano il comportamento del client.

I test portabili dei rifiuti di destinazione, inventario, build number e
licenze si eseguono con:

```bash
python3 -m unittest discover \
  -s experiments/gpui-patient-pilot/scripts -p 'test_bundle_macos.py'
```

La CI li aggiunge al job Linux già presente; non aggiunge job macOS né
confonde test portabili con firma o avvio nativo.

## Confine della consegna

La destinazione futura indicata in configurazione è soltanto informativa.
L'aggiornamento previsto richiede una sostituzione manuale esplicita del
solo bundle e la conservazione del precedente accanto o in una cartella
versionata. Nessun updater remoto, installer o automazione di rollback è
introdotto qui. Installazione, attività utile, aggiornamento, recupero e
qualifica G-9 richiedono i successivi passaggi contrattuali e le rispettive
prove sul candidato identificato.
