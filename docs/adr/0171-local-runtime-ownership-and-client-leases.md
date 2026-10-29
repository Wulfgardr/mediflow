# ADR 0171: proprietà del runtime locale e lease dei client

Stato: proposto. Parte di WUL-757.

Il launcher che avvia Web ne conserva la proprietà. Il collegamento di un plugin,
il riuso da un secondo client e l'apertura ordinaria sono sessioni distinte:
la perdita di un collegamento non autorizza l'arresto delle altre sessioni.

## Decisione

Il launcher registra prima dell'ammissione del figlio un token privato contenente
PID, istante di creazione del processo e nonce casuale. Prima di ogni segnale al
figlio o al gruppo POSIX verifica il token originale e la generazione viva.
I record precedenti senza questa prova non autorizzano segnali automatici.

Ogni collegamento plugin possiede un lease su una pipe locale privata. L'owner
verifica la propria generazione e quella del client prima di confermare il lease.
La chiusura della pipe, anche per SIGKILL del client, rilascia solo quel lease.
Il client non riceve un'autorità di arresto sul Web riusato.

Il riuso ordinario trasferisce esplicitamente un lease alla sessione manuale del
launcher, prima di aprire l'URL e terminare il comando breve. Quel lease vive fino
all'azione esplicita Arresta o alla chiusura del terminale proprietario; la perdita
del plugin iniziale non lo rilascia. Arresta rilascia le sessioni locali del
launcher, ma attende gli altri client collegati. Il cambio di modalità è negato
mentre un altro client usa il runtime. La conferma dei lease e la decisione di
arresto sono serializzate nello stesso event loop: una volta deciso l'arresto,
nuove acquisizioni sono negate e non possono essere confermate sul Web uscente.

Il lock per archivio è acquisito anche dagli avvii ordinari, prima della scelta
della modalità. Un altro checkout riusa soltanto un Web sano della stessa
impronta sorgente; se è ancora in avvio o ha un’altra revisione, non ne apre un
secondo e non ne assume la proprietà.

Su Windows la named pipe è anche un vincolo di proprietà legato a un handle del
processo. I file mantengono soltanto discovery e identità recuperabile, con il
protocollo di generazioni esistente: un processo morto o un PID riciclato non
conservano la proprietà. Un file sconosciuto non autorizza cancellazioni o segnali.

Web attende un messaggio IPC con nonce prima di eseguire il server. Un helper
PowerShell locale lo associa prima a un Job Object Windows senza breakaway e con
kill-on-close. L'helper verifica PID, tempo di creazione e token, conserva l'handle
del Job e osserva il numero di processi attivi. Quando il Web esce, elimina gli
eventuali discendenti nel Job e comunica zero processi prima del rilascio delle
proprietà di checkout e archivio. Non usa il PID di un capogruppo già morto come
prova dell'assenza dei discendenti. La pipe di vita del launcher chiude il Job in
caso di perdita del proprietario. Errori di verifica restano visibili e non danno
luogo a segnali globali o a rimozione indiscriminata dei file di discovery.

## Conseguenze e verifica

Il launcher può sopravvivere al plugin iniziale se un altro client o una sessione
manuale usa Web. Questo processo è ancora posseduto e servente, non un orfano.
La morte del launcher proprietario è diversa dalla morte di un suo client: la
prima perde tutti i collegamenti e chiude il runtime; la seconda ne rilascia uno.

I test coprono entrambi gli ordini di avvio ordinario/plugin, più client,
SIGKILL del client iniziale, identità e nonce falsi, ultima disconnessione, uscita
Web con discendenti su Windows e riacquisizione dei lock. Il Job Windows richiede
una verifica sul sistema operativo; i test POSIX non la sostituiscono.


## Recupero e tentativi di arresto

Prima di ammettere Web, il launcher pubblica nei due lock la sua generazione
serviente, poi apre il gate IPC. La morte del launcher non basta per recuperare
un lock: devono essere terminali anche Web e il suo gruppo POSIX, oppure Web e
il guardian del Job Windows. Il recupero osserva soltanto la quiescenza; non
invia segnali ai PID ritrovati su disco. Identità non leggibili e gruppi ancora
presenti negano il recupero. Su Windows il guardian conserva l'handle del Job
fino alla conferma di zero processi attivi.

Lo stop esplicito rilascia le sessioni locali e consuma l'eventuale callback idle
pendente nello stesso turno. Se altri client restano collegati restituisce 409.
Ogni retry ha un solo produttore di esito. L'observer di uscita del Web agisce
soltanto sulla propria generazione: l'uscita durante uno switch viene gestita
dal tentativo di switch già in corso.

`node scripts/recover-local-runtime.mjs /percorso/instance.json` legge una
ricevuta locale regolare e verifica sul canale privato nonce, identità del
processo, URL del chooser, checkout e archivio. La richiesta di ispezione non
acquisisce un lease e non rilascia sessioni. Solo dopo la conferma viene inviato
il POST all'URL verificato. La ricevuta alterata viene rifiutata prima del POST;
il possesso del solo PID o la forma di un UUID non autenticano un endpoint.

## Documento Web e recupero della bozza, 29 ottobre 2026

Nel runtime avviato da un plugin, ogni documento Web autenticato è un client.
Pagina, plugin e sessione manuale usano un solo registro nel launcher, con tipi
chiusi per il genere di lease e per le fasi accepting, idle-pending, stopping,
closed. Un documento rinnova ogni tre secondi un lease di massimo quindici
secondi, limitato anche dalla scadenza della sessione Web. Il launcher elimina
le scadenze ogni 250 ms: connessione HTTP aperta, invio senza risposta e timer
nel browser non costituiscono conferma. Il Web attende l'ack IPC del launcher.
La chiusura della pagina prova a rilasciare il lease; il mancato saluto non ne
impedisce la scadenza. Lock, logout o revoca negano i rinnovi; un lease già
confermato dura al massimo fino alla scadenza. La sospensione del browser o
il throttling dei suoi timer possono produrre la stessa scadenza.

L'endpoint ammette soltanto POST JSON dalla stessa origine loopback esatta,
con sessione locale Web valida per l'archivio corrente. L'identità del lease
combina il digest della sessione risolta dal server e un nonce di documento.
Il browser non può scegliere la sessione o la deadline. L'IPC appartiene al
Web posseduto della generazione corrente. Questo lease serve solo al lifecycle,
non concede navigazione, selezione, capacità o autorità clinica. Dopo la
transizione stopping non si può acquisire un lease. Gli avvii ordinari di
MediFlow.command conservano il lease manuale e non attivano il lease Web.

Il nuovo editor conservava il testo soltanto in RAM. La porta stabile da sola
non lo recupera: ora conserva automaticamente testo, tipo, sede, data e testo
dettato cifrati AES-GCM con la master key già sbloccata. La copia locale del
browser è separata per generazione dell'archivio, utente e paziente; il medesimo
contesto è verificato dentro l'involucro cifrato. Gli allegati File non sono
conservati e l'editor chiede di selezionarli di nuovo. Una copia illeggibile o
modificata in un'altra scheda non viene sovrascritta. Web Locks serializza il
confronto e la scrittura; un errore di quota resta visibile. Il recupero lascia
il testo da rivedere e la dettatura non confermata. Soltanto il normale gesto
Registra nel diario invoca il writer clinico esistente; la copia viene rimossa
dopo il successo. Nessuna nuova tabella, API dati o scrittura clinica.

Per mantenere la stessa origine il navigator del plugin conserva una porta
casuale assegnata all'archivio nella configurazione locale del launcher, con
pubblicazione esclusiva e lettura di un file regolare verificato. Le ripartenze
usano quella porta anche da un altro checkout. Se è occupata, l'avvio è negato:
non si adotta il listener e non si sceglie un'altra origine che nasconderebbe
le bozze. La configurazione non contiene dati clinici o chiavi. Gli avvii
ordinari mantengono la propria scelta di porta. Cambiare manualmente porta,
cancellare lo storage del browser o cambiare browser non trasferisce la bozza.
Questa scelta limita il cambiamento al lifecycle e alla copia cifrata locale,
senza introdurre un secondo archivio di bozze lato server.
