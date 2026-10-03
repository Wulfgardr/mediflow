# getmediflow: prodotto in vista, dettagli a scelta

[Get MediFlow](https://getmediflow.dev) è il sito pubblico di presentazione
del progetto, approvato il 5 settembre 2026 e ospitato su ChatGPT Sites. Da qui
si può conoscere il prodotto; su GitHub si trovano codice, contributi e
contratti tecnici. Il sito non ospita la cartella e non riceve dati del runtime.
Chi arriva dal sito personale può accedere liberamente alla presentazione,
all’indirizzo `getmediflow.dev`.

La 0.8.6 è ora pubblicata come sorgente. Il racconto riguarda il runtime
locale/headless sul Mac, il browser localhost, il backend e la Fabric; l’app
nativa rimane uno sviluppo separato. Gli agenti raggiungono soltanto comandi
MediFlow nominati e mediati, senza accedere direttamente a SQLite. Le funzioni
AI sono facoltative e producono proposte da rivedere. I servizi esterni,
compresa l’integrazione ChatGPT, sono spenti per default: la presenza del
percorso non attesta funzionamento live, disponibilità multipiattaforma o
idoneità clinica.

## Il filo del racconto

**Ritrova il filo.** La presentazione comincia dal gestionale e dal lavoro che
permette di organizzare, non dalla tecnologia usata per costruirlo. Una
cartella, una fonte consultabile e un’attività da seguire rendono comprensibile
il progetto prima che sia necessario nominarne l’architettura.

| Passaggio | Che cosa deve diventare comprensibile |
| --- | --- |
| Il gestionale | Cartella e schede esplorabili; il lavoro resta possibile anche senza AI. |
| Dati organizzati | Codifiche, scale, farmaci, documenti ed esportazione FHIR, con i rispettivi limiti. |
| Il contesto | Perché occorra ritrovare informazioni distribuite fra referti, allegati e attività. |
| Intelligence Fabric | Una struttura di supporto per quattro percorsi selezionabili, sempre da rivedere. |
| Scelta dei runtime | Strumenti locali, condizioni per i provider esterni e limiti dell’oscuramento dei dati identificativi, senza implicare una disponibilità universale. |
| Aprire il cofano | Letture generale, professionale e tecnica; accesso headless mediato sul Mac, non autorità generale degli agenti. |
| Responsabilità | GDPR e AI Act, con fonti e approfondimenti ma senza affermazioni di certificazione. |

La voce segue questo stesso ordine: prima l’esigenza, poi la ragione della
scelta, infine ciò che consente e ciò che esclude. La Fabric si spiega come
un’impalcatura per usare strumenti diversi quando servano; non come un elenco
di modelli. La vocazione aperta e gratuita riguarda la possibilità di studiare
e discutere MediFlow, non la gratuità dell’hardware o dei servizi esterni.
Nel prodotto si parla di «integrazione ChatGPT»; OpenAI resta il nome corretto
per l’azienda, le sue API, gli adapter distinti e le attribuzioni.

## Forma e interazioni

Il prodotto resta il soggetto di un sito semplice, con una componente giocosa
che non ostacoli la lettura. Tipografia leggibile, pannelli morbidi e piccoli
movimenti accompagnano l’esplorazione. La palette Lume usa carta, grafite e
blu minerale; contrasto scuro e verde acceso distinguono Fabric. Non si
aggiungono accenti arancio decorativi.

Le schermate reali devono provenire esclusivamente da un runtime con fixture
sintetiche. Le ricostruzioni interattive vanno dichiarate illustrative e non
devono simulare un servizio AI live. Le eventuali schermate headless mostrano
solo comandi MediFlow realmente disponibili, controlli e limiti, senza
promettere compatibilità con qualunque agente.

Ogni approfondimento risponde a una domanda concreta. Non servono etichette
di capitolo superflue, contatori, firme Ordito/Concilio o frecce senza funzione.
Il movimento deve rispettare la preferenza di riduzione ed essere disattivabile.

## La stessa progressione nella documentazione

Il README parte dal lavoro ordinario, presenta le funzioni e accompagna verso
fonti e avvio. Conserva i badge Codex, Claude Code, versione sorgente, release,
licenza e piattaforme, distinguendo la release sorgente 0.8.6 dalla revisione
editoriale e da una distribuzione binaria.

`start-here.md` collega prodotto, lavoro clinico e costruzione tecnica. Le
topologie introducono il significato dei percorsi prima di diagrammi e
contratti; la guida privacy rende leggibili le scelte senza sostituire
SECURITY, ADR o matrice dei runtime. Prove di candidatura e condizioni aperte
restano negli approfondimenti pertinenti, con date e revisioni originali.

Una riscrittura più naturale non promuove gli adapter cloud, la parità FHIRv2
o la distribuzione Apple a capacità qualificate. Gli esempi di scelta dei
modelli spiegano un principio, non aggiungono combinazioni ammesse dal sistema.

## Pubblicazione

### Esplora il codice

La [prima mappa curata](../tools/code-explorer/index.html) presenta due esempi:
lettura headless delle attività e conferma Web di una transizione checkup.
Quindici nodi e relazioni tipizzate hanno fonti nel codice pubblico, fissate al
commit `90fa7771fc0822475611c9affb9c22e212939399`. È una fotografia storica,
non la revisione disponibile in ogni installazione. Selezione, ricerca,
spiegazioni e un elenco consultabile anche senza JavaScript accompagnano le
domande «dove passa il dato?», «chi può modificarlo?» e «quali prove abbiamo?».

Import, chiamata, composizione, contratto e richiesta HTTP sono relazioni
distinte. Le curve non mostrano traffico clinico; il collegamento non attesta
esecuzione, autorizzazione o raggiungibilità. Non coprono tutta l’applicazione,
tutti i writer o una verifica delle protezioni. La pagina non è collegata al
runtime, non contiene dati clinici e non usa un modello AI.

Il [JSON generato](../tools/code-explorer/snapshot.json) conserva albero Git,
hash dei file, righe e limiti. La mappa manuale resta in
`tools/code-explorer/curated-map.json`; il generatore legge esclusivamente
blob Git al pin, senza importare il runtime:

```bash
node tools/code-explorer/generate.mjs
node tools/code-explorer/generate.mjs --check
node --test tools/code-explorer/generate.test.mjs tools/code-explorer/extract-files.test.mjs
python3 -m http.server 8765 --bind 127.0.0.1 --directory tools/code-explorer
```

Aprire `http://127.0.0.1:8765` per consultarla localmente. Per aggiornare il
pin, riesaminare anche il significato delle relazioni e i limiti, poi rigenerare
e verificare lo [schema](../tools/code-explorer/snapshot.schema.json), i target
e le fonti. L’inventario `--ref` attesta presenza dei file, non import eseguiti.

La vista «Moduli e file citati» conserva la mappa architetturale e usa lo stesso
pin. Comprende l’unione dei 19 file citati dai nodi e dalle relazioni: «file
citato come prova» è un’associazione editoriale molti-a-molti, non proprietà
del file. L’extractor usa l’AST della dipendenza TypeScript già presente e il
resolver con l’albero Git e `tsconfig.json` al pin; non importa il runtime e
non risolve target dalla checkout corrente o dai pacchetti installati.

La [fotografia dei file](../tools/code-explorer/file-topology.json) conserva
118 dichiarazioni statiche e le loro righe: 19 tra file selezionati, 62 verso
file fuori selezione, 22 moduli Node e 15 pacchetti esterni. Nessun target
irrisolto o costrutto dinamico cercato è rilevato in questa selezione storica.
Import, re-export e dichiarazioni soltanto di tipi restano riconoscibili;
una coppia di file conserva tutte le dichiarazioni che la collegano. Gli
asset citati sono attestati come file presenti, senza analizzarne il contenuto.

Scelta del modulo, ricerca e filtro delle dichiarazioni accompagnano una
spiegazione con fonti in entrata e uscita; l’elenco conserva tutti i file anche
senza JavaScript. I target fuori selezione non vengono analizzati
ricorsivamente. Import dinamici, chiamate denominate `require` e import come
espressioni di tipo sono segnalati e restano fuori dal grafo. Questo perimetro
non rappresenta tutta la codebase, la copertura dei test o flussi di dati:
le relazioni semantiche tra moduli e le dichiarazioni tra file restano viste
distinte. Lo [schema](../tools/code-explorer/file-topology.schema.json) e i test
controllano dati, classificazione e casi esclusi; `generate.mjs --check`
verifica entrambe le fotografie e la pagina riproducibile.

L’artefatto documentale è predisposto per la sezione «Come funziona» del sito,
con carta, grafite e blu minerale. La consegna nella repository non attesta
integrazione o pubblicazione su Get MediFlow: richiedono i sorgenti correnti
del sito, navigazione coerente e una ricevuta Sites separata. Per la vista
mobile l’elenco sostituisce il diagramma e conserva tutte le spiegazioni.

Il sito e la repository hanno compiti diversi: il primo presenta il prodotto,
la seconda permette di studiarne il codice, ricostruire le decisioni e
contribuire allo sviluppo. Il sito personale rimanda a Get MediFlow per
questa presentazione.

I testi pubblicati devono restare coerenti con la versione disponibile e con
le prove che la riguardano. Le ricevute identificano le versioni del sito
effettivamente pubblicate; branch, merge e release del codice conservano i
propri riferimenti. Una revisione editoriale non sposta il tag della 0.8.6.
