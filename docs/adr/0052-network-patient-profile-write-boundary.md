# ADR 0052: primo write paired per profilo paziente

Status: Accepted

## Contesto

ADR 0034, ADR 0036, ADR 0038 e ADR 0048 fissano il modello `home-base`:
il Mac resta nodo autorevole, i client Apple usano `/api/v1/network/*`, il
pairing device non riusa il `local-api-token` e lo scope clinico viene risolto
dal nodo tramite sessione operatore e ambulatorio effettivo.

Il nuovo workstream di write paired estende quel boundary oltre il read-only. L'intero perimetro include
pazienti, diario, terapie, checkup, osservazioni e cataloghi, ma atterrarlo in
un solo diff allargherebbe troppo rischio, contratti e test.

## Opzioni

1. Aprire subito tutti i write path `network`.
   - Pro: copre l'intera issue in un passaggio.
   - Contro: mescola risorse con contratti diversi, include moduli senza
     versioning row-level e rende debole la review di sicurezza.

2. Pubblicare solo `PUT /api/v1/network/patients/{id}`.
   - Pro: riusa il contratto paziente gia stabile, `version`, conflict `409`,
     normalizer e audit; dimostra il boundary paired senza delete remoto.
   - Contro: non chiude tutto il CRUD clinico non-AI del workstream.

3. Restare read-only e documentare solo la direzione.
   - Pro: rischio tecnico minimo.
   - Contro: non avanza il boundary operativo richiesto dai client paired.

## Decisione

Adottiamo l'opzione 2.

La prima slice write paired espone solo:

- `PUT /api/v1/network/patients/{id}`
- capability dedicata `network.replica.write-patient-profile`
- credenziale paired client + sessione operatore `mediflow_session`
- scope ambulatoriale risolto dal nodo `home-base`
- `version` obbligatoria e conflitto `409 VERSION_CONFLICT`
- audit PHI-safe con attore operatore e flag di paired client

Restano esplicitamente fuori:

- remote delete
- create paziente remoto
- diary/therapies/checkups/observations/catalog writes
- campi AI/document-derived (`aiSummary`, `documentInsights`)
- coda offline, sync record-level e merge automatico

## First Thin Slice

1. Aggiungere helper server-side per update paziente scoped su ambulatorio.
2. Estendere `/api/v1/network/patients/{id}` con `PUT`.
3. Pubblicare capability e OpenAPI `1.7.0`.
4. Aggiungere smoke `test:network:home-base-write` con pairing, sessione,
   capability, update positivo, `409` e blocco campi AI.
5. Lasciare il workstream aperto finche i child-resource write non vengono
   implementati e verificati in slice dedicate.

## Riferimenti

- [ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md)
- [ADR 0036](./0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md)
- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [OpenAPI v1](../openapi/mediflow-v1.yaml)
