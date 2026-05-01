<!-- Codex: created 2026-03-22 -->
# Piano esecutivo per affidabilita stack AI

Date: 2026-03-22  
Status: Working execution plan

## Scopo

Tradurre in work package eseguibili il piano di affidabilita AI emerso da:

- [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md)
- [docs/adr/0027-ai-task-extraction-envelope-and-local-render.md](./adr/0027-ai-task-extraction-envelope-and-local-render.md)
- [docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md](./adr/0028-stack-aware-ai-model-evaluation-matrix.md)
- [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md)

Questo file e operativo, non architetturale:

- non sostituisce le ADR
- non cambia il default runtime
- non autorizza egress o cloud
- non rimuove review umana dai flussi clinici

## Invarianti da preservare

- `ollama` resta il runtime generativo locale di base
- `qwen3.5:35b-a3b` resta il default operativo finche un challenger non lo batte
  su benchmark lane-specific
- `mediflow.ai.extract.v1` resta l'envelope condiviso delle lane generative
- `Smart Import` resta reviewable e non silenzioso
- `Patient Insight` resta renderizzato localmente
- `ICD-11` non viene mai inventato: solo candidate list + selezione da resolver
- nessun PII o PHI lascia il dispositivo senza decisione esplicita documentata

## Ordine di esecuzione raccomandato

1. `AI-01` Benchmark resolver reali WHO/AIFA
2. `AI-02` Hardening Smart Import su therapy-state e apply policy
3. `AI-03` Corpus e scoring dedicati per AI Patient Insight
4. `AI-04` ADR + thin slice lane `PII/redaction`
5. `AI-05` Input normalization per PDF e CDA/CCD
6. `AI-06` Benchmark NER italiano deterministico
7. `AI-07` Challenger generativi e sizing deploy
8. `AI-08` Rollout, shadow mode e stop-rules

## Work packages

## AI-01 Resolver benchmark WHO/AIFA

### Obiettivo

Rendere benchmarkabile e misurabile la parte oggi piu fragile dello stack:

- query ICD-11 verso WHO
- match farmaci verso AIFA

### Scope

- benchmark headless del resolver WHO reale
- benchmark headless del resolver AIFA reale
- corpora sintetici per query cliniche realistiche
- metriche versionate e report salvabili

### Deliverable

- `scripts/benchmark-icd-resolver.*`
- `scripts/benchmark-aifa-resolver.*`
- corpora sintetici dedicati
- report markdown/json riusabili

### Metriche minime

- top-1 recall
- top-k recall
- latency avg/p95
- ambiguity rate
- false positive rate
- hallucination rate pari a zero sui codici finali selezionati

### Casi obbligatori

- query italiana pura
- query inglese pura
- query ibrida
- brand vs principio attivo
- strength uguale con packaging diverso
- terapia sospesa vs attiva

### Exit criteria

- benchmark ripetibile da CLI
- nessun codice ICD finale fuori dalla candidate list
- evidenza documentata dei casi ancora ambigui

### Dipendenze

- nessuna

## AI-02 Smart Import hardening

### Obiettivo

Ridurre gli errori clinicamente fastidiosi di `Smart Import`, in particolare:

- therapy-state negli switch
- distinzione `ready` vs `consultive`
- applicabilita reale dei suggerimenti

### Scope

- post-processing locale per switch terapeutici
- policy piu esplicita su `manual`, `blocked`, `uncertain`
- ulteriore stretta del contratto se necessaria
- test isolati su matcher e service

### Deliverable

- guardrail in [lib/patient-smart-import-service.ts](../lib/patient-smart-import-service.ts)
- eventuali helper in [lib/patient-smart-import-matching.ts](../lib/patient-smart-import-matching.ts)
- test aggiuntivi
- benchmark `smart-import` aggiornato

### Metriche minime

- `therapyStateRecall >= 0.95` sul corpus sintetico dedicato
- `contractValidRate >= 0.95`
- `dosageRecall >= 0.95`

### Exit criteria

- caso di switch “farmaco in uscita + farmaco in ingresso” stabile
- nessuna regressione su negazioni/familiarita
- preselezione UI solo su suggerimenti forti e applicabili

### Dipendenze

- `AI-01`

## AI-03 AI Patient Insight benchmark e scoring

### Obiettivo

Misurare in modo piu rigoroso la qualita di `AI Patient Insight`, non solo la
validita del JSON.

### Scope

- corpus dedicato
- scoring su recency/focus/tone/citations
- eventuale filtro locale anti-claim speculativi

### Deliverable

- corpus dedicato `patient_insight`
- benchmark/validator dedicato o estensione di quello esistente
- test su prompt contract
- report qualità sintetico

### Metriche minime

- recency focus rate
- unsupported-claim rate
- citation coverage rate
- moralizing/speculative rate

### Exit criteria

- i casi con problema attuale evidente non aprono piu su anamnesi remota
- i claim speculativi restano sotto soglia concordata

### Dipendenze

- nessuna bloccante

## AI-04 PII/redaction lane

### Obiettivo

Chiudere una lane privacy-first locale prima della generazione.

### Scope

- ADR dedicata prima dell'implementazione
- sidecar locale opzionale `127.0.0.1`
- adapter `redaction.v1`
- smoke e benchmark PII

### Deliverable

- ADR specifica `PII/redaction`
- adapter interno
- test e benchmark corpus italiano
- modalita shadow per confronto pre/post redazione

### Metriche minime

- recall PII critici
- forbidden leak rate
- latency avg/p95
- integrita offset mapping

### Exit criteria

- lane usabile in shadow mode
- nessun leak critico nei casi sintetici gold

### Dipendenze

- nessuna

## AI-05 Input normalization e parsing documentale

### Obiettivo

Ridurre l'eterogeneita degli input prima delle lane semantiche.

### Scope

- parsing tollerante per:
  - testo libero
  - PDF
  - CDA/CCD XML
- sectioning
- normalizzazione minima date/header/temporality/negations

### Deliverable

- parser/hint layer per input non uniformi
- test su XML e OCR rumoroso
- integrazione con `document_synthesis` e lane future

### Exit criteria

- input normalizzato riusabile e meno rumoroso
- parsing resistente su casi parziali o sporchi

### Dipendenze

- nessuna

## AI-06 NER clinico italiano deterministico

### Obiettivo

Capire se una lane spans-first italiana migliora auditabilita e coding.

### Scope

- benchmark di `HUMADEX/italian_medical_ner`
- confronto con baseline attuale
- valutazione utilita reale per resolver e review UI

### Deliverable

- harness NER dedicato
- corpus spans gold
- report comparativo

### Metriche minime

- span precision/recall
- evidence coverage
- impatto su coding top-k recall

### Exit criteria

- integrazione solo se aggiunge valore misurabile

### Dipendenze

- `AI-01`
- `AI-05`

## AI-07 Challenger generativi

### Obiettivo

Valutare challenger come `BioMistral` senza rompere la baseline.

### Scope

- benchmark contrattuale sui generativi runnable
- sizing deploy/quantizzazione
- eventuale shadow comparison su subset task

### Deliverable

- report comparativo con baseline
- decisione `keep as challenger` o `discard`

### Metriche minime

- `jsonValidRate >= 0.95`
- `contractValidRate >= 0.95`
- nessun task core sotto `0.90`
- latenza non peggiorata oltre soglia utile

### Exit criteria

- nessun challenger diventa default senza battere la baseline
- stato corrente `2026-04-08`: il primo challenger MLX misurato davvero,
  `Jackrong/MLX-Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-v2-4bit`,
  resta `keep as challenger` solo `benchmark-only` perche passa il corpus
  contrattuale condiviso ma resta sotto `qwen3.5:35b-a3b` su `smart_import`
- stato corrente `2026-04-08`: `TurboQuant` non entra come semplice challenger
  modello; la sola strada sensata oggi e un prototipo benchmark-only di
  serving/KV-cache quantization su runtime isolati `Ollama` o `MLX`
- stato corrente `2026-04-08`: esiste ora un primo runner `MLX`
  benchmark-only per A/B `baseline` vs `kv_bits`, ma il primo smoke attuale e
  solo tecnico e non cambia la decisione di promozione

### Dipendenze

- `AI-01`
- `AI-02`
- `AI-03`

## AI-08 Rollout e shadow mode

### Obiettivo

Portare le lane migliorate in uso senza regressioni silenziose.

Runbook canonico:

- [docs/ai-rollout-governance.md](./ai-rollout-governance.md)

Stato implementativo:

- chiuso come governance minima in `WUL-111` tramite i child `WUL-133`..`WUL-144`
- nessuna promozione automatica delle lane `benchmark-only`

### Scope

- shadow mode
- logging PHI-safe
- fallback deterministici
- kill-switch operativi

### Deliverable

- check di rollout
- policy di fallback
- criteri di rollback
- runbook lane-aware scritto su disco
- validator CLI locale di readiness/rollout
- artifact locali persistiti (`json` + `markdown`) per ogni verdict lane-aware
- surface read-only in `Settings`, guard notice sui model selector e kill-switch
  UI-driven per le lane productized

### Stop-rules

- blocco automatico se compare un codice ICD non presente nella candidate list
- rollback se la lane PII perde PII critici oltre soglia
- blocco deploy per modelli con licenza non chiara
- blocco rollout se `therapyState` su switch resta sotto soglia

### Exit criteria

- degradazione sicura e reversibile

### Dipendenze

- tutte le fasi precedenti rilevanti

## Artefatti da produrre per ogni work package

- codice
- corpus sintetico
- benchmark/test runner
- report di esecuzione
- se serve, ADR dedicata
- aggiornamento doc index e `PLANS.md`

## Cosa non fare in questo programma

- non aprire nuovi sidecar senza benchmark e corpus
- non introdurre cloud come scorciatoia
- non passare a coding automatico non reviewable
- non cambiare il default model solo per intuizione
- non mescolare lane privacy, NER, coding e insight nello stesso benchmark
