# ADR 0082: registro persistente delle attese v0

Date: 2026-07-21
Status: Accepted

Issue: WUL-513

Related: [ADR 0015](./0015-audit-taxonomy-minimum-catalog.md), [ADR 0016](./0016-backup-artifact-v1-manifest-preflight.md), [ADR 0064](./0064-service-prescription-itemization-and-catalog-matching.md), [ADR 0066](./0066-patient-soft-delete-lifecycle.md), [ADR 0079](./0079-local-open-loops-and-result-link.md), [ADR 0080](./0080-serialize-sqlite-schema-guards-at-bootstrap.md)

---

## Problema

ADR 0079 consegna una proiezione locale delle attese. La proiezione deriva da prestazioni e risultati già persistiti. Non conserva uno stato gestito dall'operatore, una scadenza assegnata o una chiusura confermata.

Serve un registro persistente distinto. Il registro deve mantenere provenienza, concorrenza esplicita e un ciclo di vita verificabile senza introdurre automazione clinica.

## Contesto

- La prima slice resta sul web locale dell'host.
- SQLite sul Mac resta lo storage autorevole.
- Il server non possiede la chiave per decifrare i campi clinici.
- La fonte prescrittiva v0 è un `service_prescription_item`.
- Il matching può proporre una chiusura. Non può applicarla.
- Il registro non è ancora presente su `main`.

## Opzioni e trade-off

| Opzione | Esito |
| --- | --- |
| Conservare solo la proiezione di ADR 0079. | Il modello resta piccolo, ma non rappresenta scadenze e stati espliciti. |
| Aggiungere il registro locale. | Aggiunge schema, backup e ciclo di vita, ma conserva il controllo dell'operatore. |
| Introdurre reminder, job e paired. | Amplia automazione e contratti prima di validare il workflow locale. |

## Decisione

Adottiamo l'opzione 2 per il candidato v0.

### Separazione da ADR 0079

- La proiezione di ADR 0079 resta derivata, priva di stato persistito e già
  consegnata.
- Il registro nasce solo da una scelta esplicita dell'operatore.
- Il runtime non converte automaticamente le righe della proiezione in record.
- Il v0 non esegue un backfill automatico delle prestazioni esistenti.
- La UI deve distinguere una proiezione da un record del registro.

### Contratto dati e cardinalità

Ogni record usa questi gruppi di campi:

| Gruppo | Campi | Regola |
| --- | --- | --- |
| Identità | `id`, `patientId`, `ambulatoryId` | `patientId` è un riferimento interno obbligatorio. `ambulatoryId` è l'identificatore immutabile dell'ambulatorio alla creazione e resta una provenienza storica. |
| Provenienza | `sourceType`, `sourceId` | `sourceType` vale `service_prescription_item` nel v0. La coppia è immutabile e univoca. |
| Contenuto | `kind`, `description` | `kind` vale `lab`, `specialistica`, `imaging` o `altro`. `description` è cifrato lato client e non deriva automaticamente dal nome della prestazione. |
| Ciclo di vita | `status`, `dueAt`, `createdAt`, `updatedAt`, `version` | `dueAt` è facoltativo. Ogni mutazione incrementa `version`. |
| Chiusura | `closedByType`, `closedById` | `closedByType` vale solo `observation` nel v0. I due campi sono valorizzati solo nello stato `closed`. |

La cardinalità v0 è la seguente:

- un'attesa riferisce esattamente un item prescrittivo;
- un item prescrittivo ha zero o una attesa persistente;
- una attesa chiusa riferisce esattamente un candidato di chiusura;
- un candidato di chiusura può chiudere al massimo un'attesa.

Un indice univoco protegge `sourceType + sourceId`. Un indice univoco parziale
protegge `closedByType + closedById` quando `status = closed`. Il secondo indice
impedisce che due transazioni chiudano attese diverse con la stessa osservazione.

Gli identificatori, gli enum, le date e la versione restano metadati
interrogabili. I metadati non devono contenere testo clinico libero.

`description` deve usare il formato `ENC:<iv_b64>:<cipher_b64>`. Il client
fornisce il ciphertext. Il server non copia il ciphertext di `serviceName` e
non tenta di derivare testo cifrato. Ogni futuro campo narrativo deve essere
cifrato prima della persistenza.

La creazione di una attesa richiede una categoria non nulla sulla fonte. Se la
richiesta crea insieme item e attesa, deve fornire la categoria. Un item con
categoria nulla resta valido, ma non può aprire una attesa finché l'operatore
non assegna una categoria ammessa.

Per le categorie ammesse, la conversione da
`service_prescription_items.category` a `kind` è totale:

| `category` | `kind` |
| --- | --- |
| `lab` | `lab` |
| `imaging` | `imaging` |
| `visit`, `rehab`, `screening`, `procedure` | `specialistica` |
| `other` | `altro` |

Una categoria nulla o non riconosciuta interrompe soltanto la creazione
dell'attesa. Non esiste un fallback implicito a `altro`. Dopo la creazione,
`kind` è uno snapshot gestito dal registro e non segue automaticamente le
modifiche della fonte.

### Ciclo di vita, scadenza e ritardo

Gli stati persistiti sono `open`, `closed` e `cancelled`.

- La creazione imposta `open`.
- `open -> closed` richiede una fonte di chiusura confermata.
- `open -> cancelled` richiede un'azione esplicita dell'operatore.
- `closed -> open` e `cancelled -> open` sono correzioni esplicite e auditabili.
- La riapertura azzera `closedByType` e `closedById`.

L'elenco è esaustivo. Le transizioni dirette `closed -> cancelled`,
`cancelled -> closed` e ogni altra coppia non elencata sono vietate.

`cancelled` indica che l'operatore ha chiuso l'attesa senza un risultato. Il
superamento di `dueAt` non modifica lo stato persistito.

Il ritardo è uno stato derivato. Una attesa è in ritardo soltanto quando
`status = open` e `dueAt < now`. Una attesa senza `dueAt` non è in ritardo.

`dueAt` è un istante UTC in millisecondi Unix. La route host calcola il ritardo
con il proprio `Date.now()` durante la lettura e restituisce il valore derivato.
Il calcolo non scrive il database, non incrementa la versione e non avvia un
job. I client non ricalcolano il valore con un orologio distinto.

### Matching deterministico e fail-closed

Un adattatore di candidato deve fornire `candidateId`, `patientId`,
`servicePrescriptionItemId` e `deletedAt` senza inferenza. Il solo tipo ammesso
nel v0 è `observation`.

Il candidato deve essere una osservazione non eliminata, riferire lo stesso
`service_prescription_item` e appartenere allo stesso paziente. Gli allegati
restano esclusi finché non possiedono un collegamento persistente equivalente.
`closedById` conserva esattamente il `candidateId` rivalidato nella transazione
di chiusura.

Il matcher usa due mappe indicizzate per la chiave di provenienza:

1. Scansiona una volta le attese aperte e rileva le chiavi duplicate come
   difesa della funzione pura; l'indice univoco le impedisce nel database.
2. Scansiona una volta i candidati e conta i candidati compatibili per chiave.
3. Propone una chiusura solo con una attesa e un candidato compatibile.
4. Restituisce nessuna proposta per chiavi assenti, duplicate o incoerenti.

Il matcher non usa similarità testuale, intervalli temporali o fallback a
un'altra attesa. Un collegamento esplicito non valido non apre un fallback.

La complessità del matching è `O(expectations + candidates)`. La memoria è
`O(expectations + candidates)`. L'esito non dipende dall'ordine degli input.

La proposta non modifica lo stato. La chiusura richiede un'azione autenticata
dell'operatore. Il server rivalida collegamento, stato del candidato, unicità e
versione nella transazione.

Il soft-delete dell'osservazione non riapre automaticamente l'attesa. La UI
segnala che l'evidenza di chiusura non è disponibile. Una riapertura resta una
mutazione esplicita e versionata. La rimozione fisica isolata di un candidato
resta vietata nel v0; la purge paziente elimina prima le attese.

### Transazioni e concorrenza

La richiesta host che apre un item può richiedere anche l'attesa. Il client
fornisce l'eventuale `description` già cifrata. SQLite crea entrambi i record
nella stessa transazione oppure non crea nessun record.

La creazione rivalida nella stessa transazione che
`expectation.patientId = service_prescription_items.patientId`. La regola vale
sia per una fonte preesistente sia per la creazione atomica di item e attesa.

Gli aggiornamenti di `category` e `serviceName` non mutano il registro. Un
operatore può modificare `kind` o `description` con una mutazione distinta e la
versione attesa dell'attesa.

Una guardia SQLite impedisce la cancellazione di un item finché esiste l'attesa
collegata. Impedisce anche la cancellazione quando una osservazione riferisce
l'item. La regola vale per la cancellazione diretta, per il client paired e per
la cancellazione del contenitore prescrittivo. Le route restituiscono
`409 SOURCE_IN_USE` senza eliminazioni parziali.

Una seconda guardia SQLite impedisce di modificare
`observations.servicePrescriptionItemId` quando l'osservazione è usata come
`closedById` da una attesa chiusa. L'operatore deve prima riaprire o eliminare
l'attesa con la sua versione attesa. Il soft-delete dell'osservazione resta
ammesso e conserva il collegamento storico.

Per eliminare la fonte, l'operatore deve prima eliminare l'attesa con la sua
versione attesa. Deve inoltre scollegare in modo esplicito ogni osservazione con
il contratto versionato della stessa osservazione. La purge paziente è l'unica
eccezione: elimina tutti i record nell'ordine canonico e nella stessa
transazione amministrata.

Ogni update, transizione o delete diretto dell'attesa richiede la versione
attesa. Una scrittura con confronto valido incrementa la versione di uno.

Una versione non corrente produce `409 VERSION_CONFLICT` sulla route web host
locale. La risposta contiene solo riferimenti tecnici, versione corrente e
codice errore PHI-safe. Il contratto `/api/v1` non cambia.

### Audit PHI-safe

Il catalogo `audit.v1` aggiunge `subjectType = expectation` e questi eventi:
`expectation.created`, `expectation.updated`, `expectation.closed`,
`expectation.cancelled`, `expectation.reopened` ed `expectation.deleted`.

L'audit può contenere tipo evento, esito, riferimento interno, superficie,
versione, stato precedente, causa tecnica e nomi dei campi modificati. Non può contenere
`description`, testo clinico, ciphertext, identificativi esterni o contenuto
del risultato.

### Backup, restore e cancellazione paziente

- I nuovi backup usano `version = 2`. Includono la collezione `expectations`, i conteggi e il checksum corrispondente.
- Il preflight valida un artifact v1 con manifest, collezioni, conteggi, payload e checksum originali. Solo dopo la validazione lo converte nel modello interno con `expectations = []`.
- Il preflight segnala che un restore v1 replace-all elimina le attese presenti nel database. Il restore richiede una conferma esplicita dopo la segnalazione.
- Il preflight v2 richiede l'insieme esatto delle collezioni v2. Un lettore v1 rifiuta la versione 2 invece di ignorare il registro.
- Il restore resta replace-all, non esegue un merge su un database popolato e conserva il ciphertext senza modificarlo.
- Il restore rifiuta riferimenti mancanti, fonti associate a un altro paziente, duplicati di provenienza o chiusura e combinazioni non valide tra stato e candidato. Una osservazione tombstonata può restare il candidato di una attesa chiusa.
- Alla creazione, `ambulatoryId` deve riferire l'ambulatorio corrente del
  paziente. Il campo è uno snapshot storico, non una foreign key. Move,
  unassign e cancellazione dell'ambulatorio non lo riscrivono. Il preflight
  conserva il valore anche quando l'ambulatorio non esiste più. Le viste
  operative usano la membership corrente del paziente e nascondono un paziente
  non assegnato.
- Il soft-delete del paziente conserva le attese e le esclude dalle viste
  operative.
- Il restore del paziente rende nuovamente visibili le attese conservate.
- `PATIENT_CHILD_TABLES` elimina prima `expectations`, poi `observations` e infine `servicePrescriptionItems`. La guardia anti-drift di ADR 0066 deve rilevare ogni omissione o inversione.
- La purge amministrata registra solo conteggi PHI-safe. Non modifica né elimina
  file di backup già esportati.

### Migrazione

Il runtime non applica i file SQL numerati. `applySchemaGuards()` è il
meccanismo autorevole: deve creare la tabella, l'indice univoco di provenienza e
l'indice univoco parziale della chiusura in modo idempotente.

Un eventuale file SQL sotto `drizzle/` è soltanto un artefatto storico. Deve
usare il primo numero libero dopo il rebase, almeno `0024`, ma non sostituisce
la guardia runtime. L'implementazione deve verificare la serializzazione delle
schema guard rispetto ad ADR 0080 prima di modificare il bootstrap.

## Conseguenze

Il registro aggiunge una fonte operativa verificabile senza sostituire la
proiezione esistente. Concorrenza, backup e cancellazione paziente entrano nel
contratto iniziale.

Il matching intenzionalmente non associa fonti prive di collegamento. Questo
limite riduce i falsi positivi e può lasciare più lavoro manuale.

## Fuori scope

- reminder, notifiche e job automatici;
- inferenza, matching o priorità tramite AI;
- chiusura automatica o silenziosa;
- parity paired e accesso da client paired;
- creazione, lettura o mutazione del registro tramite paired o `/api/v1`;
  le write paired esistenti sulla fonte restano ammesse, ma la cancellazione di
  una fonte protetta fallisce con `409 SOURCE_IN_USE`;
- sync, replica e write offline;
- matching per similarità testuale o finestra temporale;
- scadenze inventate dal runtime.

## First Thin Slice

1. Aggiungere schema, migrazione e guardia runtime con fixture sintetiche.
2. Aggiungere apertura host atomica, mutazioni web con version guard e guardia
   SQLite contro la cancellazione di una fonte protetta.
3. Aggiungere matcher puro, controesempi e conferma esplicita della chiusura.
4. Integrare audit, backup v2, restore, soft-delete e purge del paziente.
5. Aggiungere una vista host essenziale, distinta dalla proiezione ADR 0079.

## Regole di arresto

Fermare la promozione se una slice:

- chiude una attesa senza conferma dell'operatore;
- associa un candidato senza provenienza univoca;
- apre una attesa da una fonte con categoria nulla, non ammessa o appartenente a un altro paziente;
- consente a due attese chiuse di usare la stessa osservazione;
- persiste testo clinico in chiaro o lo inserisce nell'audit;
- copia `serviceName` cifrato dentro `description` o aggiorna `description` senza ciphertext fornita dal client;
- elimina una fonte mentre esiste l'attesa o una osservazione collegata;
- permette alla cancellazione del contenitore o alla route paired di aggirare la guardia della fonte;
- modifica il collegamento prescrittivo di una osservazione usata per chiudere una attesa senza prima riaprire o eliminare l'attesa;
- estende `/api/v1`, paired o sync senza una decisione separata;
- usa un numero di migrazione occupato dopo il rebase;
- modifica backup senza test v1/v2, checksum e roundtrip replace-all;
- ripristina un backup v1 sopra attese esistenti senza segnalazione e conferma esplicita dell'operatore;
- affida la tabella a un artefatto SQL senza creare tabella e due indici nella guardia runtime idempotente;
- omette `expectations` dalla lista canonica e dalla guardia della purge.
