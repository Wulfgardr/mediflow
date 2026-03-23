<!-- Codex: created 2026-03-23 -->
# Benchmark OpenMed Redaction (`WUL-96`)

Date: 2026-03-23  
Status: Working runbook

## Scopo

Questo runbook esegue il benchmark lane-specific `redaction.v1` contro un
sidecar locale OpenMed, senza toccare il runtime applicativo MediFlow.

La decisione architetturale resta in
[ADR 0030](./adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md):

- `OpenMed` prima su `PII/redaction`
- nessun confronto diretto con i generativi
- `HUMADEX` resta lane NER separata

## Prerequisiti

- Node.js disponibile per eseguire gli script MediFlow
- un sidecar OpenMed locale raggiungibile su `127.0.0.1`
- corpus sintetico del benchmark in
  [`scripts/fixtures/redaction-benchmark-corpus.json`](../scripts/fixtures/redaction-benchmark-corpus.json)
- corpus email-focused in
  [`scripts/fixtures/redaction-benchmark-email-corpus.json`](../scripts/fixtures/redaction-benchmark-email-corpus.json)

## Avvio sidecar OpenMed

Riferimento ufficiale verificato su `openmed==0.6.2`:

```bash
uv pip install -e ".[hf,service]"
uvicorn openmed.service.app:app --host 0.0.0.0 --port 8080
```

Oppure con Docker:

```bash
docker build -t openmed:0.6.2 .
docker run --rm -p 8080:8080 -e OPENMED_PROFILE=prod openmed:0.6.2
```

Per `WUL-96` il modello di default lato adapter MediFlow e:

```text
OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1
```

## Esecuzione benchmark

Smoke locale con healthcheck preventivo:

```bash
bash scripts/run-openmed-redaction-benchmark.sh
```

Sweep delle soglie:

```bash
MEDIFLOW_OPENMED_BASE_URL=http://127.0.0.1:8080 \
npm run benchmark:redaction:sweep:openmed
```

Comando diretto equivalente:

```bash
MEDIFLOW_OPENMED_BASE_URL=http://127.0.0.1:8080 \
npm run benchmark:redaction:openmed
```

Corpus email-focused:

```bash
MEDIFLOW_OPENMED_BASE_URL=http://127.0.0.1:8080 \
npm run benchmark:redaction:email:openmed
```

Stabilita su run ripetuti:

```bash
MEDIFLOW_OPENMED_BASE_URL=http://127.0.0.1:8080 \
npm run benchmark:redaction:repeat:openmed -- --runs 5 --corpus scripts/fixtures/redaction-benchmark-email-corpus.json
```

Failure-path del benchmark/adapter:

```bash
npm run test:redaction:resilience
```

Gate di shadow-readiness:

```bash
MEDIFLOW_OPENMED_BASE_URL=http://127.0.0.1:8080 \
npm run validate:redaction:openmed
```

Gate email-focused:

```bash
MEDIFLOW_OPENMED_BASE_URL=http://127.0.0.1:8080 \
npm run validate:redaction:email:openmed
```

Override utili:

```bash
MEDIFLOW_OPENMED_PII_MODEL=OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1
MEDIFLOW_OPENMED_TIMEOUT_MS=30000
MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD=0.3
```

## Output atteso

Il benchmark produce:

- `contractValidRate`
- `entityRecall`
- `criticalRecall`
- `forbiddenLeakRate`
- `offsetIntegrityRate`
- `avgLatencyMs`
- `p95LatencyMs`
- `recallByType`
- `leakedForbiddenTokens` per-case
- `missingEntities` per-case

Ogni case puo anche riportare `error` se il sidecar fallisce o restituisce un
payload incompatibile con `mediflow.redaction.v1`.

## Note operative

- Il benchmark usa `GET /health` e `POST /pii/deidentify`.
- Gli offset di `redaction.v1` sono definiti come UTF-16 code-unit offsets
  allineati a JS/Node.
- Questo runbook e locale e intenzionalmente non CI-ready.
- Non usare dati reali: solo corpus sintetici.
- L'adapter clampa `MEDIFLOW_OPENMED_TIMEOUT_MS` a un minimo di `1000ms`.

## Run osservato

Primo run reale eseguito su questo branch il `2026-03-23` con:

- `openmed==0.6.2`
- sidecar `uvicorn` locale su `127.0.0.1`
- modello `OpenMed/OpenMed-PII-Italian-ClinicalLongformer-Base-149M-v1`
- corpus sintetico v3 da `9` casi in `scripts/fixtures/redaction-benchmark-corpus.json`

Metriche osservate sulla miglior soglia corrente (`confidence_threshold=0.3`):

- `contractValidRate`: `1.0`
- `entityRecall`: `0.8`
- `criticalRecall`: `0.8`
- `forbiddenLeakRate`: `0.556`
- `offsetIntegrityRate`: `1.0`
- `avgLatencyMs`: `119.3`
- `p95LatencyMs`: `149.6`

Breakdown principale per tipo:

- `person`: `1.0`
- `date`: `1.0`
- `phone`: `1.0`
- `address`: `1.0`
- `tax_id`: `1.0`
- `email`: `0.333`
- `organization`: `0.0` su un solo case non critico

Miss residui evidenti nel corpus attuale:

- email non redatta nel caso `redaction-clinical-mail-compact`
- email PEC non redatta nel caso `redaction-written-date-and-pec`
- email clinica non redatta nel caso `redaction-two-persons-and-clinic-email`
- mailbox clinica non redatta nel caso `redaction-clinic-referrals-mailbox`
- entrambe le email non redatte nel caso `redaction-two-mails-and-phone`

Interpretazione minima:

- il sidecar passa il contratto e gli offset in modo stabile
- la normalizzazione adapter-side ora recupera `DATEOFBIRTH`, numeri di
  telefono etichettati come `BANKACCOUNT` o `npi` e span indirizzo parziali
- la lane non e ancora pronta per `shadow -> go`, perche il leak rate sui PII
  critici resta troppo alto nel corpus sintetico esteso
- il cluster residuo e ormai leggibile: il benchmark mostra `missingEntities`
  e `leakedForbiddenTokens`, e i miss si concentrano soprattutto su mailbox
  cliniche / PEC non emesse dal modello, non su errori di offset o schema
- il nuovo `recallByType` rende esplicito il collo di bottiglia: sul corpus v3
  il modello mantiene recall pieno su persona/data/telefono/indirizzo/tax ID,
  ma scende a `0.333` sulle email

Mini sweep osservata sullo stesso corpus:

- `confidence_threshold=0.3` -> `entityRecall=0.8`, `criticalRecall=0.8`,
  `forbiddenLeakRate=0.556`, `avgLatencyMs=178.8`, `p95LatencyMs=202.3`
- `confidence_threshold=0.5` -> `entityRecall=0.8`, `criticalRecall=0.8`,
  `forbiddenLeakRate=0.667`
- `confidence_threshold=0.7` -> `entityRecall=0.6`, `criticalRecall=0.6`,
  `forbiddenLeakRate=1.0`

Segnale operativo attuale:

- sul corpus esteso la soglia `0.3` resta migliore di `0.5` e `0.7`
  perche minimizza i leak mantenendo il recall migliore o pari
- nel benchmark `WUL-96` il default adapter-side puo quindi stare a `0.3`,
  lasciando l'override via env per sweep o controprove
- le latenze sono sensibili al cold start del modello: uno sweep completo e
  piu costoso di un run warm singolo del launcher
- il caso `redaction-pec-followup-mailbox` passa, quindi il problema non e una
  incapacita assoluta sulle PEC ma un cluster piu specifico di mailbox cliniche
  e multi-email nello stesso contesto
- i leak residui non sono piu errori di normalizzazione: il corpus allargato
  rende visibili gap reali del modello soprattutto sulle email cliniche

## Test aggiuntivi

Corpus email-focused osservato (`6` casi, stesso modello/soglia `0.3`):

- `contractValidRate`: `1.0`
- `entityRecall`: `0.7`
- `criticalRecall`: `0.7`
- `forbiddenLeakRate`: `0.833`
- `offsetIntegrityRate`: `1.0`
- `email recall`: `0.143`

Interpretazione:

- il full corpus v3 dice che la lane regge bene fuori dal segmento email
- il corpus email-focused conferma che il collo di bottiglia non e marginale:
  sulle mailbox/email cliniche il modello recupera solo `1` email su `7`

Stabilita osservata su `5` run warm dello stesso corpus email-focused:

- `contractValidRate`: stabile a `1.0`
- `entityRecall`: stabile a `0.7`
- `criticalRecall`: stabile a `0.7`
- `forbiddenLeakRate`: stabile a `0.833`
- `email recall`: stabile a `0.143`
- latenza variabile quasi solo per cold start: `avgLatencyMs` da `125.2` a
  `403.6`, `p95LatencyMs` da `126.0` a `1522.3`

Failure-path verificati dal runner locale `test:redaction:resilience`:

- `HTTP 500`
- payload senza `pii_entities`
- entity con offset non validi
- timeout lato adapter

Gate decisionale osservato:

- `validate:redaction:openmed` passa sul gold adapter e fallisce su OpenMed
  reale, come previsto
- `validate:redaction:email:openmed` fallisce in modo coerente sugli stessi
  case mailbox/email
- la decisione corrente quindi e esplicita: `OpenMed redaction` resta
  `benchmark-only / not shadow-ready`

Segnale finale sullo stato dello stack:

- benchmark stack `WUL-96` ora e sostanzialmente consolidato per questa lane:
  corpus dedicati, harness, repeatability, resilience checks e gate di
  shadow-readiness sono presenti
- modello OpenMed per `redaction` non e consolidato come scelta finale, perche
  il collo di bottiglia email/mailbox resta troppo marcato per promuovere la
  lane oltre il benchmark
