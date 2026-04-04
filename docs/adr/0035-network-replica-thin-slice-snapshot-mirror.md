<!-- Codex: created 2026-04-03 -->
# ADR 0035: thin slice replica `network home-base` come snapshot mirror governato

Date: 2026-04-03  
Status: Proposed

## Problema

Con [ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md)
abbiamo chiarito che `local-only` resta il default e che il nodo paired puo
diventare autorevole solo in modalita `network home-base`.

Resta pero aperto il tema piu delicato di `WUL-120`: come dare continuita tra
macchine senza introdurre subito un motore sync record-level, una coda write
offline o un modello multi-master che contraddirebbe i guardrail attuali.

Serve quindi scegliere in modo esplicito il **first thin slice** tra:

- semplice backup locale senza vera semantica di replica
- replica/sync record-level completa con conflitti applicativi
- un modello intermedio governato che riusi i mattoni gia presenti

## Contesto

- [AGENTS.md](../../AGENTS.md), [ARCHITECTURE.md](../../ARCHITECTURE.md) e
  [SECURITY.md](../../SECURITY.md) bloccano cloud sync, multi-tenant e derive
  server-first.
- [ADR 0016](./0016-backup-artifact-v1-manifest-preflight.md) rende canonico
  l'artifact backup v1 con manifest e restore preflight.
- [ADR 0022](./0022-nightly-backup-via-macos-launchd.md) e
  [ADR 0023](./0023-backup-retention-policy-keep-last-n.md) coprono gia il
  filone backup locale, ma non definiscono il comportamento di una replica
  trusted LAN.
- Il repository ha gia optimistic concurrency sui pazienti con `version` e
  `409 VERSION_CONFLICT`, quindi esiste una base per una review manuale dei
  conflitti write senza introdurre merge automatici opachi.
- La first thin slice `network` aperta in `WUL-119` e PHI-safe e non espone
  ancora un data sync engine.

## Opzioni

1. Usare solo backup/restore manuale e chiamarlo impropriamente replica.
2. Adottare una replica iniziale a **snapshot mirror governato**:
   il client paired puo riallinearsi verso il nodo tramite snapshot cifrati e
   promotion esplicita, con fallback locale e review manuale.
3. Implementare subito sync record-level con queue offline, conflitti entity by
   entity e merge applicativo.

## Trade-off

- Opzione 1:
  - Pro: rischio minimo e nessun contratto nuovo.
  - Contro: non copre il caso di continuita operativa multi-macchina e lascia
    ambiguo il confine tra backup e replica.
- Opzione 2:
  - Pro: riusa artifact/preflight/versioning gia canonici, mantiene il diff
    contenuto e rende espliciti stati `online`, `offline/deferred` e
    `manual review`.
  - Contro: non offre ancora una vera sync continua e richiede una UX chiara su
    cosa e preview e cosa e operativo.
- Opzione 3:
  - Pro: esperienza finale potenzialmente piu ricca.
  - Contro: e troppo ampia per la fase attuale, alza il rischio di regressioni
    sui dati e costringerebbe a decidere oggi merge/conflict semantics che non
    sono ancora pronte.

## Decisione

Adottiamo l'opzione 2.

Decisioni operative:

- La first thin slice di `WUL-120` non e uno sync engine record-level, ma una
  **replica snapshot/mirror governata**.
- Il nodo paired resta la sorgente autorevole quando la modalita
  `network home-base` e effettivamente attiva.
- Il backup artifact v1 resta **backup**: non viene promosso implicitamente a
  replica solo perche usa lo stesso formato base.
- La replica iniziale puo riusare artifact cifrati, manifest e restore
  preflight, ma con metadata/stati distinti rispetto al semplice backup locale.
- Se la rete cade dopo il pairing, il client torna a lavorare in locale e lo
  stato diventa `offline-deferred`: nessun merge automatico, nessuna write
  queue nascosta.
- Il riallineamento successivo richiede una **promozione esplicita** e puo
  sfociare in `manual review` prima dell'applicazione.
- Il conflict model di alto livello per la thin slice diventa:
  - snapshot integrity + restore preflight per l'applicazione del mirror
  - `version` / compare-on-write per bloccare write stale sugli oggetti gia
    protetti a livello API
  - review manuale quando il riallineamento incontra delta non promuovibili in
    modo banale

Gli stati minimi da esporre sono:

- `local-only`
- `unpaired`
- `online`
- `offline-deferred`
- `conflict-review`

## Conseguenze

- Diventa piu chiaro il confine tra `backup`, `replica`, `sync` e `restore`.
- Il workstream puo avanzare senza introdurre subito una coda write bidirezionale.
- La UI puo dichiarare in modo onesto i casi `queued/deferred` e `manual review`
  come parte della semantica di replica.
- Resta fuori scope qualsiasi merge automatico record-level o multi-master.

## First Thin Slice

1. Persistire questa decisione come ADR per `WUL-120`.
2. Estendere il contratto `network session` con uno stato replica PHI-safe che
   distingua:
   - `local-only`
   - `unpaired`
   - `online`
   - `offline-deferred`
   - `conflict-review`
3. Aggiornare la UI `Modalita operativa` per rendere leggibile:
   - boundary tra backup e replica
   - next action (`pairing required`, `queue snapshot`, `manual review`)
   - conflict model ad alto livello
4. Lasciare a follow-up espliciti:
   - trasferimento snapshot cifrato reale
   - promozione/apply del mirror
   - review dettagliata dei conflitti entity-level

## Fuori Scope

- sync bidirezionale record-level
- merge automatico dei conflitti
- multi-master o scenari WAN
- promozione implicita del backup scheduler a replica di rete
