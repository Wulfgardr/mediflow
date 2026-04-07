<!-- Codex: created 2026-04-04 -->
# Benchmark resolver WHO ICD-11 + AIFA

Date: 2026-04-04  
Status: Working benchmark note

Ultima riesecuzione su `main`: 2026-04-07

## Scopo

Documentare la thin slice `AI-01` / `WUL-109` per misurare i resolver reali che
chiudono il passaggio tra evidenza reviewable e coding locale:

- WHO ICD-11
- catalogo farmaci AIFA locale

Questa lane segue:

- [PLANS.md](../PLANS.md)
- [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md)
- [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md)
- [docs/linear-codex-playbook.md](./linear-codex-playbook.md)

Il benchmark resta:

- locale
- corpus-only
- synthetic-only
- resolver-first

## Perche esiste

Il collo di bottiglia residuo dello stack AI MediFlow non e piu solo il
contratto generativo. La parte fragile e il passaggio tra:

- query sintetica o entity reviewable
- candidate list locale
- codice o farmaco effettivamente proponibile

Questa thin slice rende misurabili i resolver reali usati a valle delle lane AI
senza introdurre:

- cloud
- sidecar nuovi
- UI o runtime operativi diversi

## Resolver misurati

### WHO ICD-11

Il benchmark usa direttamente lo stesso endpoint locale e gli stessi header
operativi gia usati da [app/api/icd/proxy/route.ts](../app/api/icd/proxy/route.ts):

- base di default: `http://127.0.0.1:8888`
- endpoint: `/icd/release/11/2024-01/mms/search`
- `Accept-Language: en`
- `API-Version: v2`

Questo e importante: il benchmark misura il comportamento reale del lookup
attuale, inclusa la sua debolezza sulle query italiane pure.

### AIFA locale

Il benchmark usa lo stesso criterio di ricerca del catalogo esposto da
[app/api/v1/drugs/route.ts](../app/api/v1/drugs/route.ts):

- query SQL `LIKE` su `name`, `active_principle`, `aic`
- ordinamento alfabetico per `name`
- nessun ranking dosage-aware
- nessuna semantica clinica su `therapyState`

Questo benchmark quindi non misura un matcher “ideale”, ma il resolver locale
reale su cui si appoggiano le lane reviewable.

## Corpora

Corpus WHO:

- [scripts/fixtures/icd-resolver-benchmark-corpus.json](../scripts/fixtures/icd-resolver-benchmark-corpus.json)

Copertura iniziale:

- query inglesi baseline
- query italiane pure
- query ibride
- ranking cronico/permanente su fibrillazione atriale

Corpus AIFA:

- [scripts/fixtures/aifa-resolver-benchmark-corpus.json](../scripts/fixtures/aifa-resolver-benchmark-corpus.json)

Copertura iniziale:

- brand diretto
- principio attivo
- strength-sensitive
- packaging-specific
- fixed-dose combo
- caso diagnostico `therapyState = suspended`

## Metriche

### WHO ICD-11

- `top1Recall`
- `topKRecall`
- `ambiguityRate`
- `falsePositiveRate`
- `noResultRate`
- `hallucinationRate`
- `avgLatencyMs`
- `p95LatencyMs`

Definizioni operative:

- `ambiguityRate`: il resolver restituisce piu di un candidato
- `falsePositiveRate`: il resolver restituisce candidati ma nessuno dei codici
  gold entra nella finestra `top-k`
- `hallucinationRate`: il candidato top-1 non ha un codice ICD utilizzabile
  (`N/A` o vuoto)

### AIFA locale

- `top1MatchRate`
- `topKMatchRate`
- `dosageAlignmentRate`
- `packagingAlignmentRate`
- `rejectTokenHitRate`
- `ambiguityRate`
- `falsePositiveRate`
- `noResultRate`
- `hallucinationRate`
- `stateBlindHitRate`
- `avgLatencyMs`
- `p95LatencyMs`

Definizioni operative:

- `top1/topK match`: il candidato contiene i token clinicamente attesi oppure
  uno degli `AIC` gold
- `dosageAlignmentRate`: il top-1 rispetta i token strength/dosaggio attesi
- `packagingAlignmentRate`: il top-1 rispetta i token confezione attesi
- `rejectTokenHitRate`: il top-1 contiene token esplicitamente sbagliati per il
  case (es. `2,5 mg` quando il query target e `5 mg`)
- `stateBlindHitRate`: sui case marcati `suspended`, il resolver continua
  comunque a produrre match perche non ha semantica sullo stato terapeutico

## Comandi

WHO ICD-11:

```bash
npm run benchmark:icd-resolver
```

Output JSON opzionale:

```bash
npm run benchmark:icd-resolver -- --out tmp/icd-resolver-benchmark.json
```

Output markdown leggibile:

```bash
npm run benchmark:icd-resolver -- --markdown-out tmp/icd-resolver-benchmark.md
```

Base URL custom:

```bash
npm run benchmark:icd-resolver -- --base-url http://127.0.0.1:8888
```

AIFA locale:

```bash
npm run benchmark:aifa-resolver
```

DB path custom:

```bash
npm run benchmark:aifa-resolver -- --db-path "/path/to/medical.db"
```

Oppure via data dir:

```bash
npm run benchmark:aifa-resolver -- --data-dir "/path/to/MediFlow"
```

Output markdown:

```bash
npm run benchmark:aifa-resolver -- --markdown-out tmp/aifa-resolver-benchmark.md
```

## Prerequisiti locali

Per WHO:

- servizio ICD-11 locale attivo sulla porta configurata

Per AIFA:

- database locale `medical.db`
- tabella `drugs` popolata

Note pratiche:

- il benchmark AIFA non richiede che il server Next sia attivo
- il benchmark WHO non richiede UI né sessione web
- entrambi i runner sono pensati per essere eseguiti direttamente da CLI

## Snapshot recente su `main`

Riesecuzione locale del `2026-04-07`:

- WHO ICD-11: `top1Recall = 0.714`, `topKRecall = 0.714`,
  `noResultRate = 0.286`; le query inglesi e miste passano, quelle italiane
  pure restano a `0`.
- AIFA locale: `top1MatchRate = 0.429`, `topKMatchRate = 0.429`,
  `noResultRate = 0.571`, `stateBlindHitRate = 1`; i gap residui sono
  soprattutto `strength`, `packaging` e combo, coerenti con il matcher SQL
  attuale.

## Lettura pratica dei risultati

Se WHO fallisce sulle query italiane ma tiene sulle inglesi:

- il collo di bottiglia e nel lookup locale corrente, non nel parser generativo

Se AIFA ha `topKMatch` alto ma `dosageAlignment` basso:

- il catalogo contiene i candidati giusti
- il problema e il ranking/tie-breaking locale, non l’ingest del CSV

Se `stateBlindHitRate` resta alto:

- il resolver AIFA va trattato come matcher di catalogo puro
- la semantica `active|transition|inactive` va tenuta fuori da questa lane e
  gestita a monte o nel post-processing

## Fuori scope

- cambiare il default model generativo
- cambiare il ranking del resolver nel runtime applicativo
- introdurre cloud lookup
- introdurre nuove lane AI
