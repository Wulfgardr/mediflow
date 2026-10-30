# Vista paziente: prove residue della 0.9.1

Refs WUL-787. [Contratto W](../../releases/0.9.1-contract.md#w--web).

Base aggiornata: `dad877af34028b579894e301e1d69ff947263c1a`.
Prodotto candidato: `9e480838a6e417bb49b4ffb1a9b17df2cc298537`, build
`SHkU5rt6gdMDpH_SOqN3F`. I commit successivi modificano soltanto prove e dossier.
Il titolo attivo della sezione usa una base flex automatica: quando titolo e
conteggi non entrano, il conteggio passa alla riga seguente. Prima, a 320 px,
la base flex nulla restringeva il titolo sotto la larghezza della parola e
provocava una sovrapposizione. La nuova asserzione geometrica fallisce sulla
base per questo difetto. Nessuna modifica del contratto dati, writer, API,
conferma, audit o soglia.
Non occorre una nuova review delle scritture cliniche per questo contributo.

## Riconciliazione

| Riga | Prove riusate | Completamento sul prodotto integrato |
| --- | --- | --- |
| W-7 Terapie | [#619](https://github.com/Wulfgardr/mediflow/pull/619), prodotto a06ee7d469: conteggi zero/una/molte, stati attiva/sospesa/conclusa, creazione/modifica, bozza, menu, soglie e guardie. [Dossier e 56 catture](../2026-10-23-therapies/README.md), 1440/768/390 e 200% nei due temi. | Registro con tre attive, una sospesa e una conclusa, form con bozza, conferma annullata e menu a 320 px e zoom reale 400%, Giorno/Grafite. Nessun cambio di stato o cancellazione confermato dalla UI nelle nuove catture; la preparazione crea record sintetici. |
| W-9 Quadro | [#628](https://github.com/Wulfgardr/mediflow/pull/628): tabelle, letture e proiezione; [#697](https://github.com/Wulfgardr/mediflow/pull/697): intestazioni e stati comuni. | Nuove coppie dopo l'aggregazione: zero/uno/otto record, due unità dello stesso parametro con 24 misure storiche, caricamento ed errore di terapie/misure/controlli, lettura paziente fallita. Conteggi e contenuti verificati, Diario presente insieme al Quadro in estesa; nessun Quadro vuoto inventato in caso di errore paziente. |
| W-10 Lettura comune e Follow-up | [#631](https://github.com/Wulfgardr/mediflow/pull/631): componente comune, mapping, bozze e 56 catture 1440/768; note 011 su a12cd01b. | Follow-up in caricamento/errore/vuoto/disponibile e note in caricamento/non disponibili per diniego/disponibili nelle sei dimensioni dei due temi. Contenuto finale e nota del controllo verificati. Il caso difensivo senza risultato di ViewState resta coperto dalle prove del componente originarie; non è un nuovo esito HTTP simulato. |
| W-21c Elenco pazienti | [#681](https://github.com/Wulfgardr/mediflow/pull/681), [#683](https://github.com/Wulfgardr/mediflow/pull/683), [#701](https://github.com/Wulfgardr/mediflow/pull/701), [#707](https://github.com/Wulfgardr/mediflow/pull/707): letture, Da fare, HC-9 e HC-11, vuoto unico e geometria. | Matrice unica con caricamento/errore/pronto/vuoto/istantanea ritirata; Da fare con zero/uno/molti controlli, filtro durante lettura, lettura fallita, vuoto filtrato, riprova, archivio e ritorno alla riga. Controlli confermati distinti da suggerimenti, un principale, tastiera e selezione conservate. |

Quadro, Follow-up e letture Pazienti usano Giorno/Grafite a 1440/768/320/390 px
più zoom Chromium reale 200%/400%, viewport fisico 1440×1000. Le due dimensioni
nuove di Terapie completano le quattro già qualificate; dopo la correzione
condivisa vengono ricontrollate anche le quattro dimensioni originarie. Le catture zoom sono
del viewport fisico; i dettagli aggiuntivi mostrano righe e messaggi durante
lo scorrimento, senza fingere che un contenuto lungo entri in un fotogramma.
Il fuoco è esercitato su controlli reali e ripristinato dalla funzione di cattura.
Bozza e soglia delle Terapie rimangono sotto le asserzioni dello spec originale.
L'evento pagehide della Worklist è uno stimolo sintetico, non una prova di bfcache.

## Ambiente e artefatti

Node 24.18.0, ABI 137; `npm ci`, Chromium fissato dal lockfile, produzione
standalone. Base e candidata hanno build pulite distinte e archivi sintetici
separati, posseduti dal run; porte loopback 3147 e 3148. Copia legacy disabilitata.
Nessun archivio clinico reale o lanciatore primario usato. Le guardie della suite
rifiutano la porta 3000; non è stata introdotta alcuna deroga.

Galleria completa locale:
`~/Antigravity/mf-hillclimb-20261028/patient-closure-9e480838a6e417bb49b4ffb1a9b17df2cc298537/`.

[Manifest con SHA prima/dopo e SHA-256](catture.csv), [esiti](esiti.json).
I percorsi del manifest sono relativi alla galleria esterna, salvo le prove
riusate che nominano il dossier originale. Le immagini sono acquisizioni distinte
delle due build con la stessa fixture e gli stessi stati, sui due prodotti identificati nel manifest. Le catture aggiuntive delle
dimensioni Terapie già qualificate sono regressioni dopo la correzione e non
vengono presentate come nuove coppie con la base corrente. Il prefisso storico `dopo-` dei file Terapie identifica lo stile già
integrato della #619; la cartella `prima/` o `dopo/` e il manifest identificano
senza ambiguità il lato di questo confronto.

Le ricevute e i report originali, incluse le esecuzioni intermedie, sono in
`/tmp/mf-patient-closure-20261030/`. Le prove storiche sono riusate nei loro limiti,
senza rieseguire le suite di scrittura, recupero e verifica formale già valide.
La sola modifica a una classe del titolo non cambia comandi, callback,
transizioni o conservazione della bozza. La prova del contenitore visitato
verifica inoltre che il form rimanga montato dopo la chiusura.
Nessun nuovo giudizio sulle prestazioni, sulla qualifica clinica o sulla release.

## Difetto corretto

La cattura Terapie Grafite 320 mostra la sovrapposizione fra il titolo e
«3 attive · 1 sospesa · 1 conclusa». Il controllo nuovo misura il rettangolo
del testo tramite Range, poiché il solo box flex non rileva la parola che
sconfina. Fallisce sulla build base con «Titolo e conteggi devono restare
separati». La correzione agisce sulla ricetta del contenitore attivo, comune
alle sezioni paziente. Le catture di Quadro e Follow-up e i controlli
1440/768/390/200% delle Terapie vengono quindi ripetuti sulla nuova build.

## Rilavorazioni

- Primo tentativo di build respinto: il nome di output non previsto faceva
  aggiornare tsconfig a Next. Conservato il log; build pulite con `.next-e2e`.
- Prima raccolta interrotta dopo un caso, per verificare il contesto zoom;
  esplicitato baseURL nella fixture, senza cambiare le guardie.
- Raccolta iniziale: 21 verdi e un rosso del test Da fare. La funzione di cattura
  spostava il fuoco dal filtro; ora ripristina il controllo prima di proseguire.
  Nessun difetto applicativo attribuito a quel rosso.
- Lint iniziale respinto sul nome `use` del callback Playwright; rinominato.
  Selezione iniziale incompleta: aggiunta l'esclusione motivata della fixture,
  esercitata dagli spec, senza escludere alcun test.
- Prove negative della porta 3000 respinte intenzionalmente prima della UI.
  I report le distinguono dai risultati delle raccolte finali.

Sviluppo assistito: GPT 6.1 Sol, effort High, senza delega. Consumi non attribuibili.

## Esiti e consegna

La raccolta della base comprende 24 casi passati; il nuovo controllo geometrico,
eseguito a parte sulla stessa build, è rosso sul difetto atteso. La candidata
comprende 32 casi senza retry, inclusa la nuova asserzione e le dimensioni delle
Terapie interessate dalla correzione. Il manifest e gli esiti strutturati
registrano 588 nuove coppie, 24 coppie storiche riusate e 32 catture
aggiuntive di regressione soltanto dopo. Tutti i digest sono stati riletti
e verificati; nel repository restano quattro immagini di esempio.

Lint, typecheck, build delle due revisioni, verifica dei bundle standalone,
selezione dei test, never-regress e claims sono passati. Il test del contenitore
con bozza è passato. Nessuna suite già valida di scritture cliniche è stata
ripetuta per conferma.

Esempi: Terapie 320 [prima](esempi/terapie-320-prima.png) e
[dopo](esempi/terapie-320.png), [aggregazione Quadro 768](esempi/quadro-768.png),
[errore Follow-up leggibile al 400%](esempi/followup-400.png).

W-7, W-9, W-10 e W-21c sono chiuse nelle prove Web sintetiche descritte.
L'esito CI della head corrente è un requisito di consegna distinto, consultabile
nella [PR #724](https://github.com/Wulfgardr/mediflow/pull/724); nessuna CI verde
è dichiarata anticipatamente. Nessun merge o installazione richiesto qui.
