# ADR 0087: registro delle proposte diagnostiche documentali

Date: 2026-07-25
Status: Accepted

Issue: WUL-361

Related: [ADR 0015](./0015-audit-taxonomy-minimum-catalog.md),
[ADR 0065](./0065-intended-purpose-and-claims-guard.md),
[ADR 0066](./0066-patient-soft-delete-lifecycle.md),
[ADR 0080](./0080-serialize-sqlite-schema-guards-at-bootstrap.md),
[ADR 0084](./0084-document-diagnoses-review-only.md) e
[ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md).

---

## Stato attuale

La foundation persistente è consegnata. La tabella
`document_diagnosis_proposals` esiste nello schema Drizzle, nella migrazione
`0024` e nel bootstrap idempotente del database.

Il backup e il restore includono la raccolta
`documentDiagnosisProposals`. La purge amministrata del paziente include la
tabella come figlia. I test coprono il round-trip del backup, la compatibilità
del backup legacy e il cascade del paziente.

Non esiste un writer applicativo per il registro. Non esistono route dedicate,
UI, transizioni di stato o applicazione in `patients.diagnoses`.

ADR 0084 resta prevalente: le diagnosi estratte dai documenti sono
review-only. Questa foundation non modifica tale confine.

## Problema

Una proposta diagnostica documentale richiede una sede persistente distinta
dalle diagnosi cliniche. La sede deve poter seguire backup, restore e purge
senza trasformare una proposta in un dato clinico applicato.

Senza questa separazione, un record tecnico può sembrare una diagnosi
confermata oppure suggerire un flusso di scrittura non consegnato.

## Contesto e precedenze

- ADR 0084 vieta l'aggiornamento automatico di `patients.diagnoses` dalla
  sintesi documentale.
- ADR 0086 separa proposta, chiarimento, anteprima, autorizzazione e scrittura
  applicativa auditata.
- ADR 0066 richiede che le tabelle figlie del paziente seguano il cascade
  amministrato.
- ADR 0080 richiede l'allineamento tra schema, migrazione e bootstrap.

In caso di conflitto, ADR 0084 prevale sul comportamento clinico.

## Opzioni

1. Conservare le proposte solo in `documentInsights`.
2. Conservare una foundation locale separata dalle diagnosi cliniche.
3. Aggiornare `patients.diagnoses` in base alla confidenza.

## Trade-off

- L'opzione 1 non offre una raccolta persistente dedicata.
- L'opzione 2 aggiunge una tabella, ma mantiene separati proposta e diagnosi.
- L'opzione 3 viola il confine review-only di ADR 0084.

## Decisione

Accettiamo l'opzione 2 limitatamente alla foundation persistente già presente.

Il registro locale `document_diagnosis_proposals` resta distinto da
`patients.diagnoses`. Il suo inserimento nel database non costituisce una
decisione clinica né autorizza una scrittura clinica.

### Contratto persistente consegnato

La tabella contiene i seguenti campi:

| Gruppo | Campi presenti |
| --- | --- |
| Identità | `id`, `patientId`, `sourceDocumentKey`, `candidateKey` |
| Riferimenti | `attachmentId`, `documentInsightId` |
| Proposta | `payload`, `status`, `confidence` |
| Decisione registrabile | `decidedAt`, `decisionActorType`, `decisionActorRef`, `decisionPayload` |
| Concorrenza e date | `version`, `createdAt`, `updatedAt` |

`patientId`, `sourceDocumentKey`, `candidateKey`, `payload` e `confidence`
sono obbligatori nello schema. La tabella ha un riferimento a `patients.id`.

Un indice unico protegge la terna
`patientId + sourceDocumentKey + candidateKey`. Gli indici aggiuntivi coprono
`patientId` e `patientId + status`.

Lo schema non impone un vocabolario di `status`, una macchina a stati, la
derivazione delle chiavi o il formato di `payload` e `decisionPayload`. I campi
di decisione non dimostrano un'azione di decisione consegnata.

### Integrazione con i dati locali

La raccolta entra nel backup locale e nel restore. Un artifact legacy senza
`documentDiagnosisProposals` viene normalizzato con una raccolta vuota.

La raccolta è inclusa nel clear e nell'insert del restore. È inclusa anche nel
cascade di purge del paziente. Queste integrazioni conservano e rimuovono righe
del registro; non eseguono review o applicazione clinica.

### Limite operativo

La foundation non contiene un writer applicativo. Il tree corrente non espone
una route, una UI o una transizione per creare, rivedere, accettare, rifiutare
o sostituire proposte.

Il tree corrente non applica una proposta a `patients.diagnoses`. Non esiste
auto-apply, neppure quando `confidence` contiene un valore alto.

## Workflow futuro

Un packet runtime separato deve definire e verificare il workflow prima di
usare il registro applicativamente. Il packet deve rispettare ADR 0084 e non
può dedurre un'autorizzazione dalla confidenza o dai campi già persistiti.

Il packet deve dimostrare, per il suo contratto specifico:

- writer e validazioni;
- stati e transizioni consentite;
- identità e provenienza della fonte;
- protezione dei payload e dei metadati clinici;
- gesto esplicito dell'operatore e anteprima esatta;
- concorrenza, audit e rollback della eventuale scrittura;
- test negativi per assenza di auto-apply e per l'isolamento da route paired.

Finché il packet non esiste, il registro resta una foundation dati. La review
documentale continua a usare il flusso già governato da ADR 0084.

## Conseguenze

- Backup, restore e purge conoscono la tabella del registro.
- La foundation può conservare record separati dalle diagnosi cliniche.
- Nessun comportamento utente aggiuntivo è consegnato.
- La presenza di campi di proposta o decisione non prova review, audit o
  applicazione clinica.

## Non-obiettivi

Questo ADR non:

- aggiunge un writer, una route, una UI o una macchina a stati;
- modifica `documentInsights` o `patients.diagnoses`;
- abilita persistenza automatica, auto-apply o scrittura clinica;
- definisce derivazione delle chiavi, cifratura dei payload o un audit di
  decisione come comportamento runtime;
- abilita Codex Operator o un provider esterno;
- apre egress, sync, paired write o accesso diretto del provider;
- definisce una inbox conversazionale;
- modifica versione, release o dossier del programma 0.8.

## Regole di arresto

Fermare un futuro packet se:

- la confidenza viene trattata come autorizzazione;
- una proposta modifica diagnosi senza gesto esplicito;
- il writer usa il registro senza contratto di stato e validazioni verificati;
- payload o metadati clinici ricevono una protezione non dimostrata;
- backup, restore o purge vengono estesi senza test sintetici;
- una route paired o un provider accede al registro senza nuova decisione;
- una transazione può lasciare diagnosi, stato e audit incoerenti;
- una decisione contrattuale resta aperta.
