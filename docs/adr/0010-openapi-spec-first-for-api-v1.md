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


## Fase di compatibilità prescrizioni C05 — WUL-720 (2026-10-09)

La revisione `1.32.0` resta nella superficie `v1` con una fase di compatibilità
esplicita, approvata dall'owner delegato nella consegna WUL-720. Non aggiunge
route, capability o autorità di scrittura. Il perimetro è limitato agli ID dei
create di prescrizioni protesiche, prestazioni e item, e a `ordinal` degli item.

- Un ID omesso continua a essere generato dall'host. Gli ID opachi non vuoti
  restano validi e sono normalizzati con trim; ID forniti vuoti o composti solo
  da whitespace ora ricevono `400`, anziché generare una nuova identità.
- Un ID già presente nella relativa tabella riceve `409` generico, senza dati
  del record esistente né modifiche cliniche o audit. Il controllo avviene nella
  transazione IMMEDIATE dopo la verifica di parent e scope e prima di INSERT.
- `ordinal` accetta interi safe di JavaScript, compresi zero e negativi, oppure
  stringhe decimali complete con segno facoltativo e whitespace esterno. La
  conversione deve produrre un intero safe. Frazioni, stringhe parziali,
  notazione esponenziale/hex testuale e overflow ora ricevono `400`, senza
  troncamento tramite `parseInt` o `Math.trunc`. `null` resta non ammesso.
  L'omissione resta `0` nel create e conserva il valore corrente nell'update.

I caller correnti sono compatibili: il manager Web invia `ordinal: index`
(zero-based), mentre il workspace Swift invia `index + 1`. I payload Swift
usano `Int?` ed omettono il campo quando assente. Le stringhe decimali valide
sono mantenute come compatibilità API anche se questi caller non le emettono.
Il Web genera UUID espliciti; Swift può omettere l'ID per protesica e item.
Riferimenti: [manager Web](../../components/service-prescription-manager.tsx),
[workspace Swift](../../native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift)
e [payload Swift](../../native/MediFlowMac/Sources/MediFlowCore/HomeBaseModels.swift).

Questa decisione restringe intenzionalmente input prima accettati e non
rivendica retrocompatibilità universale. `contract-policy.json` registra
soltanto i due cambi `request.ordinal` di POST collection e PUT item segnalati
dal guard. Il guard resta attivo per tutti gli altri cambi; gli override non
si estendono ad altri campi, domini o futuri comportamenti. La revisione
indipendente deve verificare schema, normalizzazione, risposta duplicato e
prove SQLite senza effetti prima del merge.


## WUL-720 — Confine numerico delle versioni C05 (spec 1.35.0)

L'owner autorizza la restrizione agli interi positivi rappresentabili senza
perdita in JavaScript (`Number.isSafeInteger`, massimo 9007199254740991).
Gli input superiori, prima accettati dal parser comune, ora ricevono `400`.
Non è una promessa di compatibilità universale: i caller che inviano versioni
safe osservate restano compatibili, quelli che inviano numeri unsafe no.

| Percorso | Effetto di questa coorte |
| --- | --- |
| Patient profile PUT e checkup UPDATE, Web/local v1/paired | Parser unsafe `400`; dopo lookup, scope e stale, una versione corrente a MAX restituisce `409 VERSION_CONFLICT` prima di DML, membership o audit. MAX−1 → MAX resta permesso; il replay della vecchia versione resta `409`. |
| Patient lifecycle DELETE/restore e ambulatory PUT/DELETE/clear | Il parser comune rifiuta unsafe `400`; questa coorte non aggiunge guard sull'incremento a MAX a questi writer. |
| Entry, therapy, observation mutation | I parser locali già rifiutano unsafe e MAX; il limite esclusivo preesistente non cambia. |
| PR/SP UPDATE | Lo schema Zod `.int()` già rifiuta unsafe: nessun nuovo restringimento del relativo request pubblico. I DELETE Web tramite parser comune diventano safe; nessun endpoint paired DELETE è introdotto. |
| Create, bulk move/assign, restore archivio | Fuori dal guard di esaurimento dei due core; nessuna qualifica aggiuntiva. |

Lo spec aggiorna `maximum` soltanto nei request pubblici interessati dal
cambiamento runtime. `AmbulatoryUpdateRequest` conserva i campi del precedente
schema condiviso e aggiunge il limite solo al PUT: il create non viene
ristretto attraverso un riferimento condiviso. I payload di conflitto
esistenti sono mantenuti anche per esaurimento (expected e current possono
coincidere); nessun nuovo codice o capacità è introdotto.

Il guard OpenAPI resta invariato: la sua normalizzazione attuale non confronta
`minimum`/`maximum`, dunque non produce override puntuali per questo delta e
`contract-policy.json` non viene ampliato. La restrizione viene dichiarata qui
ed è verificata da parser e SQLite reale, oltre alla review indipendente.
Questo limite del guard non dimostra retrocompatibilità. C05 complessivo e i
residui lifecycle/move/restore restano aperti.
