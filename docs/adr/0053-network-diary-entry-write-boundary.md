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


## Consolidamento C05 del 26 settembre 2026 (candidato locale)

Le due mutazioni rete partecipano al confine ordinario del diario definito
nell'[estensione di ADR 0015](./0015-audit-taxonomy-minimum-catalog.md#estensione-c05-del-26-settembre-2026--diario-clinico-ordinario).
Ammissione del padre, scope M2M, versione, modifica e audit obbligatorio sono
verificati nella stessa transazione. Un padre mancante o eliminato logicamente
produce 404; la sola archiviazione non lo rende eliminato. PUT puo ripristinare
la voce con deletedAt:null e CAS quando il padre e attivo, non il paziente.
Questa precisazione colma un comportamento precedente non uniforme.

L'ammissione corrente del padre/scope precede anche il replay di create:
identificativo esplicito e payload identico mantengono 200 idempotente senza
nuova scrittura o audit; payload diverso produce 409. Un errore audit annulla
l'intera modifica invece di diventare un successo senza evidenza. Payload
cifrati e vincoli paired restano invariati; nessun nuovo writer headless.

## Emendamento WUL-793 del 25 ottobre 2026 (Proposed)

[ADR 0163](./0163-mobile-visit-dossier.md) ammette appunti mobili durevoli,
protetti come dati sanitari. Sono distinti dalle entries: nessuna scrittura o
coda offline. Nuovo login, rivalidazione online e revisione esplicita precedono
la precompilazione del compositore ordinario. Writer, audit e rilettura restano
quelli esistenti. Esiti incerti non autorizzano retry né cancellazione dell'appunto.


## Emendamento HC-A2 del 29 ottobre 2026: esiti delle scale

Per le creazioni con `type: scale` e per le modifiche di esiti esistenti
(o la conversione di una voce in scala), i writer condivisi
`createEntryOperation` e `updateEntryOperation` verificano paziente corretto, presente, non archiviato e
non nel cestino nella stessa transazione IMMEDIATE della voce e dell'audit.
Un rifiuto di stato restituisce `409 SCALE_PATIENT_INACTIVE`, senza voce o audit.
Nel paired, paziente mancante e paziente fuori scope restano indistinguibili:
entrambi restituiscono 404 con lo stesso codice, senza rivelarne l'esistenza.
La versione dell'anagrafica non è una precondizione: modifiche anagrafiche
estranee alla valutazione non devono bloccare il salvataggio. Le altre voci
ordinarie mantengono l'ammissione degli archiviati documentata sopra.

Il replay già esistente nel paired è riusato anche per le scale Web e v1:
stesso ID e stessi campi persistiti restituiscono `200`, ID, versione e
`idempotent: true`, senza seconda voce o audit, dopo l'ammissione corrente.
Stesso ID con paziente o contenuto diverso restituisce
`409 SCALE_IDEMPOTENCY_CONFLICT`. Le date si confrontano alla risoluzione di
un secondo del database. I client preparano una sola richiesta per bozza e
ne conservano data e byte cifrati identici per i retry; una risposta persa
non autorizza a generare una nuova identità dell'esito. La UI distingue
registrazione non confermata, paziente non disponibile ed esito già registrato.

La verifica server protegge anche la finestra fra la rilettura del client e
il POST. Il controllo client resta un aiuto per il medico, non l'autorità di
ammissione della scrittura. Per questa estensione è richiesta una review
indipendente del confine di integrità prima del merge (Part of WUL-768).
