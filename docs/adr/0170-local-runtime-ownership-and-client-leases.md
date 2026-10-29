# ADR 0170: proprietà del runtime locale e lease dei client

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
