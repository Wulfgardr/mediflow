# MLX operational parity

> Stato documento: `SECONDARY`, slice `WUL-165`.
> Le decisioni architetturali prevalenti restano ADR 0028, ADR 0029, ADR 0037 e ADR 0044.

## Decisione

Per MediFlow, `MLX` diventa **benchmark-visible** e verificabile come runtime locale
alternativo nei benchmark, ma resta **non runtime clinico** del prodotto.

Questo significa:

- `Ollama` resta il runtime operativo standard dell'app.
- `MLX` resta confinato a benchmark, diagnostica e superfici esplicitamente
  etichettate come sperimentali o benchmark-only.
- OCR resta Ollama-only, perché dipende da modelli vision e pipeline già
  governate separatamente.
- Nessun default modello o provider viene cambiato solo perché MLX è presente.
- Qualunque promozione futura richiede ADR, benchmark lane-specific, stop-rule e
  governance rollout.

## Matrice minima

| Superficie | Ollama | MLX | Stato WUL-165 |
| --- | --- | --- | --- |
| Runtime app (`lib/ai-service.ts`) | Operativo standard | Non operativo | Differenza intenzionale |
| Health/status locale | Diagnostica `11434` | Diagnostica `8080/v1/models` | Parity read-only |
| Config provider native | Supportato | Supportato con fallback esplicito | Parity controllata |
| OCR | Supportato | Escluso | Ollama-only deliberato |
| Benchmark `ai-task-contracts` | `ollama_chat` | `mlx_chat` | Parity benchmark |
| Model parliament | Runtime distinto | Runtime distinto | Parity reportistica |
| Start/stop app-managed home-base | Non app-managed | Non app-managed | Parity di non gestione |
| Runtime centralizzato paired | Gate su Ollama locale | Non promosso | Fuori scope |

## Guard

Il guard eseguibile è:

```bash
npm run check:mlx-operational-parity
```

Il guard non prova la qualità di un modello MLX. Verifica invece che il repository
mantenga i confini operativi dichiarati:

- runtime applicativo ancora Ollama-only;
- adapter benchmark simmetrici `ollama_chat` / `mlx_chat`;
- diagnostica home-base read-only per MLX già attivo;
- fallback native esplicito verso Ollama;
- documentazione del boundary benchmark-only.

## Verifiche reali opzionali

Su una macchina con MLX preparato:

```bash
bash scripts/setup-mlx.sh
npm run benchmark:ai-task-contracts -- --iterations 1 --mlx-models mlx-community/medgemma-1.5-4b-it-bf16
npm run benchmark:smart-import -- --iterations 1 --mlx-models mlx-community/medgemma-1.5-4b-it-bf16
npm run benchmark:mlx:runtime -- --model mlx-community/Llama-3.2-3B-Instruct-4bit --compare-kv-bits 4 --limit 1 --max-tokens 16
```

Questi comandi producono evidenza di benchmark, non autorizzano promozione nel
runtime clinico.
