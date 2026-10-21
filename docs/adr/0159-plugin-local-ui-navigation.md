# ADR 0159 — Plugin locale con sola navigazione MediFlow

Data: 2026-10-21. Stato: Proposed; implementazione candidata WUL-757.
Riferimenti: WUL-756, ADR 0114, 0117, 0140 e 0146.

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

La navigazione usa il canale privato Web ereditato già esistente. Funziona
prima di login e selezione senza costruire una sessione clinica. La readiness tecnica privata del Web viene attesa con timeout, senza
conservare intenti oltre la richiesta in corso. Un messaggio finito viene inoltrato, senza attenderne lookup o rendering. Il risultato
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
writer, adattatore SQLite o cloud. La closure di staging comprende i nuovi
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
