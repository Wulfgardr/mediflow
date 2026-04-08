<!-- Codex: created 2026-04-08 -->
# Benchmark runtime MLX `TurboQuant` / KV cache

Date: 2026-04-08  
Status: Working benchmark note

## Scopo

Documentare la thin slice eseguibile di `WUL-114` senza toccare il runtime
applicativo MediFlow.

Questa nota segue:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [PLANS.md](../PLANS.md)
- [ADR 0044](./adr/0044-turboquant-feasibility-and-benchmark-only-runtime-prototype.md)

La lane resta:

- locale
- benchmark-only
- synthetic-only
- separata dal parliament e dal runtime applicativo

## Runner

Il prototipo minimo vive in
[scripts/mlx-chat-batch-runner.py](../scripts/mlx-chat-batch-runner.py).

Il runner confronta:

- `baseline`
- variante KV quantized via `--kv-bits`
- confronto A/B via `--compare-kv-bits`

Corpus iniziale:

- [scripts/fixtures/mlx-runtime-benchmark-corpus.json](../scripts/fixtures/mlx-runtime-benchmark-corpus.json)

Il corpus include:

- un caso breve di riepilogo clinico
- un caso synthetic `long-context` per stressare il path runtime

## Setup locale

Prerequisiti minimi:

- `.venv_mlx` disponibile nel repo
- `mlx_lm` installato nella virtualenv
- modello MLX gia in cache oppure scaricabile localmente da Hugging Face

Bootstrap tipico:

```bash
bash scripts/setup-mlx.sh
```

Nota:

- il download eventuale del modello resta fuori dal runtime app e fuori dai
  percorsi utente MediFlow
- il runner non apre nessuna route applicativa e non modifica i benchmark
  correnti del parliament

## Comandi

Smoke dry-run:

```bash
npm run test:mlx:runtime
```

Esecuzione baseline:

```bash
npm run benchmark:mlx:runtime -- \
  --model mlx-community/Llama-3.2-3B-Instruct-4bit \
  --limit 1 \
  --max-tokens 16
```

Confronto A/B baseline vs KV quantized:

```bash
npm run benchmark:mlx:runtime -- \
  --model mlx-community/Llama-3.2-3B-Instruct-4bit \
  --compare-kv-bits 4 \
  --limit 1 \
  --max-tokens 16 \
  --out /tmp/wul-114-mlx-kv-runtime-smoke.json
```

Caso long-context:

```bash
npm run benchmark:mlx:runtime -- \
  --model mlx-community/Llama-3.2-3B-Instruct-4bit \
  --compare-kv-bits 4 \
  --case long-context-discharge-review \
  --max-tokens 64
```

## Output

Il report JSON include:

- metadati runtime (`python`, `mlxLmVersion`, `platform`)
- lista varianti eseguite
- metriche per-case su wall time, token, TPS e peak memory
- delta A/B aggregati quando si usa `--compare-kv-bits`
- snapshot degli hook storici `MEDIFLOW_MLX_TURBOQUANT*`

Compatibilita storica:

- `MEDIFLOW_MLX_TURBOQUANT`
- `MEDIFLOW_MLX_TURBOQUANT_BITS`
- `MEDIFLOW_MLX_TURBOQUANT_GROUP_SIZE`
- `MEDIFLOW_MLX_TURBOQUANT_START`

Hook storici non piu mappati direttamente nel runtime `mlx_lm` corrente:

- `MEDIFLOW_MLX_TURBOQUANT_QJL_FEATURES`
- `MEDIFLOW_MLX_TURBOQUANT_FP16_SINK_SIZE`

Il runner li persiste come nota diagnostica, senza fingere compatibilita che
oggi non esiste.

## Stato corrente

Smoke tecnico eseguito il `2026-04-08` su:

- modello `mlx-community/Llama-3.2-3B-Instruct-4bit`
- confronto `baseline` vs `kv_bits_4`
- un solo case (`short-clinical-summary`)

Esito:

- entrambe le varianti hanno completato il case
- output preview coerente tra baseline e variante quantized
- `baseline`: `wallTimeSec = 0.3006`, `peakMemoryGb = 2.0683`
- `kv_bits_4`: `wallTimeSec = 0.2653`, `peakMemoryGb = 2.0683`

Interpretazione corretta:

- questo smoke conferma solo che il path MLX benchmark-only e oggi eseguibile
  in repo
- non basta per promuovere `TurboQuant`
- non sostituisce i benchmark reali su piu case, memoria e long-context
- non cambia la decisione di [ADR 0044](./adr/0044-turboquant-feasibility-and-benchmark-only-runtime-prototype.md)

## Fuori scope

- integrazione nel runtime applicativo
- promozione nel parliament
- cambio baseline del modello operativo
- conclusioni di prodotto da un solo smoke tecnico
