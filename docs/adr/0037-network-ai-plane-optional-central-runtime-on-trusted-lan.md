<!-- Codex: created 2026-04-03 -->
# ADR 0037: `AI plane` separato con runtime centralizzato opzionale su nodo locale trusted

Date: 2026-04-03  
Status: Proposed

## Problema

Con [ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md),
[ADR 0035](./0035-network-replica-thin-slice-snapshot-mirror.md) e
[ADR 0036](./0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md)
abbiamo chiarito `data plane`, replica e identita minima del workstream
`home-base`.

Resta aperto `WUL-121`: alcuni client futuri potrebbero non avere hardware
sufficiente per eseguire bene le lane AI locali piu pesanti, ma MediFlow non
puo rispondere a questo bisogno confondendo:

- replica dati e inferenza AI
- capability opzionali e capability obbligatorie
- rete locale trusted e qualunque forma di egress/cloud

Serve quindi una decisione minima che separi chiaramente `data plane` e
`AI plane` prima di introdurre qualunque esecuzione remota reale.

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) e [SECURITY.md](../../SECURITY.md)
  impongono `local-first`, `no cloud dependency by default` e confini di
  trasporto sicuri.
- [docs/ai-stack-reliability-review.md](../ai-stack-reliability-review.md)
  fissa che il runtime generativo di base resta `ollama` locale e che l'output
  AI non e mai affidato ciecamente.
- [docs/ai-stack-execution-plan.md](../ai-stack-execution-plan.md),
  [ADR 0028](./0028-stack-aware-ai-model-evaluation-matrix.md) e
  [ADR 0029](./0029-ai-model-parliament-and-local-retention-policy.md)
  rendono gia espliciti benchmark lane-specific, challenger policy e criteri di
  promozione prudente del runtime AI.
- [ADR 0034](./0034-local-only-default-and-network-home-base-opt-in.md) dice
  gia che un runtime AI centralizzato, se esiste, e una capability separata dal
  `data plane` shared e non abilita da solo la modalita `network`.

## Opzioni

1. Lasciare tutto in `AI locale` puro su ogni device e rinunciare del tutto a
   una capability centralizzata.
2. Trattare il nodo `home-base` come `data plane + AI plane` impliciti, con una
   centralizzazione sostanzialmente automatica quando il nodo e raggiungibile.
3. Introdurre un `AI plane` separato:
   - `AI locale` come default
   - `runtime centralizzato opzionale` solo su LAN fidata e paired
   - fallback esplicito a runtime locale del client o a stato `AI non disponibile`

## Trade-off

- Opzione 1:
  - Pro: massima semplicita e zero nuovo trust surface.
  - Contro: penalizza i client a bassa potenza e impedisce un percorso pratico
    multi-device senza hardware alto su ogni macchina.
- Opzione 2:
  - Pro: esperienza apparentemente piu lineare.
  - Contro: confonde subito `data plane` e `AI plane`, rende opaco il fallback
    e alza il rischio di deriva server-first.
- Opzione 3:
  - Pro: resta coerente con il local-first, separa capability e trust boundary,
    e consente una discovery dichiarativa senza introdurre ancora execution
    remota reale.
  - Contro: richiede una UX piu esplicita e lascia il vero routing remoto a un
    follow-up ulteriore.

## Decisione

Adottiamo l'opzione 3.

Decisioni operative:

- `AI locale` resta il default operativo di MediFlow.
- Un nodo `network home-base` puo dichiarare un
  **runtime AI centralizzato opzionale** solo come capability separata dal
  `data plane`.
- Questa capability vale solo su **LAN fidata paired**: nessuna WAN, nessun
  cloud, nessuna promozione implicita fuori dal pairing locale.
- Le superfici eleggibili della thin slice sono:
  - `Patient Insight`
  - `Smart Import`
  - `Document Synthesis`
- Se il runtime AI centralizzato non e disponibile, il fallback dichiarato e:
  - runtime locale del client, se presente
  - altrimenti stato esplicito `AI non disponibile`
- La discovery/UX puo dichiarare `AI locale`,
  `AI centralizzata disponibile` o `AI centralizzata non disponibile`, ma
  questo **non significa** che il routing remoto sia gia operativo.
- Qualunque attivazione reale del runtime centralizzato resta bloccata finche
  non passano:
  - benchmark lane-specific coerenti con [ADR 0028](./0028-stack-aware-ai-model-evaluation-matrix.md)
  - governance di rollout coerente con [ADR 0029](./0029-ai-model-parliament-and-local-retention-policy.md)
    e [docs/ai-rollout-governance.md](../ai-rollout-governance.md)

## Conseguenze

- `Data plane` e `AI plane` non restano piu impliciti nello stesso concetto.
- La UI puo dichiarare onestamente capability, fallback e guardrail del nodo.
- I client a bassa potenza hanno un percorso architetturale plausibile senza
  introdurre cloud o registry remoti.
- Resta fuori scope tutta la parte di remote execution operativa, scheduling,
  benchmark automatici o download remoti dei modelli.

## First Thin Slice

1. Persistire questa decisione come ADR per `WUL-121`.
2. Introdurre un summary PHI-safe `/api/v1/network/ai-runtime` che dichiari:
   - `AI locale` vs `AI centralizzata disponibile/non disponibile`
   - boundary `AI plane` vs `data plane`
   - fallback policy
   - rollout gate e superfici eleggibili
3. Allineare `network.capabilities` in modo che
   `network.ai.central-runtime` non resti piu solo `planned`, ma dichiari
   `disabled`, `available` o `unavailable` in base allo stato del nodo.
4. Aggiornare la UI `Modalita operativa` per distinguere in modo leggibile:
   - runtime locale del nodo
   - stato della capability centralizzata
   - fallback e guardrail minimi

## Fuori Scope

- cloud inference o egress esterno
- routing remoto reale dell'inferenza tra client e nodo
- download dinamici di modelli o registry remoti automatici da UI
- auto-promozione del runtime centralizzato senza benchmark/governance
