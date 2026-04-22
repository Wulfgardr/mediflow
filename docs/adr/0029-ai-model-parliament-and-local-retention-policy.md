<!-- Codex: created 2026-03-22 -->
# ADR 0029: AI model parliament and local retention policy

Date: 2026-03-22  
Status: Proposed

## Problema

MediFlow ha gia introdotto:

- un contratto condiviso `mediflow.ai.extract.v1`
- benchmark generativi stack-aware
- benchmark lane-specific per `Smart Import`
- un registry locale dei candidati AI

Manca pero il livello decisionale che trasformi questi benchmark in una policy
operativa unica per:

- scegliere il baseline locale da mantenere
- distinguere i challenger utili dai modelli ridondanti
- evitare che i modelli inutili restino installati sul Mac senza criterio
- impedire pruning automatici opachi o pericolosi sui modelli configurati attivi

Senza questo strato, il sistema resta frammentato:

- i benchmark producono output separati
- i settings mostrano liste statiche e install-oriented
- la retention dei modelli dipende da decisioni manuali non tracciate

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede contratti espliciti, diff
  piccoli e niente scorciatoie architetturali speculative.
- [SECURITY.md](../../SECURITY.md) richiede local-first, output AI non fidato e
  niente egress implicito.
- [ADR 0012](./0012-operator-reviewed-smart-import-from-patient-context.md)
  impone che `Smart Import` resti reviewable e non silenzioso.
- [ADR 0013](./0013-qwen35-default-text-only-medgemma-specialist.md) fissa il
  default text-only attuale, ma non la governance competitiva dei challenger.
- [ADR 0027](./0027-ai-task-extraction-envelope-and-local-render.md) ha
  uniformato il contratto di estrazione per le lane generative.
- [ADR 0028](./0028-stack-aware-ai-model-evaluation-matrix.md) ha introdotto la
  matrice stack-aware e i primi stop-rule di benchmark.
- [docs/ai-stack-execution-plan.md](../ai-stack-execution-plan.md) prevede gia
  challenger generativi e rollout prudente, ma non definisce ancora una policy
  di retention locale dei modelli installati.

Vincoli ulteriori:

- nessun modello configurato nei ruoli attivi puo essere rimosso automaticamente
- nessun pruning deve partire implicitamente dal salvataggio settings o dai test
  di connessione
- le lane non generative (`PII`, `clinical_entities`, `embedding`) non vanno
  forzate nella stessa logica di benchmark dei generativi locali

## Opzioni

1. Lasciare benchmark e retention separati, demandando il pruning a decisioni
   manuali fuori dal repository.
2. Spostare subito la governance dei benchmark dentro la Settings UI e
   introdurre rimozione modelli dal prodotto.
3. Introdurre un "parlamento" report-driven che unisce benchmark, registry,
   modelli installati e policy di retention, con pruning solo esplicito e
   opzionale.

## Trade-off

- Opzione 1:
  - Pro: zero lavoro aggiuntivo oggi.
  - Contro: nessun criterio persistente; drift forte tra benchmark e runtime
    reale del Mac.
- Opzione 2:
  - Pro: UX unificata e potenzialmente piu comoda.
  - Contro: troppo presto; spinge logica di governance instabile nella UI e
    aumenta il rischio di rimozioni opache o regressioni sugli active roles.
- Opzione 3:
  - Pro: introduce subito una policy versionabile e auditabile senza rendere la
    UI dipendente da logica ancora in evoluzione; mantiene il pruning come
    azione esplicita.
  - Contro: aggiunge un artifact operativo in piu e lascia per ora i settings
    ancora statici.

## Decisione

Adottiamo l'opzione 3.

Introduciamo un `AI model parliament` locale con queste regole:

- il parlamento legge il candidate registry, i benchmark generativi e il
  benchmark `Smart Import`
- il parlamento decide sui candidati `generative + local_chat_runtime +
  runnable`, distinguendo sempre `ollama_chat` e `mlx_chat`
- i candidati `mlx_chat` restano benchmark-only e non cambiano il runtime app
  o i settings senza una decisione separata
- il parlamento produce un artifact unico con:
  - baseline raccomandato
  - challenger da mantenere
  - modelli protetti per ruolo attivo
  - modelli ridondanti o falliti candidati al pruning
- il pruning resta `report-only` di default
- l'apply pruning, se abilitato, deve essere sempre esplicito da CLI e mai
  implicito nel prodotto
- i modelli fuori registry o non benchmarkati restano in `hold`, non in
  auto-prune
- il report puo includere uno **scorecard capability/economics advisory** per
  confrontare qualita, latenza e copertura lane-aware, ma questo scorecard non
  cambia da solo baseline, readiness o policy di pruning

Regole di readiness:

- il parlamento puo passare in stato `prune_ready` solo se esiste almeno un
  modello che supera sia:
  - il chamber condiviso `mediflow.ai.extract.v1`
  - il chamber lane-specific `Smart Import`
- se nessun modello supera entrambi i chamber, il pruning resta bloccato

Regole di protezione:

- i modelli attivi configurati in `aiModel_clinical`, `aiModel_reasoning`,
  `aiModel_ocr` e `aiModel` legacy sono protetti dal pruning
- il baseline corrente `qwen3.5:35b-a3b` resta preferito se supera i threshold;
  un challenger puo essere promosso solo come raccomandazione esplicita, non
  come mutation automatica dei settings

## Conseguenze

Diventa piu semplice:

- confrontare benchmark e retention nello stesso artifact
- leggere anche il rapporto qualita/latenza e la copertura delle lane senza
  trasformare la UI in un orchestratore di promozioni
- capire quali modelli vale la pena tenere installati
- evitare che i benchmark restino scollegati dalla realta del runtime locale

Diventa piu difficile:

- introdurre scorciatoie direttamente nella Settings UI
- trattare modelli non generativi come sostituti drop-in del runtime `ollama`

Rischi noti:

- finche `AI Patient Insight` non ha ancora il suo scorer dedicato, la
  promozione di un challenger deve restare prudente
- il pruning automatico lato prodotto resta fuori scope in questa ADR

## First Thin Slice

1. Esportare il runner riusabile del benchmark `Smart Import`.
2. Aggiungere uno script `parliament` che unisca:
   - registry candidati
   - benchmark generativo stack-aware
   - benchmark `Smart Import`
   - modelli installati e modelli configurati attivi
3. Far produrre allo script un report JSON e un report markdown con:
   - baseline
   - challenger
   - prune candidates
   - modelli protetti
4. Consentire solo un `--apply-prune` esplicito da CLI, mai dal flusso settings.

## Fuori Scope

- cambiare automaticamente il default in `lib/ai-models.ts`
- introdurre subito una UI di pruning in `app/settings/page.tsx`
- benchmarkare nella stessa gara lane `PII`, `NER` o `embedding`
- rimozione automatica di modelli non tracciati dal registry
- introdurre pruning implicito dei modelli MLX/Hugging Face dentro questa ADR
