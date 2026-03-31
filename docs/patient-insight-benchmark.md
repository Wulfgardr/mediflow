<!-- Codex: created 2026-03-31 -->
# Benchmark `patient_insight`

Date: 2026-03-31  
Status: Working benchmark note

## Scopo

Documentare la thin slice `AI-03` / `WUL-123` per misurare `AI Patient Insight`
in modo locale, sintetico e generalizzabile.

Questa lane segue:

- [PLANS.md](../PLANS.md)
- [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md)
- [docs/adr/0027-ai-task-extraction-envelope-and-local-render.md](./adr/0027-ai-task-extraction-envelope-and-local-render.md)
- [docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md](./adr/0028-stack-aware-ai-model-evaluation-matrix.md)
- [docs/linear-codex-playbook.md](./linear-codex-playbook.md)

Il benchmark resta:

- locale
- corpus-only
- synthetic-only
- evidence-first

## Perche esiste

Il benchmark generico dei task contracts misura soprattutto:

- JSON valido
- envelope corretto
- latenza

Per `patient_insight` questo non basta. I problemi reali emersi sul campo sono
stati soprattutto:

- perdita del problema clinico piu attuale a favore dell'anamnesi remota
- citazioni presenti ma poco disciplinate
- recupero insufficiente del follow-up documentale
- claim incompleti o moralizzanti

Questa thin slice misura quindi non solo il contratto, ma anche:

- focus clinico
- copertura citazioni
- copertura delle fonti preferite recenti
- leakage da fonti stale o fuori target
- burden di claim `[DATI-INCOMPLETI]`

## Contratto locale

Lo scaffold usa [lib/ai-task-contracts.ts](../lib/ai-task-contracts.ts) e
richiede:

- `schemaVersion = mediflow.ai.extract.v1`
- `task = patient_insight`
- sezioni `currentState`, `alerts`, `nextSteps`, `gaps`
- claim brevi gia marcati con `[Sx]` o `[DATI-INCOMPLETI]`

Nota importante:

- le citazioni non sono ancora strutturate come campi separati
- lo scoring quindi lavora sulle stringhe gia parse-ate dal runtime, non sul raw
  del modello

Questo e intenzionale: il benchmark misura quello che MediFlow usa davvero a
runtime dopo il parser locale.

## Policy gold del corpus

Il corpus iniziale copre cinque famiglie di caso:

- follow-up cronico respiratorio con osservazioni recenti
- diabete con follow-up laboratoristico e gap di aderenza
- post-frattura con rischio di riaprire su anamnesi remota
- accesso PS con rivalutazione anticoagulante e multi-fonte recente
- documento ricco di riabilitazione con codifica strutturata scarsa

Regole gold correnti:

- le aspettative sono a token-set, non a frase esatta
- le fonti recenti preferite sono esplicite per-case
- le fonti stale o i topic fuori focus possono essere proibiti per-case
- il benchmark privilegia priorita clinica e tracciabilita, non esaustivita
  enciclopedica

Questo evita benchmark fragili e mantiene la lane coerente con la UI reale,
dove `Patient Insight` deve restare compatto e operativo.

## Corpus iniziale

Corpus di default:

- [scripts/fixtures/patient-insight-benchmark-corpus.json](../scripts/fixtures/patient-insight-benchmark-corpus.json)

Ogni case include:

- `context`: prompt completo sintetico
- `expected.currentStateAny|alertsAny|nextStepsAny|gapsAny`
- `preferredSourceIds`
- `forbiddenSourceIds`
- `forbiddenTokens`
- `maxIncompleteClaims`

## Metriche

Metriche aggregate:

- `jsonValidRate`
- `contractValidRate`
- `currentStateRecall`
- `alertsRecall`
- `nextStepsRecall`
- `gapsRecall`
- `focusRecall`
- `citationCoverageRate`
- `supportedClaimRate`
- `preferredSourceCoverage`
- `incompleteClaimRate`
- `incompleteBudgetFailureRate`
- `forbiddenLeakRate`
- `forbiddenSourceLeakRate`
- `moralizingLeakRate`
- `avgLatencyMs`
- `p95LatencyMs`

Lettura pratica:

- `focusRecall` dice se il modello apre e orienta il follow-up sul problema
  giusto, non solo se produce JSON corretto
- `preferredSourceCoverage` misura se le fonti recenti davvero entrano
- `forbiddenSourceLeakRate` e `forbiddenLeakRate` segnalano quando la sintesi
  torna a farsi trascinare da anamnesi o topic fuori focus
- `incompleteClaimRate` mostra quanto spesso il modello si rifugia in
  `[DATI-INCOMPLETI]`
- `incompleteBudgetFailureRate` mostra quando il modello supera il budget
  massimo di claim incompleti previsto dal case

## Comandi

Benchmark:

```bash
npm run benchmark:patient-insight
```

Benchmark su un solo modello:

```bash
npm run benchmark:patient-insight -- --models qwen3.5:35b-a3b
```

Validation gate leggero:

```bash
npm run validate:patient-insight
```

Il validator npm usa la baseline operativa corrente:

- `qwen3.5:35b-a3b`

Output opzionale su file:

```bash
npm run benchmark:patient-insight -- --out tmp/patient-insight-benchmark.json
```

## Soglie iniziali del validator

Il gate iniziale controlla:

- `contractValidRate >= 0.95`
- `focusRecall >= 0.75`
- `citationCoverageRate >= 0.95`
- `preferredSourceCoverage >= 0.60`
- `forbiddenLeakRate <= 0.10`
- `forbiddenSourceLeakRate <= 0.05`
- `moralizingLeakRate <= 0`
- `incompleteClaimRate <= 0.35`

Queste soglie sono conservative:

- abbastanza dure da intercettare regressioni evidenti
- non cosi dure da bloccare ogni miglioramento incrementale

Se una soglia cambia, il cambio va tracciato in repo e collegato alla issue
Linear del workstream.

## Uso operativo

Usa questa lane quando:

- tocchi prompt/guardrail di `Patient Insight`
- cambi il context builder o la priorita delle fonti
- modifichi il rendering o la policy su `[DATI-INCOMPLETI]`
- vuoi confrontare un challenger locale senza cambiare il default operativo

Non usarla da sola per promuovere un fix. Va letta insieme a:

- test unitari mirati
- prove manuali su dati sintetici o clone locale
- issue Linear/branch/commit collegati

## Audit trail

Workstream attuale:

- Issue Linear: `WUL-123`
- Branch consigliato: `codex/wul-123-ai-insight-benchmark-framework`

Il benchmark non cambia il runtime operativo e non promuove automaticamente
nuove policy cliniche. E solo una lane di misura locale per evitare regressioni
opache.
