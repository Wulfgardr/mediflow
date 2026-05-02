# ADR 0054: write paired per terapie versionate

Status: Accepted

## Contesto

ADR 0052 ha aperto il write paired sul profilo paziente e ADR 0053 ha esteso il
boundary al diario clinico. Le terapie sono il prossimo modulo operativo per i
client paired, ma richiedono concorrenza row-level e una semantica chiara per la
cancellazione: la tabella `therapies` non esponeva ancora `version`,
`updated_at`, `deleted_at` o `deletion_reason`.

## Opzioni

1. Pubblicare solo create remoto delle terapie.
   - Pro: diff piccolo.
   - Contro: non consente aggiornamenti sicuri e lascia scoperto il conflitto.

2. Pubblicare read/create/update/soft-delete con `therapies.version`.
   - Pro: replica paired operabile, `409` PHI-safe, audit e nessun hard delete remoto.
   - Contro: richiede migrazione DB, OpenAPI `1.9.0` e smoke dedicato.

3. Aspettare sync/offline completo.
   - Pro: modello finale piu uniforme.
   - Contro: blocca il thin slice e mescola sync con il write boundary.

## Decisione

Adottiamo l'opzione 2.

La slice espone:

- `GET /api/v1/network/patients/{id}/therapies`
- `POST /api/v1/network/patients/{id}/therapies`
- `GET /api/v1/network/patients/{id}/therapies/{therapyId}`
- `PUT /api/v1/network/patients/{id}/therapies/{therapyId}`
- capability `network.replica.readonly-therapies`
- capability `network.replica.write-therapies`
- `therapies.version` obbligatoria per update paired e conflitto `409 VERSION_CONFLICT`
- soft delete/restore via `deletedAt` e `deletionReason`
- audit PHI-safe con attore operatore, paired-client flag e scope ambulatoriale

Restano fuori:

- hard delete remoto paired
- campi AI/document-derived e provenance documentale
- sync record-level, coda offline e merge automatico
- checkup, osservazioni, cataloghi e riconciliazione completa

## First Thin Slice

1. Aggiungere `therapies.version`, `updated_at`, `deleted_at` e `deletion_reason`
   con fallback runtime.
2. Pubblicare helper read/write network scoped su ambulatorio effettivo.
3. Aggiornare OpenAPI a `1.9.0` e capability discovery.
4. Aggiungere smoke `test:network:home-base-therapy-write`.
5. Tenere il workstream aperto per le prossime risorse cliniche.

## Riferimenti

- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0052](./0052-network-patient-profile-write-boundary.md)
- [ADR 0053](./0053-network-diary-entry-write-boundary.md)
- [OpenAPI v1](../openapi/mediflow-v1.yaml)
