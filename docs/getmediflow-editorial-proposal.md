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

Il sito e la repository hanno compiti diversi: il primo presenta il prodotto,
la seconda permette di studiarne il codice, ricostruire le decisioni e
contribuire allo sviluppo. Il sito personale rimanda a Get MediFlow per
questa presentazione.

I testi pubblicati devono restare coerenti con la versione disponibile e con
le prove che la riguardano. Le ricevute identificano le versioni del sito
effettivamente pubblicate; branch, merge e release del codice conservano i
propri riferimenti. Una revisione editoriale non sposta il tag della 0.8.6.
