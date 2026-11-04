# Qualifica visiva Web 0.9.1

Con Node 24 e le dipendenze locali già preparate:

```sh
VISUAL_091_OUTPUT=/percorso/esterno/nuova-cartella npm run qualify:visual-091
```

La destinazione deve essere nuova. Il comando alloca porta loopback e archivio
sintetico temporanei, avvia Next dev, esegue 24 casi (sei percorsi in Giorno e
Grafite, a 1440 e 390 px), ferma il proprio server e rimuove archivio e build.
Non usa il database della checkout. Rifiuta CI e l'esenzione dalla protezione
loopback del browser. Riusa `e2e/fixtures/secure-browser.ts` e il bootstrap della
sessione degli spec esistenti; lo stato SISS è simulato come nello spec SISS.
Import, persistenza, PDF testuale ed estrazione passano dal codice reale.

Questa configurazione è esterna a `e2e/` e agli shard CI. Le due esclusioni
nel registro della selezione test sono intenzionali. Per restringere una prova
si possono passare gli argomenti Playwright, per esempio `--project=giorno-390`.

La cartella contiene PNG con nomi di stato, video per caso sotto `flows/`,
report HTML, risultati JSON, `assertions.jsonl` con esito e durata di ogni
asserzione/passo e `inventory.json` con elenco file, dimensioni e tempo totale.
Le misure di overflow a 390 px sono allegate al report per ogni schermata:
documento, body, main, sezioni principali e dialoghi. Non viene concessa
un'esenzione implicita ai contenitori con scorrimento intenzionale.

I casi da tastiera predispongono i dati dei campi prima del percorso; poi
raggiungono i controlli con Tab e Shift+Tab e attivano con Invio e Spazio.
Per ogni controllo nominato verificano elemento attivo e outline o box-shadow
calcolato, e salvano una schermata. Il file è iniettato sul controllo file
raggiunto da tastiera: la finestra nativa del sistema operativo è fuori prova.
Il test Conservazione salva la finestra e ne rilegge il valore dal server;
l'import da tastiera attraversa fonte, colonne, anteprima e conferma.

Gli screenshot documentano l'acquisizione. Le asserzioni automatiche non
misurano contrasto, sovrapposizioni o qualità clinica. Il server è di sviluppo:
questa corsa non qualifica la build standalone né i portali regionali esterni.
Un difetto riprodotto va registrato con identificatore, passo e schermata;
solo il caso corrispondente va marcato `test.fail` con quel riferimento,
conservando le asserzioni. Nessuna correzione del prodotto appartiene a questo
harness.

## HV-001: dossier C-6 a 390 px (corretto)

Riprodotto il 4 novembre 2026: a 390 px `main` misurava 395-396 px e le
sezioni del dossier 380 px su 358. Causa: i due elenchi «Scheda di
destinazione» e «Scheda» prendevano la larghezza dell'opzione più lunga e la
griglia del campo non li conteneva. Compariva solo con una scheda dal nome
lungo già in archivio, quindi nella corsa completa e non nel caso isolato.
Corretto in `components/patient-bulk-import-panel.module.css`; il caso non è
più atteso-fallire.
