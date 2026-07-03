---
summary: "Maintenance runbook for the stable MediFlow OpenAPI /api/v1 contract, drift checks, versioning, and documentation workflow."
read_when:
  - "Changing or reviewing /api/v1 client-facing API contracts."
  - "Running OpenAPI drift checks or deciding whether a route belongs in the stable spec."
---

# OpenAPI `/api/v1`: Runbook di Manutenzione

Stato documento: `SECONDARY`  
Fonte canonica del contratto: [docs/openapi/mediflow-v1.yaml](./mediflow-v1.yaml)  
Decisioni di riferimento: [docs/adr/0010-openapi-spec-first-for-api-v1.md](../adr/0010-openapi-spec-first-for-api-v1.md), [docs/adr/0052-network-patient-profile-write-boundary.md](../adr/0052-network-patient-profile-write-boundary.md), [docs/adr/0053-network-diary-entry-write-boundary.md](../adr/0053-network-diary-entry-write-boundary.md), [docs/adr/0054-network-therapy-write-boundary.md](../adr/0054-network-therapy-write-boundary.md), [docs/adr/0055-network-checkup-write-boundary.md](../adr/0055-network-checkup-write-boundary.md), [docs/adr/0056-network-observation-write-boundary.md](../adr/0056-network-observation-write-boundary.md)

## A cosa serve

Questo file spiega **come mantenere aggiornata** la documentazione OpenAPI mentre
lo sviluppo continua.

La spec OpenAPI non descrive tutto il backend MediFlow. Descrive solo il
**contratto client-facing** esposto in modo stabile sotto `/api/v1/*`.

## Cosa entra nella spec

Metti nella spec:

- endpoint esposti sotto `/api/v1/*`
- parametri query/path
- payload request/response
- auth richiesta
- errori osservabili dai client

Non mettere nella spec:

- endpoint interni `app/api/*` usati solo dal web
- proxy locali tecnici (es. ICD, Ollama) se non fanno parte del contratto `/api/v1`
- dettagli implementativi del DB o della logica interna

Regola pratica:

Se un client macOS/iOS/iPadOS deve potersi affidare stabilmente a quell'endpoint,
allora quell'endpoint deve stare nella spec.

## Regola ricorsiva

Ogni PR che tocca uno di questi punti deve fare una delle due cose:

- aggiornare [docs/openapi/mediflow-v1.yaml](./mediflow-v1.yaml)
- dichiarare esplicitamente `no contract impact`

File/aree da considerare sensibili:

- `app/api/v1/*`
- `lib/api/v1/types.ts`
- client/model consumer native collegati a `/api/v1`
- `docs/openapi/contract-policy.json` per eccezioni di coverage e override breaking

Domanda guida per la review:

> Se genero o leggo oggi il contratto OpenAPI, il comportamento osservabile del
> client cambia?

Se la risposta e `si`, la spec va aggiornata.

## Workflow minimo

1. Classifica il cambiamento:
   - solo implementazione interna
   - cambiamento contrattuale non-breaking
   - cambiamento breaking
2. Se il cambiamento tocca il contratto, aggiorna la spec nello stesso diff.
3. Allinea eventuali consumer (`lib/api/v1/types.ts`, client Swift, docs collegate).
4. Nella PR scrivi cosa e cambiato:
   - spec aggiornata
   - oppure `no contract impact`
5. Se il cambio e breaking o deprecante, aggiorna prima ADR/PLANS/Linear.
6. Esegui `npm run check:openapi:drift` per verificare coverage, drift e breaking.

## Rehearsal di compatibilita

Per una issue di migrazione o rilascio che deve dimostrare la compatibilita
senza cambiare necessariamente il contratto, usa:

```bash
npm run rehearse:api-v1-compatibility
```

Il comando esegue lo stesso guard anti-drift e produce un ledger Markdown
temporaneo in `tmp-api-v1-compatibility-rehearsal.md` con base/head, esito,
conteggio delle operation documentate, operation implementation-only coperte da
policy e file sensibili modificati rispetto alla base. Il file e pensato come
evidenza da allegare a PR/Linear, non come artifact da committare.

## Registro eccezioni e override

- `docs/openapi/contract-policy.json` elenca gli endpoint implementati ma ancora
  fuori dalla slice OpenAPI pubblicata; una nuova operation `/api/v1` deve stare
  o nella spec o in questo registro
- `breakingOverrides` nello stesso file e il punto unico per deroghe intenzionali:
  ogni voce deve citare il change esatto bloccato dal guard e il Linear issue che
  la giustifica

## Versioning semplice

- `info.version`:
  - `patch` per chiarimenti, esempi, correzioni senza cambio di shape
  - `minor` per aggiunte non-breaking
- `/api/v1` resta invariato finche il contratto rimane retrocompatibile
- breaking change: nuova major (`/api/v2`) o finestra di compatibilita esplicita

## Esempi rapidi

Aggiorna la spec:

- aggiungi un nuovo campo opzionale in risposta
- aggiungi un nuovo query parameter opzionale
- aggiungi un nuovo endpoint stabile in `/api/v1`
- cambi il payload di errore osservabile dal client

`no contract impact` plausibile:

- refactor SQL interno senza cambiare response
- miglioramento logging
- riorganizzazione helper privata
- fix interno che non cambia shape, semantica o auth

## Baseline attuale

La baseline pubblicata oggi copre:

- `GET /api/v1/patients`
- `GET /api/v1/patients/{id}`
- `PUT /api/v1/patients/{id}`
- `DELETE /api/v1/patients/{id}`
- `GET /api/v1/network/node`
- `GET /api/v1/network/session`
- `GET /api/v1/network/capabilities`
- `GET /api/v1/network/identity`
- `GET /api/v1/network/ai-runtime`
- `GET /api/v1/network/pairing-intents`
- `POST /api/v1/network/pairing-intents`
- `POST /api/v1/network/pairing-intents/{intentId}/confirm`
- `GET /api/v1/network/ambulatories`
- `GET /api/v1/network/patients`
- `GET /api/v1/network/patients/{id}`
- `PUT /api/v1/network/patients/{id}`
- `GET /api/v1/network/patients/{id}/entries`
- `POST /api/v1/network/patients/{id}/entries`
- `GET /api/v1/network/patients/{id}/entries/{entryId}`
- `PUT /api/v1/network/patients/{id}/entries/{entryId}`
- `GET /api/v1/network/patients/{id}/therapies`
- `POST /api/v1/network/patients/{id}/therapies`
- `GET /api/v1/network/patients/{id}/therapies/{therapyId}`
- `PUT /api/v1/network/patients/{id}/therapies/{therapyId}`
- `GET /api/v1/network/patients/{id}/checkups`
- `POST /api/v1/network/patients/{id}/checkups`
- `GET /api/v1/network/patients/{id}/checkups/{checkupId}`
- `PUT /api/v1/network/patients/{id}/checkups/{checkupId}`
- `GET /api/v1/network/patients/{id}/observations`
- `POST /api/v1/network/patients/{id}/observations`
- `GET /api/v1/network/patients/{id}/observations/{observationId}`
- `PUT /api/v1/network/patients/{id}/observations/{observationId}`

L'estensione agli altri endpoint `v1` va fatta per moduli stabili, senza
gonfiare la spec in un unico passaggio.

Nota operativa per `WUL-308` (sotto-risorse cliniche locali, slice
implementation-only coperta da `contract-policy.json`):

- `/api/v1/patients/{id}/{entries|therapies|checkups|observations}` ora hanno
  lifecycle uniforme tra le quattro sotto-risorse
- `PUT` e `DELETE` sul dettaglio richiedono `version` (`400 Version is required`
  se assente) e rispondono `409` con payload `VERSION_CONFLICT` PHI-safe
  (stessa shape della slice `network`) su versione stantia
- `DELETE` scrive un tombstone soft-delete (`deletedAt`/`deletionReason`,
  default `api-v1-delete`) invece di hard-deletare; il restore passa da `PUT`
  con `deletedAt: null`
- le list `GET` nascondono di default le righe soft-deleted e accettano
  `includeDeleted=true|1` per esporle
- l'audit distingue `*.deleted` da `*.updated` in base alla transizione di
  `deletedAt`
- gli endpoint restano fuori dalla slice OpenAPI pubblicata (tracking `WUL-40`);
  i dettagli sono registrati nelle `reason` di `contract-policy.json`

Nota operativa per `WUL-150`:

- la slice `network` resta prudente, ma non e piu solo stub PHI-safe
- distingue `node summary`, `session gate`, `capability discovery`, `pairing intent`, `pairing confirmation` e primo `read-only data plane`
- sul lato Apple-native, la discovery LAN puo pubblicizzare lo stesso nodo via
  Bonjour `_mediflow-homebase._tcp`, mantenendo fuori dal TXT record qualunque
  dato PHI e riusando `/api/v1/network/node` come summary PHI-safe reviewable
- la `session summary` puo includere metadata PHI-safe sul piano replica
  (`snapshot mirror`, `deferred`, `manual review`) senza implicare che esista
  gia un motore sync operativo
- `network/identity` esplicita che pairing device e login operatore sono due
  piani distinti e dichiara lo scope ambulatoriale effettivo/default risolto dal nodo
- `network/patients*` usa un boundary auth esplicito:
  - paired client id
  - paired client token
  - sessione operatore `mediflow_session`
- `PUT /api/v1/network/patients/{id}` e la prima write slice paired:
  richiede capability `network.replica.write-patient-profile`, `version`,
  sessione operatore e scope ambulatoriale del nodo; blocca campi
  AI/document-derived e non abilita delete remoto, child CRUD, sync o coda offline
- `/api/v1/network/patients/{id}/entries*` pubblica la slice diario paired:
  capability `network.replica.readonly-clinical-diary` /
  `network.replica.write-clinical-diary`, `entries.version`, `409`
  PHI-safe e soft delete via `deletedAt`; hard delete, attachment e campi
  AI/document-derived restano fuori boundary
- `/api/v1/network/patients/{id}/therapies*` pubblica la slice terapie paired:
  capability `network.replica.readonly-therapies` /
  `network.replica.write-therapies`, `therapies.version`, `409` PHI-safe e
  soft delete via `deletedAt`; hard delete remoto e campi AI/document-derived
  restano fuori boundary
- `/api/v1/network/patients/{id}/checkups*` pubblica la slice checkup paired:
  capability `network.replica.readonly-checkups` /
  `network.replica.write-checkups`, `checkups.version`, `409` PHI-safe e
  soft delete via `deletedAt`; hard delete remoto e campi AI/document-derived
  restano fuori boundary
- `/api/v1/network/patients/{id}/observations*` pubblica la slice osservazioni paired:
  capability `network.replica.readonly-observations` /
  `network.replica.write-observations`, `observations.version`, `409` PHI-safe e
  soft delete via `deletedAt`; hard delete remoto e campi AI/document-derived
  restano fuori boundary
- `network/ai-runtime` esplicita che `AI plane` e `data plane` restano separati
  e dichiara solo `AI locale` vs `AI centralizzata disponibile/non disponibile`
  piu fallback e rollout gate, senza introdurre ancora remote execution reale
- non introduce ancora catalog write remoto, sync record-level,
  cache offline, identity model completo o routing remoto operativo del runtime
  AI centralizzato
- puo ancora esporre stati `disabled` o `planned` per capability che restano follow-up
