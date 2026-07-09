<!-- @Codex -->
# ADR 0074: network cross-patient read boundary

Date: 2026-07-09
Status: Accepted

## Problema

Il boundary paired offriva letture per singolo paziente. Agenda e diario
globale richiedono righe da piu pazienti in una richiesta, aumentando la
superficie di esposizione di ogni grant.

## Contesto

MediFlow resta local-first e zero-knowledge. L'host paired non decifra i campi
`ENC:iv:data`: li inoltra come ciphertext e la decrittazione avviene solo sul
client Apple paired. Lo scope ambulatoriale autorevole e la membership
`patientsToAmbulatories`, non il solo `patientId` di una riga clinica.

## Opzioni

1. Riutilizzare le capability per-paziente per le query aggregate.
2. Esporre query aggregate senza join di membership.
3. Introdurre letture aggregate read-only con capability e scope dedicati.

## Trade-off

- Opzione 1: riduce il diff, ma estende un grant per-paziente senza consenso
  esplicito.
- Opzione 2: semplifica la query, ma permette scope leak da righe che non
  appartengono all'ambulatorio effettivo.
- Opzione 3: mantiene i grant espliciti e rende verificabili limit, filtri e
  join.

## Decisione

Adottiamo l'opzione 3.

- Le letture cross-paziente sono sola lettura e richiedono sempre il join con
  `patientsToAmbulatories` sullo scope ambulatoriale effettivo.
- Filtri e ordinamento server-side usano solo colonne plaintext. I campi `ENC`
  sono passthrough opachi e non sono chiavi di filtro, ordinamento o
  aggregazione.
- Ogni endpoint applica un `limit` obbligatorio con default e cap documentati.
- `network.replica.readonly-agenda` e
  `network.replica.readonly-clinical-diary-global` sono capability distinte
  dalle capability per-paziente.
- Il diario globale include le tombstone soft-delete per consentire al client
  di mostrare lo stato Eliminata dopo la decrittazione locale.

## Conseguenze

Agenda e diario globale possono essere consumati da un client paired senza
accesso a SQLite e senza decrittazione sull'host. Un grant per-paziente non
abilita implicitamente una vista cross-paziente. Analytics che richiedono
campi clinici decifrati restano lato client.

## First Thin Slice

1. Aggiungere gli indici globali per data e i guard runtime idempotenti.
2. Pubblicare `GET /api/v1/network/checkups` e
   `GET /api/v1/network/entries` con scope, filtri plaintext e limit cap.
3. Aggiungere `include=diagnoses` alla lista pazienti come passthrough
   ciphertext opt-in.
4. Coprire con test l'esclusione di un paziente fuori ambulatorio.

## Riferimenti

- [ADR 0038](./0038-network-readonly-data-plane-auth-boundary.md)
- [ADR 0048](./0048-apple-shared-client-architecture-and-home-base-runtime.md)
- [ADR 0066](./0066-patient-soft-delete-lifecycle.md)
- [OpenAPI v1](../openapi/mediflow-v1.yaml)
