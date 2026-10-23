# ADR 0159 — Plugin locale con sola navigazione MediFlow

Data: 2026-10-21. Stato: Proposed; implementazione candidata WUL-757.
Riferimenti: WUL-756, ADR 0114, 0117, 0140 e 0146.

## Rettifica del lifecycle — 23 ottobre 2026

La qualifica sintetica dei client ha dimostrato che la chiusura dell'host
arrestava anche il Web posseduto dal plugin. Il successivo controllo di sicurezza
smontava l'editor e perdeva la bozza non registrata, pur conservando i record salvati.
La decisione di coordinamento sostituisce la proprietà del Web descritta sotto:
il plugin è un telecomando e non possiede il runtime clinico.

Il raccordo avvia il launcher ordinario della medesima sorgente e del
medesimo archivio come processo indipendente,
staccato, con build già ammessa e decisione `reuse`. Non adotta listener arbitrari,
non avvia build o installazioni implicite e non registra il launcher o il Web fra
i figli posseduti. La chiusura dell'host termina soltanto il raccordo MCP.

L'avvio interno usa `--riusa` senza imporre `--scelta` o `--senza-browser`:
restano la preferenza e il selettore ordinari. Il riuso non riscrive le preferenze.
Un runtime headless, nativo o di sviluppo non dichiara capacità di navigazione
Web: il controllo rifiuta l'intento e il raccordo non restituisce successo.

Il pacchetto e il navigator applicano la stessa allowlist esplicita in
`plugins/mediflow-local-ui/src/runtime-environment.mjs`. HOME e le variabili
profilo Windows conservano la sede utente; APPDATA, LOCALAPPDATA e XDG conservano
configurazione e risorse locali; TMPDIR/TMP/TEMP mantengono la sede temporanea;
LANG, LANGUAGE, le categorie LC elencate e TZ conservano lingua, formati e fuso.
PATH conserva i programmi locali configurati, preceduto dal Node fisico ammesso;
SystemRoot/WINDIR/ComSpec/PATHEXT servono ai comandi Windows. DISPLAY,
WAYLAND_DISPLAY, XDG_RUNTIME_DIR e DBUS_SESSION_BUS_ADDRESS conservano l'accesso
alla sessione grafica Linux. MEDIFLOW_MAC_CONFIG conserva la scelta del bundle
locale. MEDIFLOW_DATA_DIR proviene sempre dall'archivio ammesso nel pacchetto;
PORT viene scelto dal navigator. Le chiavi residenti e il loro wrapping restano
nei percorsi ordinari dell'archivio e della UI: nessun segreto viene preso
dall'ambiente dell'host MCP. Non vengono ereditati flag E2E, loader Node,
preload dinamici, token o variabili non elencate.

La navigazione attraversa il controllo locale già posseduto dal launcher e il suo
IPC Web: soltanto i quattro intenti chiusi, dopo verifica di identità e archivio.
Ogni inoltro porta un identificativo casuale e la scadenza della richiesta
corrente. Il raccordo ricontrolla il segnale prima del POST e dopo la risposta;
annullamento o timeout revocano quell'identificativo. Il controllo rifiuta
identificativi già usati o revocati, inoltri scaduti e runtime privi della capacità
Web; la disconnessione HTTP annulla un inoltro ancora pendente. Il Web ricontrolla
la scadenza al ricevimento IPC e ritira soltanto l'intento della richiesta
revocata, lasciando intatta un'eventuale richiesta successiva. Non viene
conservata una coda da riprendere. La risposta al modello resta fissa. Non cambiano sessione clinica, single-writer,
conferma locale, epoch, scadenza o revoca. Nessuna porta clinica viene composta dal
raccordo. Il recupero cifrato delle bozze dopo riavvio resta una proposta separata.

## Decisione

Codex locale e Claude Code usano pacchetti sottili sopra lo stesso MCP e
Supervisor. Il nuovo ingresso trusted `plugin_local_ui` compone soltanto
`mediflow.local_ui.navigate.v1`: input strict con un enum fra `search`,
`identity`, `history`, `prescribing`. Nessun identificativo, testo libero,
URL, proof o parametro di profilo. Non compone owner, lease, mirror, audit
clinico, porte profilo/checkup o servizi clinici. Le mappe RPC negano anche
chiamate dirette alle operazioni degli altri profili. Gli ingressi esistenti,
Mini e il grant opzionale profilo conservano i propri contratti; il grant
`none` non significa local-only.

La navigazione usa il controllo privato del launcher ordinario e il suo IPC Web.
Funziona prima di login e selezione senza costruire una sessione clinica.
Prima dell'inoltro verifica sorgente, archivio e readiness tecnica, entro il timeout
della richiesta; non conserva intenti per una riconnessione. Il messaggio finito
non attende lookup o rendering. Il risultato
pubblico è sempre `continue_in_mediflow`; non prova apertura, caricamento,
presenza del paziente o esecuzione di atti. Errori pubblici e diagnostica sono
fissi, anche per la validazione MCP prima dell'handler. Non esistono resource,
prompt, progress o metadati con dati del paziente.

La pagina `/plugin-local-ui` e il solo layout `/patients/[id]/modules`
valutano a ogni rendering su richiesta la stessa condizione della route eventi:
`MEDIFLOW_PLUGIN_LOCAL_UI=1` e IPC connesso. Espongono soltanto il booleano tramite un provider circoscritto ai due consumatori; senza quel
segnale il client non apre l'EventSource. La valutazione avviene dopo
`connection()`, quindi non resta
fissata al momento della build. Il layout radice non legge il runtime né
richiede rendering dinamico: le altre route conservano il prerendering di main.
Il controllo post-build confronta il manifest con la baseline statica di
`b10f4d2567e19169ad332af445a1abb08be0b844`. Il flag abilita solo l'ascolto: non concede
autorità e la route mantiene i controlli runtime e di origine, con `404`
fuori dal runtime designato.

Il Web trasmette l'intento soltanto ai documenti locali attualmente connessi,
senza conservarlo o ripubblicarlo alla riconnessione. In assenza di un documento
connesso apre la pagina locale fissa `/plugin-local-ui`, senza parametri o
frammenti: login/PIN e scelta del paziente rimangono nella UI. Gli intenti
precedenti al login sono quindi consumati come ingresso, mai ripresi dopo
l'autenticazione. La pagina spiega i percorsi e rimanda alla ricerca esistente,
anche per CF. Nessun altro URL è ammesso dal messaggio privato.

Nella cartella già aperta, un intento di vista richiede una nuova conferma
locale sul paziente visibile. Non ricerca né seleziona pazienti. La richiesta
è volatile, scade e viene ritirata al cambio di pagina/paziente, lock, logout,
revoca o disconnessione. L'apertura di una sezione riusa i reader ordinari:
PatientIdentityLens, ClinicalRiverTimeline con fonti e i gestori terapia,
prestazioni e protesica. La guida prescrittiva distingue i tre percorsi;
nessun tool decide terapia, conferma, firma o trasmette prescrizioni.

## Consegna e limiti

L'ingresso del pacchetto verifica il payload sorgente versionato tramite il
ledger e il runtime Node locali esistenti prima di eseguire il Supervisor.
Niente MCP bare, HTTP generico, download impliciti, broker residente, nuovo
writer, adattatore SQLite o cloud. Il controllo locale esistente del launcher
ammette soltanto l'enum e i metadati di richiesta nel comando nominato `navigate`,
con revoca nominata `cancel-navigation`, protetti dal suo token
locale e dall'origine; non espone un inoltro HTTP arbitrario. La closure di staging comprende i nuovi
ingressi. Il plugin sintetico storico rimane distinto. Rimozione del pacchetto
non modifica archivio o chiavi; il Supervisor arresta solo i propri figli.

Il modello non riceve CF o storia, quindi non può restituirli in chat né
ragionare su quella storia. Questa è UI fidata separata, non un pannello host.
Il confine non isola il Mac dagli altri tool dell'host, da file, browser o
screenshot autorizzati altrove. Non è anonimizzazione, ammissione clinica,
compatibilità generale di tutti gli host o approvazione di una directory.
Contatto e pubblicazione restano WUL-759, riservati a Leonardo.

## Verifica e ritorno

Prove sintetiche attraverso MCP e RPC reali: ingresso prebinding, enum/input
avversari, nomi tool nascosti, capability/profilo forgiati, output costante,
sentinelle su tutti i blocchi/errori/log/URL, assenza di composizione clinica,
duplicati e cleanup. UI: ricerca CF, selezione locale, anagrafica, storia con
fonti, guida dei tre percorsi, richieste superate e disconnessione. Smoke dei
client reali separati dalla validazione dei manifest e dall'installazione.

Reversione senza migrazione: rimuovere pacchetti e ingresso ristretto. Non
esistono dati clinici, autorizzazioni o richieste persistenti da convertire.


### Emendamento 23 ottobre: identità del canale di navigazione

La ricevuta su disco e il fingerprint pubblico non autenticano un listener.
Il navigator non legge `instance.json` e non invia più HTTP al controllo scoperto.
Avvia il launcher ordinario con il solo `--riusa` su IPC ereditato e inoltra
soltanto enum, ID casuale e scadenza sul medesimo canale di processo.
Il launcher avviato così reclama esclusivamente una directory lock nuova:
nessuna adozione o recupero di ricevute, PID o porte, inclusi alias della lock.
Il Web è quello avviato direttamente da quel launcher, sul proprio IPC.
Se esiste un launcher separato la navigazione fallisce chiusa; va arrestato
localmente prima di avviare una nuova sessione plugin. È un limite esplicito
rispetto al precedente riuso per discovery, comprese le riconnessioni dopo
la chiusura dell'host. Non modifica l'archivio o le preferenze ordinarie.

Le risposte IPC sono correlate all'ID della richiesta. Annullamento e
handoff rifiutato revocano soltanto quell'ID. La disconnessione revoca gli
handoff ancora pendenti, senza arrestare il launcher o il Web autonomi.
`--riusa` conserva inizializzazione e servizi facoltativi ordinari, incluso
Ollama, e limita il riuso alla build già ammessa e alla conservazione delle
preferenze. Il selettore ordinario e le scelte ricordate restano efficaci.
