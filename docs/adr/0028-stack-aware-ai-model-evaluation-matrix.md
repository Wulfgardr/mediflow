<!-- Codex: created 2026-03-21 -->
# ADR 0028: Stack-aware AI model evaluation matrix

Date: 2026-03-21
Status: Proposed

## Problema

Il report di scouting dei modelli propone candidati eterogenei:

- modelli generativi text-only
- modelli NER clinici
- modelli PII/de-identification
- encoder biomedical per embedding e reranking

Il benchmark introdotto da
[ADR 0027](./0027-ai-task-extraction-envelope-and-local-render.md) confronta
oggi soprattutto modelli `ollama` generativi contro il contratto condiviso
`mediflow.ai.extract.v1`.

Se proviamo a "testare tutto" come se ogni modello fosse un sostituto drop-in
del runtime generativo, otteniamo due errori:

- falsi confronti tra lane tecnicamente diverse
- pressione a introdurre dipendenze o servizi non ancora governati

Serve quindi una matrice di valutazione che permetta di iniziare i test subito,
restando coerenti con i confini local-first del repository.

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede diff piccoli, contratti
  espliciti e niente riscritture speculative.
- [SECURITY.md](../../SECURITY.md) richiede no egress di default e output AI
  trattato come non fidato.
- [docs/adr/0012-operator-reviewed-smart-import-from-patient-context.md](./0012-operator-reviewed-smart-import-from-patient-context.md)
  impone smart import reviewable.
- [docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md](./0013-qwen35-default-text-only-medgemma-specialist.md)
  fissa il default text-only corrente e MedGemma come opzione specialistica.
- [docs/adr/0027-ai-task-extraction-envelope-and-local-render.md](./0027-ai-task-extraction-envelope-and-local-render.md)
  ha gia separato extraction contract e render locale per benchmark cross-task.

## Opzioni

1. Forzare tutti i candidati nello stesso benchmark generativo.
2. Integrare subito ogni candidato nel runtime applicativo prima di valutarlo.
3. Introdurre una matrice stack-aware con registry dei candidati, lane
   esplicite e status di eseguibilita distinti.

## Trade-off

- Opzione 1:
  - Pro: una sola pipeline di benchmark.
  - Contro: confronto tecnicamente scorretto tra `LLM`, `NER`, `PII` ed
    `encoder`; produce falsi negativi e falsi positivi.
- Opzione 2:
  - Pro: risultati piu vicini alla produzione.
  - Contro: costo alto upfront; rischio di introdurre nuove dipendenze,
    sidecar o egress prima di avere un criterio di selezione minimo.
- Opzione 3:
  - Pro: consente di testare subito i modelli generativi gia eseguibili nello
    stack e di tracciare in modo esplicito i candidati bloccati da
    integrazione, licenza o gating.
  - Contro: richiede mantenere una piccola tassonomia aggiuntiva dei candidati.

## Decisione

Adottiamo l'opzione 3.

Introduciamo una matrice di valutazione stack-aware con queste regole:

- i modelli generativi eseguibili tramite runtime chat locali espliciti
  (`ollama_chat`, `mlx_chat`) possono essere benchmarkati tramite il corpus e
  il validator di ADR 0027
- i report devono distinguere sempre runtime e modello; `mlx_chat` resta
  benchmark-only finche una decisione separata non ne promuove l'uso operativo
- i candidati non generativi vengono registrati con lane e status espliciti,
  senza essere forzati nel benchmark JSON
- gli status ammessi per la prima thin slice sono:
  - `runnable`
  - `integration_required`
  - `license_blocked`
  - `gated_access`
- nessun candidato introduce cloud, egress o nuove dipendenze applicative in
  questa fase

Stop-rule minime:

- un candidato generativo puo passare da benchmark a "challenger reale" solo se
  mantiene `contractValidRate >= 0.95`, `jsonValidRate >= 0.95` e nessun task
  sotto `0.90` sul corpus sintetico condiviso
- un candidato `NER` o `PII` puo passare a thin slice implementativa solo dopo
  un adapter locale dedicato e benchmark lane-specific
- un candidato encoder puo avanzare solo con licenza chiara e uso circoscritto
  a retrieval/reranking o classificazione locale

## First Thin Slice

1. Aggiungere un registry locale dei candidati del report e dei baseline gia
   presenti nello stack.
2. Riutilizzare `scripts/benchmark-ai-task-contracts.ts` per benchmarkare solo
   i candidati `generative + local_chat_runtime + runnable`.
3. Produrre un report unico che distingua:
   - modelli benchmarkati davvero
   - modelli mancanti nel runtime locale
   - modelli bloccati da integrazione/licenza/gating
4. Usare il report per decidere il prossimo adapter locale:
   `BioMistral` se si vuole un challenger generativo biomedicale,
   `HUMADEX` per `clinical_entities.v1`,
   `OpenMed PII` per `redaction.v1`.

## Fuori Scope

- sostituire il default runtime di produzione in questa ADR
- integrare subito Hugging Face/ONNX/Transformers nel web runtime
- introdurre servizi remoti per ICD, embeddings o de-identification
- valutazione clinica finale su dataset reali o PHI-containing
