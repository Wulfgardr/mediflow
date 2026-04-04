<!-- Codex: created 2026-04-03 -->
# ADR 0034: `local-only` come default e `network home-base` esplicito su LAN fidata

Date: 2026-04-03  
Status: Proposed

## Problema

MediFlow ha gia una north star architetturale chiara: il Mac puo diventare
`home base`, i client futuri possono collegarsi sulla stessa rete locale e il
fallback offline deve restare esplicito.

Oggi pero il prodotto e la documentazione operativa descrivono ancora soprattutto
un'app `local-first` sul singolo computer. Se apriamo `/api/v1/network`,
replica, AI centralizzata, settings e credenziali come filoni separati senza una
decisione madre, rischiamo di introdurre:

- inversioni implicite della sorgente autorevole del dato
- toggle UX poco chiari tra locale puro e nodo centrale
- drift tra `backup`, `replica`, `sync`, `pairing` e `AI runtime`
- una deriva non dichiarata verso un modello server-first

## Contesto

- [AGENTS.md](../../AGENTS.md) dichiara la north star con **Mac come home
  base**, client futuri su rete locale, cache locale e riconciliazione esplicita.
- [ARCHITECTURE.md](../../ARCHITECTURE.md) e
  [SECURITY.md](../../SECURITY.md) impongono `local-first`, `no cloud`,
  `no multi-tenant` e contratti `/api/v1` stabili.
- [docs/walkthrough.md](../walkthrough.md) dichiara oggi:
  - offline sync non presente
  - Bonjour discovery non presente
  - multi-user limitato
- [ADR 0010](./0010-openapi-spec-first-for-api-v1.md) rende `/api/v1`
  `spec-first`.
- [ADR 0016](./0016-backup-artifact-v1-manifest-preflight.md),
  [ADR 0022](./0022-nightly-backup-via-macos-launchd.md) e
  [ADR 0023](./0023-backup-retention-policy-keep-last-n.md) forniscono gia
  mattoni locali utili per continuita operativa, ma non definiscono ancora una
  modalita `network`.
- [PLANS.md](../../PLANS.md) mette nel focus corrente:
  - ADR + thin slice del nodo locale `home-base`
  - capability contract `/api/v1/network`
  - prima slice multi-device read-only

## Opzioni

1. Restare in `local-only` puro e trattare il nodo centrale come insieme di
   backup/export/import senza una vera modalita `network`.
2. Trattare il nodo centrale come modalita primaria quando rilevato su LAN
   fidata, con attivazione implicita o semi-automatica.
3. Introdurre due modalita operative esplicite:
   `local-only` come default e `network home-base` come opt-in con pairing
   esplicito verso un solo nodo trusted.

## Trade-off

- Opzione 1:
  - Pro: massima semplicita, rischio minimo, zero ambiguita di trust.
  - Contro: non sblocca davvero il workstream multi-device e lascia
    `/api/v1/network` come appendice mal definita.
- Opzione 2:
  - Pro: esperienza apparentemente piu fluida e centralizzazione immediata.
  - Contro: contraddice il default `local-first`, rende implicito il cambio di
    authority, alza il rischio security/UX e apre una deriva server-first.
- Opzione 3:
  - Pro: coerente con i vincoli gia scritti, permette un percorso incrementale e
    separa chiaramente trust, data plane e capability aggiuntive.
  - Contro: richiede una UX piu esplicita su stato/modalita e lascia alcuni
    follow-up architetturali a issue figlie.

## Decisione

Adottiamo l'opzione 3.

Decisioni operative:

- `local-only` resta la modalita di default e continua a funzionare senza rete
  o nodo centrale.
- `network home-base` e una modalita esplicita, attivata dall'operatore e
  legata a un pairing/trust bootstrap verso **un solo nodo Mac trusted alla
  volta**.
- La discovery di rete puo aiutare a proporre nodi candidati, ma non puo
  cambiare da sola trust, authority o modalita operativa.
- Quando un client e in modalita `network home-base`, il nodo paired diventa la
  **sorgente autorevole del data plane condiviso** per le capability di rete.
- Il client puo mantenere una cache locale cifrata per continuita operativa, ma
  nella first thin slice questa cache non e un peer paritario e non introduce
  ancora sync bidirezionale completo.
- Il runtime AI centralizzato opzionale e una **capability separata** del nodo
  paired: non ridefinisce il data plane, non e obbligatorio e non abilita da
  solo la modalita `network`.
- Gli stati operativi minimi diventano:
  - `local-only`
  - `network-unpaired`
  - `network-paired-online`
  - `network-paired-offline-degraded`
- Nella first thin slice, `network-paired-offline-degraded` significa
  **cache read-only + resync esplicito successivo**, non coda write automatica.
- `identity model`, `replica/sync`, `AI plane` e `scope medico` restano filoni
  separati e vengono raffinati nelle issue figlie `WUL-119..122`.

## Conseguenze

- Diventa piu semplice definire `WUL-119` senza mischiare pairing, health,
  capability e sync engine nella stessa issue.
- Diventa piu semplice preservare il default `local-first` senza negare la
  north star `home base`.
- Diventa piu semplice separare il piano dati dal piano AI centralizzato.
- Diventa piu difficile la UX, perche bisogna rendere esplicite modalita,
  pairing e stato del nodo.
- Restano deliberatamente fuori scope il conflict model write, la replica
  bidirezionale e il modello identitario minimo cross-device.

## First Thin Slice

1. Persistire questa decisione come ADR `Proposed` per `WUL-117`.
2. Aprire `WUL-119` come contratto `spec-first` `/api/v1/network` limitato a:
   - identita nodo
   - pairing intent/bootstrap
   - stato sessione/connessione
   - capability discovery
   - error taxonomy PHI-safe
3. Aprire `WUL-118` per rendere visibile in UI:
   - modalita operativa corrente
   - stato pairing
   - stato nodo paired
4. Mantenere la prima slice multi-device come **read-only**:
   - host Mac autorevole
   - client paired che legge dati remoti
   - cache locale solo per fallback degradato in lettura
5. Lasciare a follow-up espliciti:
   - `WUL-120` replica/sync e riconciliazione
   - `WUL-121` AI centralizzata opzionale
   - `WUL-122` identity/scope medico sul nodo

## Fuori Scope

- cloud sync o egress implicito
- failover automatico non confermato dall'operatore
- mesh peer-to-peer o multi-master
- RBAC enterprise o federazione identita
- write queue offline o sync record-level nella thin slice iniziale
