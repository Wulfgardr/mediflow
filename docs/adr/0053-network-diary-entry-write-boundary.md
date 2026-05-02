# ADR 0053: write paired per diario clinico versionato

Status: Accepted

## Contesto

ADR 0052 ha aperto il primo write paired limitato al profilo paziente. Il
workstream paired resta piu ampio: include anche diario, terapie, controlli,
osservazioni e cataloghi. Il diario clinico e il prossimo modulo naturale, ma
prima di pubblicarlo sul data plane paired serve una semantica di concorrenza
esplicita: la tabella `entries` non aveva ancora una `version` row-level.

## Opzioni

1. Pubblicare solo create remoto del diario.
   - Pro: diff piccolo.
   - Contro: non permette update sicuri e non soddisfa il requisito `409`.

2. Pubblicare read/create/update/soft-delete del diario con `entries.version`.
   - Pro: contratto paired realmente operabile, con conflict `409` e audit.
   - Contro: introduce una piccola migrazione DB e un incremento OpenAPI.

3. Aspettare una soluzione completa di sync/offline.
   - Pro: modello finale piu uniforme.
   - Contro: blocca il thin slice e mescola sync con il boundary write.

## Decisione

Adottiamo l'opzione 2.

La slice espone:

- `GET /api/v1/network/patients/{id}/entries`
- `POST /api/v1/network/patients/{id}/entries`
- `GET /api/v1/network/patients/{id}/entries/{entryId}`
- `PUT /api/v1/network/patients/{id}/entries/{entryId}`
- capability `network.replica.readonly-clinical-diary`
- capability `network.replica.write-clinical-diary`
- `entries.version` obbligatoria per update e conflitto `409 VERSION_CONFLICT`
- audit PHI-safe con attore operatore, paired-client flag e scope ambulatoriale

Restano fuori:

- hard delete remoto
- upload/scrittura attachment remoti
- campi AI/document-derived
- offline queue, merge automatico e sync record-level
- terapie, checkup, osservazioni e cataloghi

## First Thin Slice

1. Aggiungere `entries.version` con default `1` e fallback runtime.
2. Pubblicare helper read/write network scoped su ambulatorio effettivo.
3. Aggiornare OpenAPI a `1.8.0` e capability discovery.
4. Aggiungere smoke `test:network:home-base-diary-write`.
5. Tenere il workstream aperto per le prossime risorse cliniche.

## Riferimenti

- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0052](./0052-network-patient-profile-write-boundary.md)
- [OpenAPI v1](../openapi/mediflow-v1.yaml)
