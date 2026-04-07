<!-- Codex: created 2026-03-21 -->
# Valutazione Toolkit OpenMed vs stack AI MediFlow

Date: 2026-03-21  
Status: Exploratory note

## Scopo

Valutare se [OpenMed](https://openmed.life/) sia:

- un concorrente reale dello stack AI locale di MediFlow
- un toolkit integrabile in modo coerente con i vincoli del repository
- un candidato utile per una thin slice concreta post-`WUL-95`

Questa nota non cambia il runtime di produzione e non sostituisce le decisioni
gia fissate in [ADR 0013](./adr/0013-qwen35-default-text-only-medgemma-specialist.md),
[ADR 0012](./adr/0012-operator-reviewed-smart-import-from-patient-context.md) e
[ADR 0027](./adr/0027-ai-task-extraction-envelope-and-local-render.md).

## Fonti usate

Fonti esterne primarie:

- [openmed.life](https://openmed.life/)
- [OpenMed docs](https://openmed.life/docs/)
- [OpenMed Analyze Text Helper](https://openmed.life/docs/analyze-text/)
- [OpenMed Feature Map](https://openmed.life/docs/feature-map/)
- [OpenMed Testing & QA](https://openmed.life/docs/testing/)
- [OpenMed GitHub](https://github.com/maziyarpanahi/openmed)

Fonti interne MediFlow:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [PLANS.md](../PLANS.md)
- [docs/adr/0012-operator-reviewed-smart-import-from-patient-context.md](./adr/0012-operator-reviewed-smart-import-from-patient-context.md)
- [docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md](./adr/0013-qwen35-default-text-only-medgemma-specialist.md)
- [docs/adr/0027-ai-task-extraction-envelope-and-local-render.md](./adr/0027-ai-task-extraction-envelope-and-local-render.md)
- [lib/ai-service.ts](../lib/ai-service.ts)
- [lib/ai-task-contracts.ts](../lib/ai-task-contracts.ts)
- [lib/ai-summary-service.ts](../lib/ai-summary-service.ts)
- [lib/patient-smart-import-service.ts](../lib/patient-smart-import-service.ts)
- [lib/document-synthesis-service.ts](../lib/document-synthesis-service.ts)

## Cosa offre OpenMed

In base alle fonti pubbliche, OpenMed e un toolkit Python orientato a:

- `analyze_text(...)` per medical NER con output strutturati
- `extract_pii(...)` e `deidentify(...)` per redaction/de-identification
- REST service FastAPI/Docker con endpoint `GET /health`, `POST /analyze`,
  `POST /pii/extract`, `POST /pii/deidentify`
- model registry curato, batch processing, configuration profiles e test/smoke
  runner

Punti forti dichiarati pubblicamente:

- licenza Apache-2.0 del toolkit
- deploy self-hosted o on-prem
- supporto multilingua PII incluso italiano
- validazioni esplicite per identificativi nazionali, incluso `Codice Fiscale`
- forte investimento documentale su NER e PII

Punto da leggere con prudenza:

- il marketing parla anche di "LLMs" e "medical reasoning", ma le evidenze
  tecniche pubbliche viste qui sono molto piu solide su `NER`, `PII`,
  toolkit/servizio e meno su un path generativo JSON paragonabile al contratto
  `mediflow.ai.extract.v1`

Questa ultima frase e un'inferenza dai materiali pubblici consultati.

## Confronto con lo stack MediFlow attuale

### 1. Runtime generativo

MediFlow oggi ha gia:

- runtime locale `ollama` via [lib/ai-service.ts](../lib/ai-service.ts)
- default text-only fissato su `qwen3.5:35b-a3b` da
  [ADR 0013](./adr/0013-qwen35-default-text-only-medgemma-specialist.md)
- contratto condiviso `mediflow.ai.extract.v1` in
  [lib/ai-task-contracts.ts](../lib/ai-task-contracts.ts)
- benchmark locale e validator sul contratto introdotti in
  [ADR 0027](./adr/0027-ai-task-extraction-envelope-and-local-render.md)

OpenMed, per come e documentato pubblicamente, non sostituisce bene questa
lane:

- espone soprattutto token-classification e output NER
- non mostra un envelope generativo disciplinato comparabile al nostro
- non porta evidenza pubblica sufficiente, qui, per rimpiazzare la lane
  `extract -> render` gia consolidata

Verdetto: `non candidato primario` per il runtime generativo di MediFlow.

### 2. Smart Import e Document Synthesis

MediFlow oggi usa un LLM locale per:

- estrarre candidati reviewable da note, diario e documenti
- normalizzare verso shape task-specific dentro il contratto condiviso
- demandare il coding finale ai resolver locali

OpenMed puo aiutare, ma non come drop-in:

- il suo `analyze_text(...)` produce entita e confidence
- non produce direttamente le shape cliniche reviewable che MediFlow si aspetta
- non conosce di default i vincoli locali `ICD/AIFA/esenzioni`

Verdetto: `integrabile come enrich upstream`, non come sostituto diretto di
`smart import` o `document synthesis`.

### 3. PII / de-identification

Qui il fit e molto piu forte.

MediFlow oggi ha guardrail documentali forti su local-first e PHI-safe logging,
ma non ha ancora una lane dedicata e benchmarkata per redaction automatica.

OpenMed offre proprio:

- `extract_pii` / `deidentify`
- modelli PII per italiano
- validazione contestuale e pattern locali
- deploy locale/self-hosted

Verdetto: `miglior punto di integrazione emerso`.

### 4. NER clinico deterministico

OpenMed ha una suite NER estesa e ben documentata. Tuttavia, rispetto alla
nostra analisi precedente:

- per italiano clinico territoriale resta piu convincente
  `HUMADEX/italian_medical_ner` come primo candidato specializzato
- OpenMed resta comunque un benchmark tecnico utile come baseline
  `sidecar NER`

Verdetto: `interessante come baseline secondaria`, non come primo candidato
italiano-specifico.

## Matrice sintetica

| Lane | Stack MediFlow oggi | Fit OpenMed | Valutazione |
| --- | --- | --- | --- |
| Generative extraction contract | Forte | Basso/indiretto | Non usare come drop-in |
| Local patient insight render path | Forte | Assente | Nessun vantaggio |
| Smart import structured suggestions | Medio-forte | Medio come enrich upstream | Solo adapter dedicato |
| Document synthesis structured extraction | Medio-forte | Medio come enrich upstream | Solo adapter dedicato |
| PII / de-identification | Debole o assente come lane dedicata | Alto | Miglior thin slice |
| Biomedical/clinical NER | Assente come lane dedicata | Medio-alto | Valutare dopo PII |

## Rischi di integrazione

1. Il toolkit e Python-first. In MediFlow non va portato dentro il runtime
   Next.js: il pattern corretto e sidecar locale opzionale su `localhost`.
2. OpenMed supporta anche deployment SageMaker/AWS nelle sue superfici
   pubbliche. Per MediFlow questo va escluso: usare solo modalita self-hosted.
3. Il model registry di OpenMed consente discovery Hugging Face. In MediFlow non
   dobbiamo aprire download dinamici o scelta arbitraria di modelli remoti da
   UI/utente.
4. La lane PII deve essere benchmarkata prima su corpus sintetico italiano
   senza PHI reali.
5. L'output OpenMed va comunque trattato come non fidato e rimappato su un
   contratto nostro stabile.

## Raccomandazione

OpenMed non va trattato come concorrente del core AI stack MediFlow.

Va invece trattato come possibile `toolkit locale specializzato` per una lane
separata che oggi ci manca, soprattutto:

1. `redaction.v1` con OpenMed PII come sidecar locale
2. solo dopo, eventuale benchmark comparativo NER sidecar vs `HUMADEX`
3. nessun tentativo di sostituire il runtime generativo `ollama + mediflow.ai.extract.v1`

## Thin slice consigliata

### Slice A: OpenMed PII sidecar benchmark

Obiettivo:

- misurare se OpenMed migliora davvero il livello di privacy-by-default degli
  artifact AI locali

Confine:

- nessun impatto sulla UX paziente
- nessun uso cloud
- nessun cambio del default generativo

Deliverable minimi:

1. sidecar locale Docker o Python service solo su `127.0.0.1`
2. adapter MediFlow interno verso un contratto `redaction.v1`
   - foundation adapter interno poi formalizzato in [docs/adr/0041-openmed-redaction-shadow-adapter.md](./adr/0041-openmed-redaction-shadow-adapter.md)
3. corpus sintetico italiano con nomi, date, telefoni, indirizzi, `Codice Fiscale`
4. benchmark con:
   - recall sui PII critici
   - precision ragionevole
   - latenza locale
   - shape stabile dell'output

### Slice B: solo se Slice A passa

- confronto `OpenMed NER` vs `HUMADEX`
- decisione se introdurre `clinical_entities.v1` per arricchire `smart import`
  e `document synthesis`

## Decisione operativa proposta

- `Go` su esplorazione tecnica di OpenMed come sidecar `PII/redaction`
- `Hold` su NER fino a benchmark italiano lane-specific
- `No-go` come sostituto del runtime generativo attuale
