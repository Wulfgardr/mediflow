<!-- Codex: created 2026-04-08 -->
# ADR 0044: TurboQuant come tema di runtime, non come semplice challenger modello

Date: 2026-04-08  
Status: Accepted

## Problema

`WUL-114` nasce da un dubbio pratico: se `TurboQuant` possa entrare nello stack
locale MediFlow come un normale challenger generativo oppure se richieda un
nuovo workstream di serving e benchmark runtime.

Il rischio, senza una decisione esplicita, e trattare una tecnica di
compressione della KV cache come se fosse solo:

- un nuovo modello da aggiungere al registry
- una nuova quantizzazione di pesi da benchmarkare nel parliament
- un cambio drop-in del runtime operativo locale

Questo sarebbe incoerente con [ARCHITECTURE.md](../../ARCHITECTURE.md),
[SECURITY.md](../../SECURITY.md),
[ADR 0028](./0028-stack-aware-ai-model-evaluation-matrix.md) e
[ADR 0029](./0029-ai-model-parliament-and-local-retention-policy.md), che gia
separano chiaramente benchmark lane-specific, runtime operativi e promozioni
prudenziali.

## Contesto

- La fonte primaria sul tema e il paper
  [TurboQuant](https://hf.co/papers/2504.19874), che presenta la tecnica come
  quantizzazione online/vettoriale utile anche per KV cache quantization, non
  come semplice formato di pesi intercambiabile.
- Su questa macchina, il runtime locale reale mostra due capability rilevanti:
  - `ollama serve --help` su `ollama 0.20.4` espone
    `OLLAMA_FLASH_ATTENTION` e `OLLAMA_KV_CACHE_TYPE`
  - `mlx_lm.generate --help` su `mlx_lm 0.31.2` espone `--kv-bits`,
    `--kv-group-size` e `--quantized-kv-start`
- Su Hugging Face esistono gia asset community con tag `turboquant`, per
  esempio
  [majentik/gemma-4-E4B-turboquant](https://hf.co/majentik/gemma-4-E4B-turboquant)
  e
  [apothic/bonsai-8B-1bit-turboquant](https://hf.co/apothic/bonsai-8B-1bit-turboquant),
  ma sono distribuiti su librerie/path differenti (`transformers`,
  `llama.cpp`) e non costituiscono di per se un percorso drop-in per il runtime
  applicativo MediFlow.

## Opzioni

1. Trattare TurboQuant come un normale challenger modello dentro il benchmark
   stack esistente.
2. Riconoscere TurboQuant come tema di runtime/KV cache e aprire solo un
   prototipo benchmark-only su serving isolato.
3. Dichiarare il tema non praticabile adesso e deferirlo integralmente finche
   non esiste supporto first-class piu chiaro nei runtime locali.

## Trade-off

- Opzione 1:
  - Pro: riuso massimo dell'harness corrente.
  - Contro: confonde tecnica di serving con scelta del modello; rischia
    benchmark ingannevoli e conclusioni non trasferibili al runtime reale.
- Opzione 2:
  - Pro: distingue correttamente `Ollama`, `MLX` e runtime dedicati;
    consente uno smoke serio senza contaminare il runtime operativo.
  - Contro: apre un micro-workstream di serving/benchmark invece di un semplice
    cambio registry.
- Opzione 3:
  - Pro: rischio quasi nullo.
  - Contro: ignora capability gia presenti nei runtime locali e rinvia troppo
    presto un tema che puo essere misurato in modo confinato.

## Decisione

Adottiamo l'opzione 2.

Per MediFlow, oggi, la raccomandazione su `WUL-114` e:

- `prototype`, ma solo come **runtime prototype benchmark-only**
- **non** trattare TurboQuant come un nuovo challenger drop-in del parliament
- **non** cambiare il runtime applicativo locale o i default AI in questa issue

In pratica:

- via `Ollama`, la fattibilita esiste solo come serving isolato con knob
  runtime (`OLLAMA_FLASH_ATTENTION`, `OLLAMA_KV_CACHE_TYPE`), quindi non come
  semplice cambio modello nel registry
- via `MLX`, la fattibilita e piu esplicita ma richiede comunque un path
  dedicato, perche i knob di KV quantization stanno nel runtime/CLI
  (`--kv-bits`, `--kv-group-size`, `--quantized-kv-start`) e non nell'harness
  applicativo standard
- gli asset community Hugging Face sono segnali di ecosistema utile, ma non
  bastano a rendere TurboQuant una lane promotabile del runtime MediFlow

## Conseguenze

Positivo:

- la questione viene ricondotta a un benchmark di serving e non a una gara
  impropria tra modelli
- il workstream resta local-only e benchmark-only, coerente con i guardrail
  MediFlow
- si chiarisce che `Ollama` e `MLX` non offrono lo stesso path operativo

Negativo:

- non c'e nessun guadagno immediato sul prodotto
- serviranno benchmark separati su memoria, latenza e almeno un corpus
  abbastanza lungo da rendere significativa la KV cache quantization
- il parliament corrente non e il posto giusto per promuovere o bocciare questa
  tecnica senza un harness runtime dedicato

## First Thin Slice

Il primo deliverable minimo realistico, se `WUL-114` viene eseguita davvero,
e questo:

1. avviare un runtime `Ollama` isolato con `OLLAMA_FLASH_ATTENTION=1` e
   `OLLAMA_KV_CACHE_TYPE` esplicito, separato dal server applicativo standard
2. avviare un runtime `MLX` isolato con `kv-bits` e relativi parametri di
   quantizzazione esplicitati nel comando di serving
3. misurare i due path solo in `benchmark-only` su:
   - latenza
   - footprint memoria
   - tenuta del contratto condiviso
   - almeno un caso synthetic long-context
4. fissare poi una decisione successiva: `defer`, `keep as runtime experiment`
   oppure `not viable now`

## Fuori Scope

- aggiungere TurboQuant al runtime app o alle route AI operative
- usare asset community Hugging Face come scorciatoia verso promozione runtime
- trattare la sola quantizzazione dei pesi come sostituto della valutazione KV
  cache/runtime
- cambiare il baseline protetto `qwen3.5:35b-a3b`
