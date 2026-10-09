# ADR 0142: ammissione delle connessioni SQLite durante la manutenzione

Date: 2026-10-08

Status: Proposed — tranche admission/scheduler; integrazione del lifecycle Web ancora HOLD

## Problema e confine

Lo swap con journal conserva snapshot autonome e distingue il commit dalla
pulizia, ma richiede che altri writer non operino sull'archivio durante la
sostituzione. Lo scheduler apre direttamente SQLite fuori dal processo Web,
attende la serializzazione del backup e scrive lo stato in `settings`. Il suo
precedente ramo d'errore apriva una seconda connessione senza chiudere la prima.
Un lock sulla directory dei backup e un guard in memoria dello swap non
coordinano queste connessioni.

Questa tranche fornisce il protocollo di ammissione condiviso e collega lo
scheduler. Non collega automaticamente il repair Web al nuovo protocollo:
assenza di connessioni registrate non prova assenza di operazioni Web asincrone
né di processi che non partecipano al protocollo. Il repair online resta HOLD
fino all'integrazione e alla verifica del lifecycle proprietario.

## Decisione

`lib/sqlite-maintenance-admission.mjs`, importabile sia da TypeScript sia dal
runner Node, associa al target canonico la directory
`medical.db.maintenance-admission`. `protocol.json` contiene versione e target;
`leases/<uuid>.json` contiene le registrazioni; `intent.json` rappresenta una
richiesta di manutenzione. La directory `gate` serializza le modifiche brevi.
Il PID nei record è informativo: non conferisce autorità di recupero.

`openAdmittedSqlite` registra e sincronizza un lease prima del costruttore nativo.
Un intent presente o residui dello swap impediscono l'apertura. Il lease dura
fino alla chiusura verificata della connessione: `close()` chiude prima SQLite,
poi rimuove esclusivamente il proprio record sotto il gate. Una chiusura
fallita, un'apertura nativa incerta o una perdita dell'identità del record
mantengono il blocco della manutenzione; non vengono dedotti da timeout o PID.

`runWithSqliteMaintenance` pubblica un intent sotto lo stesso gate usato dalle
ammissioni. Da quel punto nessuna nuova connessione partecipante può aprirsi;
quelle già registrate possono completare e chiudersi. La callback viene
raggiunta soltanto dopo il drain di tutti i lease registrati entro una deadline
monotona. Timeout prima della callback non tocca il database e consente di
annullare soltanto l'intent verificato di quella stessa invocazione.

L'intent resta per tutta la callback. Un errore o crash dopo il suo ingresso
conserva l'intent, perché il modulo non conosce gli effetti del lavoro di
manutenzione. Il completamento riuscito consente la rimozione verificata e
sincronizzata dell'intent. La callback è destinata al proprietario del lifecycle
già drenato: non è una nuova autorità HTTP e non costituisce una prova del drain
Web. Il proprietario è responsabile della chiusura degli handle che apre durante
la callback prima di dichiararla completata.

Il runner dei backup usa un solo handle ammesso in `try/catch/finally`. Se il
lavoro fallisce dopo l'ammissione, registra l'errore sullo stesso handle e poi
chiude. Se l'ammissione viene negata, non apre una seconda connessione per
scrivere l'errore; restituisce il fallimento operativo fuori dal database.
Un errore di chiusura impedisce di riportare un completamento riuscito.
Registrazione OS, abilitazione dello scheduler, formato del backup, audit e
guard dei comandi review restano invariati.

## HOLD e recupero

Versione o target discordi, file inattesi, record malformati, link, identità
perduta, gate interrotto e sincronizzazione non verificata producono
`SQLITE_MAINTENANCE_HOLD`. Non si elimina un lease o intent perché è vecchio,
perché il PID non risponde o perché una scansione appare vuota. Un crash può
quindi richiedere una riconciliazione offline: è un residuo operativo da
risolvere attraverso il proprietario, non un invito a cancellare i marker.

Il modulo non implementa un comando di pulizia automatica. Il successivo owner
dovrà verificare l'uscita dei processi posseduti e l'identità/generazione dei
record prima di qualsiasi riconciliazione. Un segnale inviato, IPC disconnesso,
`child.killed`, mtime o PID riusato non dimostrano la chiusura di SQLite.
Un'installazione aggiornata deve prima fermare i vecchi processi non partecipanti:
assenza di lease non dimostra che un vecchio runner non stia operando.

## Integrazione operativa ancora necessaria

Il lifecycle Web deve impedire nuovo lavoro, attendere le operazioni già
avviate, chiudere gli handle e fornire una ricevuta terminale del processo
posseduto prima dello snapshot. Un'operazione che ha letto il database A non
deve riprendere e scrivere nel database B. Il solo proxy di SQLite o una flag
nel route non garantisce questo confine.

Il collegamento di `db-server`, recovery all'avvio, owner del processo Web e
route repair richiede una tranche coordinata distinta. Anche gli altri tool
diretti che possono operare sul target gestito devono partecipare o avere un
confine offline/sintetico verificato. Il modulo non autorizza uno swap sulla
base di un censimento incompleto. Non si presume approvata una nuova API,
capability di autenticazione o rappresentazione delle credenziali.

La distribuzione include esplicitamente la chiusura degli import del runner:
otto sorgenti e diciotto file JavaScript/JSON delle dipendenze con SHA-256
fissati nel contratto `scripts/scheduled-backup-runtime-contract.mjs`, più il
binario nativo SQLite. Le dipendenze sono `better-sqlite3`, `bindings` e
`file-uri-to-path`. I 27 include letterali di Next sono confrontati nei test
con il roster canonico, senza aggiungere import alla superficie resolver
protetta. Il contratto verifica il payload standalone e la copia `WebRuntime` del
builder Mac, prima della rilocazione nativa. Gli otto sorgenti hanno regole
Git `eol=lf` esplicite, così la conversione CRLF del checkout non ne altera
l'identità. Ogni modifica ai sorgenti fissati
richiede un aggiornamento deliberato e revisionato dei relativi hash.

La verifica importa il runner e le dipendenze ESM/CJS dal solo payload fisico
in un processo Node 24 separato, senza avviare il job, senza permesso di
scrittura o caricamento di addon nativi. Prima di eseguire il codice, il
processo proprietario verifica tutti gli hash fissati, indipendenti dai
manifest e dall'output del payload. Nome/versione e una ricevuta stampata dal
processo figlio non sostituiscono questa verifica. File mancanti, hash discordi,
link e risoluzione esterna impediscono il proseguimento del packaging. La presenza
del binario SQLite non ne dimostra l'ABI; i controlli nativi restano separati.
Questa verifica non è una SBOM né una qualifica della firma o del funzionamento
di un artefatto distribuito. La sua ricevuta vale per il payload effettivamente
fornito al controllo; fixture e import locali non qualificano altre build.

Il successo del drain dello
scheduler non chiude da solo il requisito del repair esposto. L'accettazione
operativa richiede un repair autorizzato completo, riavvio riuscito, verifica
del nuovo archivio e successivo backup programmato riuscito.

## Verifica

Fixture interamente sintetiche con SQLite reale e barriere tra processi:
ammissione prima dell'intent, intent prima dell'apertura, pagine WAL, chiusura
fallita, crash di partecipante/owner, deadline senza snapshot, record ambigui e
sincronizzazione fallita. Le prove del runner verificano successo ed errore
prima dello snapshot, assenza del secondo writer, chiusura in `finally` e
rifiuto senza modificare lo stato dello scheduler.

Le ricevute di esecuzione appartengono al pin candidato. Le prove locali macOS
non qualificano filesystem Windows/Linux, locked-file semantics, directory
fsync, scheduler installato, power loss o parità del runtime distribuito.
Sincronizzazioni non supportate falliscono; non esiste un fallback che le
trasformi in successo. Nessun RPO zero o recupero completo di dati/chiavi viene
affermato. La custodia dell'envelope C06/C07 resta un contratto separato.
