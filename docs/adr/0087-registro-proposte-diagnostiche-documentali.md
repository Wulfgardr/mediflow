# ADR 0087: registro delle proposte diagnostiche documentali

Date: 2026-07-25
Status: Proposed

Issue: WUL-361

Related: [ADR 0015](./0015-audit-taxonomy-minimum-catalog.md),
[ADR 0065](./0065-intended-purpose-and-claims-guard.md),
[ADR 0066](./0066-patient-soft-delete-lifecycle.md),
[ADR 0080](./0080-serialize-sqlite-schema-guards-at-bootstrap.md),
[ADR 0084](./0084-document-diagnoses-review-only.md) e
[ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md).

---

## Stato di questo packet

Questo ADR riapre il contratto come proposta, senza dichiarare un runtime
attivo. Non aggiunge schema, migrazione, API, UI o scritture cliniche.
`documentInsights` resta il contenitore operativo delle proposte da rivedere.
ADR 0085 resta riservato a Codex Operator e non cambia.

## Problema

La sintesi documentale può estrarre diagnosi candidate con fonte ed evidenza.
ADR 0084 impone che queste diagnosi restino review-only.

Una futura revisione persistente richiede un oggetto distinto. Deve conservare
la provenienza, evitare duplicati al replay e mantenere la decisione umana.
Deve inoltre separare proposta e applicazione e fallire su ogni ambiguità.

Senza un contratto dedicato, una proiezione documentale può sembrare un record
clinico oppure diventare una scrittura implicita.

## Contesto e precedenze

- ADR 0084 è il confine corrente: la sintesi non aggiorna
  `patients.diagnoses`.
- ADR 0086 separa pipeline, proposta, chiarimento, anteprima, autorizzazione e
  scrittura applicativa auditata.
- SQLite resta autorevole e i campi clinici sensibili restano cifrati lato
  client.
- I test futuri usano solo fixture sintetiche.

In caso di conflitto, ADR 0084 prevale sul comportamento corrente. Questo ADR
non abilita la persistenza finché resta `Proposed`.

## Opzioni

1. Conservare ogni proposta solo dentro `documentInsights`.
2. Definire un registro locale dedicato, distinto dalle diagnosi cliniche.
3. Scrivere direttamente in `patients.diagnoses` quando la confidenza è alta.

## Trade-off

- L'opzione 1 è piccola, ma non conserva una revisione stabile e idempotente.
- L'opzione 2 aggiunge controlli, ma separa evidenza, proposta e dato clinico.
- L'opzione 3 viola il review-only e tratta la confidenza come autorizzazione.

## Decisione proposta

Proponiamo l'opzione 2.

Una futura implementazione può aggiungere un registro locale
`document_diagnosis_proposals`. Il registro non è una diagnosi clinica e non
autorizza una scrittura.

### Contratto minimo del record

| Gruppo | Campi proposti | Regola |
| --- | --- | --- |
| Identità | `id`, `patientId` | Il paziente è obbligatorio e deve essere il target attivo della revisione. |
| Fonte | `sourceDocumentKey`, `attachmentId`, `documentInsightId` | La chiave della fonte è stabile. Gli altri riferimenti sono interni e facoltativi. |
| Candidato | `candidateKey`, `payload` | La chiave è deterministica. Il payload clinico è cifrato lato client. |
| Revisione | `status`, `confidence`, `decisionPayload` | La confidenza ordina la revisione. Non autorizza una decisione. |
| Concorrenza | `version`, `createdAt`, `updatedAt` | Ogni mutazione futura usa confronto di versione. |
| Decisione | `decidedAt`, `actorRef` | I campi sono valorizzati solo da un'azione autenticata e auditata. |

Payload e decisione usano `ENC:<iv_b64>:<cipher_b64>`. Il testo in chiaro contiene
solo identificatori interni, chiavi HMAC, enum, versione e timestamp. Non
contiene descrizione, codice clinico, testo fonte o motivazione libera.

### Identità della fonte

La fonte usa `source_content_sha256`, calcolato sui byte originali del
documento prima di OCR, parsing o normalizzazione.

La stessa sequenza di byte mantiene l'identità anche se cambiano nome file,
MIME, intestazione Data URL, riferimenti interni, risultato OCR o replay.

Se i byte originali non sono disponibili, il sistema non crea una proposta
persistente. Il candidato resta materiale review-only nella proiezione
documentale corrente.

Il digest grezzo non viene usato come chiave interrogabile. Il client deriva
`sourceDocumentKey` con HMAC e una chiave di dominio derivata dalla master key.

### Identità del candidato

`candidateKey` deriva con HMAC da `patientId`, sistema normalizzato e codice
normalizzato.

La derivazione usa una chiave di dominio diversa dalla chiave della fonte.
Il server non riceve la chiave HMAC.

Un codice assente, invalido o ambiguo non produce una proposta persistente.
La stessa regola vale per una confidenza bassa o per un campo clinico bloccato.
L'evidenza resta disponibile per la revisione ordinaria.

### Deduplica e replay

La cardinalità è univoca per
`patientId + sourceDocumentKey + candidateKey`.

Il comportamento futuro deve rispettare queste regole:

- lo stesso candidato dalla stessa fonte aggiorna solo una proposta `pending`;
- due fonti diverse restano due proposte distinte;
- una proposta terminale non torna `pending` durante un replay;
- un replay non crea una diagnosi e non cambia una decisione;
- un conflitto di identità fallisce senza scegliere un target alternativo.

La deduplica riduce duplicati tecnici. Non unisce evidenze cliniche provenienti
da documenti diversi.

### Ciclo di vita

Gli stati proposti sono:

- `pending`: proposta da rivedere;
- `accepted`: proposta confermata e applicata nella stessa transazione futura;
- `rejected`: proposta respinta senza scrittura clinica;
- `superseded`: proposta sostituita con motivo e provenienza tracciati.

`accepted`, `rejected` e `superseded` sono terminali. Nessuna transizione è
automatica.

Questo packet definisce gli stati ma non implementa route o transizioni.

### Creazione futura

La creazione del registro, se autorizzata da un packet successivo, resta sul
web locale dell'host.

- Richiede una sessione web valida.
- Non espone nuove route `/api/v1` o paired.
- Non aggiorna `patients.diagnoses`.
- Rivalida paziente, fonte, codice e stato nella stessa operazione.
- Inserisce o aggiorna soltanto una proposta `pending`.
- Restituisce conflitti tecnici senza testo clinico.

La sintesi documentale resta utilizzabile anche quando il registro non è
disponibile.

### Decisione e applicazione future

Una futura applicazione richiede:

1. sessione valida e attore derivato dal server;
2. paziente e proposta inequivocabili;
3. anteprima esatta della diagnosi proposta;
4. gesto esplicito dell'operatore;
5. versione corrente della proposta e del target;
6. validazione del sistema e del codice;
7. una sola transazione SQLite;
8. un audit PHI-safe nella stessa transazione.

Solo `accepted` può accompagnare una scrittura in `patients.diagnoses`.
L'aggiornamento della diagnosi, lo stato e l'audit riescono insieme oppure
vengono annullati insieme.

`rejected` non scrive diagnosi. Un errore o un conflitto non produce uno stato
terminale e non applica dati parziali.

Il provider AI non decide lo stato e non accede direttamente al database.

### Audit, backup e cancellazione

Una futura implementazione deve:

- aggiungere eventi audit dedicati senza payload clinico o ciphertext;
- includere il registro nel backup e nel relativo preflight;
- includerlo nella cancellazione amministrata del paziente;
- preservarlo durante soft-delete e restore del paziente;
- aggiornare la lista canonica delle tabelle figlie;
- verificare ordine e atomicità della purge.

Questo ADR non modifica oggi audit, backup o cancellazione.

### Migrazione e bootstrap

Questo packet non crea e non riserva una migrazione.

Un futuro packet runtime deve scegliere il primo numero libero sulla propria
base. Deve allineare schema, migrazione e bootstrap idempotente. Deve anche
rispettare la serializzazione definita da ADR 0080.

Non è ammesso usare una migrazione SQL come unica prova del contratto runtime.

## Test richiesti per un futuro runtime

Il packet applicativo deve includere almeno:

- identità stabile sugli stessi byte con metadati diversi;
- identità diversa per byte, paziente, sistema o codice diversi;
- rifiuto quando i byte originali non sono disponibili;
- rifiuto di codice assente, invalido o ambiguo;
- payload e decisione sempre in formato `ENC:`;
- deduplica idempotente della stessa fonte e candidato;
- separazione di fonti diverse;
- impossibilità di riaprire uno stato terminale tramite replay;
- nessuna modifica a `patients.diagnoses` durante la creazione;
- autorizzazione, target e versioni rivalidati nella transazione;
- rollback completo su conflitto o errore audit;
- audit senza testo clinico, codice, ciphertext o digest grezzo;
- backup, restore, soft-delete e purge con fixture sintetiche;
- assenza di route paired o accesso diretto del provider.

I test devono includere falsificatori validi. Un test che verifica solo il caso
felice non dimostra il confine.

## Conseguenze

- La proposta può avere un'identità stabile senza diventare una diagnosi.
- Replay e decisioni umane restano separati.
- Il futuro runtime richiede più componenti e verifiche prima dell'adozione.
- La correlazione delle chiavi HMAC nel database resta un metadato osservabile
  e deve essere limitata al necessario.
- Finché l'ADR è `Proposed`, il comportamento operativo non cambia.

## Non-obiettivi

Questo ADR non:

- modifica `documentInsights` o `patients.diagnoses`;
- implementa schema, migrazione, API, UI o runtime;
- abilita persistenza automatica ad alta confidenza;
- abilita Codex Operator o un provider esterno;
- apre egress, sync, paired write o accesso diretto al database;
- definisce una inbox conversazionale;
- autorizza diagnosi, prescrizioni o identità paziente automatiche;
- modifica versione, release o dossier del programma 0.8.

## First Thin Slice

1. Registrare questo contratto con stato `Proposed`.
2. Aggiornare solo gli indici documentali canonici.
3. Richiedere una decisione separata prima di schema o migrazione.
4. Aprire packet runtime piccoli solo dopo l'accettazione del contratto.

## Regole di arresto

Fermare una futura implementazione se:

- la confidenza viene trattata come autorizzazione;
- una proposta modifica diagnosi senza gesto esplicito;
- la fonte usa OCR, nome file o metadati al posto dei byte originali;
- una chiave o un payload clinico viene persistito in chiaro;
- un replay riapre o riscrive una decisione terminale;
- una route paired o un provider accede al registro senza nuova decisione;
- una transazione può lasciare diagnosi, stato e audit incoerenti;
- il numero di migrazione è occupato sulla base del packet;
- backup, restore o purge ignorano il nuovo record;
- una decisione contrattuale resta aperta.
