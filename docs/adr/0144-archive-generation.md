# ADR 0144: generazione dell’archivio e sostituzione Web gestita

Date: 2026-10-11

Status: Accepted — implementazione Web 0.9.0; qualifica delle altre piattaforme separata

## Problema

C15 / [WUL-730](https://linear.app/wulfgardr/issue/WUL-730), criteri 4 e 5:
un’operazione che ha letto l’archivio A non deve scrivere nell’archivio B,
anche quando identificativi e versioni delle righe coincidono. Ritirare solo
le sessioni non basta: una scheda vecchia può ereditare il cookie nuovo da
un’altra scheda, e una richiesta può aver già superato l’autenticazione.
Il repair fisico deve inoltre impedire che un processo conservi handle o
continuazioni asincrone sul file sostituito.

## Decisione

### Generazione e autorità

`archive_generation` contiene una sola UUID casuale. Non è un dato clinico,
non contiene credenziali e non è esportata nel backup. Lo schema passa alla
versione 3. Il ripristino logico la ruota nella stessa transazione IMMEDIATE
delle scritture distruttive; il repair e l’adozione legacy la ruotano nella
copia preparata, prima del seal del journal. La sorgente resta intatta.

Le sessioni Web conservano il legame durevole in `archive_session_generations`
(hash dell’identificativo, generazione e scadenza), senza cambiare la forma
dell’owner di autenticazione. Le sessioni native catturano la generazione
nell’adattatore host; i grant di pairing la conservano nel loro stato.
L’autenticazione rifiuta un legame diverso dall’archivio corrente. Il restore
ritira anche le sessioni native in memoria. Un client abbinato deve ripetere
abbinamento e sincronizzazione; l’interfaccia lo dichiara prima del restore.

La generazione della sessione si cattura **prima** degli await della richiesta.
Il writer audit obbligatorio la verifica dentro la stessa transazione della
modifica clinica: una divergenza causa rollback e `409 ARCHIVE_REPLACED`.
Non si sostituisce mai una generazione vecchia con quella appena riletta.

Anche setup, adozione, cambio e recupero delle credenziali catturano la
generazione prima delle attese e la confrontano nella transazione CAS. Un
utente con lo stesso ID e le stesse credenziali nell’archivio B non eredita
l’operazione iniziata su A.

### Schede Web e richieste già avviate

Check, login e setup espongono la generazione. Il documento Web la fissa alla
prima osservazione e non la aggiorna in place: un cambiamento scarta lo stato
e forza il reload. Anche le richieste Web mutanti dichiarano
`x-mediflow-archive-generation`, stampata dal trasporto comune con il valore
fissato dal documento. Dopo autenticazione e scope, il server confronta
intestazione, legame della sessione e archivio. Così una scheda A con il nuovo
cookie B riceve 409, anche prima che il polling osservi il cambiamento.

Le factory opache mantengono autenticazione e autorità canoniche: un contesto
asincrono trasporta soltanto la generazione della richiesta; l’ammissione
esistente verifica il legame prima di pubblicare capability o inviare dati.
Il controllo viene ripetuto nella transazione clinica. Non è introdotto un
secondo resolver di identità e non cambia il contratto wire dei client nativi.

### Proprietario del processo Web per il repair fisico

Il supervisor esistente espone `--maintenance-web` (`npm run maintenance:web`)
per il runtime standalone di produzione. Non cambia `npm run dev` né i
launcher di sviluppo. Il proprietario mantiene il lease SQLite del figlio;
il figlio Node 24 non ha il permesso di creare subprocessi. In questa modalità
i helper che richiedono processi figli non sono disponibili. Non esiste un
listener di comandi: il canale IPC privato ammette solo il repair legacy con
UUID della richiesta e generazione attesa, senza percorsi o comandi arbitrari.

Il proprietario copia e valida la sorgente fissa `medical.db` in una directory
isolata mentre A continua a funzionare. Una sorgente assente o non valida è
rifiutata senza arrestare A. Per una copia valida: pubblica l’intent, ferma il
figlio posseduto, attende il suo evento terminale `close`, chiude handle e lease,
attende gli altri partecipanti e solo allora esegue lo swap con il journal
esistente. Riavvia il figlio dopo il commit, verificabile da `auth/check`.
Una richiesta accettata (202) non è un repair riuscito: l’interfaccia distingue
esito committed, rejected e risultato ancora non confermato tramite request ID.

Un errore dopo l’arresto conserva intent e copie e richiede recupero esplicito;
non riavvia automaticamente A o B e non elimina record in base a PID o età.
Le regole di ammissione e recovery restano quelle dell’[ADR 0142](0142-sqlite-maintenance-admission.md).

### Writer che non usano l’audit clinico comune

| Percorso | Confine per il cambio archivio |
| --- | --- |
| `system/migrate` | Generazione catturata prima della decifratura asincrona e verificata nella transazione di aggiornamento. Il contratto audit preesistente non viene ampliato qui. |
| `physician-review-command` | Confronto esplicito nella transazione IMMEDIATE che scrive stato, audit e replay. |
| SOAP headless e transizioni checkup | Rivalidazione dell’owner di sessione/selezione dentro il commit; la sessione è vincolata alla generazione. |
| Backfill documentale CLI | Dry-run con lease read-only; apply esclusivo offline sotto intent per l’intero backup, letture asincrone e scritture. Un lease attivo impedisce anche il backup. |
| Store envelope/replay di review e link paziente | Primitive sincrone senza composizione Web esposta; non costituiscono un’API autonoma. |
| Bootstrap, reset, cataloghi e impostazioni | Confini operativi, non riprese cliniche da uno snapshot paziente; bootstrap ammesso, richieste Web protette dal documento corrente. |

## Alternative scartate e limiti

Solo logout non chiude richieste in attesa né schede con cookie condiviso.
Una chiave in `settings` sarebbe scrivibile dall’API generica. Un lock soltanto
nel route non chiude handle e continuazioni del processo. Perciò il repair
senza proprietario gestito rimane indisponibile, non viene degradato a uno swap
online. La qualifica dei client nativi e dei filesystem Windows/Linux resta
separata; questi controlli non dichiarano parità, resistenza a power loss o
recupero completo delle chiavi.

## Verifica

Fixture sintetiche con SQLite reale provano A→B a identico ID/versione durante
l’attesa del body, rollback senza dati o audit, scheda A con cookie B rifiutata,
nuova sessione/documento B ammessi, revoca pairing e latch Web che non promuove
la vecchia scheda. Il supervisor viene provato con figlio reale: ingresso
concorrente, rifiuto della sorgente prima dello stop, stop terminale prima dello
swap e errore post-stop senza riavvio automatico. Il percorso operativo passa
anche da Next standalone, setup, repair accettato, riavvio e nuovo archivio.


## Backup completo cifrato e recupero offline

L’esportazione portabile `.mediflow` resta distinta: non esporta account e
involucri delle chiavi e mantiene il blocco sui comandi durevoli. Il backup
completo `.mediflow-recovery` conserva invece **tutte le tabelle SQLite**, senza
un registro di collezioni: account, involucri, impostazioni, ledger e audit
originale compresi. Non copia token locali, configurazioni o file esterni a
SQLite. La directory di lavoro e quella di recupero devono stare su un volume
cifrato; l’artefatto scaricato è cifrato separatamente.

Un amministratore Web sbloccato con passphrase richiede una copia consistente
con `VACUUM INTO`, sotto l’ammissione del processo esistente. La copia isolata
è verificata e restituita solo al browser same-origin autenticato, con
`no-store`; non viene offerta come download in chiaro. La directory temporanea
sta accanto all’archivio ed è rimossa prima della risposta. Il browser genera una
chiave AES-256 casuale per il backup, cifra la copia e avvolge quella chiave
con la master key residente **senza esportarla**. La chiave clinica non arriva
al server Web. Un cambio di autorità durante gli await annulla il download.

Il formato v1 è binario e limitato a 256 MiB di SQLite. Il prefisso `MDFREC01`
(8 byte) è seguito da nonce casuale di wrapping (12), chiave avvolta con tag
(48), nonce casuale del contenuto (12) e contenuto cifrato con tag (almeno 116).
Entrambi usano AES-256-GCM con tag da 128 bit. Il wrapping usa l’AAD
`mediflow.recovery-backup.key.v1`; il contenuto autentica tutti gli 80 byte
dell’intestazione. Non ci sono nome utente, kit o metadati clinici in chiaro.
Il kit resta un file separato; la chiave cartacea non viene salvata nel backup.

Il recupero canonico è una CLI **offline**, non un endpoint anonimo: legge la
chiave da terminale senza eco, mai da argomenti, variabili d’ambiente o log.
Solo quel processo dedicato recupera temporaneamente la master key in memoria.
Autenticità, limite, integrità SQLite, schema corrente completo, relazioni e
corrispondenza del kit all’account amministratore nello snapshot sono verificati
prima dell’apertura mutante della destinazione. Un kit di un’altra rotazione
è rifiutato: va conservato il kit corrispondente a ciascun backup.

La destinazione deve essere assente oppure un archivio inizializzato senza
alcuna riga, eccetto la generazione. Un `local-api-token` già presente o un
override `MEDIFLOW_LOCAL_API_TOKEN` fanno rifiutare il recupero: non devono
ereditare autorità sui dati ripristinati. Non vanno ricopiati o riutilizzati
all’avvio successivo. Dopo la nuova verifica sotto ammissione
esclusiva, il recupero riusa lo swap con journal: nessun secondo owner o motore
di ripristino. La copia preparata ruota la generazione e elimina i legami delle
sessioni; i processi devono essere chiusi e i dispositivi riabbinati. Ledger e
audit restano byte per byte nei loro valori; i comandi non vengono rieseguiti.
Il recupero della passphrase successivo usa il percorso dell’ADR 0143.

Il lease impedisce la doppia autorità **locale sullo stesso archivio**, non la
riaccensione di una copia su un altro computer. L’operatore deve ritirare
l’installazione sorgente prima di lavorare su quella recuperata; la CLI richiede
questa conferma. Non è una prevenzione tecnica dei cloni remoti. La UI distingue
backup creato, autenticità della cifratura verificata e ripristino provato.
