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
