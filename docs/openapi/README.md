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

Un client deve sapere su quali comportamenti possa fare affidamento anche
mentre il backend evolve. Questa guida spiega quindi come mantenere allineata
la documentazione OpenAPI al **contratto esposto stabilmente ai client** sotto
`/api/v1/*`. La specifica descrive solo quel perimetro, non tutto il backend
MediFlow.

## Cosa entra nella spec

Inserisci nella specifica ciò che il client deve poter conoscere:

- endpoint esposti sotto `/api/v1/*`
- parametri query/path
- payload request/response
- auth richiesta
- errori osservabili dai client

Restano invece fuori dalla specifica:

- endpoint interni `app/api/*` usati solo dal web
- proxy locali tecnici (es. ICD, Ollama) se non fanno parte del contratto `/api/v1`
- dettagli implementativi del DB o della logica interna

Il criterio è la stabilità del rapporto con il client: se un client
macOS/iOS/iPadOS deve potersi affidare a un endpoint, quell'endpoint deve essere
nella specifica.

## Regola ricorsiva

Perché il contratto non si allontani dal comportamento reale, ogni PR che
tocca le aree indicate sotto deve compiere una delle due azioni:

- aggiornare [docs/openapi/mediflow-v1.yaml](./mediflow-v1.yaml)
- dichiarare esplicitamente `no contract impact`

File/aree da considerare sensibili:

- `app/api/v1/*`
- `lib/api/v1/types.ts`
- client/model consumer native collegati a `/api/v1`
- `docs/openapi/contract-policy.json` per eccezioni di coverage e override breaking

La revisione deve distinguere una modifica interna da una modifica visibile
all'esterno. La domanda è quindi:

> Il cambiamento modifica un comportamento che il client può osservare nel
> contratto OpenAPI?

Se la risposta è `si`, la specifica va aggiornata.

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
6. Esegui `npm run check:openapi:drift` per verificare coverage, drift e breaking.

<a id="rehearsal-di-compatibilita"></a>

## Prova di compatibilità

Una migrazione o un rilascio possono richiedere una prova di compatibilità
anche quando il contratto non cambia. In quel caso usa:

```bash
npm run rehearse:api-v1-compatibility
```

Il comando esegue lo stesso controllo contro le divergenze e raccoglie il
risultato nel registro Markdown temporaneo
`tmp-api-v1-compatibility-rehearsal.md` (private). Il registro riporta base/head,
esito, conteggio delle operazioni documentate, operazioni implementate ma
coperte solo dalla policy e file sensibili modificati rispetto alla base.

## Registro eccezioni e override

- `docs/openapi/contract-policy.json` elenca gli endpoint implementati che non
  appartengono ancora al perimetro OpenAPI pubblicato. Una nuova operazione
  `/api/v1` deve comparire nella specifica oppure in questo registro.
- `breakingOverrides`, nello stesso file, è l'unico punto previsto per le
  deroghe intenzionali. Questa guida non specifica il formato della relativa
  giustificazione.

<a id="versioning-semplice"></a>

## Versionamento

- `info.version`:
  - `patch` per chiarimenti, esempi, correzioni senza cambio di shape
  - `minor` per aggiunte non-breaking
- `/api/v1` resta invariato finché il contratto rimane retrocompatibile
- breaking change: nuova major (`/api/v2`) o finestra di compatibilità esplicita

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

La baseline descritta è la versione `1.24.0` del contratto.

Per evitare che il controllo della dimensione si traduca in un troncamento
silenzioso dei campi, [ADR 0124](../adr/0124-bounded-native-network-json.md)
introduce limiti in byte UTF-8 per 26 operazioni JSON network e la risposta
413 `JSON_BODY_TOO_LARGE`. Le estensioni `x-mediflow-json-max-bytes` ne indicano
i massimi; per gli allegati, il budget deriva dal limite configurato sul
trasporto. Queste nuove restrizioni dimensionali non troncano i campi. Il login
nativo, esterno al perimetro `/api/v1`, applica lo stesso contratto con un limite
di 64 KiB, come documentato nell’ADR.

Questa baseline pubblicata copre:

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
- `DELETE /api/v1/network/pairing-clients/{clientId}`
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

L'estensione agli altri endpoint `v1` va condotta per moduli stabili: il
contratto deve crescere insieme ai comportamenti su cui il client può fare
affidamento, non includere tutto il backend in un unico passaggio.

La nota operativa `WUL-308` riguarda le sotto-risorse cliniche locali. Si tratta
di comportamenti implementati, coperti da `contract-policy.json` ma non ancora
inclusi nella specifica pubblicata:

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

La nota operativa `WUL-150` distingue la scoperta di un nodo dall'autorizzazione
ad accedere ai suoi dati e a eseguire operazioni:

- il perimetro `network` non comprende più soltanto risposte di predisposizione
  prive di dati identificativi, o stub PHI-safe, ma resta delimitato
- distingue `node summary`, `session gate`, `capability discovery`, `pairing intent`, `pairing confirmation` e primo `read-only data plane`
- sul lato Apple-native, la discovery LAN può pubblicizzare lo stesso nodo via
  Bonjour `_mediflow-homebase._tcp`, mantenendo fuori dal TXT record qualunque
  dato PHI e riusando `/api/v1/network/node` come summary PHI-safe reviewable
- la `session summary` può includere metadata PHI-safe sul piano replica
  (`snapshot mirror`, `deferred`, `manual review`) senza implicare che esista
  già un motore sync operativo
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
- `network/ai-runtime` mantiene separati `AI plane` e `data plane`: mostra lo
  stato Fabric PHI-safe con accesso `status_only`, esecuzione paired
  `not_authorized`, uscita dati chiusa e ripiego automatico negato. La
  disponibilità centrale descrive solo la configurazione dell'host; non
  autorizza il client associato a usare l'AI
- non introduce ancora catalog write remoto, sync record-level,
  cache offline, identity model completo o routing remoto operativo del runtime
  AI centralizzato
- può ancora esporre stati `disabled` o `planned` per capability che restano follow-up
