<!-- Codex: created 2026-04-04 -->
# ADR 0039: cloud comparator shadow eval opt-in con case pack privato, gate privacy e distillazione sintetica

Date: 2026-04-04  
Status: Proposed

## Problema

MediFlow oggi ha benchmark e governance solide per le lane AI locali, ma manca
ancora una strada disciplinata per rispondere a una domanda strategica legittima:

- quanto dista davvero lo stack locale da un comparatore cloud piu forte su casi
  documentali complessi?
- dove il gap riguarda il modello e dove invece riguarda prompt, retrieval,
  source hierarchy o post-processing locale?

Se questo confronto avviene in modo ad hoc, il rischio e immediato:

- egress non governato di materiale clinico
- caso realistico privato trattato come dataset operativo
- conclusioni impressionistiche invece di output reviewable
- bypass implicito del principio `local-first` gia fissato in repo

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) e [SECURITY.md](../../SECURITY.md)
  impongono `local-first`, `no cloud` di default e nessun PHI/PII in repo.
- [ADR 0032](./0032-document-intelligence-corpus-and-private-shadow-vault.md)
  separa gia corpus canonico `synthetic-only` e vault locale privato.
- [ADR 0033](./0033-ai-rollout-governance-lane-aware-shadow-mode.md)
  formalizza `shadow mode`, fallback, rollback e stop-rules, ma non definisce
  ancora il caso specifico di un comparatore cloud.
- [ADR 0012](./0012-operator-reviewed-smart-import-from-patient-context.md)
  impone che `Smart Import` resti reviewable e non diventi auto-write.
- [docs/patient-insight-benchmark.md](../patient-insight-benchmark.md) e
  [scripts/benchmark-smart-import.ts](../../scripts/benchmark-smart-import.ts)
  offrono gia rubriche lane-specific utili, ma lavorano su corpus canonici
  sintetici e non su case pack privati redatti/minimizzati.
- `WUL-151` chiede esplicitamente una lane opzionale `cloud comparator shadow
  eval` verso `GPT-5.4`, senza trasformarlo in runtime operativo di MediFlow.
- Il bisogno reale non e promuovere un modello cloud nel prodotto, ma usare un
  comparatore piu forte come lente interna di engineering per capire come
  evolvere stack locale, prompt, retrieval, heuristics e post-processing.

## Opzioni

1. Vietare ogni confronto cloud e limitarsi ai benchmark locali sintetici.
2. Consentire confronti cloud ad hoc con documenti redatti caso per caso,
   senza un contratto o un audit trail dedicato.
3. Introdurre una lane opt-in e reviewable con:
   - case pack privato fuori Git
   - gate privacy esplicito
   - prompt contract coerente con `mediflow.ai.extract.v1`
   - report comparativo e distillazione obbligatoria verso corpus sintetici.

## Trade-off

- Opzione 1:
  - Pro: rischio privacy minimo e governance semplice.
  - Contro: lascia irrisolto il bisogno strategico di capire il delta reale
    rispetto a un comparatore cloud forte.
- Opzione 2:
  - Pro: massimo pragmatismo apparente e bassa frizione iniziale.
  - Contro: e troppo fragile; sposta il rischio nel processo umano e lascia il
    confronto non auditabile e non ripetibile.
- Opzione 3:
  - Pro: preserva il default local-first, rende il confronto citabile e limita
    l’egress a casi esplicitamente approvati e gia minimizzati.
  - Contro: aggiunge un artifact privato in piu, richiede disciplina manuale e
    non elimina da solo il giudizio umano sulle redazioni.

## Decisione

Adottiamo l’opzione 3.

`Cloud comparator shadow eval` e ammesso solo come lane opzionale di
engineering, con queste regole:

- il default MediFlow resta `local-only`; nessun runtime cloud entra nel
  prodotto per default
- `gpt-5.4` non e un challenger da promuovere nel runtime MediFlow: e un
  **comparatore interno di ricerca/engineering** usato per distillare metodo di
  lavoro, failure patterns e miglioramenti locali
- il comparatore cloud iniziale e `gpt-5.4` via `Responses API`
- i confronti cloud sono ammessi solo su **case pack privati** fuori Git,
  redatti/minimizzati e approvati esplicitamente da un reviewer umano interno
- il case pack deve includere almeno:
  - origine privata del caso (`private-shadow-vault`)
  - gate privacy (`directIdentifiersRemoved`, `quasiIdentifiersMinimized`,
    `operatorReviewed`, `cloudExportApproved`)
  - input lane-specific per `Patient Insight` e/o `Smart Import`
  - aspettative di scoring reviewable
  - piano minimo di distillazione verso corpus sintetici, con learning
    objectives e hypothesis tags opzionali
- il confronto deve restare, quando possibile, sullo stesso envelope logico
  `mediflow.ai.extract.v1`, cosi il delta osservato misura semantica e
  guardrail, non una UI diversa
- le risposte cloud non possono:
  - scrivere direttamente dati paziente
  - entrare nel runtime clinico
  - essere committate nel repository
- il successo della lane non si misura con una futura “promozione cloud”, ma
  con la capacita di tradurre il delta osservato in miglioramenti locali
  reviewable nello stack MediFlow
- l’output utile del workstream e un **report comparativo locale** con:
  - metriche lane-specific
  - differenze `cloud vs local`
  - failure patterns espliciti
  - insight tassonomici che classificano il delta in:
    - reasoning pattern da imitare
    - euristica locale mancante
    - problema di retrieval/source hierarchy
    - problema di contract/rendering
    - problema di review safety/guardrail
    - synthetic benchmark gap
  - una `local evolution agenda` che trasformi gli insight in candidate thin
    slice locali con layer tecnico primario, validation path, benchmark target
    , touchpoint candidati nel repo e un mini execution brief esportabile
  - domande/follow-up per trasformare il delta in nuovi benchmark sintetici,
    nuove euristiche o nuove thin slice locali

## Conseguenze

Diventa piu semplice:

- confrontare local vs cloud senza confondere il vault privato con il corpus
  canonico
- capire se il gap riguarda focus, evidence discipline, source hierarchy,
  therapy-state o utilita reviewable
- trasformare un miglior risultato cloud in un task locale concreto e misurabile
  senza cambiare l’identita `local-first` del prodotto

Diventa piu difficile:

- improvvisare upload una tantum “solo per vedere”
- usare il cloud comparator come scorciatoia verso un runtime operativo remoto
- lasciare il delta osservato come semplice impressione non versionata

## First Thin Slice

1. Aprire `WUL-151` con ADR dedicata e runbook operativo.
2. Aggiungere un contratto `cloud comparator case pack` privato e un fixture
   sintetico d’esempio solo per documentare la shape.
3. Aggiungere un harness CLI locale che:
   - emette prompt comparabili
   - puo eseguire baseline locale
   - puo chiamare `gpt-5.4` solo in opt-in esplicito
   - produce report JSON/Markdown con failure patterns e distillazione
4. Lasciare fuori dal diff:
   - integrazione runtime/UI del cloud
   - auto-write dei risultati
   - storage in repo di case reali o quasi reali

## Fuori Scope

- promuovere `gpt-5.4` come runtime operativo MediFlow
- inviare documenti non minimizzati o non approvati al cloud
- usare output cloud come verita clinica o come apply automatico
- usare questa lane come surrogate roadmap per sostituire lo stack locale
- aggiungere sync, telemetry o egress generalizzato di PHI
