<!-- Claude: direttiva utente 2026-07-12 -->
# ADR 0077: Astrazione provider del runtime AI e confine di anonimizzazione per l'egress

Date: 2026-07-12
Status: Proposed

Related: ADR 0028 (stack-aware AI model evaluation matrix), ADR 0029 (AI model
parliament and local retention policy), ADR 0033 (AI rollout governance
lane-aware shadow mode), ADR 0037 (network AI plane), ADR 0039 (cloud
comparator shadow evaluation), [ADR 0065](./0065-intended-purpose-and-claims-guard.md),
[ADR 0070](./0070-in-house-first-for-buildable-logic.md), la governance rollout
AI locale, il benchmark di redazione OpenMed e
[lib/ai-service.ts](../../lib/ai-service.ts).

## Problema

Il runtime AI di MediFlow e oggi monolitico su Ollama: `AIProvider = 'ollama'`
e un tipo con un solo valore, le assunzioni Ollama-specifiche (formato
messaggi, `think:false`, `keep_alive`, proxy `x-target-url`, euristica
anti-`:8080`) sono sparse tra servizio, proxy e contratti, e le impostazioni
conoscono solo `aiModel_<ruolo>` come stringa nuda.

Questo blocca tre evoluzioni gia richieste dalla visione di prodotto:

1. **Eterogeneita locale**: runtime alternativi on-device (server
   openai-compatible come MLX, llama.cpp, LM Studio, vLLM) sono il percorso
   realistico per i profili hardware bassi e per la parita Windows/Linux, ma
   oggi non sono collegabili senza forkare `AIService`.
2. **Runtime LAN centralizzato** (ADR 0037): la capability dichiarata non ha
   un punto di innesto pulito nel client.
3. **Assist cloud opzionale**: un provider frontier (OpenAI, Anthropic) come
   lente per i casi difficili e oggi impossibile da valutare nel runtime senza
   violare gli invarianti privacy, perche non esiste un confine di egress
   strutturale: esiste solo il comparatore shadow fuori runtime (ADR 0039).

## Contesto

- Il local-first resta l'identita del prodotto: nessun cloud di default,
  nessun PHI fuori dal dispositivo senza decisione esplicita documentata
  (SECURITY.md, ADR 0065). Il wording dei claim zero-knowledge resta congelato
  sotto WUL-342/354.
- La lane redaction e l'unico prerequisito tecnico credibile per qualunque
  egress: OpenMed e stato misurato e resta `benchmark-only / not shadow-ready`
  (leak rate email/mailbox troppo alto); il candidato corrente e GLiNER2-PII
  con layer regex deterministico in-app come primo strato obbligatorio.
- La governance esistente (parliament, rollout readiness, kill switch
  fail-closed, `forbiddenLeakRate = 0`) e l'asset da riusare identico: un
  provider nuovo e un candidato come lo e un modello nuovo.
- ADR 0070 (in-house-first) resta valido: il confine esplicito ammesso per le
  dipendenze esterne e esattamente quello che questo ADR definisce.

## Opzioni

1. Restare Ollama-only e rimandare ogni astrazione.
2. Aggiungere provider con `if` dentro `AIService` man mano che servono.
3. Introdurre un'astrazione `ProviderAdapter` con registry, binding per ruolo
   nelle impostazioni, e un **egress gate** strutturale che rende i provider
   cloud raggiungibili solo attraverso anonimizzazione fail-closed e consenso
   esplicito.

## Trade-off

- Opzione 1: zero rischio oggi, ma ogni frontiera (profili hardware, LAN,
  cloud assist) resta bloccata e il debito Ollama-specifico continua a
  crescere nei contratti.
- Opzione 2: veloce, ma replica il pattern che ha gia prodotto proxy gemelli
  incoerenti e euristiche URL duplicate; il confine privacy resterebbe una
  convenzione, non una struttura.
- Opzione 3: piu lavoro iniziale e una superficie settings piu ricca da
  spiegare, ma il confine privacy diventa un chokepoint verificabile e ogni
  provider futuro costa un adapter, non un fork.

## Decisione

Adottiamo l'opzione 3, in slice successive e con default invariati.

### 1. Astrazione ProviderAdapter

- Nuovo modulo `lib/ai-providers/` con interfaccia unica:
  `chat`, `listModels`, `health`, `pullModel` (opzionale), piu metadati
  dichiarativi: `id`, `kind: 'local' | 'lan' | 'cloud'`, capability
  (vision, json mode, streaming, thinking) e requisiti di gate.
- `OllamaAdapter` estrae 1:1 il comportamento attuale di `AIService`
  (refactor puro, zero cambi di comportamento, test invariati verdi).
- `AIService` resta la facciata per i chiamanti: nessun call-site di lane
  cambia firma.
- Le assunzioni specifiche del modello/provider oggi cablate nel layer
  contratti (marker `<think>`, `<unused94>`) migrano verso il provider in una
  slice dedicata, coordinata con il refactor prompt gia in volo (WUL-491).

### 2. Registry e binding nelle impostazioni

- Registro provider persistito nelle impostazioni locali: per ogni provider
  `id`, `kind`, `baseUrl`, eventuale credenziale cifrata nel DB locale (mai
  in export, mai in backup portabili, mai in OSS export).
- Binding per ruolo: `ruolo -> { providerId, model }` per `clinical`,
  `reasoning`, `ocr` e ruoli futuri (`stt`, `redaction`), con migrazione
  trasparente delle chiavi legacy `aiModel_*` e default identici a oggi
  (Ollama + qwen3.5:35b-a3b / deepseek-ocr).
- Il registro dei ruoli diventa esplicito e dichiarativo: ogni ruolo dichiara
  kill switch, lane di benchmark e copertura del rollout guard. Chiude la
  classe di problemi "ruolo fantasma" (reasoning senza consumer ieri, ocr
  senza guard oggi).

### 3. Ordine dei kind e default

- `local` resta il default operativo (Ollama, poi openai-compatible locale
  loopback-only). Nessun cambiamento per chi non tocca le impostazioni.
- `lan` implementa la capability ADR 0037 quando il nodo home-base la
  dichiara: stesso adapter openai-compatible, trust boundary del pairing.
- `cloud` esiste come kind ma NON e istanziabile senza l'egress gate attivo:
  il costruttore fallisce, non degrada.

### 4. Egress gate (confine di anonimizzazione)

Chokepoint unico `lib/ai-egress-gate.ts`, fail-closed, attraversato da ogni
payload diretto a un provider `cloud` (e riusabile per qualunque egress
futuro):

- **Layer 1 obbligatorio, deterministico, in-house** (ADR 0070): regex e
  lookup locali per CF, NRE, tessera TEAM, codice nosologico, telefoni,
  email, date di nascita, piu i nomi/cognomi noti dall'anagrafica locale del
  paziente in contesto.
- **Layer 2 neurale** (NER PII, candidato GLiNER2-PII): obbligatorio per il
  testo narrativo appena una lane redaction supera i gate ADR 0033; finche
  non esiste una lane redaction almeno `shadow-ready`, il gate rifiuta
  l'egress di testo narrativo clinico. Punto di stato attuale: OpenMed resta
  benchmark-only, quindi oggi il gate e chiuso per costruzione.
- **Pseudonimizzazione coerente**: i token sostitutivi sono deterministici
  per sessione; la mappa di reidratazione vive solo in RAM locale e l'output
  del provider viene reidratato localmente prima del render.
- **Minimizzazione**: parte solo il contesto richiesto dall'envelope della
  lane, mai il documento intero quando bastano le sezioni.
- **Audit locale append-only**: per ogni egress si registrano hash del
  payload, conteggi di entita redatte, provider, lane e esito. Mai il
  contenuto.
- **Parametri provider**: `store: false` o equivalente dove l'API lo
  prevede; la scelta di endpoint e data-retention del vendor resta una
  responsabilita dichiarata dell'operatore, non un claim di MediFlow.

### 5. Consenso e provenienza

- Impostazione globale `Consenti provider cloud` con default OFF; si attiva
  solo da una superficie dedicata che spiega in linguaggio onesto cosa parte,
  cosa viene redatto e cosa resta locale (niente meta-testo).
- Il binding di un ruolo o di una lane a un provider cloud e sempre un atto
  esplicito nelle impostazioni; nessuna promozione silenziosa.
- Ogni superficie che mostra output passato dal cloud porta il badge di
  provenienza gia previsto dal design (Struttura / Documento / AI), esteso
  con l'indicazione del kind di provider e della redazione applicata.

### 6. Governance invariata

- Un provider nuovo entra come candidato `benchmark_only`, passa parliament e
  rollout readiness per lane come qualunque modello, con gli stessi gate
  (`forbiddenLeakRate = 0` non negoziabile) e shadow-first.
- Kill switch fail-closed per lane restano l'interruttore operativo; il gate
  cloud vi si aggiunge, non li sostituisce.
- L'AI resta assistiva e review-first (ADR 0065): il cloud non cambia il
  perimetro delle decisioni, cambia solo dove gira l'inferenza di una lane
  esplicitamente configurata.

## Conseguenze

- Il local-first smette di essere difeso dall'assenza di alternative e viene
  difeso da un confine verificabile: la strada cloud esiste, ma e
  strutturalmente impossibile senza redazione promossa, consenso esplicito e
  audit.
- I profili hardware bassi guadagnano un percorso reale (runtime
  openai-compatible locali) senza toccare le lane.
- Il runtime LAN (ADR 0037) trova il suo punto di innesto naturale.
- La superficie settings cresce: serve cura UX per non trasformare Modelli in
  un pannello da sistemista.
- Nasce un asset riusabile (egress gate + audit) per ogni futura
  integrazione che tocchi l'esterno.

## First Thin Slice

1. Estrarre `OllamaAdapter` e il registry con binding per ruolo, refactor
   puro con default invariati; migrazione chiavi legacy; test dedicati.
2. Dichiarare il registro ruoli (kill switch + lane benchmark + guard) ed
   estendere il rollout guard al ruolo `ocr`.
3. Scheletro di `lib/ai-egress-gate.ts` con il solo layer 1 deterministico e
   lo stato `closed_pending_redaction_lane` esplicito, piu audit locale.
4. Superficie settings minimale: lettura del registry, kind visibile,
   nessun provider cloud offerto finche il gate e chiuso.

## Fuori Scope

- Qualunque adapter cloud operativo (bloccato dal gate finche la lane
  redaction non supera i gate ADR 0033).
- Streaming delle risposte (slice separata, prioritaria per STT).
- Routing automatico tra provider in base al caso clinico.
- Telemetria remota, registry remoti di modelli, download automatici.
- Modifiche all'envelope `mediflow.ai.extract.v1` e ai contratti delle lane.
