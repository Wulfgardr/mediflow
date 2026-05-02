# ADR 0056: write paired per osservazioni versionate

Status: Accepted

## Contesto

ADR 0052, ADR 0053, ADR 0054 e ADR 0055 hanno aperto il write paired su
profilo paziente, diario clinico, terapie e checkup. Le osservazioni cliniche
sono il successivo dato operativo utile per i client paired, ma non devono
introdurre ancora sync record-level, merge automatico o provenance documentale
remota. La tabella `observations` non esponeva ancora concorrenza row-level ne
soft delete remoto.

## Opzioni

1. Pubblicare solo read remoto delle osservazioni.
   - Pro: diff piccolo.
   - Contro: non abilita l'uso reale da iPad/iPhone per dati vitali o misure.

2. Pubblicare read/create/update/soft-delete con `observations.version`.
   - Pro: boundary paired utile, `409` PHI-safe, audit esplicito e nessun hard delete remoto.
   - Contro: richiede migrazione DB, OpenAPI `1.11.0` e smoke dedicato.

3. Aspettare sync/offline completo.
   - Pro: modello finale piu uniforme.
   - Contro: blocca il thin slice e mescola write boundary con replica.

## Decisione

Adottiamo l'opzione 2.

La slice espone:

- `GET /api/v1/network/patients/{id}/observations`
- `POST /api/v1/network/patients/{id}/observations`
- `GET /api/v1/network/patients/{id}/observations/{observationId}`
- `PUT /api/v1/network/patients/{id}/observations/{observationId}`
- capability `network.replica.readonly-observations`
- capability `network.replica.write-observations`
- `observations.version` obbligatoria per update paired e conflitto `409 VERSION_CONFLICT`
- soft delete/restore via `deletedAt` e `deletionReason`
- supporto iniziale vincolato a codici LOINC e unita UCUM
- audit PHI-safe con attore operatore, paired-client flag e scope ambulatoriale

Restano fuori:

- hard delete remoto paired
- campi AI/document-derived e provenance documentale
- sync record-level, coda offline e merge automatico
- cataloghi e riconciliazione completa

## First Thin Slice

1. Aggiungere `observations.version`, `updated_at`, `deleted_at` e
   `deletion_reason` con fallback runtime.
2. Pubblicare helper read/write network scoped su ambulatorio effettivo.
3. Aggiornare OpenAPI a `1.11.0` e capability discovery.
4. Aggiungere smoke `test:network:home-base-observation-write`.
5. Tenere il workstream aperto per cataloghi e sync.

## Riferimenti

- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0052](./0052-network-patient-profile-write-boundary.md)
- [ADR 0053](./0053-network-diary-entry-write-boundary.md)
- [ADR 0054](./0054-network-therapy-write-boundary.md)
- [ADR 0055](./0055-network-checkup-write-boundary.md)
- [OpenAPI v1](../openapi/mediflow-v1.yaml)
