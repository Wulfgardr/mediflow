<!-- Codex: created 2026-03-22 -->
# Stato attuale e affidabilita dello stack AI MediFlow

Date: 2026-03-22  
Status: Working technical note

## Scopo

Fissare in un unico documento:

- lo stato reale dello stack AI locale MediFlow
- le decisioni gia prese e i relativi vincoli
- i problemi incontrati davvero durante l'integrazione
- i benchmark gia eseguiti
- i colli di bottiglia attuali
- le soluzioni consigliate per rendere il sistema piu affidabile

Questa nota non sostituisce le ADR gia approvate. Le decisioni normative restano
quelle in:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [ADR 0011](./adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md)
- [ADR 0012](./adr/0012-operator-reviewed-smart-import-from-patient-context.md)
- [ADR 0013](./adr/0013-qwen35-default-text-only-medgemma-specialist.md)
- [ADR 0018](./adr/0018-ai-insight-full-auto-and-pro-settings.md)
- [ADR 0020](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md)
- [ADR 0027](./adr/0027-ai-task-extraction-envelope-and-local-render.md)
- [ADR 0028](./adr/0028-stack-aware-ai-model-evaluation-matrix.md)

Per la sequenza operativa dei work package usa
[docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md).

Per il failure mode documentale emerso sul campo il 2026-04-03, con recovery
locale di allegati PDF e insight finale, usa anche
[docs/patient-insight-document-troubleshooting.md](./patient-insight-document-troubleshooting.md).

## Executive summary

Lo stack AI MediFlow oggi e coerente, ma non ancora omogeneamente affidabile.

Il quadro corrente e questo:

1. la lane generativa locale `ollama` resta la base del sistema
2. `qwen3.5:35b-a3b` resta il miglior default operativo text-only
3. il contratto condiviso `mediflow.ai.extract.v1` ha ridotto il drift fra
   `AI Patient Insight`, `Smart Import` e `Document Synthesis`
4. `Smart Import` va tenuto, ma ristretto a `clinical coding assistant`
   reviewable, non trattato come reasoner clinico generale
5. `OpenMed` ha senso come lane separata `PII/redaction`, non come sostituto
   del runtime generativo

La fragilita residua non e piu soprattutto "il modello sbaglia tutto", ma:

- routing locale e configurazione target runtime
- differenza fra output generativo e resolver locali `ICD/AIFA`
- therapy-state nelle transizioni
- corpora e benchmark ancora troppo piccoli su alcune lane
- quality gap misurabili sui resolver reali `ICD/AIFA`, soprattutto query
  italiane pure WHO e matching `strength/packaging` AIFA

## Stack attuale

### 1. Runtime generativo locale

Componente base:

- [lib/ai-service.ts](../lib/ai-service.ts)

Scelte gia fissate:

- provider operativo: `ollama`
- default text-only: `qwen3.5:35b-a3b`
- no cloud dependency di default
- output AI trattato come non fidato

Ruolo nel sistema:

- generation task per `AI Patient Insight`
- extraction task per `Smart Import`
- extraction/synthesis task per `Document Synthesis`

### 2. OCR e document understanding

Componenti principali:

- [lib/document-synthesis-service.ts](../lib/document-synthesis-service.ts)
- [lib/document-synthesis-parser.ts](../lib/document-synthesis-parser.ts)
- [ADR 0011](./adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md)

Modello/lane:

- OCR locale specialistico
- post-processing generativo su testo OCR

Vincolo importante:

- l'autofill automatico resta limitato ai soli ICD espliciti presenti nel
  documento

### 3. AI Patient Insight

Componenti principali:

- [lib/ai-summary-service.ts](../lib/ai-summary-service.ts)
- [lib/ai-context.ts](../lib/ai-context.ts)
- [ADR 0018](./adr/0018-ai-insight-full-auto-and-pro-settings.md)
- [ADR 0020](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md)

Stato attuale:

- usa il contratto condiviso `mediflow.ai.extract.v1`
- il modello produce extraction JSON
- il render markdown finale e locale, non delegato al modello

### 4. Smart Import

Componenti principali:

- [lib/patient-smart-import-service.ts](../lib/patient-smart-import-service.ts)
- [components/patient-smart-import-panel.tsx](../components/patient-smart-import-panel.tsx)
- [ADR 0012](./adr/0012-operator-reviewed-smart-import-from-patient-context.md)

Ruolo corretto:

- estrarre diagnosi correnti o gestionalmente rilevanti
- estrarre farmaci e posologie
- confrontare i candidati con i resolver locali
- lasciare sempre review umana sull'applicazione finale

Ruolo scorretto:

- dedurre piani clinici ampi
- fare counselling generico
- agire come mini-EMR reasoner

### 5. Contratto condiviso AI

Componente principale:

- [lib/ai-task-contracts.ts](../lib/ai-task-contracts.ts)

Base decisionale:

- [ADR 0027](./adr/0027-ai-task-extraction-envelope-and-local-render.md)

Envelope minimo:

```json
{
  "schemaVersion": "mediflow.ai.extract.v1",
  "task": "patient_insight|smart_import|document_synthesis",
  "summary": "stringa breve oppure vuota",
  "data": {}
}
```

Effetto pratico:

- parser e benchmark omogenei
- JSON validity e contract validity misurabili
- separazione netta fra extraction e render locale

### 6. Benchmark e challenger matrix

Componenti principali:

- [scripts/benchmark-ai-task-contracts.ts](../scripts/benchmark-ai-task-contracts.ts)
- [scripts/benchmark-smart-import.ts](../scripts/benchmark-smart-import.ts)
- [scripts/fixtures/ai-task-contract-corpus.json](../scripts/fixtures/ai-task-contract-corpus.json)
- [scripts/fixtures/smart-import-benchmark-corpus.json](../scripts/fixtures/smart-import-benchmark-corpus.json)
- [ADR 0028](./adr/0028-stack-aware-ai-model-evaluation-matrix.md)

Decisione chiave:

- non confrontare nello stesso benchmark generativo modelli `LLM`, `PII`,
  `NER` ed `encoder`
- benchmarkare i generativi `ollama` nel contratto condiviso
- trattare PII/NER come lane dedicate con benchmark propri

#### Snapshot 2026-04-02: Gemma 4 su `M4 Max 36 GB`

Workstream:

- `WUL-132`

Contesto pratico:

- la build stabile locale `Ollama 0.19.0` non riesce ancora a pullare i
  manifest `Gemma 4`
- il benchmark reale e quindi stato eseguito su una build `HEAD` isolata di
  `ollama`, esposta solo su `127.0.0.1:11435`, senza sostituire il runtime
  operativo di default dell'app
- i modelli effettivamente benchmarkati sono stati:
  - `gemma4:e2b`
  - `gemma4:e4b`
  - baseline `qwen3.5:35b-a3b`

Esito sintetico:

- **shared contract chamber**:
  - `gemma4:e2b` e `gemma4:e4b` passano `jsonValidRate=1` e
    `contractValidRate=1` sul corpus condiviso
  - `qwen3.5:35b-a3b` resta piu fragile sul benchmark contrattuale generale
    (`0.857/0.857` nello sweep osservato)
- **patient insight dedicated benchmark**:
  - `qwen3.5:35b-a3b` resta il migliore per qualita clinica/focus
    (`focusRecall=0.95`, `preferredSourceCoverage=1`)
  - `gemma4:e4b` e promettente e molto piu veloce
    (`focusRecall=0.8`, `preferredSourceCoverage=0.933`,
    `avgLatencyMs=11662`), ma non supera ancora la baseline
  - `gemma4:e2b` e veloce e disciplinato nel contratto, ma troppo debole sulla
    resa insight (`focusRecall=0.35`, `currentStateRecall=0`)
- **smart import / parliament fit**:
  - nessun modello passa oggi entrambe le chamber
  - `gemma4:e2b` fallisce soprattutto su `diagnosisRecall=0.4`,
    `diagnosisQueryRecall=0.2`, `therapyStateRecall=0.6`
  - `gemma4:e4b` migliora nettamente su `e2b`, ma fallisce ancora su
    `diagnosisQueryRecall=0.9`, `therapyStateRecall=0.6` e leak proibiti
    (`forbiddenLeakRate=0.222`)
  - il parliament resta quindi in stato `hold` e mantiene
    `qwen3.5:35b-a3b` come baseline protetta

Decisione corrente:

- tenere `gemma4:e4b` come challenger locale promettente
- tenere `gemma4:e2b` solo come baseline di robustezza/latency, non come
  candidato operativo per task clinici complessi
- lasciare `gemma4:26b` e `gemma4:31b` in `hold` finche non viene giustificato
  il sizing sul Mac corrente
- non cambiare il default operativo per intuizione: `qwen3.5:35b-a3b` resta il
  modello protetto fino a superamento reale delle lane `patient_insight` e
  `smart_import`

### 7. Lane OpenMed esplorata

Riferimento:

- [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md)

Conclusione corrente:

- `OpenMed` non e un sostituto del runtime generativo MediFlow
- e un buon candidato per una lane separata `redaction.v1`

## Struggle reali incontrati

## 1. 405 su tutto lo stack AI web

Problema osservato:

- `AI Patient Insight` e `Smart Import` restituivano
  `AI Provider Error (405): {"error":"Ollama Error: Method Not Allowed"}`

Root cause:

- il target Ollama configurato lato client non veniva propagato coerentemente
  alle route proxy
- i proxy `ollama/chat` e `ollama/generate` cadevano su env/default target e
  non sul target effettivamente impostato

Fix applicato:

- propagazione `x-target-url` dal client AI
- normalizzazione dei suffix `/v1`, `/api/chat`, `/api/generate`
- allineamento anche della pagina settings per listing/pull modelli

File coinvolti:

- [lib/ai-service.ts](../lib/ai-service.ts)
- [app/api/proxy/ollama/chat/route.ts](../app/api/proxy/ollama/chat/route.ts)
- [app/api/proxy/ollama/generate/route.ts](../app/api/proxy/ollama/generate/route.ts)
- [app/settings/page.tsx](../app/settings/page.tsx)

Lezione:

- affidabilita AI locale non significa solo "modello giusto": il transport layer
  verso il runtime locale e parte del prodotto

## 2. AI Patient Insight troppo storico, moralizzante e poco operativo

Problema osservato:

- il sommario iniziale apriva da anamnesi remota e codici storici
- produceva claim tipo "alta fragilita" o counselling generico da tabacco/alcol
- non dava la giusta priorita al problema clinico attuale

Caso concreto discusso:

- paziente con frattura pertrocanterica recente ma output centrato su pregresso
  oncologico, obesita, tabacco, alcol

Correzione introdotta:

- priorita esplicita a documenti recenti, diario recente, osservazioni recenti e
  controlli pendenti
- divieto di etichette inferite o moralizzanti se non supportate
- storia remota solo se cambia davvero la gestione attuale

Lezione:

- per `Patient Insight` il problema non era solo il modello, ma il contratto
  clinico dato al modello

## 3. Smart Import troppo largo rispetto al problema reale

Problema osservato:

- feature percepita come fragile e poco adeguata
- troppo vicina a un importer semantico generico
- troppo lontana da un vero assistente di coding clinico

Root cause principali:

- confine clinico troppo ambiguo
- match AIFA non abbastanza dosage-aware
- query ICD non abbastanza allineate al lookup WHO locale
- preselezione UI troppo permissiva

Correzione introdotta:

- prompt piu stretto su patologie correnti/rilevanti e terapie esplicite
- migliore allineamento `icdQuery` -> WHO ICD-11 English-first
- preselezione UI solo per suggerimenti forti
- matcher AIFA dosage-aware
- benchmark dedicato Smart Import

File chiave:

- [lib/ai-task-contracts.ts](../lib/ai-task-contracts.ts)
- [lib/patient-smart-import-matching.ts](../lib/patient-smart-import-matching.ts)
- [lib/patient-smart-import-service.ts](../lib/patient-smart-import-service.ts)
- [components/patient-smart-import-panel.tsx](../components/patient-smart-import-panel.tsx)

## 4. Benchmark "tutto contro tutto" non utile

Problema osservato:

- c'era il rischio di confrontare nello stesso piano modelli generativi, NER,
  PII ed encoder

Decisione presa:

- matrice stack-aware con lane separate
- benchmark reale solo dove il confronto e tecnicamente corretto

Lezione:

- senza segmentazione per lane si ottengono confronti inutili e scelte sbagliate

## Benchmark e risultati utili

## 1. Benchmark contrattuale Smart Import

Comando:

```bash
npm run benchmark:smart-import -- --iterations 1 --models qwen3.5:35b-a3b
```

Run eseguito:

- 2026-04-07 23:32 Europe/Rome

Corpus:

- [scripts/fixtures/smart-import-benchmark-corpus.json](../scripts/fixtures/smart-import-benchmark-corpus.json)

Risultati del run:

- `jsonValidRate`: `1.0`
- `contractValidRate`: `1.0`
- `diagnosisRecall`: `0.9`
- `diagnosisQueryRecall`: `0.8`
- `therapyRecall`: `1.0`
- `dosageRecall`: `1.0`
- `therapyStateRecall`: `1.0`
- `sourceIdRate`: `1.0`
- `reviewUsefulnessRate`: `0.9`
- `forbiddenLeakRate`: `0.0`
- `alreadyPresentLeakRate`: `0.444`
- `avgLatencyMs`: `13538.9`
- `p95LatencyMs`: `23830.7`

Interpretazione:

- il contratto e stabile
- il benchmark `smart-import` ora misura la lane dopo la normalizzazione locale
  di `therapyState` e il filtro runtime dei duplicati `already-present`
  in contesto “nessuna novita clinica”
  del `therapyState`, non solo il JSON grezzo del modello
- l'hardening `AI-02` raggiunge i gate operativi su `therapyState` e dosaggio
- il residuo piu rumoroso non e piu sugli switch, ma sui referral senza novita
  clinica, che possono ancora produrre suggerimenti review-only inutili

Guardrail chiusi in `AI-02`:

- normalizzazione locale del farmaco in uscita da `inactive` a `transition`
  quando l'evidenza documenta un passaggio terapeutico
- terapie `manual-only` tenute consultive e non direttamente applicabili
- terapie `catalog` senza posologia utile tenute consultive e non persistibili
- titolazioni posologiche riportate come update/`active`, non come switch
- terapie proposte o a breve rivalutazione tenute `uncertain`

Conclusione:

- Smart Import oggi e usabile come extractor reviewable
- i gate `AI-02` su `therapyStateRecall`, `contractValidRate` e `dosageRecall`
  sono chiusi sul baseline locale `qwen3.5:35b-a3b`
- il referral-only `smart-import-referral-known-condition-should-not-create-import-noise`
  non perde piu nel benchmark visibile (`forbiddenLeakRate = 0`)
- il residuo principale si sposta sui leak `already-present` ancora review-only
  in alcuni casi `discharge-letter`, `specialist-report` e `rehab-adi`

## 2. Benchmark OpenMed PII / redaction

Riferimento:

- [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md)

Run esplorativo riportato:

- installazione locale `openmed[hf,service]==0.6.3`
- smoke `GET /health`
- prove reali `POST /pii/extract` e `POST /pii/deidentify`

Risultati sintetici:

- `extract recall`: `0.975`
- `extract criticalRecall`: `0.971`
- `deidentify default recall`: `0.825`
- `deidentify tuned(0.5) recall`: `0.975`
- `deidentify tuned(0.5) criticalRecall`: `0.971`
- latenza warm `extract`: circa `26.5 ms avg`
- latenza warm `deidentify tuned`: circa `22.0 ms avg`

Miss residuo osservato:

- indirizzo `Viale Europa 5`

Conclusione:

- forte fit per lane `redaction.v1`
- fit debole come sostituto del runtime generativo

## 3. Patient Insight

Per `Patient Insight` il risultato principale non e stato un benchmark numerico
strutturato, ma il miglioramento di affidabilita del contratto clinico:

- meno enfasi su anamnesi remota
- piu focus sul problema attuale
- meno claim inferiti
- render finale mantenuto locale

Questo punto resta da misurare meglio con un corpus dedicato piu ampio.

## Colli di bottiglia attuali

## 1. Resolver reali WHO / AIFA non ancora benchmarkati headless abbastanza

Oggi abbiamo:

- benchmark del contratto generativo
- test mirati sul matcher Smart Import

Manca ancora:

- benchmark end-to-end headless del resolver WHO locale
- benchmark end-to-end headless del resolver AIFA locale
- metriche di precision/false positives su corpus piu estesi

Questo e probabilmente il collo di bottiglia piu importante per `Smart Import`.

## 2. Therapy state nelle transizioni

Il modello tende ancora a leggere il farmaco "in uscita" come `inactive`
anziche `transition` quando la frase contiene sia sospensione sia passaggio.

Conseguenza:

- rischio di classificazione semantica imperfetta nelle modifiche terapia

Soluzione suggerita:

- post-processing locale che alzi a `transition` il farmaco in uscita se la
  stessa evidenza contiene anche un `passare a ...`

## 3. Latenza locale ancora alta sui benchmark task-specific

Sul benchmark Smart Import:

- media circa `36.5s`
- `p95` circa `56.0s`

Questo e accettabile per benchmark, non ancora ideale per UX se l'operatore
vuole risposte immediate.

Leve possibili:

- prompt piu corti
- riduzione del numero di fonti per lane
- caching migliore lato resolver e lato AI
- challenger model piu piccolo solo se non degrada il contratto

## 4. Copertura benchmark non uniforme fra le lane

Abbiamo oggi una buona base per:

- contract validity
- Smart Import quality sintetica
- PII redaction esplorativa

Siamo ancora deboli su:

- insight quality benchmark strutturato
- document synthesis quality benchmark lane-specific
- regressioni browser end-to-end su flussi AI completi

## Soluzioni consigliate per aumentare l'affidabilita

## Priorita 1 completata: benchmarkare i resolver locali veri

Stato `2026-04-07`:

1. benchmark headless WHO ICD-11 disponibile e rieseguibile da CLI
2. benchmark headless AIFA disponibile e rieseguibile da CLI
3. evidenza dei gap residui ora esplicita in
   [docs/resolver-benchmark.md](./resolver-benchmark.md)

Snapshot corrente:

- WHO overall: `top1/topKRecall = 0.714`, con gap confinato alle query
  italiane pure
- AIFA overall: `top1/topKMatchRate = 0.429`, `noResultRate = 0.571`,
  `stateBlindHitRate = 1`, quindi resolver ancora catalog-first e non
  dosage/packaging-aware

Motivo:

- il collo di bottiglia residuo non e piu l'assenza di harness, ma la qualita
  semantica dei resolver locali

## Priorita 2: aggiungere guardrail locali post-model

Da fare:

- `Patient Insight`: filtro finale contro claim troppo speculativi
- `Smart Import`: filtro piu severo sui referral/documenti che non introducono
  novita cliniche ma solo continuita di problemi/terapie gia noti

Motivo:

- alcune regressioni non richiedono un modello migliore, ma un post-processing
  locale piu severo

## Priorita 3: ampliare i corpora sintetici lane-specific

Da fare:

- piu casi `Patient Insight` con conflitto fra storia remota e problema attuale
- piu casi `Smart Import` con negazioni, familiarita, switch e dosaggi simili
- piu casi `Document Synthesis` con OCR sporco e codici ICD espliciti/parziali
- corpus PII italiano piu ricco per OpenMed

Motivo:

- senza corpus piu ampi si tende a confondere "caso passato bene" con
  affidabilita reale

## Priorita 4: trattare OpenMed come lane separata, non come drop-in

Da fare:

- tenere OpenMed su branch/workstream separato
- usarlo solo per `redaction.v1` o NER lane-specific
- non mischiarlo al benchmark generativo `ollama`

Motivo:

- confronto corretto per lane
- meno rischio di regressioni architetturali

## Priorita 5: mantenere il contratto condiviso come backbone

Da preservare:

- envelope `mediflow.ai.extract.v1`
- render locale dove il prodotto finale non deve dipendere dal markdown del
  modello
- benchmark comuni sui task generativi

Motivo:

- e il pezzo che ha piu chiaramente ridotto il drift del sistema

## Piano operativo derivato dal report esterno

Il report esterno letto il 2026-03-22 e sostanzialmente allineato con la
direzione gia emersa nel repository:

- stack separato per lane
- resolver deterministici per `ICD-11` / `AIFA` / esenzioni
- `Qwen` come lane generativa default, non unico motore "che fa tutto"
- `OpenMed` per `PII/redaction`
- `HUMADEX` come candidato principale per una lane NER clinica italiana

La parte da elaborare non e quindi "cambiare direzione", ma sequenziare in modo
implementabile valutazione, test e rollout.

### Fase 0: governare il perimetro prima del codice

Obiettivo:

- fissare lane, corpora, metriche e stop-rules prima di aggiungere altri modelli

Passi:

1. confermare che `ADR 0027` e `ADR 0028` siano la base effettiva del filone AI
2. definire per ogni lane:
   - input supportati
   - output contrattuale
   - metriche minime
   - stop-rules
3. separare chiaramente:
   - lane generativa
   - lane PII
   - lane NER
   - lane resolver/coding
4. versionare tutti i corpora sintetici usati nei benchmark

Deliverable:

- benchmark corpus versionati
- checklist di acceptance per lane
- esplicitazione dei modelli "baseline", "challenger" e "blocked"

Exit criteria:

- nessun benchmark viene aggiunto senza corpus e metriche esplicite

### Fase 1: chiudere davvero la lane `PII/redaction`

Obiettivo:

- fare in modo che testo e documenti passino da una redazione locale prima di
  qualunque elaborazione generativa o debugging

Modello prioritario:

- `OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1`

Passi:

1. sidecar locale isolato solo su `127.0.0.1`
2. adapter interno con contratto `redaction.v1`
3. chunking robusto per testi lunghi
4. offset mapping stabile `raw -> redacted -> extracted`
5. blocco di log raw e persistenza solo di hash / artifact redatti

Test e benchmark:

- corpus sintetico italiano con:
  - nomi e cognomi
  - telefoni
  - date
  - indirizzi
  - codici fiscali
  - dati misti in narrative cliniche
- metriche:
  - recall PII critici
  - forbidden leak rate
  - latenza warm/cold
  - integrita offset mapping

Exit criteria:

- nessun PII critico perso nei casi gold piu importanti
- lane usabile in shadow mode prima di attivazione operativa

### Fase 2: normalizzare gli input prima della semantica

Obiettivo:

- non mandare al modello input sporchi o eterogenei senza sectioning

Passi:

1. definire parser tolleranti per:
   - `text/plain`
   - PDF
   - XML CDA / CCD
2. su CDA/CCD:
   - estrarre la narrative human-readable
   - usare la parte strutturata come `hint`, non come verita cieca
3. applicare normalizzazione minima di:
   - date
   - headers/sezioni
   - negazioni
   - temporality

Test:

- corpus sintetico di input misti
- casi con OCR rumoroso
- casi con XML parziale o non perfettamente profile-compliant

Exit criteria:

- l'input passato alle lane successive e stabile e confrontabile

### Fase 3: valutare una lane NER clinica italiana deterministica

Obiettivo:

- capire se una lane spans-first italiana migliora `Smart Import` rispetto al
  solo prompting LLM

Modello prioritario:

- `HUMADEX/italian_medical_ner`

Passi:

1. benchmark isolato su `PROBLEM`, `TEST`, `TREATMENT`
2. confronto contro baseline attuale LLM-only sullo stesso corpus
3. misurare utilita reale per:
   - estrazione span
   - evidence coverage
   - input ai resolver

Test:

- precision/recall span-level
- errore su negazioni e familiarita
- stabilita su testi italiani territoriali e note molto compresse

Exit criteria:

- si integra solo se migliora davvero auditabilita o recall resolver

### Fase 4: benchmarkare i resolver reali come first-class citizens

Obiettivo:

- rendere misurabile la parte piu fragile dello stack, cioe il passaggio da
  entita/claim a codifica locale

#### 4A. WHO ICD-11

Passi:

1. mantenere benchmark headless sul resolver WHO reale rieseguibile da CLI
2. misurare query:
   - italiane
   - inglesi
   - miste
   - con/senza codice esplicito
3. salvare solo:
   - codice
   - URI
   - evidenza
   - candidate list

Test specifici:

- token refresh OAuth2
- top-k recall
- hallucination rate pari a zero sui codici selezionati
- gestione `needsHumanValidation`

#### 4B. AIFA

Passi:

1. stabilizzare ingest del CSV open data
2. benchmarkare match su:
   - brand
   - principio attivo
   - strength
   - packaging
   - ambiguita multi-confezione
3. mantenere il tie-breaking dosage-aware

Test specifici:

- exact match
- top-k recall
- false positive rate su strength sbagliata
- therapy-state con brand/generico equivalenti

#### 4C. Esenzioni

Passi:

1. versionare tabelle regionali e nazionali
2. trasformare le fonti PDF in tabelle preprocessate offline
3. benchmarkare mapping con rationale e `needsHumanValidation`

Exit criteria:

- nessun resolver viene considerato "production-grade" senza benchmark headless
  reale e casi ambigui espliciti

### Fase 5: hardening di `Smart Import`

Obiettivo:

- farlo evolvere da feature fragile a workbench affidabile di coding clinico

Passi:

1. tenere il contratto stretto e JSON-only
2. combinare:
   - extraction lane
   - resolver reali
   - UI review
3. aggiungere guardrail locale su:
   - switch terapeutici
   - negazioni
   - storia remota
   - terapie future/condizionali
4. mantenere preselezione solo su suggerimenti forti

Test:

- benchmark contrattuale
- benchmark resolver
- e2e browser con pazienti sintetici
- apply-flow con dedupe e rigenerazione summary

Exit criteria:

- zero silent autofill
- therapy-state robusto nei casi di switch
- buona separazione fra `ready`, `manual`, `blocked`

### Fase 6: hardening di `AI Patient Insight`

Obiettivo:

- farlo restare utile, sobrio e centrato sul problema attuale

Passi:

1. costruire un corpus dedicato con:
   - storia remota vs problema attuale
   - fattori sociali non attivi
   - follow-up pendenti
   - documenti recenti vs codici storici
2. introdurre scoring su:
   - recency
   - focus
   - citation discipline
   - non-moralizing tone
3. aggiungere un filtro locale opzionale contro claim troppo speculativi

Exit criteria:

- l'output non apre piu da anamnesi remota quando il problema attuale e chiaro

### Fase 7: challenger models solo dopo baseline stabile

Obiettivo:

- valutare alternative senza rompere il runtime base

Ordine consigliato:

1. `BioMistral` come challenger biomed generativo
2. `Meditron` solo se il tema licensing/gating e operativo
3. `MedGemma` solo se emerge un bisogno reale di document understanding
   multimodale
4. `bioBIT` / `medBIT` solo dopo chiarimento licenze

Regola:

- nessun challenger diventa default se non batte la baseline sui benchmark della
  sua lane

### Fase 8: rollout prudente e guardrail di produzione

Obiettivo:

- far entrare le lane nuove senza regressioni cliniche o regolatorie

Passi:

1. shadow mode prima della UI operativa
2. audit trail su input/output redatti
3. stop automatico su:
   - ICD inventati
   - PII leak oltre soglia
   - licenza non chiara
4. fallback deterministico quando il JSON fallisce o il modello degrada

Exit criteria:

- il sistema degrada in modo sicuro, non in modo "creativo"

## Stop-rules operative da ereditare dal report esterno

- stop automatico se appare un codice `ICD-11` non presente nella candidate list
  del resolver
- stop/rollback se la lane `PII` lascia passare PII critici oltre soglia
- stop su modelli con licenza non chiara per produzione
- hardening obbligatorio prima del rollout se `therapyState` sugli switch resta
  debole

## Traduzione pratica del report esterno nel backlog MediFlow

Ordine corretto:

1. benchmark resolver veri
2. chiusura lane PII
3. hardening `Smart Import`
4. corpus dedicato `Patient Insight`
5. solo dopo challenger e lane NER opzionali

Ordine scorretto:

1. cambiare subito il modello default
2. aggiungere molti nuovi modelli senza corpora
3. implementare coding automatico end-to-end senza review umana
4. aprire la questione multimodale prima di chiudere privacy e resolver

## Cose da non fare

- non trasformare `Smart Import` in autofill silenzioso
- non sostituire `ollama` con toolkit specialistici come se fossero drop-in
- non benchmarkare `NER`, `PII` ed `LLM` come se fossero la stessa lane
- non usare dati reali o PHI per questi benchmark
- non introdurre cloud o egress implicito

## Prossimo piano pratico

### Slice A

Hardening `Smart Import`:

1. rieseguire benchmark resolver WHO/AIFA headless come baseline
2. guardrail locale sugli switch terapeutici
3. corpus sintetico allargato

### Slice B

Hardening `Patient Insight`:

1. corpus benchmark dedicato
2. scoring su recency/focus/non-moralizing
3. filtro locale opzionale anti-claim speculativi

### Slice C

Lane specialistiche:

1. `OpenMed redaction.v1` in shadow/sidecar locale
2. eventuale confronto NER lane-specific dopo il passaggio PII

## Comandi utili

```bash
npm run typecheck
bash scripts/ai-task-contracts-test.sh
bash scripts/patient-smart-import-test.sh
npm run benchmark:ai-task-contracts -- --iterations 1 --models qwen3.5:35b-a3b
npm run benchmark:smart-import -- --iterations 1 --models qwen3.5:35b-a3b
```

## Stato finale della raccomandazione

### Da tenere

- `ollama` come runtime generativo locale
- `qwen3.5:35b-a3b` come default operativo attuale
- envelope condiviso `mediflow.ai.extract.v1`
- `Smart Import` come workbench reviewable ristretto
- `OpenMed` come esplorazione `PII/redaction`

### Da correggere

- therapy-state negli switch
- benchmark resolver locali
- copertura corpus lane-specific
- e2e verification dei flussi AI principali

### Da evitare

- allargare ancora il perimetro semantico di `Smart Import`
- trattare un toolkit specialistico come sostituto del core runtime generativo
