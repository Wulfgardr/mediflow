# ADR 0073: treatment reasoning ATHENA-style boundary

Date: 2026-07-07
Status: Accepted for MediFlow-native review-only lane; ATHENA-R1 local MLX runtime enabled behind kill switch

---

## Problema

MediFlow ha gia superfici AI locali review-first (`AI Patient Insight`,
Smart Import, document synthesis) e un boundary versionato per le terapie. Il
passo successivo e una lane di ragionamento terapeutico che possa leggere il
contesto paziente e aiutare il medico a rivedere trattamenti, alternative,
controindicazioni e monitoraggi.

Il rischio e introdurre troppo presto un agente terapeutico come se fosse un
prescrittore, un motore di decisione clinica autonoma o una dipendenza cloud.
Questo violerebbe ADR 0033 (private),
[ADR 0054](./0054-network-therapy-write-boundary.md),
[ADR 0057](./0057-local-evidence-absorption-layer.md),
[ADR 0065](./0065-intended-purpose-and-claims-guard.md) e
[SECURITY.md](../../SECURITY.md).

## Contesto

ATHENA-R1 e descritto dal repository Harvard/MIMS come agente per treatment
reasoning multi-step su 212 tool biomedici tramite ToolUniverse, con server vLLM
e ToolUniverse come backing services. Il paper arXiv 2606.28692 presenta il
task come ragionamento terapeutico iterativo su malattia, comorbidita,
farmaci, controindicazioni ed evidenza aggiornata. Il repository dichiara anche
che ATHENA-R1 e un artefatto di ricerca per decision support, non un medical
device e non per direct patient care.

Fonti esterne di riferimento:

- repository: <https://github.com/mims-harvard/ATHENA>
- paper arXiv: <https://arxiv.org/abs/2606.28692>
- sito progetto: <https://athena.openscientist.ai/>

MediFlow assorbe il pattern utile e, dal checkpoint 95%, puo usare i pesi
locali ATHENA-R1-Qwen3-8B via MLX per generare la bozza. Questo non promuove
ToolUniverse/vLLM nel data plane clinico e non cambia il boundary: la lane deve
restare:

- local-first e opt-in;
- review-first;
- source-grounded;
- synthetic-only nel repo;
- senza auto-write su `therapies`;
- fuori da `/api/v1/network/*` finche non esiste una decisione separata;
- compatibile con benchmark/shadow mode prima di ogni uso operativo.

## Opzioni

1. Integrare ATHENA-R1 direttamente nel profilo paziente.
2. Creare una lane MediFlow-native `treatment_reasoning` con output
   ATHENA-compatible, e tenere ATHENA come sidecar benchmark/shadow opzionale.
3. Non aggiungere una lane nuova e continuare solo con Smart Import e Patient
   Insight.

## Trade-off

- Opzione 1: massima vicinanza alla ricerca ATHENA, ma introduce runtime pesante,
  tool esterni, rischio regolatorio e confusione tra supporto e prescrizione.
- Opzione 2: conserva il valore concettuale di ATHENA (trace, evidenza,
  caveat, report strutturato) senza cambiare il boundary clinico. Richiede piu
  lavoro di contratto e benchmark, ma mantiene reversibilita.
- Opzione 3: minimizza il rischio immediato, ma lascia scoperto il ragionamento
  terapeutico trasversale che Smart Import non deve risolvere.

## Decisione

Adottare l'opzione 2.

MediFlow introduce il contratto `mediflow.treatment_reasoning.v1` come lane
separata da `mediflow.ai.extract.v1`. La nuova lane produce:

- raccomandazione sintetica;
- evidenze chiave con source id verificabili;
- reasoning leggibile;
- caveat e incertezze;
- safety flag;
- suggested actions solo `review_only`, `form_prefill_only` o `no_write`;
- trace compatibile con un futuro adapter ATHENA/ToolUniverse.

La lane non applica modifiche cliniche. Ogni eventuale proposta verso terapie,
diagnosi, monitoraggi o follow-up resta una bozza da rivedere o un prefill di
form esistente.

## Conseguenze

Diventa piu semplice aggiungere un pannello paziente o un futuro plug chat che
risponde su una finestra di contesto clinico senza duplicare Smart Import. Il
contratto puo anche ospitare un adapter ATHENA locale/shadow quando vLLM e
ToolUniverse sono disponibili.

Diventa piu difficile perche la promozione della lane deve passare da corpus
sintetico, validator, kill-switch, fallback e revisione safety. Questo costo e
intenzionale: impedisce promozioni implicite di un agente terapeutico.

## Implemented Checkpoint

La prima slice ha introdotto contratto e benchmark senza runtime clinico:

1. documento di integrazione `docs/treatment-reasoning-athena-integration.md`;
2. contratto puro `lib/treatment-reasoning-contract.ts`;
3. test di contratto `lib/treatment-reasoning-contract.test.ts`;
4. corpus sintetico `scripts/fixtures/treatment-reasoning-corpus.json`;
5. benchmark/validator `scripts/benchmark-treatment-reasoning.ts`;
6. wiring npm per `test:treatment-reasoning`,
   `benchmark:treatment-reasoning` e `validate:treatment-reasoning`;
7. aggiornamento di `docs/README.md` e `docs/markdown-index.md`.

Il checkpoint 75% ha aggiunto una lane model-powered locale ma sempre
review-only:

1. context builder paziente `lib/treatment-reasoning-context.ts`: il contesto
   sintetico esclude i campi anagrafici strutturati (nome, codice fiscale,
   contatti); gli estratti liberi (note, diario, evidenze) possono comunque
   contenere riferimenti identificativi e restano confinati al runtime locale;
2. service wrapper `lib/treatment-reasoning-service.ts`, con modello locale
   `AIService.create('reasoning')`, parser contract-bound e nessun write path;
3. kill switch fail-closed `lib/ai-treatment-reasoning-kill-switch.ts`;
4. pannello profilo `components/treatment-reasoning-panel.tsx` dentro la
   sezione terapie;
5. toggle in `app/settings/ai/funzioni/page.tsx`;
6. smoke live DB read-only/redatto
   `scripts/treatment-reasoning-live-db-smoke.ts`.

Il checkpoint 95% aggiunge il runtime locale ATHENA-R1:

1. download locale fuori repo del modello
   `mims-harvard/ATHENA-R1-Qwen3-8B`;
2. adapter MLX server-side `lib/athena-mlx-runtime.ts`;
3. endpoint locale autenticato
   `/api/system/treatment-reasoning/athena-mlx`;
4. service browser che usa ATHENA MLX per la lane Treatment Reasoning;
5. smoke live DB multi-paziente con `--runtime athena_mlx --cases <n>`.

Ollama resta disponibile per altre lane AI. Treatment Reasoning usa ATHENA-R1
quando viene invocata dal pannello e il kill switch e attivo.

Il checkpoint 99% chiude il primo giro performance/safety sul runtime locale:

1. il runtime MLX riconosce sia l'artefatto BF16 sharded scaricato da Hugging
   Face sia un artefatto MLX convertito/quantizzato Q4;
2. il default di output scende a 1600 token, con override
   `MEDIFLOW_ATHENA_MAX_TOKENS` e hard cap 4096;
3. il decoding clinico usa temperatura 0, top-p 1 e seed stabile 7
   sovrascrivibile con `MEDIFLOW_ATHENA_SEED`;
4. lo smoke live DB accetta `--max-tokens` e registra artefatto/quantizzazione
   nel report redatto;
5. la route ATHENA MLX applica il kill switch server-side, resta solo
   session-cookie e rifiuta prompt non marcati
   `mediflow.treatment_reasoning.v1`;
6. il runtime pinna `mlx-lm==0.29.1`, imposta Hugging Face/Transformers/uv in
   modalita offline durante la generazione e non riflette stderr al client;
7. il pannello mostra caveat/limiti e una nota permanente di revisione clinica;
8. la documentazione registra crediti ATHENA paper/repo/model e i risultati
   Q4/BF16.

Misure locali 2026-07-07, tutte redatte e senza raw output:

- Q4 live DB, 3 casi, 1600 token e decoding deterministico: contratto 3/3,
  evidence refs 3/3, latenza 25.5s / 31.0s / 27.8s;
- BF16 live DB, 1 caso, 1600 token: contratto 1/1, evidence refs 1/1, latenza
  63.4s;
- Q4 dopo pin/offline runtime, 1 caso: contratto 1/1, evidence refs 1/1,
  latenza 27.8s.

`mlx_lm.server`, KV cache quantization e prompt cache restano non promossi:
sono candidati performance, ma su questa macchina il server warm ha fallito lo
smoke locale con errore GPU stream, il KV cache Q4 non ha dato un vantaggio
pulito e il prompt cache richiede una lifecycle separata.

## Stop Rules

Fermarsi e aprire ADR/issue separata se una proposta:

- introduce cloud AI o ToolUniverse remoto come default;
- invia PHI/PII fuori dal dispositivo;
- salva prompt completi, risposte raw o trace PHI-bearing;
- scrive direttamente in `therapies`, diagnosi, osservazioni o prescrizioni;
- espone la lane su `/api/v1/network/*`;
- tratta ATHENA-R1 come medical device o direct patient care;
- salta benchmark sintetico, kill-switch o governance ADR 0033;
- usa dati reali non redatti nel repo;
- stampa o salva output live DB non redatto, anche quando il test e
  esplicitamente autorizzato.
- risolve pacchetti Python o scarica modelli dalla rete durante una generazione
  clinica;
- espone stderr/stdout MLX, prompt completi o output grezzi in risposte HTTP,
  log persistenti o report.
