<!-- Codex: created 2026-03-23 -->
# ADR 0030: OpenMed redaction first, Italian NER as a separate benchmark lane

Date: 2026-03-23  
Status: Proposed

## Problema

Il filone `WUL-96` deve confrontare candidati specialistici esterni senza
rompere il backbone gia deciso per le lane generative locali.

Il rischio attuale e doppio:

- trattare `OpenMed` come concorrente drop-in di `qwen`/`MedGemma`
- mescolare nello stesso benchmark lane tecnicamente diverse (`PII`, `NER`,
  `LLM`, resolver/coding)

Questo produce confronti scorretti e spinge integrazioni premature fuori dai
confini local-first del repository.

## Contesto

- [ARCHITECTURE.md](../../ARCHITECTURE.md) richiede contratti espliciti, diff
  piccoli e niente dipendenze cloud di default.
- [SECURITY.md](../../SECURITY.md) richiede output AI non fidato, solo corpus
  sintetici e nessun egress implicito.
- [PLANS.md](../../PLANS.md) separa gia `AI-04` (`PII/redaction`) da `AI-06`
  (`NER clinico italiano deterministico`).
- [docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md](./0028-stack-aware-ai-model-evaluation-matrix.md)
  vieta di forzare `PII` e `NER` nel benchmark generativo `ollama`.
- [docs/adr/0029-ai-model-parliament-and-local-retention-policy.md](./0029-ai-model-parliament-and-local-retention-policy.md)
  esclude lane `PII`, `NER` ed `embedding` dal parlamento dei generativi.
- [docs/openmed-toolkit-evaluation.md](../openmed-toolkit-evaluation.md)
  conclude che `OpenMed` ha fit forte per `redaction.v1`, mentre per `NER`
  resta solo baseline secondaria.
- [docs/ai-stack-execution-plan.md](../ai-stack-execution-plan.md) e
  [docs/ai-stack-reliability-review.md](../ai-stack-reliability-review.md)
  chiedono shadow mode, corpus versionati e stop-rules lane-specific.

## Opzioni

1. Confrontare `OpenMed`, `HUMADEX` e i generativi nello stesso benchmark.
2. Usare `OpenMed` come primo candidato sia per `PII` sia per `NER`.
3. Separare `WUL-96` in lane benchmark distinte: `OpenMed` prima su
   `redaction.v1`, poi `HUMADEX` come primo confronto NER italiano, con
   `OpenMed NER` solo come baseline secondaria.

## Trade-off

- Opzione 1:
  - Pro: una sola pipeline.
  - Contro: confronto tecnicamente scorretto, metriche poco leggibili e drift
    architetturale immediato.
- Opzione 2:
  - Pro: riduce il numero di toolkit esplorati.
  - Contro: ignora il fit migliore emerso dalle note esistenti e sacrifica la
    priorita italiana della lane NER.
- Opzione 3:
  - Pro: mantiene benchmark e contratti coerenti per lane, preserva il backbone
    generativo e rende chiari corpus, metriche ed exit criteria.
  - Contro: richiede due harness separati e una sequenza piu disciplinata.

## Decisione

Adottiamo l'opzione 3.

Per `WUL-96` valgono queste regole:

- `OpenMed` entra prima solo nella lane `PII/redaction`
- il contratto locale della thin slice e `mediflow.redaction.v1`
- la lane `NER` resta separata e non blocca la redaction
- `HUMADEX/italian_medical_ner` e il primo candidato NER italiano
- `OpenMed NER` puo essere benchmarkato solo come baseline secondaria
- nessun confronto diretto `OpenMed` vs `qwen`/`MedGemma` e ammesso nella stessa
  gara
- ogni lane richiede corpus sintetico dedicato, benchmark CLI dedicato e shadow
  mode prima di qualunque uso operativo

## Conseguenze

Diventa piu semplice:

- misurare `OpenMed` dove ha davvero fit, cioe privacy/redaction
- mantenere `ollama + mediflow.ai.extract.v1` fuori da confronti impropri
- decidere la lane NER con metriche italiane e non per analogia

Diventa piu difficile:

- accelerare integrazioni speculative in un unico benchmark
- promuovere `OpenMed NER` senza prima verificare il candidato italiano

## First Thin Slice

1. Introdurre il benchmark scaffold `redaction.v1` con corpus sintetico italiano
   e report di `contractValidRate`, `entityRecall`, `criticalRecall`,
   `forbiddenLeakRate`, `offsetIntegrityRate`, `avgLatencyMs`,
   `p95LatencyMs`.
2. Lasciare l'adapter OpenMed fuori dal runtime applicativo e collegarlo solo a
   un harness CLI locale o a un futuro sidecar `127.0.0.1`.
3. Rimandare la lane `clinical_entities.v1` a un harness dedicato, con
   `HUMADEX` primo candidato e `OpenMed NER` baseline secondaria.
4. Fissare `start/end` di `redaction.v1` come offset UTF-16 code-unit allineati
   a JS/Node, cosi il benchmark e gli adapter cross-runtime usano la stessa
   semantica.

## Fuori Scope

- sostituire il runtime generativo locale
- cambiare il default `qwen3.5:35b-a3b`
- introdurre cloud, download dinamici o discovery modelli da UI
- attivare redaction o NER sul traffico utente reale in questa thin slice
