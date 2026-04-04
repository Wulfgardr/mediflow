<!-- Codex: created 2026-04-04 -->
# ADR 0038: boundary auth del primo data plane read-only `network`

Date: 2026-04-04  
Status: Proposed

## Problema

Con [ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md),
[ADR 0035](./0035-network-replica-thin-slice-snapshot-mirror.md) e
[ADR 0036](./0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md)
abbiamo chiarito che:

- `local-only` resta il default
- il pairing del device non equivale al login operatore
- la first thin slice `network` deve restare prudente e read-only

Manca pero il boundary concreto per `WUL-150`: come si passa da un bootstrap
PHI-safe a un vero accesso remoto `read-only` ai pazienti senza allargare il
`local-api-token` o confondere trust del device e identita clinica.

## Contesto

- Le route `/api/v1/patients*` esistenti usano il `local-api-token` e valgono
  come superficie locale/admin, non come credenziale remota di pairing.
- `ADR 0036` dichiara esplicitamente che pairing device e login operatore sono
  due piani distinti.
- `SECURITY.md` e `AGENTS.md` escludono scorciatoie che promuovano un token
  tecnico locale a credenziale clinica remota generale.
- La first thin slice deve restare:
  - reviewable
  - PHI-safe nel bootstrap
  - limitata a lista/dettaglio pazienti read-only

## Opzioni

1. Riutilizzare il `local-api-token` anche per i client paired.
2. Considerare il pairing del device sufficiente per leggere i dati clinici.
3. Separare tre boundary:
   - bootstrap pairing PHI-safe
   - credenziale dedicata del device paired
   - sessione operatore del nodo per accesso clinico effettivo

## Trade-off

- Opzione 1:
  - Pro: implementazione minima.
  - Contro: allarga un token tecnico locale oltre il suo perimetro, rende piu
    debole la revoca per-device e confonde bootstrap/admin con accesso remoto.
- Opzione 2:
  - Pro: UX apparentemente piu fluida.
  - Contro: viola il boundary fissato da ADR 0036, indebolisce audit e scope.
- Opzione 3:
  - Pro: mantiene separati trasporto trusted, trust del device e identita
    clinica; abilita revoca per-device; resta coerente con local-first.
  - Contro: richiede un piccolo protocollo in piu e una conferma esplicita lato
    nodo.

## Decisione

Adottiamo l'opzione 3.

Decisioni operative:

- `POST /api/v1/network/pairing-intents` diventa un bootstrap PHI-safe senza
  `local-api-token`, ammesso solo se il nodo e in `network-home-base`.
- Il pairing reale resta **esplicito e locale**:
  - il nodo elenca gli intent pending
  - il nodo conferma un intent specifico
  - la conferma genera una credenziale dedicata del device paired
- La credenziale del device paired e distinta dal `local-api-token` e viene
  usata solo sulla superficie `network` dedicata.
- Il primo data plane read-only (`/api/v1/network/patients*`) richiede sempre:
  - credenziale valida del device paired
  - sessione operatore valida (`mediflow_session`)
- Lo scope clinico resta risolto dal nodo con la policy gia fissata in
  `ADR 0036` (`session-context-else-node-default`).
- Se manca una sessione operatore o uno scope effettivo, il data plane non
  risponde con dati clinici.

## Conseguenze

- Il `local-api-token` non diventa un token remoto general purpose.
- Il nodo puo revocare o ruotare il trust per singolo device paired.
- Pairing e login operatore restano separati anche quando il data plane diventa
  reale.
- La thin slice resta limitata a `read-only patients`, senza introdurre ancora:
  - write remote
  - sync record-level
  - cache offline
  - RBAC avanzato

## First Thin Slice

1. Persistire intent pending e paired clients in `settings` JSON.
2. Esporre:
   - `GET /api/v1/network/pairing-intents`
   - `POST /api/v1/network/pairing-intents/{intentId}/confirm`
3. Introdurre nuove route read-only:
   - `GET /api/v1/network/patients`
   - `GET /api/v1/network/patients/{id}`
4. Dichiarare in OpenAPI il nuovo boundary auth:
   - header `paired client`
   - cookie sessione operatore
5. Lasciare fuori scope UI di review, revoca device e snapshot/cache.

## Fuori Scope

- write operations remote
- sync o replica record-level
- trust automatico senza review locale
- login federato o multi-tenant
- revoca/rotation UX completa dei paired client
