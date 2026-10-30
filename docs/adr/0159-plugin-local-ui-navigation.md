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

Prima di scegliere fra abbinamento e avvio, il launcher prepara fuori dallo
stato condiviso una generazione completa: owner immutabile con PID e identità
temporale OS, e receipt aggiornabile separata. Pubblica l'intero contenitore
con rename; un contenitore occupato e non vuoto non può essere sostituito.
Le generazioni hanno nomi casuali non riutilizzati. Il recupero sposta soltanto
il nome della generazione verificata morta, mai la directory `active` intera:
un recuperatore in ritardo non può spostare una generazione successiva. Lo stop
ritira nello stesso modo la propria generazione, senza prima cancellarne la
receipt. Il contenitore di protocollo resta sul disco; `active` vuota o assente
non rappresenta un writer.

Il file permanente `${lockDirectory}.recovery`, con schema
`mediflow.launcher-lock.v2`, seleziona il protocollo: non è un mutex e non
attribuisce proprietà. È pubblicato completo con hard link esclusivo da una
preparazione privata sullo stesso filesystem. Impedisce al vecchio protocollo
di acquisire il proprio mutex con `mkdir`, anche mentre si pubblica il nuovo
contenitore. Un crash può lasciare il secondo link della preparazione: è
ammesso soltanto per questo marcatore pubblico e immutabile, non per owner o
receipt. Directory, symlink o contenuti diversi nello stesso percorso sono
stato legacy incerto, conservato senza conversione automatica.

Per un PID vivo, un'identità corrispondente, una vecchia receipt senza identità
temporale o una verifica OS indisponibile non autorizzano il recupero. La
receipt aggiornabile mancante o parziale non cancella l'owner immutabile:
finché è vivo o incerto resta protetto, dopo la morte verificata la generazione
può essere ritirata. Alias e file non regolari di directory, owner e receipt
restano negati. Le receipt legacy complete sono ancora riconosciute; la
migrazione di un owner verificato morto scrive il protocollo prima di togliere
la vecchia receipt, così un crash intermedio non crea uno stato anonimo nuovo.

Una lock legacy vuota, una receipt legacy parziale e il vecchio mutex anonimo
non provano la morte del proprietario. Anche dopo un crash osservato restano
conservati con l'errore «Stato legacy del lanciatore senza proprietario
verificabile». L'intervento richiede evidenza di quiescenza dei launcher di quel
checkout, compresi processi vecchi sospesi o ancora in acquisizione e relativi
figli, e una copia dello stato prima della rimozione delle sole tracce pertinenti.
Il consenso a ignorare l'ownership, l'età e l'assenza della receipt non sono
prove di quiescenza. Non esiste un flag di recupero forzato.

Le garanzie riguardano concorrenza e terminazione dei processi sulle primitive
di hard link esclusivo e rename locale; i test delle stesse primitive sono
inclusi nella matrice CI Windows/Linux/macOS. Non attestano resistenza alla perdita
di alimentazione o alla corruzione del filesystem. Preparazioni e generazioni
ritirate lasciate da un crash non conferiscono proprietà e non bloccano nuovi
ingressi. La proprietà del launcher non concede navigazione.

Prima di acquisire o pubblicare owner e generazione su Windows, il bootstrap
carica un piccolo binding C Node-API precompilato per `process.arch` (x64 o
ARM64). Le due funzioni espongono `GetSystemDirectoryW`, con buffer Unicode
ridimensionato, e `getProcessCreationTimeTicks(pid)`. Quest’ultima apre un
handle non ereditabile con il solo `PROCESS_QUERY_LIMITED_INFORMATION`,
legge `GetProcessTimes` e chiude esattamente una volta ogni handle aperto.
Qualsiasi errore, anche di chiusura o conversione, nega l’identità. Il binding appartiene al
launcher: non entra nella closure Headless, che continua a negare `.node` e
DLL. Non usa report, DbgHelp, FFI, ambiente o processi ausiliari.

L’identità Windows usa la stessa funzione per ogni PID, proprio e di un
owner precedente. La conversione intera FILETIME → FileTimeToSystemTime →
calendario gregoriano e frazione sub-millisecondo conserva esattamente la
stringa decimale dei tick UTC .NET, poi il precedente SHA-256. Non usa double
per i tick, subprocessi, lookup di root ambiente, wait, polling o privilegi
elevati. Il bootstrap pubblica insieme binding e percorso taskkill soltanto
dopo tutte le verifiche, prima del claim. Errore proprio impedisce qualsiasi
owner; errore per un owner vivo conserva owner e receipt. Non si modificano
lo schema V2, la pubblicazione o il recupero per morte già verificata.

La compatibilità richiede, su Windows x64 e ARM64, confronto byte-per-byte
con l’espressione PowerShell legacy sul medesimo processo vivo, proprio e
figlio posseduto, e poi confronto degli hash. L’oracle è soltanto nel gate
esterno al prodotto, con budget 30 s per invocazione, senza retry o warm-up;
non modifica le deadline del launcher. Timeout significa prova mancante.
Una receipt legacy viva deve restare invariata e negare il nuovo claim.
Se l’equivalenza non è dimostrata, la distribuzione resta bloccata: nessuna
nuova identità incompatibile viene ammessa sotto lo schema precedente.

Il manifest schema 2 e il loader richiedono esattamente i due export
`getProcessCreationTimeTicks,getSystemDirectory`, entrambi funzioni. Il
medesimo artefatto per architettura mantiene il nome system-directory.node.
Il loader verifica architettura PE, digest, provenienza del sorgente e della
ricetta dell'artefatto locale. Digest e ledger identificano i byte: non provano
l'equivalenza fra sorgente e binario. Sorgente, ricetta e artefatti ammessi
sono distribuiti insieme; non servono `node_modules`, download o compilazione
per arrivare alla scelta ordinaria prima di un eventuale `npm ci` confermato.
Un'architettura senza artefatto verificato è negata; ia32/WOW64 non è ammessa.
Windows ARM con Node x64 emulato usa l'artefatto x64: il gate nativo ARM64
non qualifica automaticamente l'intera applicazione ARM64.

La fonte OS determina esclusivamente `<systemDirectory>/taskkill.exe`.
Directory e candidato devono essere percorsi locali assoluti; `lstat` deve
osservare directory/file regolari senza link riconosciuti e `realpath.native`
deve conservare il parent canonico, con confronto Windows case-insensitive.
Non sono ammessi fallback da PATH, cwd, SystemRoot, WINDIR o root costanti.
Il percorso positivo è acquisito una volta prima del claim, mai scoperto
lazy durante lo stop. In caso di errore il bootstrap non crea owner; un
helper senza bootstrap valido nega lo stop e conserva l'owner già presente.

Si assumono integri Windows, Node e il package di bootstrap distribuito.
I controlli non firmano taskkill, non escludono ogni reparse tag né eliminano
il TOCTOU contro un amministratore che modifica la directory OS.
La fonte è [GetSystemDirectoryW](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemdirectoryw),
non una variabile del chiamante. Le build di sviluppo/CI native x64 e ARM64
verificano toolchain, dipendenze e avvio senza node_modules; gli artefatti
prodotti devono essere ammessi e versionati prima della consegna source-first.
La preparazione della CI non attesta artefatti ancora mancanti.

Su Windows lo Stop di Web, sviluppo e agenti esegue subito una sola
invocazione assoluta del `taskkill.exe` acquisito, con
`/pid <pid-originale> /T /F`, senza frame IPC di arresto. Listener e
deadline sono installati prima del comando; subito prima dell'invocazione
sincrona il launcher verifica ancora che il ChildProcess originale sia vivo.
Entro un unico budget di 8 secondi servono entrambe le prove: comando senza
errore o timeout e con status 0, ed evento `exit` dell'originale ChildProcess.
L'ordine dei due eventi non cambia il criterio. Solo questa congiunzione
registra una ricevuta idempotente sullo stesso handle, mai sul solo PID.
Un leader già terminale senza tale ricevuta, un errore del comando o un exit
mancante conservano owner e generazione e negano il nuovo claim. Nessun retry
automatico; un errore non viene sanato da un exit successivo.

`/T` riguarda l'albero e `/F` rende lo Stop forzato
([Microsoft taskkill](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill)).
Può saltare la chiusura applicativa e interrompere lavoro in corso: non è
semanticamente equivalente allo stop cooperativo. La terminazione Win32 può
essere asincrona
([Microsoft TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess));
lo status del comando da solo non sostituisce l'attesa dell'originale.
Prima dell'integrazione è obbligatorio il gate Windows reale con archivio
sintetico: Stop dalla superficie ordinaria, Web non raggiungibile, generazione
ritirata, riavvio sulla stessa cartella, integrità SQLite, conservazione della
scrittura committata e rollback della transazione incompleta. Se il gate
separa Web e albero sintetico con transazione, le due coperture e il limite
della composizione devono essere dichiarati. La preparazione del gate e i
driver Windows simulati non ne attestano il passaggio. La prova sintetica non
garantisce innocuità universale o ammissione all'uso clinico.
L'ammissione IPC dopo readiness e prova HMAC resta necessaria soltanto per
navigazione e cancel.

Su POSIX il numero del gruppo non ne prova la continuità dopo la fine del
capogruppo. Il launcher rinvia i segnali a una nuova fase del ciclo Node,
lascia completare i callback di raccolta dei figli e ricontrolla il leader
subito prima del segnale, senza ulteriori attese nella sezione sincrona.
Se il leader è terminale e il gruppo risulta presente o non verificabile,
lo stop resta non confermato: launcher e generazione rimangono posseduti,
senza ulteriori segnali a quel gruppo. Un nuovo gesto Arresta non supera
questa incertezza. Soltanto ESRCH osservato e memorizzato prova l'assenza;
dopo una quiescenza verificata il gesto può concludere lo stop. Questo
comportamento riguarda il lifecycle Node/libuv verificato, non costituisce
una garanzia universale su reaper esterni o implementazioni POSIX diverse.

Il pacchetto e il navigator applicano la stessa allowlist esplicita in
`plugins/mediflow-local-ui/src/runtime-environment.mjs`. HOME e le variabili
profilo Windows conservano la sede utente; APPDATA, LOCALAPPDATA e XDG conservano
configurazione e risorse locali; TMPDIR/TMP/TEMP mantengono la sede temporanea;
LANG, LANGUAGE, le categorie LC elencate e TZ conservano lingua, formati e fuso.
PATH conserva i programmi locali configurati, preceduto dal Node fisico ammesso;
SystemRoot/WINDIR/ComSpec/PATHEXT servono ai comandi Windows. DISPLAY,
WAYLAND_DISPLAY, XDG_RUNTIME_DIR e DBUS_SESSION_BUS_ADDRESS conservano l'accesso
alla sessione grafica Linux. MEDIFLOW_MAC_CONFIG conserva la scelta del bundle
locale. Le sei configurazioni MEDIFLOW_ATHENA_* lette dal prodotto e
MEDIFLOW_UVX_BIN conservano runner MLX, modello locale, Python, pacchetto, seed
e limite token; restano inoltre le configurazioni esplicite di ICD WHO locale,
OpenMed locale, limite allegati e rete. MEDIFLOW_DATA_DIR proviene sempre dall'archivio ammesso nel pacchetto;
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
raccordo. Il lifecycle e il recupero della bozza locale seguono ADR 0171, emendamento del 29 ottobre 2026.

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
Niente MCP bare, HTTP generico, download impliciti, broker persistente, nuovo
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
soltanto enum, ID casuale e scadenza, con fingerprint sorgente e archivio attesi,
sul medesimo canale di processo. Il launcher confronta questi ultimi con la
propria identità e il proprio archivio prima di inoltrare un intento.
Per l'avvio a freddo reclama una directory lock nuova. Una lock già presente
non viene letta come prova e non autorizza HTTP verso un candidato. Gli alias
sono rifiutati. L'uscita o la disconnessione del figlio ritira il suo handle;
la richiesta successiva può avviare una nuova generazione senza riusare stato.

### Abbinamento confermato di un'istanza già aperta — decisione 23 ottobre

Il medico mantiene aperta la propria MediFlow. Il raccordo posseduto dalla
sessione host crea un nonce, un identificativo host e un codice casuale a 96 bit,
con scadenza di 60 secondi. Mostra il codice in una propria pagina loopback,
servita su un socket che mantiene aperto; il medico lo copia nella UI MediFlow
che stava già usando e preme «Consenti a Codex/Claude di aprire schermate qui?».
Il bottone «Consenti» richiede un evento browser trusted, user activation e
documento visibile. «Rifiuta» non concede navigazione. Non si apre mai come
bootstrap una pagina del listener candidato o un URL ricavato dalla receipt.

Il codice resta nella memoria del raccordo e nei due documenti locali usati
dal medico. Non va in file, receipt, schema, risultati, stderr o chat MCP.
Il rendezvous privato su disco contiene soltanto nonce, sede di ritorno,
identità sorgente/archivio, host casuale e scadenza: non è una prova di fiducia.
Il launcher già vivo lo consuma senza seguire symlink e inoltra la richiesta
al proprio Web solo dopo la prova di possesso del listener. Il codice inserito
tramite la sessione Web autenticata torna sul suo IPC e su una connessione
locale dedicata. Il raccordo verifica codice, nonce e identità prima di usare
quella connessione. Un listener che legge o falsifica il rendezvous pubblico
non conosce il codice e non può creare un abbinamento. Un endpoint che dichiara
semplicemente «confermato» non basta.

La capacità resta legata al nonce consumato, host fisico (vita del raccordo
sul suo IPC), istanza Web/generazione casuale, sorgente e archivio canonico,
nonché alla sessione Web e alla generazione effettiva dell'archivio. Ogni uso
ricontrolla la risorsa di sessione proprietaria prima dell'inoltro dei soli
quattro intenti. Non compone servizi o autorità cliniche. La UI espone la revoca;
lock, logout, scadenza della sessione, sostituzione dell'archivio, riavvio Web,
disconnessione dell'host o chiusura del canale ritirano la capacità e il suo
intento corrente. Anche la richiesta già osservata nella UI è ritirata al lock.
Un nonce rifiutato, scaduto o revocato non è ripresentabile. Una nuova sessione
host richiede una nuova conferma.

Il tool mantiene il proprio limite di otto secondi. Nessun intento viene
accodato in attesa del medico: se l'abbinamento avviene dopo il termine serve
una nuova richiesta esplicita. Ricevuta ed errore MCP restano fissi e non
rivelano codice, consenso, archivio o sessione. La pagina del codice non è una
superficie clinica; la UI fidata rimane quella già aperta dal launcher ordinario.
Le prove non promettono isolamento dagli altri strumenti del medesimo utente
OS autorizzati a leggere browser o memoria, né da un OS compromesso.

Il Web autentica il proprio listener con HMAC di una sfida fresca. Il segreto
casuale per generazione è trasmesso al figlio posseduto e resta fuori da HTTP e
receipt. Il launcher verifica la risposta del server dopo il bind e prima di
ogni handoff: fingerprint pubblico, PID vivo e ready IPC prematuro non bastano.
Se la prova manca o la porta passa a un listener estraneo, navigazione negata.

Il navigator attende l’handshake del processo figlio prima della prima
richiesta: il solo evento OS `spawn` precede l’installazione dei gestori IPC
e non è readiness. Le risposte IPC sono correlate all’ID della richiesta. Annullamento e
handoff rifiutato revocano soltanto quell'ID. La disconnessione revoca gli
handoff ancora pendenti, senza arrestare il launcher o il Web autonomi.
`--riusa` conserva inizializzazione e servizi facoltativi ordinari, incluso
Ollama, e limita il riuso alla build già ammessa e alla conservazione delle
preferenze. Il selettore ordinario e le scelte ricordate restano efficaci.
