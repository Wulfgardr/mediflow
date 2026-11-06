# ADR 0180: ATHENA fuori dal nucleo, modelli locali scelti per dominio

Data: 2026-11-05. Stato: **Accepted** (decisione di Leonardo del 5 novembre 2026).
Supera la parte di [ADR 0166](./0166-athena-method-runner-boundary.md) che
teneva aperta la ripresa di ATHENA come filone del nucleo; integra
[ADR 0073](./0073-treatment-reasoning-athena-boundary.md),
[ADR 0077](./0077-ai-provider-abstraction-and-egress-anonymization-boundary.md),
[ADR 0086](./0086-intelligent-scaffold-and-graded-automation-boundary.md) e
[ADR 0117](./0117-headless-portable-agent-first-and-capability-first-fabric.md).
Nessun impatto sul contratto `/api/v1`.

## Decisione

1. **ATHENA non è un requisito del nucleo, in nessuna release.** Il nucleo si
   avvia, si installa e si usa senza pesi ATHENA, senza MLX e senza il runner
   dedicato. Treatment Reasoning resta non disponibile su ogni superficie,
   come già fissato per la 0.9.1 (W-8, D-I2 del
   [contratto 0.9.1](../releases/0.9.1-contract.md)).
2. **Nessun modello legato a una sola piattaforma nel percorso ordinario.**
   Un modello locale entra nel Fabric soltanto con un artefatto portabile
   (oggi GGUF eseguito da llama.cpp o da Ollama). MLX, Metal o CUDA restano
   accelerazioni opzionali dello stesso artefatto, mai l'unico modo di farlo
   girare.
3. **Il Fabric funziona anche senza modello.** Ogni capacità dichiara cosa fa
   con regole e cataloghi e cosa aggiunge un modello. Undici capacità su
   sedici del catalogo Fabric v1 sono già deterministiche; le cinque
   generative ricadono sulle regole o si dichiarano non disponibili.
4. **Il modello si sceglie per dominio, non uno per tutto.** Un candidato
   entra in un dominio solo dopo prove proprie su quel dominio, con identità,
   digest e ricetta registrati come chiede ADR 0117.
5. **Treatment Reasoning potrà tornare solo con un'identità nuova.** Una
   proposta futura porta il proprio nome di modello e metodo, gira sul
   runtime portabile e supera il validatore V2 e le 18 soglie già approvate,
   senza allentarli per ottenere un esito positivo.

Questo ADR non rimuove codice. La rimozione del runner ATHENA, del launcher
MLX dedicato e dei relativi controlli di parità è un lavoro successivo, con
prove proprie; fino ad allora il diniego in `lib/ai-function-availability.ts`
resta la barriera.

## Perché

**ATHENA non passa.** Nei due giri di misura del 30 ottobre 2026, richiamati da
ADR 0166, i cinque positivi di ciascun percorso sono rifiutati e 10 soglie su
18 falliscono, con errori di contenuto (date confuse, rischi senza riscontro)
e non solo di forma. Il modello gira inoltre solo con MLX, quindi soltanto su
Mac.

**Nessun sostituto è pronto.** Il 5 novembre 2026 cinque modelli aperti in
GGUF su llama.cpp hanno risposto agli stessi 49 casi sintetici (245
inferenze, nessun dato reale):

| Modello | JSON puro su 49 | Terapia V2 | Estrazione letterale | PII critici su 35 | Latenza mediana |
|---|---:|---:|---:|---:|---:|
| Qwen3.5-0.8B | 45 | 0/5 | 2/5 | 23 | 0,7 s |
| Qwen3.5-2B | 39 | 0/5 | 5/5 | 35 | 1,0 s |
| Qwen3.5-4B | 23 | 0/5 | 3/5 | 35 | 2,2 s |
| SmolLM3-3B | 36 | 0/5 | 5/5 | 30 | 1,3 s |
| BioMistral-7B | 17 | 0/5 | 3/5 | 0 | 1,8 s |

Nessun candidato supera il contratto terapeutico. I risultati utili sono
circoscritti: Qwen3.5-4B conserva tutti i gruppi attesi nei tre casi di
Patient Insight; Qwen3.5-2B copia fonti e identificativi senza perderne.
I PII sono contati anche quando la risposta è chiusa in un blocco Markdown,
quindi non qualificano un modello come barriera di redazione.

## Conseguenze per dominio

| Dominio | Senza modello | Con modello, da qualificare |
|---|---|---|
| ICD, AIFA, prestazioni | Ricerca e verifica sul catalogo | Riscrittura della query e ordinamento con un modello di embedding piccolo; il codice finale esiste sempre nel catalogo |
| FHIR, open loops, range, identità, FSE | Regole e mapping | Nessun modello necessario |
| Redazione PII | Layer 1 deterministico e GLiNER2-PII governato (ADR 0077) | Nessun LLM come unica barriera |
| Patient Insight | Fonti ordinate e contesto strutturato | Qwen3.5-4B come primo candidato sperimentale |
| Sintesi documenti, Smart Import | Parsing, classificazione, fallback testuale | Estrazione delimitata con citazione letterale (Qwen3.5-2B); riconciliazione farmaci ancora non coperta |
| Treatment Reasoning | Non disponibile | Nessun candidato |
| OCR | Percorsi documentali esistenti | Motore CPU multipiattaforma da misurare |

## Cosa resta da provare

- Funzionamento equivalente su Windows, Linux e su un Mac con 8 GB.
- Qualità su documenti reali e lunghi; queste misure usano solo corpora
  sintetici.
- Gli encoder per ICD e NER, misurati sullo stesso corpus.
- Il pilot sui pesi di Qwen3.5-2B (modifica mirata, controllo sham, LoRA,
  verifica dopo quantizzazione Q4), avviato il 5 novembre 2026 sul metodo di
  *Sparks of Weight-Space Programming* (Takehi, Teoh, Zhang, Khattab, MIT
  CSAIL, 2 novembre 2026). Un derivato non entra nel Fabric finché non batte
  la decodifica vincolata da grammatica sullo stesso test.

## Attuazione del 6 novembre 2026

Rimossi dal prodotto i runtime MLX e Transformers dedicati a Treatment
Reasoning, i relativi launcher, provisioning, download, impostazioni e
composizioni di esecuzione. Rimossa anche la composizione Treatment Reasoning
del canale ChatGPT. I due endpoint di anteprima e acquisizione conservano
soltanto autenticazione e risposta `treatment_reasoning_unavailable_in_release`.

Il catalogo Fabric v1 mantiene le sedici identità e le cinque funzioni
generative. `treatment_reasoning` è `unavailable`, senza sedi né entry point
eseguibile; il catalogo dei modelli conserva le quattro funzioni e non propone
modelli per questa voce. Il crosswalk operativo passa da quattro a tre percorsi
`proposal_only` e da uno a due `unavailable`; l’artefatto storico con hash resta
immutato. La revisione derivata del catalogo modelli cambia e le scelte
precedenti richiedono una nuova verifica, senza riscritture automatiche.

Le impostazioni e i record lifecycle legacy restano su disco: nessuna migrazione
li cancella. La proiezione corrente ignora i provider rimossi e mostra Treatment
Reasoning disabilitato, senza scelta del modello. I parser descrittivi di
artefatti storici e il valore `athena_sidecar` dei vecchi envelope restano
leggibili. Apple e GPUI non presentano più il provider rimosso. Le prove di
compilazione e i relativi limiti sono riportati sulla PR di attuazione.

Lo schema nativo OpenAPI v1 conserva i valori provider legacy per evitare
un restringimento incompatibile del contratto pubblicato. Sono valori
descrittivi di compatibilità e non vengono emessi dalle esecuzioni correnti.
La rimozione non aggiunge operazioni o permessi al contratto `/api/v1`.
