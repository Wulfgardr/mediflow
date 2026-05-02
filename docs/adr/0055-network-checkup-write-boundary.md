# ADR 0055: write paired per checkup versionati

Status: Accepted

## Contesto

ADR 0052, ADR 0053 e ADR 0054 hanno aperto il write paired su profilo
paziente, diario clinico e terapie. I checkup/appuntamenti sono il passo
successivo per rendere utile il client paired senza introdurre ancora sync
record-level o merge automatico. La tabella `checkups` non esponeva ancora una
concorrenza row-level ne una semantica di soft delete remota.

## Opzioni

1. Pubblicare solo read remoto dei checkup.
   - Pro: diff piccolo.
   - Contro: non abilita il lavoro reale da iPad/iPhone.

2. Pubblicare read/create/update/soft-delete con `checkups.version`.
   - Pro: boundary paired utile, `409` PHI-safe, audit esplicito e nessun hard delete remoto.
   - Contro: richiede migrazione DB, OpenAPI `1.10.0` e smoke dedicato.

3. Aspettare sync/offline completo.
   - Pro: modello finale piu uniforme.
   - Contro: blocca il thin slice e mescola write boundary con replica.

## Decisione

Adottiamo l'opzione 2.

La slice espone:

- `GET /api/v1/network/patients/{id}/checkups`
- `POST /api/v1/network/patients/{id}/checkups`
- `GET /api/v1/network/patients/{id}/checkups/{checkupId}`
- `PUT /api/v1/network/patients/{id}/checkups/{checkupId}`
- capability `network.replica.readonly-checkups`
- capability `network.replica.write-checkups`
- `checkups.version` obbligatoria per update paired e conflitto `409 VERSION_CONFLICT`
- soft delete/restore via `deletedAt` e `deletionReason`
- audit PHI-safe con attore operatore, paired-client flag e scope ambulatoriale

Restano fuori:

- hard delete remoto paired
- campi AI/document-derived e provenance documentale
- sync record-level, coda offline e merge automatico
- osservazioni, cataloghi e riconciliazione completa

## First Thin Slice

1. Aggiungere `checkups.version`, `updated_at`, `deleted_at` e
   `deletion_reason` con fallback runtime.
2. Pubblicare helper read/write network scoped su ambulatorio effettivo.
3. Aggiornare OpenAPI a `1.10.0` e capability discovery.
4. Aggiungere smoke `test:network:home-base-checkup-write`.
5. Tenere il workstream aperto per osservazioni, cataloghi e sync.

## Riferimenti

- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0052](./0052-network-patient-profile-write-boundary.md)
- [ADR 0053](./0053-network-diary-entry-write-boundary.md)
- [ADR 0054](./0054-network-therapy-write-boundary.md)
- [OpenAPI v1](../openapi/mediflow-v1.yaml)
