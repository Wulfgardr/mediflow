<a id="mlx-operational-parity"></a>

# Equivalenza operativa MLX

> Stato documento: `SECONDARY`, slice `WUL-165`.
> Le decisioni architetturali prevalenti restano ADR 0028, ADR 0029, ADR 0037,
> ADR 0044 e il ritiro OCR deciso per la 0.8.5.

## Decisione

Nel perimetro WUL-165, la classificazione
**`benchmark-visible`, non runtime clinico** indica che MLX generico può essere misurato nei benchmark senza
essere ammesso alle funzioni cliniche del prodotto. Il percorso governato
`ATHENA MLX` di Treatment Reasoning costituisce un'eccezione esplicita e
separata: produce soltanto anteprime locali, con un proprio ciclo di vita, senza
promuovere il server MLX generico a provider clinico. La matrice e il controllo
seguenti descrivono questo confine, non il catalogo completo delle funzioni AI.

La distinzione ha conseguenze operative precise:

- `Ollama` resta il runtime operativo standard dell'app.
- Il server `mlx_chat` generico resta confinato a benchmark, diagnostica e
  superfici esplicitamente etichettate come benchmark-only.
- `ATHENA MLX` resta confinato a Treatment Reasoning, con esecuzione locale,
  lifecycle dedicato, receipt e output `proposal_only`.
- **OCR non disponibile** nel runtime generativo qui confrontato: nel
  perimetro ritirato per la 0.8.5 non sono raggiungibili task, modelli o
  fallback OCR.
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

Il controllo non valuta la qualità di un modello MLX: verifica che il codice
mantenga la separazione operativa dichiarata. Il suo esito va quindi letto
rispetto a questi vincoli:

- runtime applicativo generativo ancora Ollama-only;
- adapter benchmark simmetrici `ollama_chat` / `mlx_chat`;
- diagnostica home-base read-only per MLX già attivo;
- fallback esplicito verso Ollama nel runtime bundled dell'app nativa
  (`lib/ai-service.ts`; dalla Fase 0 non esiste più un resolver Swift dedicato);
- l'OCR di questo perimetro resta terminalmente non disponibile e assente dal
  registro dei task;
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

I comandi producono misure di benchmark. Anche un esito positivo non autorizza
la promozione nel runtime clinico, che resta soggetta alla decisione e alle
condizioni indicate sopra.
