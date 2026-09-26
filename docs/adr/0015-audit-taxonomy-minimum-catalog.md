# ADR 0015: Taxonomy audit minima e logging PHI-safe

Date: 2026-03-17  
Status: Accepted

---

## Problema

MediFlow non ha ancora una taxonomy audit canonica e versionata. Senza una
lingua comune, i log rischiano di diventare ad hoc, incoerenti tra web e native
e, soprattutto, troppo ricchi di dettagli clinici.

Serve una base minima per tracciare chi ha fatto cosa, quando, da quale
superficie e con quale esito, senza trasformare il logging applicativo in un
contenitore di PHI.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` impongono local-first, nessun egress cloud
  di default e logging PHI-safe.
  taxonomy e i confini, non il writer append-only completo.
- Non vogliamo toccare backup, parity native o UI per introdurre questa base.

## Opzioni

1. Continuare con log testuali liberi e convenzioni locali per ciascun modulo.
2. Definire un envelope audit generico ma senza catalogo versionato.
3. Introdurre un catalogo audit versionato con schema minimo e confini PHI-safe
   espliciti.

## Trade-off

- Opzione 1:
  - Pro: nessun lavoro iniziale.
  - Contro: drift, scarsa auditabilita e alto rischio di leak.
- Opzione 2:
  - Pro: un po' piu ordinata dei log liberi.
  - Contro: manca una fonte di verita stabile e valida per i client.
- Opzione 3:
  - Pro: contratto chiaro, auditability migliore, difesa migliore contro
    logging eccessivo.
  - Contro: richiede disciplina e un follow-up per il writer append-only.

## Decisione

Adottiamo l'opzione 3.

La taxonomy canonica e `audit.v1`.

### Event catalogo minimo

Eventi core:

- `auth.login.succeeded`
- `auth.login.failed`
- `auth.logout`
- `patient.created`
- `patient.updated`
- `patient.deleted`
- `patient.restored`
- `entry.created`
- `entry.updated`
- `entry.deleted`
- `therapy.created`
- `therapy.updated`
- `therapy.deleted`
- `observation.created`
- `observation.updated`
- `observation.deleted`
- `settings.updated`

Regole:

- ogni evento deve essere classificato con un `eventType` stabile e non libero
- l'esito deve essere esplicito (`success`, `failure`, `denied`)
- il catalogo non deve includere testo narrativo o motivazioni cliniche libere

### Schema evento v1

Ogni record audit deve seguire questo shape logico:

```ts
type AuditEventV1 = {
  schemaVersion: 1;
  eventId: string;
  eventType: string;
  occurredAt: string;
  outcome: 'success' | 'failure' | 'denied';
  actorType: 'user' | 'system';
  actorRef: string;
  subjectType: 'session' | 'patient' | 'entry' | 'therapy' | 'observation' | 'settings';
  subjectRef?: string;
  sourceSurface: 'web' | 'native' | 'api' | 'job';
  requestId?: string;
  redactedMetadata?: {
    changedFields?: string[];
    resourceVersion?: number;
    counts?: number;
    flags?: string[];
    reasonCode?: string;
  };
};
```

Regole di schema:

- `actorRef` e `subjectRef` devono essere riferimenti interni o redatti, mai
  nomi, codici fiscali o testo libero
- `redactedMetadata` puo contenere solo valori strutturati e non narrativi
- `subjectRef` puo essere omesso per gli eventi auth che non hanno un soggetto
  stabile da esporre

### Boundaries PHI-safe

Consentito nel catalogo audit:

- timestamp, outcome e tipo evento
- riferimenti interni o redatti
- numeri di versione, conteggi, flag e codici di stato
- nomi di superfici tecniche (`web`, `native`, `api`, `job`)

Vietato nel catalogo audit e nei log applicativi:

- testo OCR grezzo
- note paziente, diario o prompt AI in chiaro
- allegati o base64
- PIN, token, chiavi o salt
- descrizioni cliniche libere o motivazioni narrative non redatte

## Conseguenze

- Positivo: i lavori futuri su audit trail, actor attribution e viewer possono
  condividere un contratto stabile.
- Positivo: la policy di logging diventa verificabile e allineata tra web e
  native.
- Negativo: i futuri writer dovranno rispettare uno schema piu rigido.
- Vincolo: questa ADR non implementa ancora il writer append-only o l'export.

## First Thin Slice

1. Usare `audit.v1` come fonte canonica per i futuri writer.
2. Tenere i log applicativi fuori dal contenuto clinico.
3. Implementare il writer append-only e la UI/estrazione audit in una issue
   successiva.

## Estensione del 26 settembre 2026 — pilota C04 (candidato locale)

Il catalogo `audit.v1` e lo schema append-only restano invariati. Il pilota
WUL-719 riguarda soltanto l'aggiornamento del profilo paziente attraverso le
tre superfici esistenti Web, API-v1 locale e rete associata, dopo la
convergenza sull'operazione unica di WUL-718. Non attesta la migrazione degli
altri writer, assegnata a C05, ne il rilascio o l'ammissione clinica.

### Evidenza obbligatoria e confine di commit

L'aggiornamento paziente, la relativa associazione ambulatoriale e il suo
evento di audit obbligatorio devono appartenere alla stessa transazione
sincrona del database autorevole. Il writer richiesto riceve la transazione
gia aperta: non risolve una seconda connessione, non effettua chiamate esterne
e non intercetta il fallimento per proseguire con successo. Se l'inserimento
dell'evento fallisce, anche modifica, associazione e incremento della versione
sono annullati. La risposta di successo viene prodotta solo dopo il commit.

Gli adapter mantengono autenticazione, autorizzazione, scope e normalizzazione
esistenti. Forniscono solo il contesto attore ricavato dall'host, la superficie
e il riferimento di richiesta. Il core deriva soggetto, azione, esito positivo
e versione dallo stato e dai valori normalizzati che sta salvando. I metadati
contengono nomi dei campi applicati, versione e flag strutturati: mai valori
clinici, testo libero o chiavi sconosciute fornite nel corpo della richiesta.
Il riferimento di richiesta resta correlazione, non prova di identita.

Il contratto di replay resta il controllo della versione: una seconda richiesta
con la versione precedente restituisce conflitto, senza una seconda modifica
ne un secondo evento di successo. Dopo una risposta persa il client rilegge
lo stato corrente; non si introduce una promessa di replay della risposta.

### Confini preservati e prove

- Nessun secondo ledger, outbox o migrazione dello schema. Eventi storici
  leggibili e trigger append-only invariati; rollback del codice senza
  cancellare la storia.
- Il pilota non sostituisce le Clinical Commit Receipts headless, che hanno
  garanzie proprie piu forti.
- Telemetria operativa e tentativi negati possono mantenere i loro contratti
  distinti. Una modifica clinica non diventa telemetria per evitare l'audit
  obbligatorio; i writer non migrati restano un debito esplicito C05.
- Le prove richieste usano SQLite reale temporaneo: errore del sink audit,
  vincolo, limite di pagine del database, interruzione prima del commit,
  risposta persa dopo il commit, concorrenza/replay, riapertura, append-only e
  minimizzazione. Il limite di pagine simula `SQLITE_FULL`, non l'esaurimento
  del disco fisico del computer.

L'accettazione del candidato richiede una review indipendente con contesto
fresco. Il completamento del pilota non equivale al completamento di C04:
la classificazione di tutti i sink e chiamanti e la lista di migrazione C05
devono restare esplicite, con gli elementi non risolti ancora aperti.

## Estensione C05 del 26 settembre 2026 — DELETE paziente Web e API-v1

Candidato locale da verificare, scritto prima dell'implementazione. Questa
coorte applica il writer obbligatorio ai soli `DELETE /api/patients/{id}` e
`DELETE /api/v1/patients/{id}`. La cancellazione logica resta quella di
[ADR 0066](./0066-patient-soft-delete-lifecycle.md): non elimina la riga, i
figli clinici o le associazioni ambulatoriali. Rete, ripristino amministrativo,
purge, creazione e operazioni multiple restano fuori da questa coorte.

Un'operazione specifica condivisa rilegge il paziente non eliminato, verifica
la versione e salva tombstone, incremento di versione e `patient.deleted`
nella medesima transazione sincrona immediata. Anche un inserimento audit
ignorato senza errore deve impedire il commit. Attore e superficie provengono
dall'host; soggetto, esito e versione sono derivati dall'operazione, mai dal
corpo come autorita di audit. La motivazione non entra nei metadati audit.

`resourceVersion` indica la versione **committata**, come nel pilota PUT:
`expectedVersion + 1`. Si corregge cosi il precedente metadato Web/v1 che
indicava la versione richiesta, senza riscrivere gli eventi storici.
Il conflitto su un paziente ancora attivo resta 409; un paziente gia eliminato
resta 404, anche dopo risposta persa. Non si introduce un replay idempotente
della risposta. Stato e figli vengono riletti per verificare l'esito.

Gli adapter conservano i permessi e la normalizzazione della motivazione.
Usano il controllo dell'oggetto JSON gia introdotto da C05: richieste non
valide sono respinte prima delle scritture. **No contract impact** sulla
superficie v1: nessun nuovo endpoint, campo, permesso o formato di risposta;
400 e 500 mantengono il loro significato documentato.

L'accettazione richiede baseline/candidato SQLite reali, guasti audit inclusi
inserimenti ignorati, successo con un solo evento, assenza di effetti per
dinieghi/conflitti, conservazione dei figli e associazioni, concorrenza e
rilettura dopo riapertura, oltre alla review indipendente del coordinatore.


## Estensione C05 del 26 settembre 2026 — ciclo di vita paziente in rete

Contratto della prossima coorte, scritto prima del suo runtime. Le tre
operazioni gia esistenti di creazione, cancellazione logica e ripristino del
paziente nella rete associata sono una sola famiglia. Non si aggiungono
endpoint, campi, permessi, capability o formati di risposta. Restano distinti
il ripristino dal cestino e la riattivazione di un paziente archiviato.

Ogni operazione usa la stessa transazione sincrona immediata per stato
paziente, eventuale associazione ambulatoriale, incremento di versione ed
evento obbligatorio (`patient.created`, `patient.deleted`, `patient.restored`).
Il writer transazionale gia adottato dal pilota deve confermare esattamente
un inserimento; errore o inserimento ignorato annullano tutti gli effetti.
La risposta di successo puo uscire soltanto dopo il commit. Il precedente
writer best-effort non e un fallback per queste tre operazioni.

Autenticazione, sessione associata, capability, ambulatorio autorizzato,
limite del corpo e controllo dei campi cifrati restano quelli esistenti.
Il servizio non decifra i campi ne modifica i valori cifrati conservati.
Attore utente, identificativo client e riferimento di richiesta derivano
dal contesto host; soggetto ed evento derivano dall'operazione e versione
dallo stato committato (1 per creazione, versione attesa + 1 per le altre).
Metadati limitati a versione e flag strutturati di autenticazione, client e
scope; nessuna motivazione o valore clinico, nessuna autorita dal body.

Cancellazione e ripristino conservano figli, associazioni e stato di
archiviazione secondo ADR 0066. Conflitto su stato disponibile resta 409;
stato non disponibile o fuori scope resta 404. La creazione con ID gia
presente conserva il comportamento esistente del vincolo, senza upsert.
Una risposta persa non autorizza replay del successo: il client rilegge.
Nessuna migrazione schema, outbox, secondo ledger o riscrittura degli eventi.

L'accettazione richiede prove SQLite reali con riapertura: per ciascuna
operazione errore e inserimento audit ignorato devono lasciare lo stato
identico a prima; successo deve produrre un solo evento con versione e
attore corretti. Verificare anche dinieghi, scope, conflitto, duplicati,
conservazione di figli/associazioni/cifrati/archiviazione e assenza di
seconda scrittura dopo risposta persa. La prova HTTP esistente della
famiglia rete deve restare valida, con pairing, sessione e capability reali
sintetici, oltre ai controlli del repository e alla review indipendente.
Questo risultato non chiude C05 globale ne qualifica i client nativi.


## Estensione C05 del 26 settembre 2026 — creazione paziente locale

Contratto scritto prima del codice della coorte. Sono compresi i tre
percorsi esistenti: POST Web legacy, POST Web `fixed-preview-v1` e POST
API-v1 locale. Tutti devono salvare paziente, eventuale appartenenza
ambulatoriale e un solo `patient.created` nella medesima transazione
sincrona immediata. Il writer obbligatorio deve inserire esattamente un
evento; errore o inserimento ignorato annullano tutti gli effetti. Il
successo e restituito solo dopo il commit. Nessun fallback best-effort.

Il percorso con anteprima conserva il suo contratto piu forte: ambulatorio
fissato nella preview dell'host, generazione/sessione correnti, verifica
preliminare e veto finale dell'owner dopo la callback. Se quel veto arriva
dopo gli INSERT, la transazione deve annullare paziente, appartenenza e
qualsiasi audit gia inserito; nessun successo deve precedere il controllo
finale. Non si sostituisce `createPatientAtPreviewDestination` con CRUD
generico e non si modifica l'owner fisico o il registro dei contesti.

Per legacy e v1 restano i rispettivi criteri di scelta dell'ambulatorio,
permessi, sessioni e token. Identita dell'attore, superficie e flag derivano
dal contesto host, risolto prima della transazione senza attese al suo
interno. Soggetto, `patient.created`, esito e versione iniziale 1 derivano
dall'operazione. I metadati possono contenere solo nomi dei campi normalizzati
e persistiti, versione e flag previsti: non nomi arbitrari o autorita
proposti dal body, valori clinici, ciphertext o nonce dell'anteprima.
Il riferimento di richiesta rimane correlazione, non identita.

Validazione, normalizzazione, dati cifrati, stato di archiviazione ammesso
alla creazione v1 e formato della risposta restano invariati. La creazione
e create-only, non upsert: ID duplicati non sostituiscono dati o generano
un secondo evento. Una risposta persa richiede rilettura e revisione; non
introduce retry automatici ne replay garantito del successo. Nessuna nuova
UI, capability, migrazione, outbox o riscrittura della storia.

L'accettazione richiede baseline prima del runtime e i sei fault audit
FAIL/IGNORE sui tre percorsi con confronto di stato completo da connessione
indipendente. Servono successi con evento unico e attribuzione verificata;
veto fisico dell'owner dopo gli INSERT con rollback anche dell'audit;
precondizioni non valide, scadute o di altra generazione senza effetti;
ID duplicato, concorrenza e retry della stessa richiesta senza duplicazioni.
La prova HTTP dei percorsi ammessi e rifiutati e separata dalle prove con
seam di autenticazione. Si riusano le evidenze UI e dei servizi invariati,
con review del delta e controlli pertinenti, senza chiusura globale C05.


## Estensione C05 del 26 settembre 2026 — ripristino amministrativo paziente

Contratto scritto prima del runtime della coorte, dopo il roster delle
operazioni. Il perimetro e il POST esistente `/api/system/restore-patient`;
il GET amministrativo resta di sola lettura. Entrambi richiedono una
sessione Web admin: un token locale, una sessione nativa o il ruolo medico
non conferiscono questa autorita. Restano separati ripristino di rete,
riattivazione dall'archivio, eliminazione definitiva e recupero da backup.

Il POST continua ad accettare `patientId`, senza introdurre versione
attesa del client, grant, receipt o replay garantito. L'host acquisisce una
transazione SQLite sincrona immediata prima di leggere stato e versione
correnti. Paziente assente resta 404; paziente non cancellato logicamente,
compresa una richiesta ripetuta dopo il successo, resta 409. Il ripristino
cancella soltanto i due campi del tombstone, aggiorna `updatedAt` e incrementa
la versione corrente di uno. Conserva archiviazione, ciphertext, associazioni
ambulatoriali e figli. L'UPDATE verifica ID, versione letta e tombstone;
deve modificare esattamente una riga, altrimenti la transazione fallisce.

Il medesimo commit deve contenere un solo evento `patient.restored`, scritto
con il writer audit transazionale obbligatorio gia adottato. Errore o INSERT
ignorato annullano tutti gli effetti. Solo dopo il commit puo uscire la
risposta esistente `{success:true, patientId, version}`. Le richieste
concorrenti osservano la decisione serializzata dell'host; una seconda
richiesta non restituisce il successo precedente e non genera un altro
evento. La rilettura autorevole dello stato resta necessaria dopo un esito
incerto, senza retry automatici.

Attore, superficie Web e flag di sessione derivano dalla sessione admin
ammessa, non da body, header di superficie o un bearer aggiuntivo. Il
riferimento di richiesta e solo correlazione. Metadati limitati ai due nomi
di campo del tombstone, versione risultante e flag di autenticazione:
nessun motivo di cancellazione, contenuto clinico o valore cifrato.

Il corpo ammesso contiene soltanto `patientId`, stringa non vuota dopo trim.
Il raccordo C05 seguente introduce esplicitamente un massimo di 65.536 byte
per questo POST: 413 per eccesso dichiarato o osservato, 400 per JSON
malformato, null, array, primitivo o proprieta non supportate, prima di
qualunque scrittura. Nessuna nuova semantica di versione del client. Questa
coorte non completa la normalizzazione generale degli input C05.

L'accettazione distingue baseline e candidato: SQLite reale con audit FAIL
ed IGNORE, UPDATE ignorato, confronto completo da connessione riaperta,
conservazione di figli e associazioni, evento unico e attribuzione host.
Servono rifiuti di autenticazione/ruolo senza effetti, JSON non valido,
404/409, contesa e riproposizione dopo successo. Le prove HTTP con cookie
reali sono separate dalle seam dei test di handler; il token solo non deve
autorizzare il ripristino. Si riusano primitive e prove non modificate e si
riesamina il delta indipendentemente, senza dichiarare chiusi C05 o C14.


### Raccordo C05 successivo alla prima consegna amministrativa

La prima consegna ha dimostrato atomicita e attribuzione dell'audit, ma la
review del requisito WUL-720 ha rilevato un residuo: le proprieta estranee
venivano ignorate, compresi `version` ed `expectedVersion`. La precedente
scelta di non introdurre una allowlist non soddisfa il requisito sui campi
non supportati; questo raccordo la sostituisce per il solo POST di ripristino
amministrativo, prima del relativo nuovo delta runtime. Lo snapshot della
prima consegna e le sue prove restano immutati, con accettazione circoscritta
all'atomicita/audit e non a tutto il contratto di input.

Il body ammesso contiene soltanto `patientId`, stringa non vuota dopo trim.
Ogni altra proprieta deve produrre 400 prima di scritture o audit, anche se
porta nomi di attore, superficie o controllo versione. Non si introduce CAS
del client: un campo versione non appartiene a questa operazione e non deve
sembrare accettato. Il successo viene provato con il solo campo ammesso;
header aggiuntivi non autorevoli restano una prova distinta sull'identita
host, non una giustificazione per accettare proprieta estranee nel body.
Autenticazione e ruolo Web admin precedono qualsiasi lettura del corpo.

Il budget del corpo e un requisito distinto dalla forma JSON-object e dalla
allowlist. La ricerca delimitata non ha trovato un massimo gia governato
per questo POST. Il raccordo del 26 settembre, concordato con il Chief of
Staff nel mandato C05, introduce quindi una NUOVA restrizione esplicita:
massimo 65.536 byte (64 KiB) per il solo inviluppo amministrativo di questa
operazione. Non e un limite ereditato da native/network, allegati, AI o Next.
La busta contiene un solo identificativo opaco, non dati clinici o ciphertext.

Dopo autenticazione e ruolo Web admin, leggere il corpo con la primitiva
canonica `readBoundedJsonBody` in modalita `request-json`, usando una costante
locale alla route. Il massimo riguarda sia la dimensione dichiarata sia i
byte effettivi, prima di decodifica/parse: 413 se uno supera il tetto, senza
troncature e senza transazione/audit. Il confine esatto e ammesso quando
forma e campo sono validi; UTF-8 e contato in byte, anche tra chunk.
Restano 400 per errori di lettura/JSON, forma o proprieta non supportate.
Non introdurre nuovi limiti di durata o operazioni simultanee e non
presentare questo vincolo byte come garanzia sul tempo totale di lettura.

Compatibilita: in precedenza identificativi opachi e whitespace non avevano
un massimo documentato per questo ingresso. Inviluppi storicamente ammessi
ma superiori al nuovo tetto ora ricevono 413. Questa e una restrizione
intenzionale del contratto, non l'esito di un censimento dei client reali;
nessun dato clinico reale e stato consultato. I vecchi snapshot conservano
contratto e prove storici, senza riscriverne l'accettazione.

Accettazione del delta: confine esatto e superamento di un byte, UTF-8
multibyte, chunked e Content-Length assente o fuorviante, eccesso dichiarato
rifiutato prima della prima lettura, auth-prima-accesso/lettura, stato SQLite
completo invariato sui rifiuti e HTTP 413 con positivo ammesso. Riutilizzare
suite e semantiche del reader canonico, transazione/audit e altre superfici
immutate; nessun normalizzatore generico o ampliamento ad altri writer.


## Estensione C05 del 26 settembre 2026 — diario clinico ordinario

Roster congelato prima del runtime: POST `/api/entries`, PUT/DELETE
`/api/entries/{id}`, POST `/api/v1/patients/{id}/entries`, PUT/DELETE
`/api/v1/patients/{id}/entries/{entryId}`, POST e PUT dei corrispondenti
percorsi `/api/v1/network/patients/{id}/entries*`. Sono otto mutazioni,
non dieci: i due export di `network-entry-write` sono writer delle due
route rete, non ulteriori operazioni. GET, altre famiglie cliniche e il
writer SOAP headless con grant/receipt piu forti restano fuori da questa
coorte. Non vengono aggiunti DELETE rete, hard delete, nuove capability
headless o autorita di scrittura per agenti.

La baseline reale su SQLite ha riprodotto tutte le sedici combinazioni
operazione/superficie con fault audit FAIL e IGNORE: successo HTTP del
handler e modifica persistita senza evento. Ha inoltre osservato JSON null
o malformato convertiti in 500, proprieta estranee accettate, date booleane
convertite in timestamp e tipo numerico ignorato durante una modifica
altrimenti valida. Queste sono osservazioni precedenti alla correzione,
non accettazione del comportamento. Auth e capability nella baseline sono
seam dichiarati; le prove HTTP restano un passaggio distinto.

### Decisione del confine ordinario

Creazione e aggiornamento del diario convergono su una sola operazione
ordinaria condivisa per ciascuna semantica, non su un framework CRUD.
Gli adapter conservano ammissione Web, token locale e capability/sessione/
scope del paired client. Nella stessa transazione sincrona IMMEDIATE
vengono risolti identita e appartenenza della voce, currentness, scrittura
con esattamente una riga interessata ed evento audit obbligatorio tramite
la primitiva C04. Nessun await o connessione audit distinta nel callback.
Un inserimento audit fallito o ignorato, oppure una scrittura ignorata dopo
il controllo della versione, non produce successo: rollback di tutti gli
effetti. La risposta positiva viene costruita dopo il commit.

Il contesto audit deriva esclusivamente dall'ammissione host. Nelle route
Web un bearer aggiunto alla sessione non cambia l'attore/superficie ammessi;
API locale e rete conservano la propria attribuzione e i flag governati.
Soggetto, tipo evento e resourceVersion derivano dall'operazione e dallo
stato. changedFields deriva solo dai nomi dei valori effettivamente
normalizzati/applicati, mai da chiavi estranee o contenuti clinici.

Le differenze di contratto restano esplicite: Web e API locale non ricevono
le autorizzazioni della rete o viceversa; la rete mantiene i propri vincoli
ENC, i campi AI/document-derived esclusi e i timestamp controllati dall'host.
Metadata, riferimenti allegati e ciphertext restano opachi e conservano la
rappresentazione ammessa. Nessuna decifratura o reinterpretazione clinica.
Gli esiti e i payload 409 di concorrenza restano quelli della voce diario.

Il replay di create con identificativo esplicito e payload esattamente uguale
resta idempotente soltanto in rete, con 200 e nessun secondo evento; payload
diverso e conflitto. Nei create locali l'identificativo gia occupato produce
409 senza effetti invece del precedente 500 di vincolo, senza introdurre
la garanzia idempotente della rete. La ripetizione di una modifica con la
vecchia versione restituisce 409 e non registra un secondo successo.

### Ingressi della stessa famiglia

Un controllo specifico per il diario precede i normalizzatori esistenti,
senza cambiare quelli di terapie, osservazioni o checkup. JSON null, array,
primitivi, malformato, proprieta proprie non ammesse, identificativi espliciti
non stringa/vuoti e valori invalidi producono errori client prima degli
effetti. Identificativi opachi validi non sono trasformati in UUID; un UUID
viene generato soltanto quando l'identificativo di create e omesso.
Le versioni devono essere interi positivi rappresentabili esattamente, con
incremento sicuro. Date numeriche finite gia ammesse restano compatibili;
booleani, oggetti e valori non validi non sono date. In un update, type e
content presenti devono essere stringhe, non ignorati se di tipo diverso.

Compatibilita locale esplicita: i chiamanti Web correnti inviano createdAt e
updatedAt. createdAt viene validato ma l'istante memorizzato resta dell'host;
updatedAt mantiene la normalizzazione storica. Questo adapter puo essere
ritirato solo dopo migrazione dei DTO di creazione e dei chiamanti che
inviano createdAt, non facendo fallire silenziosamente i client esistenti.
La rete continua a rifiutare questi campi client, come da ADR 0053.

La voce conserva il proprio tombstone reversibile. Omissione di deletedAt
non e cancellazione, null esplicito ripristina tramite PUT e CAS; la forma
vuota storicamente ammessa dal normalizzatore resta compatibilita di clear.
DELETE locale resta soft-delete, con motivo/timestamp predefiniti della
superficie e nessuna cancellazione fisica. Il vocabolario non cambia:
ripristinare una voce resta entry.updated, non un evento inventato.

### Decisioni su stato del padre e budget del corpo

Il raccordo con il Chief del 26 settembre rende esplicito, prima del codice
dipendente, il rifiuto 404 per padre mancante o tombstoned su tutte le otto
mutazioni. E una decisione di consolidamento motivata da ADR 0066, non la
pretesa che tutti gli handler precedenti gia la applicassero. L'ammissione
avviene nella stessa transazione di scope, currentness, modifica e audit.
Le guardie di ruolo/scope precedenti restano prima della lettura del body e
non rivelano nuova informazione di esistenza al chiamante non ammesso.

Un padre solo isArchived resta ammesso. PUT deletedAt:null con CAS puo
ripristinare la voce quando il padre e attivo: non ripristina implicitamente
il paziente. Anche l'idempotenza del create rete segue prima l'ammissione
corrente del padre e lo scope; il replay identico di una voce non concede
accesso a un padre ora eliminato e non ripete effetti o audit. Le prove
baseline/candidato mostrano espressamente questa variazione e le ordinazioni
fra tombstone del padre e scrittura del diario, senza equiparare un singolo
processo HTTP a tutte le forme di concorrenza del database.

La rete conserva il tetto gia governato di 4 MiB (ADR 0124). Le sei mutazioni
locali introducono un NUOVO limite specifico di **4.194.304 byte (4 MiB)**,
scelto per questa famiglia di payload clinici nello stesso ordine di grandezza
della rete, non ereditato dal ripristino amministrativo di 64 KiB.
In precedenza gli inviluppi locali non avevano un massimo governato; richieste
superiori prima ammesse ora ricevono 413. Non e stato svolto un censimento
dei client reali. Payload cifrati entro il tetto sono preservati senza tagli
o normalizzazioni del lettore.

Il reader canonico in modalita request-json interviene dopo i gate pertinenti.
413 su eccesso dichiarato o effettivo prima degli effetti; 400 su forma/JSON/
proprieta non ammesse, conservando gli altri errori contrattuali della
superficie. Nessun nuovo limite temporale o di operazioni simultanee.
Le prove coprono confine esatto, UTF-8/chunk, Content-Length assente o
fuorviante, rifiuti senza effetti e compatibilita dei campi temporali del
client, riusando le prove valide del reader. Timestamp invalidi non vengono
accettati tramite l'adapter locale e createdAt non diventa autorita client.
