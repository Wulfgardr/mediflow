# ADR 0010: Strategia OpenAPI spec-first per /api/v1

Date: 2026-03-10  
Status: Accepted

---

## Problema

`/api/v1` e gia il contratto condiviso tra web e client native (ADR 0005), ma oggi
quel contratto e implicito e duplicato in piu punti:

- route handlers `app/api/v1/*` (route `route.ts`)
- DTO TypeScript in `lib/api/v1/types.ts`
- model/client Swift in `native/MediFlowMac/...`

Non esiste ancora una specifica OpenAPI canonica, quindi il rischio di drift cresce
con ogni nuova capability parity, soprattutto in vista di futuri client iOS/iPadOS.

## Contesto

- `ARCHITECTURE.md` e `SECURITY.md` impongono che `/api/v1/*` resti versionata,
  documentata e retrocompatibile nella stessa major.
  e contract checks.
- Il repository non usa oggi tooling OpenAPI, swagger annotations o generatori.
- Questa decisione governa strategia e manutenzione del contratto, non documenta
  ancora tutta la superficie API e non introduce API management esterno.

## Opzioni

1. `spec-first`: la specifica OpenAPI e la fonte canonica del contratto, il codice
   la implementa.
2. `source annotations`: la specifica e derivata dai route handler annotati.
3. `dual source`: specifica e annotazioni convivono come due fonti equivalenti.

## Trade-off

- Opzione 1:
  - Pro: contratto linguaggio-agnostico, reviewabile in diff, adatto a web/native
    e a futura generazione client.
  - Contro: senza disciplina e check automatici puo diventare stale rispetto al codice.
- Opzione 2:
  - Pro: riduce il rischio di drift tra handler e spec nello stesso linguaggio.
  - Contro: richiede introdurre nuove convenzioni o dependency nel web stack,
    accoppia il contratto a TypeScript/Next.js e non risolve la duplicazione verso Swift.
- Opzione 3:
  - Pro: massima flessibilita locale ai team.
  - Contro: crea ambiguita sulla fonte di verita e rende la review poco affidabile.

## Decisione

Adottare l'opzione 1: **OpenAPI spec-first** come strategia unica per `/api/v1`.

Decisione approvata dal Lead Architect il 2026-03-10.

Regole decisionali:

- La specifica OpenAPI versionata in repository e la fonte canonica del contratto
  `/api/v1` (path, parametri, payload, errori, auth, deprecazioni).
- I route handler in `app/api/v1/*`, i DTO in `lib/api/v1/types.ts` e i client/model
  Swift sono implementazioni derivate e non possono ridefinire il contratto.
- Eventuali annotazioni nel codice possono esistere come supporto locale, ma non sono
  autorevoli e non sostituiscono la spec canonica.

## Regole operative

### Ownership e review

- Owner semantico del contratto: Lead Architect.
- Owner operativo della sincronizzazione: autore della PR che modifica `/api/v1/*`.
- Ogni PR che cambia la superficie `/api/v1/*` deve includere una di queste due cose:
  - aggiornamento della specifica OpenAPI nello stesso diff
  - nota esplicita `no contract impact` con spiegazione breve
- Se il cambio e breaking, deprecante o cambia semantica osservabile da client
  web/native, serve ADR o update ADR prima del merge.
- La review deve verificare sempre:
  - coerenza con ADR 0005 (contratto condiviso web/native)
  - coerenza con auth/errori documentati
  - allineamento di DTO/client consumer nello stesso diff o con follow-up issue esplicita

### Versioning e compatibilita

- La major vive nel path: `/api/v1/*`.
- Le revisioni della specifica all'interno della stessa major usano `info.version`
  per tracciare release `patch/minor` del contratto.
- Restano in `v1` solo cambi **non-breaking**, per esempio:
  - nuovi endpoint opzionali/additivi
  - nuovi query param opzionali
  - nuovi campi opzionali in request/response
  - documentazione piu precisa o nuovi esempi/error payload gia compatibili
- Sono **breaking** e richiedono nuova major (`/api/v2/*`) o fase di compatibilita
  esplicita:
  - rimozione o rename di path/campi
  - cambio tipo o requiredness di un campo
  - cambio semantico di filtri, ordinamenti, status o payload osservabili dai client
  - restringimento input validi, auth piu stretta o risposta diversa su casi gia supportati
  - nuovi valori enumerati in risposta quando i client possono trattarli in modo esaustivo
- Una deprecazione in `v1` deve essere prima marcata nella spec e pianificata in
  compatibilita documentata.

## Conseguenze

- Positivo: il contratto diventa esplicito, reviewabile e indipendente dal linguaggio
  dei consumer.
- Positivo: riduce il rischio di drift tra handler Next.js, DTO TypeScript e client Swift.
- Positivo: prepara il terreno a typed clients e contract checks senza imporli subito.
- Negativo: fino a quando T02-003/T02-006 non saranno completati, il processo resta
  disciplinare e non completamente automatizzato.

## First Thin Slice

1. Pubblicare una baseline OpenAPI per i path `GET /api/v1/patients` e
   `GET /api/v1/patients/{id}`.
2. Richiedere da subito spec diff o nota `no contract impact` per ogni PR che tocca
   `/api/v1/*`.
3. Aggiungere in follow-up contract checks e generazione client solo dopo la baseline.
