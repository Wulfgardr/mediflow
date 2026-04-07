# Cloud Comparator Shadow Eval

Stato documento: `SECONDARY`  
Ultimo aggiornamento: 2026-04-04

Questo runbook documenta la thin slice `WUL-151`: confronto opzionale
`local vs GPT-5.4` su casi privati redatti/minimizzati, con output utile per
engineering e senza cambiare il runtime operativo di MediFlow.

`GPT-5.4` qui non e un modello da integrare nel prodotto: e una lente interna
di lavoro per capire come rendere piu intelligente lo stack locale MediFlow.

Riferimenti canonici:

- [SECURITY.md](../SECURITY.md)
- [docs/adr/0032-document-intelligence-corpus-and-private-shadow-vault.md](./adr/0032-document-intelligence-corpus-and-private-shadow-vault.md)
- [docs/adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md](./adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md)
- [docs/adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md](./adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md)
- [docs/adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md](./adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md)

## Obiettivo

Misurare in modo reviewable il delta tra:

- baseline locale MediFlow
- comparatore cloud `gpt-5.4`

su task ad alto valore come:

- `Patient Insight`
- `Smart Import`

senza:

- mandare materiale non governato al cloud
- usare il cloud come runtime clinico
- contaminare il repository con dati privati

Scopo reale della lane:

- imparare dai pattern migliori osservati nel comparatore cloud
- distillare nuove euristiche, nuovi benchmark e nuove thin slice locali
- migliorare il metodo di lavoro dello stack `AI + heuristics`, non cambiare il
  posizionamento `local-first`

## Guardrail obbligatori

- Il case pack reale vive **fuori Git** in un vault locale privato.
- Il case pack deve passare il gate privacy:
  - `directIdentifiersRemoved = true`
  - `quasiIdentifiersMinimized = true`
  - `operatorReviewed = true`
  - `cloudExportApproved = true`
- Nessun output cloud o report derivato da case reali va salvato nel repo.
- `Smart Import` resta sempre reviewable: nessun apply automatico.
- Il comparator usa lo stesso envelope logico `mediflow.ai.extract.v1` quando
  possibile, per confrontare semantica e guardrail invece di cambiare interfaccia.
- Nessun output di questa lane va letto come candidato automatico a entrare nel
  runtime MediFlow solo perche “migliore” su un case pack privato.

## Contratto del case pack

Implementazione:

- [lib/cloud-comparator-case-pack.ts](../lib/cloud-comparator-case-pack.ts)
- fixture sintetico d’esempio:
  [scripts/fixtures/cloud-comparator-case-pack.example.json](../scripts/fixtures/cloud-comparator-case-pack.example.json)

Il fixture in repo e solo dimostrativo. I case pack reali vanno creati nel vault
privato.

Campi chiave:

- `origin.storage = "private-shadow-vault"`
- `privacy.*` per il gate privacy
- `patientInsight.context + expected`
- `smartImport.payload + expected`
- `distillation.syntheticArchetypeHints` per guidare il passaggio dal delta
  osservato a nuovi casi sintetici canonici
- `distillation.learningObjectives` per fissare che cosa vogliamo imparare dal
  confronto
- `distillation.hypothesisTags` per annotare il tipo di ragionamento/ipotesi
  che stiamo cercando di validare

## Comando unico

Entry point:

```bash
npm run benchmark:cloud-comparator -- --case-pack /percorso/privato/case-pack.json
```

Il comando non fa nulla di remoto se non aggiungi `--run-cloud`.

## Workflow consigliato

### 1. Prepara il case pack nel vault privato

Usa il fixture sintetico come template, ma salva il file fuori repo, ad esempio:

```bash
cp scripts/fixtures/cloud-comparator-case-pack.example.json \
  /Users/<utente>/MediFlowShadowVault/case-packs/wul-151-case-001.json
```

Poi sostituisci i contenuti con il caso reale gia:

- redatto
- minimizzato
- approvato esplicitamente per export cloud

### 2. Emetti i prompt reviewable

```bash
npm run benchmark:cloud-comparator -- \
  --case-pack /Users/<utente>/MediFlowShadowVault/case-packs/wul-151-case-001.json \
  --emit-prompts-dir /Users/<utente>/MediFlowShadowVault/runs/wul-151/prompts
```

Questo produce i prompt lane-specific senza toccare il runtime applicativo.

### 3. Esegui la baseline locale

```bash
npm run benchmark:cloud-comparator -- \
  --case-pack /Users/<utente>/MediFlowShadowVault/case-packs/wul-151-case-001.json \
  --run-local \
  --raw-out-dir /Users/<utente>/MediFlowShadowVault/runs/wul-151/raw \
  --briefs-out-dir /Users/<utente>/MediFlowShadowVault/runs/wul-151/briefs \
  --out /Users/<utente>/MediFlowShadowVault/runs/wul-151/report.local.json \
  --markdown-out /Users/<utente>/MediFlowShadowVault/runs/wul-151/report.local.md
```

Default locale:

- modello: `qwen3.5:35b-a3b`
- endpoint: `OLLAMA_BASE_URL` oppure `http://127.0.0.1:11434`

### 4. Esegui il comparatore cloud `gpt-5.4`

Il run cloud e esplicitamente opt-in. Il comando fallisce se il case pack o i
report restano dentro il repo.

```bash
OPENAI_API_KEY=... npm run benchmark:cloud-comparator -- \
  --case-pack /Users/<utente>/MediFlowShadowVault/case-packs/wul-151-case-001.json \
  --run-local \
  --run-cloud \
  --raw-out-dir /Users/<utente>/MediFlowShadowVault/runs/wul-151/raw \
  --briefs-out-dir /Users/<utente>/MediFlowShadowVault/runs/wul-151/briefs \
  --out /Users/<utente>/MediFlowShadowVault/runs/wul-151/report.compare.json \
  --markdown-out /Users/<utente>/MediFlowShadowVault/runs/wul-151/report.compare.md
```

Parametri cloud usati da default:

- modello: `gpt-5.4`
- API: `Responses API`
- `reasoning.effort = "high"`
- `text.verbosity = "low"`
- `store = false`

Razionale:

- `gpt-5.4` e `Responses API` sono l’interfaccia attuale consigliata per task
  complessi e multi-step secondo la documentazione ufficiale OpenAI:
  [Using GPT-5.4](https://developers.openai.com/api/docs/guides/latest-model/)

Nota:

- La thin slice non usa Structured Outputs per cambiare il contratto della lane;
  mantiene lo stesso envelope `mediflow.ai.extract.v1` del runtime locale.

### 5. Leggi il report

Il report JSON/Markdown contiene:

- metriche lane-specific del locale
- metriche lane-specific del cloud
- delta `cloud-local`
- failure patterns utili
- insight tassonomici di distillazione verso benchmark sintetici e thin slice
  locali
- `localEvolutionAgenda` con task candidati, layer tecnico primario,
  benchmark-target, validazione attesa, touchpoint candidati del repo, branch
  suggerito sotto `WUL-151`, template branch `codex/<issue-id>-...` per i
  follow-up issue dedicati, hint di coordinamento `parallel-safe|serialized` e
  `definition of done`
- brief markdown opzionali, uno per task, e un `README.md` indice con
  recommended next slice se usi `--briefs-out-dir`
- `NEXT_SLICE.md` opzionale con la slice raccomandata e i primi comandi da
  eseguire
- `DOCUMENT_INTELLIGENCE_REVIEW.md` opzionale con la lettura strutturata del
  modello dati documentale e delle thin slice consigliate

Metriche principali:

- `Patient Insight`
  - `focusRecall`
  - `citationCoverageRate`
  - `preferredSourceCoverage`
  - `forbiddenLeakCount`
- `Smart Import`
  - `diagnosisRecall`
  - `diagnosisQueryRecall`
  - `therapyRecall`
  - `therapyStateRecall`
  - `reviewUsefulnessRate`

## Distillazione obbligatoria

Il case pack privato non e un asset canonico. Dopo il confronto:

1. leggi `failurePatterns`
2. leggi `insights` e classifica il delta in una delle categorie:
   - `reasoning-pattern`
   - `missing-local-heuristic`
   - `retrieval-source-hierarchy`
   - `contract-rendering`
   - `review-safety`
   - `synthetic-benchmark-gap`
3. astrai il pattern clinico/documentale
4. crea o aggiorna un caso sintetico nel corpus canonico pertinente
5. apri la thin slice locale successiva su prompt, retrieval, matcher,
   contract/render o guardrail
6. usa `localEvolutionAgenda` per scegliere la prossima thin slice locale con
   il minor diff utile e con benchmark/validator gia esplicitati
7. se la thin slice diventa una issue autonoma, apri una nuova conversazione
   Codex e rinomina il branch secondo il template `codex/<issue-id>-<slug>` del
   playbook Linear/Codex

Il comparatore cloud serve quindi a generare lavoro locale migliore, non a
sostituire lo stack locale.

La domanda corretta non e “come portiamo GPT nello stack?”, ma:

- quale approccio di ragionamento va imitato?
- quale euristica locale manca?
- quale benchmark sintetico ci impedira di perdere di nuovo questo pattern?

## Verifiche disponibili

Test sintetici del contratto e dello scorer:

```bash
npm run test:cloud-comparator
```

Typecheck repository:

```bash
npm run typecheck
```
