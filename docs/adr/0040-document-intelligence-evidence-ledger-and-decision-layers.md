<!-- Codex: created 2026-04-04 -->
# ADR 0040: document intelligence come evidence ledger con decision layers separati

Date: 2026-04-04  
Status: Proposed

## Problema

MediFlow oggi tratta i documenti con una pipeline utile ma ancora troppo
compressa:

- `document synthesis` produce summary, diagnosi e farmaci
- `document_evidence_pack.v2` compatta alcuni fatti reviewable
- `Patient Insight` e `Smart Import` consumano proiezioni locali di quel pack

Questo approccio funziona per thin slice incrementali, ma mostra limiti sempre
piu chiari quando confrontiamo lo stack locale con un comparator piu forte:

- il recente e l attivo non emergono sempre con il peso giusto
- la source hierarchy non e ancora un artifact esplicito del dato documentale
- le negazioni e le esclusioni restano meglio governate nei benchmark che nel
  runtime documentale persistito
- extraction, ranking, decisione reviewable e render finale sono ancora troppo
  vicini

Il rischio non e solo perdere recall: e rendere il documento un blob da
riassumere invece che una base di evidenza da governare.

## Contesto

- [ADR 0027](./0027-ai-task-extraction-envelope-and-local-render.md) ha gia
  separato extraction envelope e local render nelle lane generative.
- [ADR 0031](./0031-clinical-entities-evidence-first-medication-problem-lane.md)
  ha fissato un approccio evidence-first per una lane NER benchmark-only.
- [ADR 0032](./0032-document-intelligence-corpus-and-private-shadow-vault.md)
  governa corpus canonico e vault privato.
- [ADR 0039](./0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md)
  apre il comparator cloud come strumento interno di distillazione.
- Il runtime attuale persiste ancora `patients.documentInsights` come archivio
  limitato e usa `document_evidence_pack.v2` come pack reviewable compatto, ma
  non ha ancora un ledger documentale completo con ranking, exclusions e
  decision layers espliciti.

## Opzioni

1. Continuare con l approccio attuale, migliorando solo prompt ed euristiche
   per-lane.
2. Introdurre subito un nuovo runtime documentale ricco e sostituire in blocco
   `documentInsights` e `document_evidence_pack.v2`.
3. Adottare come north star un `document evidence ledger`, ma arrivarci per
   thin slice: prima review strutturato, poi contratto esteso, poi proiezioni
   lane-specific.

## Trade-off

- Opzione 1:
  - Pro: diff minimi e basso rischio immediato.
  - Contro: i limiti del modello dati documentale restano impliciti e
    continuiamo a spostare logica in prompt/post-processing.
- Opzione 2:
  - Pro: massimo riordino concettuale.
  - Contro: troppo ampia per una thin slice; alto rischio di rompere runtime e
    benchmark insieme.
- Opzione 3:
  - Pro: rende esplicita la direzione architetturale senza chiedere un rewrite;
    permette di validare i nuovi layer uno alla volta.
  - Contro: richiede disciplina nel convivere temporaneamente con v2 + nuovo
    target architetturale.

## Decisione

Adottiamo l opzione 3.

La direzione architetturale per la document intelligence diventa:

- trattare il documento come **evidence ledger** e non come semplice testo da
  riassumere
- separare in modo esplicito quattro layer:
  - `recognition`: fatti e span/document evidence trovati
  - `source governance`: recency, priorita, trust e provenance delle fonti
  - `decision`: cosa diventa attivo, reviewable, blocked o out-of-focus
  - `render/projection`: come i fatti vengono proiettati in `Patient Insight`,
    `Smart Import` o lane future
- rendere first-class nel modello documentale:
  - temporality
  - status
  - source priority / freshness
  - reviewability
  - negative assertions / exclusions
  - provenance sufficiente per capire perche un fatto e stato promosso o
    escluso

Nota importante:

- questa ADR non impone oggi un rewrite di `documentInsights`
- `document_evidence_pack.v2` resta valido come baseline
- le proiezioni lane-specific continuano a esistere
- il comparator cloud resta solo un lens interno per capire dove il ledger deve
  evolvere

## Conseguenze

Diventa piu semplice:

- spiegare perche un fatto documentale entra o non entra in una lane
- confrontare il gap tra comparator e locale senza ridurlo a “modello migliore”
- creare benchmark sintetici che misurino ranking, exclusions e reviewability
  oltre al recall

Diventa piu difficile:

- continuare ad accumulare logica documentale implicita in prompt e parser
- trattare `documentInsights` come contenitore indistinto sufficiente a lungo
  termine

## First Thin Slice

1. Estendere `WUL-151` con un `document intelligence review` strutturato che
   trasformi i delta del comparator in osservazioni sul modello dati
   documentale.
2. Formalizzare nei report i gap su:
   - focus/recency
   - source hierarchy
   - reviewability
   - negative assertions / exclusions mancanti
   - separazione insufficiente tra decisione e render
3. Usare questo review per scegliere la prima thin slice runtime, senza ancora
   cambiare il contratto persistito.

## Fuori Scope

- sostituire subito `patients.documentInsights`
- introdurre migrazioni DB o nuove tabelle in questa ADR
- cambiare il posizionamento `local-first`
- promuovere il comparator cloud nel runtime MediFlow
