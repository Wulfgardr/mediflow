<!-- Codex: created 2026-03-23 -->
# Benchmark `clinical_entities.v1`

Date: 2026-03-23  
Status: Working benchmark note

## Scopo

Documentare come eseguire la thin slice `clinical_entities.v1` di `WUL-96`
senza toccare il runtime applicativo MediFlow.

Questa lane segue:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [PLANS.md](../PLANS.md)
- [ADR 0030](./adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md)
- [ADR 0031](./adr/0031-clinical-entities-evidence-first-medication-problem-lane.md)

Il benchmark resta:

- locale
- corpus-only
- synthetic-only
- evidence-first

## Contratto locale

Lo scaffold usa [lib/clinical-entities-contracts.ts](../lib/clinical-entities-contracts.ts)
e richiede:

- `schemaVersion = mediflow.clinical_entities.v1`
- sole entity class `problem` e `medication`
- `text`, `evidence`, `start`, `end` ancorati al testo sorgente
- offset UTF-16 allineati a JS/Node

## Policy gold del corpus

Il corpus attuale `v2` misura solo:

- `problem`
- `medication`

Regole gold correnti:

- includere tutti i problemi e farmaci espliciti nel testo, non solo il
  "problema principale"
- mantenere match evidence-first su span espliciti, senza fuzzy matching
- escludere `TEST` diagnostici, route/frequenza, verbi di contesto e parole
  come `Terapia` quando non rappresentano una entity clinica autonoma

Questo spiega perche alcune emissioni restano falsi positivi anche se
clinicamente "plausibili" ma non sono la entity target della thin slice.

## Candidato attuale

Primo adapter reale: `HUMADEX/italian_medical_ner`.

Fonti primarie usate:

- model card Hugging Face:
  [HUMADEX/italian_medical_ner](https://huggingface.co/HUMADEX/italian_medical_ner)
- config Hugging Face:
  [config.json](https://huggingface.co/HUMADEX/italian_medical_ner/raw/main/config.json)

Fatti tecnici rilevanti:

- `pipeline_tag = token-classification`
- label family `PROBLEM`, `TREATMENT`, `TEST`
- `config.json` usa BIOES (`B/I/E/S-*`)

Inferenza applicata nel benchmark:

- `PROBLEM -> problem`
- `TREATMENT -> medication`
- `TEST` fuori scope nella thin slice attuale

Questa mappatura e un adapter benchmark-only, non una decisione runtime.

## Setup locale

Prerequisiti minimi:

- `python3.12`
- installazione locale di `torch`, `transformers`, `safetensors`

Setup consigliato:

```bash
python3.12 -m venv .venv_humadex
.venv_humadex/bin/pip install --upgrade pip
.venv_humadex/bin/pip install torch transformers safetensors
```

Nota:

- il primo bootstrap puo scaricare il modello da Hugging Face se non e gia in
  cache locale
- questo download e benchmark-only, fuori dal runtime app, e non introduce
  dipendenze cloud di default in MediFlow
- l'adapter imposta `HF_HUB_DISABLE_TELEMETRY=1`

Variabili opzionali:

- `MEDIFLOW_HUMADEX_PYTHON=/path/to/python`
- `MEDIFLOW_HUMADEX_MODEL=HUMADEX/italian_medical_ner`
- `MEDIFLOW_HUMADEX_DEVICE=cpu|mps`
- `MEDIFLOW_HUMADEX_LOCAL_FILES_ONLY=1`
- `MEDIFLOW_HUMADEX_CONFIDENCE_THRESHOLD=0.0`

Per la baseline secondaria OpenMed:

```bash
python3.12 -m venv .venv_openmed
.venv_openmed/bin/pip install --upgrade pip
.venv_openmed/bin/pip install "openmed[hf]==0.6.3"
```

Variabili opzionali OpenMed:

- `MEDIFLOW_OPENMED_PYTHON=/path/to/python`
- `MEDIFLOW_OPENMED_DISEASE_MODEL=disease_detection_superclinical`
- `MEDIFLOW_OPENMED_PHARMA_MODEL=pharma_detection_superclinical`
- `MEDIFLOW_OPENMED_DEVICE=cpu|mps`
- `MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD=0.0`

## Comandi

Gold adapter:

```bash
npm run benchmark:clinical-entities
```

HUMADEX:

```bash
npm run benchmark:clinical-entities:humadex
```

OpenMed baseline:

```bash
npm run benchmark:clinical-entities:openmed
```

Repeatability:

```bash
npm run benchmark:clinical-entities:repeat:humadex -- --runs 5
npm run benchmark:clinical-entities:repeat:openmed -- --runs 5
```

Promotion gate:

```bash
npm run validate:clinical-entities:humadex
npm run validate:clinical-entities:openmed
```

Output:

- metriche aggregate
- dettagli per-case
- `missingEntities`
- `unexpectedEntities`

Il gate `promotionReady` richiede:

- `contractValidRate = 1`
- `evidenceCoverage = 1`
- `criticalRecall = 1` su ogni case gold
- zero `unexpectedEntities` sui case negativi

## Stato corrente

Il gold adapter passa sul corpus sintetico dedicato.

Corpus attuale: `v2`, 10 casi sintetici italiani.

### `HUMADEX/italian_medical_ner`

Misurazione reale, stabile su 5 run:

- `contractValidRate = 1`
- `spanPrecision = 0.6`
- `spanRecall = 0.7`
- `criticalRecall = 0.7`
- `evidenceCoverage = 1`
- `avgLatencyMs ~= 412.8`
- `p95LatencyMs ~= 2220.3`
- `negativeCaseLeakRate = 1`

Segnali qualitativi:

- buoni recuperi su `diabete mellito tipo 2`, `metformina 850 mg`,
  `denosumab 60 mg`, `salmeterolo/fluticasone`, `apixaban 5 mg`
- falsi positivi contestuali ricorrenti su `Terapia`, `una`, `inalazione`
- under-span residui su alcuni problemi (`dispnea` vs `dispnea da sforzo`,
  `trombosi venosa` vs `trombosi venosa profonda`)
- rumore sui case negativi/lab-only
- il gate fallisce in modo ripetibile su sei case, inclusi il negative set
  `labs-no-entities` e problemi composti come `Scompenso cardiaco cronico`,
  `Lombalgia meccanica` e `trombosi venosa profonda`

### `OpenMed NER` baseline secondaria

Configurazione misurata:

- `disease_detection_superclinical`
- `pharma_detection_superclinical`
- `openmed==0.6.3`

Misurazione reale, stabile su 5 run:

- `contractValidRate = 1`
- `spanPrecision = 0.5`
- `spanRecall = 0.6`
- `criticalRecall = 0.6`
- `evidenceCoverage = 1`
- `avgLatencyMs ~= 981.5`
- `p95LatencyMs ~= 5041.8`
- `negativeCaseLeakRate = 1`

Segnali qualitativi:

- buona copertura sui casi piu semplici
- tende ad accorciare i problemi composti (`Osteoporosi` invece di
  `Osteoporosi post-menopausale`, `fibrillazione atriale` invece di
  `fibrillazione atriale permanente`)
- rumore specifico sui lab come `Creatinina 1,0 mg` e `Hb 13,4 g`, emessi come
  `medication`
- nel caso BPCO arriva anche a misclassificare `BPCO` come `medication`
- il gate fallisce in modo ripetibile su otto case, con negative set leak e
  recall critico sotto soglia su piu problemi composti

### Verdetto corrente

- `HUMADEX` resta il primo candidato della lane `clinical_entities.v1`
- `OpenMed NER` ha valore come baseline secondaria, ma oggi sottoperforma
  rispetto a `HUMADEX` sullo stesso harness
- la benchmark stack della lane e ora abbastanza consolidata da sostenere una
  decisione: benchmark comparativo, repeatability a 5 run e promotion gate
  danno tutti lo stesso esito
- la lane resta `benchmark-only` per entrambi: nessun adapter e
  `promotionReady`, per falsi positivi sui negative set e under-span su
  problemi composti/clinicamente importanti
