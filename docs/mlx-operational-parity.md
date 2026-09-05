# MLX operational parity

> Stato documento: `SECONDARY`, slice `WUL-165`.
> Le decisioni architetturali prevalenti restano ADR 0028, ADR 0029, ADR 0037,
> ADR 0044 e il ritiro OCR deciso per la 0.8.5.

## Decisione

Per MediFlow, il runtime MLX generico resta **benchmark-visible** e verificabile
nei benchmark, ma resta **non runtime clinico** del prodotto. La lane governata
`ATHENA MLX` di Treatment Reasoning è un'eccezione esplicita e separata: produce
solo anteprime locali, usa il proprio lifecycle e non promuove il server MLX
generico a provider clinico.

Questo significa:

- `Ollama` resta il runtime operativo standard dell'app.
- Il server `mlx_chat` generico resta confinato a benchmark, diagnostica e
  superfici esplicitamente etichettate come benchmark-only.
- `ATHENA MLX` resta confinato a Treatment Reasoning, con esecuzione locale,
  lifecycle dedicato, receipt e output `proposal_only`.
- OCR non disponibile nella 0.8.5: nessun task, modello o fallback OCR e
  raggiungibile dal runtime prodotto.
- Nessun default modello o provider viene cambiato solo perché MLX è presente.
- Qualunque promozione futura richiede ADR, benchmark lane-specific, stop-rule e
  governance rollout.

## Matrice minima

| Superficie | Ollama | MLX | Stato WUL-165 |
| --- | --- | --- | --- |
| Runtime app (`lib/ai-service.ts`) | Operativo standard | Non operativo | Differenza intenzionale |
| Health/status locale | Diagnostica `11434` | Diagnostica `8080/v1/models` | Parity read-only |
| Runtime app nativa (WebRuntime bundled, `lib/ai-service.ts`) | Operativo standard | Fallback esplicito verso Ollama | Parity controllata |
| Treatment Reasoning | Non usato | `ATHENA MLX`, lane governata | Anteprima locale `proposal_only` |
| OCR | Non disponibile | Non disponibile | Nessun task o fallback runtime |
| Benchmark `ai-task-contracts` | `ollama_chat` | `mlx_chat` | Parity benchmark |
| Registry comparativo modelli | Runtime distinto | Runtime distinto | Parity reportistica |
| Start/stop app-managed home-base | Non app-managed | Non app-managed | Parity di non gestione |
| Runtime centralizzato paired | Gate su Ollama locale | Non promosso | Fuori scope |

## Guard

Il guard eseguibile è:

```bash
npm run check:mlx-operational-parity
```

Il guard non prova la qualità di un modello MLX. Verifica invece che il repository
mantenga i confini operativi dichiarati:

- runtime applicativo generativo ancora Ollama-only;
- adapter benchmark simmetrici `ollama_chat` / `mlx_chat`;
- diagnostica home-base read-only per MLX già attivo;
- fallback esplicito verso Ollama nel runtime bundled dell'app nativa
  (`lib/ai-service.ts`; dalla Fase 0 non esiste piu un resolver Swift dedicato);
- OCR resta terminalmente non disponibile e assente dal registro dei task;
- la lane ATHENA di Treatment Reasoning resta distinta dal server MLX generico;
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
