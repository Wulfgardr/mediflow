# PLANS: MediFlow (Piano Engineering Attivo)

Questo è il **piano operativo engineering** (orizzonte settimane), non la roadmap prodotto.
Per direzione prodotto e release narrative, usa [docs/ROADMAP.md](./docs/ROADMAP.md).

> Aggiorna questo file ogni volta che cambia una priorità o la sequenza di esecuzione.

Ultimo aggiornamento: 2026-06-16

---

## Focus corrente (prossime 2-6 settimane)

### Punto fermo post-bug-hunt 2026-06-16
- [ ] Usare [docs/development-push-proposal-2026-06-16.md](./docs/development-push-proposal-2026-06-16.md) come mappa operativa temporanea per il prossimo push: riconcilia `main`, PR aperte, `WUL-341`, `WUL-356`, roadmap post-v0.6 e segnali pubblici da `../leonardopegollo.dev`.
- [ ] Chiudere la fase solo con uno stabilization exit package: merge/hold table PR aggiornata, fix selezionate dal bug hunt distinte dal backlog futuro, claim freeze dichiarato, evidenza CI/locale e piano patch notes/documenti sistema dopo merge reali.
- [ ] Tenere `WUL-373` come issue di consolidamento process/docs e `WUL-374` come issue separata per il copy pubblico del sito; non modificare il sito dentro branch MediFlow.
- [ ] Mantenere credito Kree8 esplicito: forte nel design/app come ispirazione visuale esterna, piu leggero ma presente nel sito quando si racconta il look corrente.
- [ ] Trattare la coda `WUL-356` come nuova coda attiva post-review: le issue `WUL-357`..`WUL-361` sono il safety floor critical prima di nuove promozioni AI/document intelligence; le issue `WUL-362`..`WUL-372` restano slice high/medium da verificare una alla volta, non tutte da assorbire nel prossimo push.
- [ ] Non usare claim pubblici zero-knowledge forti finche `WUL-342`/`WUL-354` non sono risolti o non viene registrata una decisione esplicita di copy freeze/attenuazione.
- [ ] Considerare `WUL-344` e `WUL-335` moltiplicatori di rischio del push: finche restano aperti, ogni PR deve dichiarare quali check locali sono stati eseguiti e quali restano bloccati.

### Post-v0.6.0 (validazione sul campo + hardening bounded)
- [ ] Eseguire validazione sul campo delle superfici UI/AI/home-base rilasciate in `v0.6.0` e riversare bug/regressioni in Linear con priorita esplicite.
- [x] Eseguire le wave di review trasversale `2026-06-09/10` (tracker `WUL-303`) e implementarne i fix sul branch di integrazione sprint, oggi in review: lifecycle soft-delete paziente con purge/restore amministrati (`WUL-306`, ADR 0066), lifecycle unificato delle sotto-risorse cliniche `/api/v1` (`WUL-308`), semantica SET-PRIMARY sulla membership multi-ambulatorio (`WUL-309`), token paired inerti quando la modalita `network home-base` e disattivata (`WUL-307`), repair-db crash-safe (`WUL-321`), date ISO negli artifact di backup schedulato con restore retro-compatibile (`WUL-319`), guard che preserva il ciphertext originale quando il decrypt fallisce (`WUL-323`), robustezza delle route locali su attachments/checkups/settings/system (`WUL-326`), estrazione identita documentale senza fallback data-di-nascita (`WUL-324`), errori dello stream pull Ollama visibili e timeout OCR abortabile (`WUL-325`), coda OCR-needed con replay idempotente post-OCR (`WUL-237`), sequencing dell'autocomplete ICD (`WUL-311`), `statusReason` preservato nel form paziente (`WUL-310`), clear del test-container basato su membership (`WUL-322`), riepilogo `Cosa rivedere adesso` nel dettaglio paziente (`WUL-262`) e Impostazioni ristrutturate in sidebar + sub-route con dashboard `Stato sistema` (`WUL-297`). Il pacchetto non e ancora release.
- [ ] Smaltire la nuova coda follow-up post-review `WUL-329`..`WUL-337` come queue di breve termine. Due priorita esplicite: `WUL-333` resta release blocker perche il lifecycle unificato `/api/v1` e breaking per il client macOS nativo, da riallineare prima della prossima release packaged; `WUL-335` traccia lo smoke e2e rotto su `main`.
- [ ] Mantenere affidabile il verify loop per le patch `0.6.x`: `lint`, `typecheck`, `build` verdi, benchmark CLI generativi eseguibili su `main` e smoke `test:network:home-base-readonly` / `test:network:home-base-write` / `test:network:home-base-diary-write` / `test:network:home-base-therapy-write` / `test:network:home-base-checkup-write` / `test:network:home-base-observation-write` quando si tocca il boundary paired.
- [ ] Fissare prima la mappa ufficiale `SSI/A2A` oltre il `portal-handoff` (`WUL-180`) prima di qualunque tentativo di prescrittivo nativo, `FSE` embedded o altri moduli SISS dentro MediFlow.
- [x] Portare su `main` la first thin slice `home-base` read-only: modalita `network-home-base`, overview Settings, pairing esplicito e primo data plane `/api/v1/network/patients*` (`WUL-117` -> `WUL-122` -> `WUL-150`).
- [ ] Hardening della slice `home-base` gia eseguibile: refinement UX, smoke regolari e chiarimento replica/fallback; primi write remoti limitati a profilo/status paziente, diario, terapie, checkup e osservazioni versionati sotto `WUL-190`, senza hard delete remoto, attachment remoti, cataloghi o sync.
- [ ] Formalizzare e avviare il rollout Apple-native condiviso (`WUL-187`): ADR architettura shared Apple client (`WUL-188`), hardening trasporto paired (`WUL-189`), boundary write remoto reviewable (`WUL-190`), target shell condivisi (`WUL-191`), macOS `home-base` packaged (`WUL-192`) e client iPhone/iPad paired con parity non-AI + cache locale (`WUL-193`, `WUL-194`). Slice `WUL-192` acquisiti: shell Apple/home-base come entrypoint macOS primario, pannello runtime, start/stop esplicito di backend web production + proxy TLS con escalation locale, guard standalone anti-artefatti locali, health diagnostico read-only per Ollama/Docker-ICD e packaging firmabile/notarizzabile via variabili esplicite. Slice `WUL-194` acquisita: manifest QA Apple-wide con evidenza/gap capability-by-capability. Prima slice `WUL-193`: cache mobile cifrata della lista pazienti, stato `offline degradato` in sola consultazione e copy senza overclaim di scritture offline. Slice diario mobile paired: read + create online idempotente (`WUL-206`) e update/annullamento online con conflitto `version` visibile (`WUL-208`). Slice terapie mobile paired: list/create/update/annullamento online per campi manuali non-AI essenziali, con conflitto `version` visibile e senza prescribing SISS o coda offline (`WUL-209`). Slice controlli/osservazioni mobile paired: list/create/update/annullamento online manuale non-AI su LOINC/UCUM e checkup status versionati, senza AI/OCR/offline queue (`WUL-210`).
- [x] Portare su `main` la first slice runtime del `document evidence ledger` (`WUL-152`): artifact canonico `parse/evidence` cifrato sugli allegati, consumer iniziale in `Patient Insight`, `documentInsights` mantenuto come compat layer.
- [ ] Proseguire la document intelligence separando recognition, source governance e decision layer senza rompere i flussi esistenti. Stato WUL-225/WUL-226: OCR primario locale via Ollama/DeepSeek, fallback Apple Vision certificato solo su macOS per output blank/low-signal, nessun fallback platform-specific equivalente dichiarato su Windows/Linux.
- [x] Aprire il corpus documentale locale SISS/FSE 2.0 (`WUL-176`) come base per integrazioni regionali piu profonde, con manifest sorgenti, fetch pubblico ripetibile e placeholder `manual-import` per documenti autenticati/non redistribuibili.
- [x] Portare `WUL-179` al primo stato utile: source sync engine locale con refresh policy, change detection e report di freshness sopra il corpus SISS/FSE.
- [x] Ritirare i preview profiles funzionali da `main` (`WUL-199`) e promuovere il contesto paziente SISS come parte stabile del `Clinical Workbench`.
- [ ] Stabilizzare il nuovo diario protesico (`WUL-204`) con documentazione reale allegata: mantenere `Protesica-RL` come `portal-handoff`, usare campi decodificati locali per ausili/codici ISO/misure/collaudo e aggiornare la skill di lettura semantica dopo esempi documentali reali.
- [x] Riallineare documentazione di riferimento/supporto allo stato corrente di `main` (`WUL-203`): Workbench unico, SISS/FSE corpus, `home-base` read-only, document intelligence artifact-first e direzione Apple condivisa.
- [x] Aggiungere una lettura canonica completa dello stato corrente (`docs/STATE_OF_THE_SYSTEM.md`) e riallineare mappe private/OSS cosi che onboarding profondo, review trasversale e export pubblico partano da un quadro unico.
- [x] Formalizzare il primo `patient import decision` reviewable tra review documentale e persistenza prudente, per distillare il create/merge/apply in un contratto riusabile (`WUL-167`).
- [x] Aggiungere la prima granularita section-aware al `parse/evidence` artifact (`WUL-159`): `sectionMap` opzionale con sezioni classificate, fact anchors `page/section/snippet` e conflitti terapeutici espliciti, senza migrazione DB o auto-write.
- [x] Ridurre il drift della shell locale con revision fingerprint, `/api/system/revision` e reset `.next` source-aware in `Start_MediFlow.command`.
- [ ] Tenere fuori dal runtime operativo le lane ancora `benchmark-only` o di ricerca: `WUL-96`, `WUL-113`, `WUL-114`, `WUL-115` e `WUL-165`, salvo promozione esplicita sostenuta da benchmark, ADR e stop-rules. Slice `WUL-165` acquisita: MLX diventa benchmark-visible e diagnosticabile in read-only nella home-base, con guard `check:mlx-operational-parity`, ma `Ollama` resta runtime clinico generativo standard e motore OCR primario. Dal WUL-225/WUL-226 l'unico fallback OCR platform-specific certificato e Apple Vision su macOS; Windows/Linux restano senza fallback equivalente dichiarato.

Nota operativa:
- `v0.6.0` e la release corrente formalizzata su `main` il `2026-05-02`
- `v0.5.0` resta la release storica di consolidamento AI/UI formalizzata su `main` il `2026-03-29`
- `v0.4.0` resta la baseline storica taggata su `main` il `2026-03-19`
- `WUL-95` resta la thin slice gia acquisita che ha disciplinato il task contract AI; il ciclo successivo sposta il focus su uso reale, rollout governance e architettura home-base
- `WUL-150` ha spostato `home-base` da discovery teorica a first slice eseguibile: pairing PHI-safe, Settings overview e primo read path remoto protetto
- `WUL-187` apre il macro filone Apple-native: core Swift condiviso, Mac `home-base` packaged come runtime host autorevole e parity non-AI di iPhone/iPad solo tramite `/api/v1/network/*`, mai via accesso diretto a SQLite
- `WUL-192` ha raggiunto la definizione minima di packaged home-base: il bundle macOS mostra il shell Apple/home-base, gestisce esplicitamente backend web production e proxy TLS con stop bounded/escalation, espone solo diagnostica read-only per Ollama/Docker-ICD e puo essere firmato/notarizzato tramite variabili esplicite; non dichiara gestione app-managed dei servizi opzionali.
- `WUL-194` apre la verifica Apple-wide post-WUL-192: `docs/apple-wide-parity-qa.md` e `docs/apple-wide-qa-manifest.json` distinguono capability coperte da comandi/runbook e gap ancora assegnati a `WUL-193` per CRUD UI mobile completa e cache/offline.
- `WUL-152` ha trasformato ADR 0040 in primo runtime concreto: `parse/evidence` cifrato sugli allegati, `documentInsights` come projection compatibile e consumer iniziale in `Patient Insight`
- `WUL-225`/`WUL-226` aggiornano la filiera OCR documentale: DeepSeek/Ollama resta primario locale; Apple Vision e fallback locale certificato solo su macOS quando il primario produce output blank/low-signal; Windows/Linux non hanno oggi un fallback OCR platform-specific equivalente e devono fallire esplicitamente quando non c'e testo utile.
- `WUL-176` ha portato su `main` il corpus documentale locale SISS/FSE: manifest versionato, fetch pubblico ripetibile fuori Git e placeholder `manual-import` per le fonti non redistribuibili
- `WUL-179` ha completato il primo layer operativo sopra il corpus: `sync` incrementale, `changeState`, policy di refresh e report locale di freshness, senza introdurre ancora scheduling o daemon dedicati
- `WUL-203` chiude il passaggio documentale post-`WUL-199` / post-`WUL-179`: le mappe, la roadmap, la sintesi architetturale, il changelog e la facciata OSS non devono piu raccontare i preview profiles come runtime disponibile su `main`
- il label Linear `bucket/post-0.4` resta etichetta legacy da separare progressivamente tra backlog post-release e residui storici

### Contesto storico chiuso: Release gate v0.5.0 (consolidamento AI/UI)
- [x] Chiudere il pacchetto UI web orientato alla leggibilita clinica e al first fold operativo: `WUL-94`, `WUL-98`, `WUL-106`, `WUL-107`, `WUL-108`.
- [x] Portare le lane AI core a una baseline release-ready di consolidamento, con focus su task contract condiviso, benchmark generativi eseguibili e governance esplicita del runtime locale.
- [x] Ripristinare il verify loop minimo della release: `lint` confinato ai file sorgente, `typecheck`/`build` verdi e harness CLI dei benchmark generativi di nuovo eseguibili su `main`.
- [x] Tenere fuori dal gate `v0.5.0` le lane ancora `benchmark-only` o di ricerca: `WUL-96`, `WUL-113`, `WUL-114`, `WUL-115`.
- [x] Chiudere la narrativa release in modo coerente e documentato: `v0.4.0` come baseline storica, `v0.5.0` come release di consolidamento AI/UI, `post-v0.5` per nodo centrale locale, replica tra macchine e reboot native.

Nota operativa:
- la validazione manuale desktop/mobile continua nel focus post-release e non va retro-proiettata come gate bloccante ormai chiuso
- `WUL-109`, `WUL-110` e `WUL-111` sono chiusi come coda di hardening AI minima; le lane non promosse restano tracciate dai rispettivi tracker benchmark-only, non dal gate `v0.5.0`

### Contesto storico chiuso: Release gate v0.4 (web/core only)
- [x] Chiudere i bug web/core che bloccano davvero `0.4`: `WUL-56` (ICD header), `WUL-58` (OCR smart su immagini/input non-PDF supportabili), `WUL-60` (placeholder anagrafici in import impegnativa).
- [x] Riallineare Linear sugli issue non bloccanti `0.4`, mantenendoli in `Backlog` senza mischiarli con il push release.
- [x] Chiudere la queue attiva non-macOS in Linear (`Todo`, `In Progress`, `In Review` a zero) lasciando solo backlog intenzionale, tracker e filone native congelato.
- [x] Eseguire la sequenza di stabilizzazione web/core pre-version-bump fissata in [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./docs/adr/0024-web-core-stabilization-before-next-version-bump.md).
- [x] Completare push/tag/patch notes `0.4.0` sullo stato reale di `main`.

Nota operativa:
- il filone parity/macOS resta congelato fino al rebuild controllato della shell nativa
- i punti `P0b` e `P2`-`P6` sotto non bloccano il push `0.4`
- le issue native/miste restano tracciate in Linear ma fuori dal release gate corrente
- il residuo aperto in Linear era composto da backlog intenzionale `bucket/post-0.4`, macro/tracker e `bucket/frozen-native`, quindi non rientrava nel gate `0.4`
- follow-up `2026-05-02`: i tracker macro storici (`WUL-37`, `WUL-39`, `WUL-40`, `WUL-41`, `WUL-42`, `WUL-74`, `WUL-75`, `WUL-187`) sono stati rolluppati e chiusi quando tutti i figli erano gia consegnati; `WUL-85` e stato chiuso come funzionalita nativa gia soddisfatta/superata dalla direzione artifact-first; `WUL-33` e stato cancellato come PoC toolchain stale. `WUL-35` chiude il residuo di governance/toolchain invece di restare come delivery queue attiva.

### 0b) Terminologie cliniche e compliance FSE 2.0 (ADR 0006)
- [x] Portare `ATC` a first-class nei flussi terapia (`AIC + ATC` coerenti su web/native API).
- [x] Introdurre contratto minimo `terminology` su `/api/v1` (systems/search/resolve).
- [x] Introdurre validazione documentale pilota FSE (`error` + `warning`) prima dell'export.
- [x] Avviare thin slice osservazioni con `LOINC + UCUM` su un percorso clinico verticale.
- [x] Introdurre smart import reviewable nel profilo paziente da note/diario/documenti per diagnosi ICD-11 e terapie, mantenendo l'autofill automatico limitato ai soli ICD espliciti (ADR 0012).

### 0c) Affidabilita stack AI locale
- [x] Eseguire `AI-01`: benchmark headless dei resolver reali WHO ICD-11 e AIFA, con corpora sintetici e metriche top-k/latency/ambiguity.
  Completato in `WUL-109`; rieseguito su `main` il `2026-04-07`.
  Snapshot corrente: WHO `top1/topKRecall = 0.714` con gap confinato alle
  query italiane pure; AIFA `top1/topKMatchRate = 0.429`,
  `noResultRate = 0.571`, `stateBlindHitRate = 1`, confermando che il
  resolver resta un matcher di catalogo puro e non dosage/packaging-aware.
- [x] Eseguire `AI-02`: hardening Smart Import sui casi di switch terapeutico, applicabilita suggerimenti e policy `manual|blocked|uncertain`.
  Completato tramite i thin slice post-`v0.5.0` su `main`:
  switch terapeutici normalizzati lato post-processing locale, terapie
  `manual-only` tenute consultive, terapie senza posologia utile non
  persistibili e benchmark `smart-import` riallineato al behavior locale.
  Rieseguito il `2026-04-07` su `qwen3.5:35b-a3b` con
  `contractValidRate = 1`, `dosageRecall = 1`, `therapyStateRecall = 1`.
  Follow-up chiuso lo stesso giorno con un thin slice dedicato sul filtro
  “nessuna novita clinica”: il case referral-only
  `smart-import-referral-known-condition-should-not-create-import-noise`
  ora va a `forbiddenLeakRate = 0` nella lane visibile di runtime/benchmark.
- [x] Eseguire `AI-03`: introdurre corpus e scoring dedicati per `AI Patient Insight` (recency, focus, citation discipline, anti-moralizing).
- [ ] Eseguire `AI-04`: preparare ADR e thin slice lane `PII/redaction` locale in shadow mode, coerente con la valutazione OpenMed. Stato `WUL-96`: benchmark stack chiuso, ma `OpenMed redaction` resta `benchmark-only / not shadow-ready` per leak critici sulle email/mailbox (`email recall = 0.333` sul corpus v3, `0.143` sul corpus email-focused).
- [x] Eseguire `AI-05`: aggiungere input normalization tollerante per PDF e CDA/CCD prima delle lane semantiche.
  Completato in `WUL-110`: helper condiviso di normalizzazione documentale locale (OCR/testo + CDA/CCD) integrato in `document_synthesis`, import/OCR locale, fact pack storico e contesto `Patient Insight`, senza sconfinare in NER/redaction/coding.
- [ ] Eseguire `AI-06`: benchmarkare una lane NER clinica italiana deterministica (`HUMADEX`) solo se migliora auditabilita o coding. Stato `WUL-96`: corpus `clinical_entities.v2`, confronto reale, repeatability a 5 run e promotion gate completati; `HUMADEX` resta davanti a `OpenMed NER` (`0.6/0.7` precision/recall vs `0.5/0.6`), ma entrambi falliscono il gate (`promotionReady = false`) per leak sui case negativi e under-span su problemi composti, quindi la lane resta `benchmark-only`.
- [ ] Eseguire `AI-07`: valutare challenger generativi solo dopo baseline e resolver stabili, senza cambiare il default per intuizione.
- [x] Eseguire `AI-08`: formalizzare rollout/shadow mode/stop-rules delle lane AI prima di qualunque attivazione operativa.
  Completato tramite `WUL-111` e child `WUL-133`..`WUL-144`: runbook canonico, validator locale, artifact persistiti JSON/Markdown, pannello `Settings` read-only, guard notice vicino ai model selector e kill-switch UI-driven per `patient_insight`, `smart_import` e `document_synthesis`. Nessuna lane `benchmark-only` viene promossa da questo closeout.

Nota operativa:
- la sequenza esecutiva dettagliata e in [docs/ai-stack-execution-plan.md](./docs/ai-stack-execution-plan.md)
- il contesto tecnico e i benchmark gia eseguiti restano documentati in [docs/ai-stack-reliability-review.md](./docs/ai-stack-reliability-review.md)
- `AI-03` e ora tracciato in `WUL-123` come harness locale dedicato per corpus, scoring e validator di `Patient Insight`
- `AI-03` e stato rieseguito localmente il `2026-04-04` sul baseline protetto `qwen3.5:35b-a3b`; il validator corrente passa con `contractValidRate = 1`, `focusRecall = 0.95`, `citationCoverageRate = 1` e `preferredSourceCoverage = 1`
- `WUL-113` apre la comparazione fair dei challenger MLX nel solo stack
  benchmark: i runner `ai-task-contracts`, `smart-import`, `model-stack` e
  `model-parliament` ora distinguono `ollama_chat` e `mlx_chat`, mentre il
  runtime applicativo resta invariato; primo seed MLX nel registry:
  `mlx-community/medgemma-1.5-4b-it-bf16`, con challenger HF aggiornato
  `Jackrong/MLX-Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-v2-4bit`
- `WUL-115` chiude la prima decisione reale sul challenger Jackrong MLX:
  il `2026-04-08` il `9B` distillato passa il corpus contrattuale condiviso
  (`jsonValidRate = 1`, `contractValidRate = 1`, `avgLatencyMs = 20500.8`),
  ma su `smart_import` resta sotto la baseline protetta
  `qwen3.5:35b-a3b` (`therapyRecall = 0.9`, `therapyStateRecall = 0.8`,
  `avgLatencyMs = 18185.1` contro `1 / 1 / 14396.4`), quindi resta
  challenger `benchmark-only` e non promotabile nel runtime operativo
- `WUL-114` chiarisce che `TurboQuant` non e un semplice nuovo challenger
  modello: oggi e un tema di runtime/KV cache. La raccomandazione fissata su
  disco e `prototype`, ma solo come serving isolato `benchmark-only`
  (`Ollama` con `OLLAMA_KV_CACHE_TYPE`, `MLX` con `kv-bits`), senza promozione
  nel runtime applicativo o nel parliament corrente
- `WUL-114` ha ora anche un primo harness eseguibile in repo:
  `scripts/mlx-chat-batch-runner.py` confronta `baseline` e `kv_bits` su corpus
  sintetico dedicato; smoke tecnico `2026-04-08` riuscito su
  `mlx-community/Llama-3.2-3B-Instruct-4bit`, ma resta solo prova di
  percorribilita del path `MLX` e non una decisione di promozione runtime
- `WUL-165` chiarisce il significato operativo minimo della parity MLX:
  il path `MLX` e visibile in benchmark, model parliament e diagnostica
  home-base read-only, ma resta fuori dal runtime clinico; il guard
  `check:mlx-operational-parity` blocca drift su default Ollama generativo,
  fallback espliciti e confine benchmark-visible/non-promoted; la successiva
  eccezione OCR certificata e Apple Vision solo macOS, formalizzata in ADR 0059
- `WUL-131` apre la governance del `document intelligence lab`: corpus
  canonico `synthetic-only` in repo + vault locale privato per shadow
  evaluation, come ponte tra `WUL-129` e `WUL-111`
- `WUL-151` apre la lane opzionale `cloud comparator shadow eval`:
  `gpt-5.4` e ammesso solo su case pack privati redatti/minimizzati fuori Git,
  con gate privacy esplicito, audit trail locale e obbligo di distillare ogni
  delta utile in nuovi benchmark sintetici, euristiche o thin slice locali;
  il report deve classificare i gap in `reasoning pattern`, `missing local
  heuristic`, `retrieval/source hierarchy`, `contract/rendering`,
  `review-safety` e `synthetic benchmark gap`, oltre a produrre una
  `localEvolutionAgenda` con candidate thin slice e validation path; resta uno
  strumento interno di engineering e non un percorso di promozione del modello
  cloud nel runtime MediFlow; prima ricaduta runtime gia aperta:
  `patient-insight-focus-recency`, con coda documentale unica per data/priorita
  clinica e date esplicite sulle fonti documentali di `Patient Insight`;
  seconda ricaduta runtime gia aperta: `patient-insight-source-hierarchy-recency`,
  con de-prioritizzazione dei documenti cronici/stale quando una fonte piu
  recente copre gia lo stesso dominio clinico
- `ADR 0040` fissa la prossima north star della document intelligence: dal
  `document_evidence_pack.v2` come pack compatto a un approccio
  `document evidence ledger`, con separazione esplicita tra recognition,
  source governance, decision layer e render/projection
- `WUL-167` apre una thin slice adiacente a `ADR 0040` e `ADR 0042`: il
  create-flow document-driven inizia a produrre un `patient import decision`
  esplicito (`create_new_patient` / `merge_existing_patient` /
  `review_identity`, write strutturate vs note-only) invece di lasciare la
  semantica prudente implicita nel solo apply finale
- `WUL-159` estende il `parse/evidence` artifact in modo compatibile con la
  north star di `ADR 0040`: i nuovi snapshot includono una `sectionMap`
  riusabile con sezioni classificate, ancore fact `page/section/snippet` e
  conflitti/ambiguita terapeutiche da mantenere reviewable prima dei decision
  layer
- `WUL-152` apre la prima slice runtime del nuovo approccio `document evidence
  ledger`: introduce l'artifact canonico `parse/evidence` per documento
  singolo, lo persiste come snapshot cifrato sugli `attachments`, mantiene
  `patients.documentInsights` come projection/compat layer iniziale e porta il
  primo consumer su `Patient Insight`
- `WUL-132` ha aperto il primo sweep reale `AI-07` su `Gemma 4`:
  `gemma4:e2b` e `gemma4:e4b` sono benchmarkati su `M4 Max 36 GB` tramite
  un runtime `Ollama HEAD` isolato, perche la build stabile `0.19.0`
  dell'app locale non riesce ancora a pullare i manifest Gemma 4; risultato
  corrente: entrambe passano la chamber contrattuale generativa ma falliscono
  `Smart Import`, quindi `qwen3.5:35b-a3b` resta baseline protetta e `Gemma 4`
  resta challenger `hold`
- `WUL-133` apre la prima thin slice vera di `AI-08`: runbook canonico
  lane-aware per `shadow mode`, fallback, rollback e kill-switch, senza ancora
  spostare nel prodotto la governance di rollout
- `WUL-134` e il primo passo eseguibile di `AI-08`: validator CLI locale che
  legge report benchmark gia esistenti e produce uno stato `hold` /
  `shadow-ready` / `rollback-required` senza introdurre ancora automazioni UI o
  runtime
- `WUL-135` rende il validator reviewable anche fuori dal terminale:
  persistenza locale canonica del verdict e report Markdown lane-aware,
  senza ancora introdurre API o superfici UI dedicate
- `WUL-136`..`WUL-144` chiudono il resto operativo di `AI-08`:
  surface read-only in `Settings`, coverage dedicata, guard notice sui modelli
  selezionati e kill-switch locali productized per `patient_insight`,
  `smart_import` e `document_synthesis`
- nuove lane o sidecar AI richiedono corpus sintetico, benchmark dedicato e, se cambiano l'architettura, ADR esplicita prima dell'implementazione

### 0) Guardrail e operabilità minima (T00 + T05)
- [x] Formalizzare i controlli "never regress" (no default creds, no egress di default, no regressioni zero-knowledge).
- [x] Definire artifact backup v1 con manifest e metadati di integrità.
- [x] Definire preflight restore (compatibilità schema/versione, integrità, ownership) prima della fase scripting completa.

### 1) Integrità dati e concorrenza esplicita (T04)
- [x] Introdurre semantica di optimistic concurrency (`version`) su entità cliniche prioritarie.
- [x] Applicare compare-on-write a livello API e standardizzare risposta conflitto (`409` + metadata snapshot).
- [x] Coprire con test di scenari write concorrenti web/native.

### 2) Stabilizzazione contratto locale `/api/v1` (T02)
- [x] Definire strategia OpenAPI (`spec-first` vs `source annotations`) per la superficie `v1`. (`docs/adr/0010-openapi-spec-first-for-api-v1.md`)
- [x] Pubblicare baseline OpenAPI per endpoint `v1` stabili. (thin slice iniziale: `docs/openapi/mediflow-v1.yaml`)
- [x] Aggiungere contract checks per prevenire drift non documentato.

### 3) Audit minimo ad alto valore (T03)
- [x] Definire tassonomia eventi audit (auth + CRUD sensibili + settings admin). (`docs/adr/0015-audit-taxonomy-minimum-catalog.md`)
- [x] Implementare write path append-only con campi PHI-safe.
- [x] Assicurare attribuzione attore coerente per chiamate web/native.

### 4) Hardening auth prima di RBAC completo (T01)
- [x] Definire policy lockout/failed attempts e uniformare regole session/token tra web e native. (`docs/adr/0017-auth-lockout-policy.md`)
- [ ] Eseguire RBAC granulare in fase successiva, dopo i controlli base sopra.

### 5) Parità funzionale web/native (mandato)
- [ ] Definire e mantenere una matrice capability-by-capability (view/add/edit/delete/filter) per pazienti, diario clinico, terapie, appuntamenti, farmaci, esenzioni.
- [ ] Rendere `/api/v1/*` il contratto locale canonico per le funzioni condivise tra client.
- [ ] Chiudere i gap CRUD nativa rispetto al web, senza introdurre storage duplicato o percorsi separati per i dati.
- [ ] Applicare il modello ADR 0008: delivery web-first + parity sweep periodici su macOS, con backlog gap sempre esplicito.
- [ ] Garantire per i moduli core il target parity: stessa funzione, stessi campi, stessa flessibilita, stessa autonomia operativa tra web e macOS.

#### 5a) Sequenza esecutiva parity (step-by-step)
- [x] `P0` Baseline parity matrix versionata (web vs macOS) sui 6 moduli core, distinguendo chiaramente `contratto API` vs `UI disponibile`. (`docs/parity-matrix.md`)
- [x] `P0b` Stabilizzare harness smoke parity (web Playwright + native XCTest/Xcode + click-map macOS) su ambiente isolato/VM.
- [x] `P0b.a` Introdurre runner unificato parity smoke + report artifacts (`scripts/parity-smoke.sh`, `docs/parity-smoke.md`).
- [x] `P0b.b` Definire checklist click-map macOS per run manuali ripetibili (`docs/parity-click-map-macos.md`).
- [x] `P0b.c` Eseguire run strict web+native required con Playwright disponibile. Evidenza `WUL-21` del 2026-05-02: `MEDIFLOW_PARITY_REQUIRE_WEB=1 MEDIFLOW_PARITY_REQUIRE_NATIVE=1 MEDIFLOW_PARITY_NATIVE_RUNNER=xcode`, web smoke `2/2` e Xcode native `45/45` passati. `WUL-26` non chiude la parity piena: certifica solo la lane automatizzata, mentre la click-map manuale capability-by-capability resta il gate `P6`.
- [x] `P1` Pazienti native: completare `edit/delete/archive/search/sort` e filtri stato (`attivi/archiviati`) in UI macOS.
- [x] `P2` Esenzioni native: aggiungere selector/search su `/api/v1/exemptions` e salvataggio in create/update paziente. Evidenza `WUL-22`: UI macOS gia presente in create/edit paziente con search/select, persistenza cifrata anche della lista vuota e roundtrip sul contratto condiviso `/api/v1/exemptions`; la gestione cataloghi in Settings resta separata in `P5`/`WUL-25` e la prova manuale completa resta nel gate `P6`.
- [x] `P3` Osservazioni native: esporre in UI macOS il CRUD `LOINC + UCUM` gia disponibile a contratto (`/api/v1/patients/:id/observations`). Evidenza `WUL-23` del 2026-05-02: UI macOS gia presente con lista/create/edit/delete, editor LOINC/UCUM, validazioni e test nativi su payload, route client ed editor; la click-map manuale completa resta nel gate `P6`.
- [x] `P4` Diario clinico: allineare semantica delete web/native (soft delete + restore + reason) per evitare drift comportamentale. Evidenza `WUL-24` del 2026-05-02: `/api/v1/patients/{id}/entries*` locale nasconde i tombstone di default, espone `includeDeleted=true`, soft-delete/restore via `PUT`, `DELETE` locale sicuro come tombstone validato, macOS usa reason sheet + restore e non usa piu hard delete per le entry.
- [x] `P5` Cataloghi farmaci/esenzioni: minima operabilita native in Settings senza storage duplicato. Evidenza `WUL-25` del 2026-05-02: pane macOS `Cataloghi` con status/count, import JSON e clear per farmaci via `/api/v1/drugs` ed esenzioni via `/api/exemptions`, piu test nativi sulle route client.
- [x] `P6` Chiusura parity legacy: closeout documentale eseguito in `WUL-26` il 2026-05-02 dopo `WUL-25`/`WUL-76`/`WUL-77`; strict smoke web+native required passato in `tmp-parity-smoke/wul-26-20260502-post-module-closeout-rerun/summary.md`. Esito: nessun gap modulo-specifico legacy resta aperto, ma non si dichiara UI parity piena della vecchia shell clinica; con `WUL-192` il bundle macOS passa al shell Apple/home-base e la prossima click-map capability-by-capability passa al filone Apple-native/home-base (`WUL-187`/`WUL-194`).

Ordine di consegna consigliato (incrementale):
1. `P0` + `P1`
2. `P2`
3. `P3`
4. `P4`
5. `P5`
6. `P6`

### 6) Hardening: coerenza API <-> UI
- [ ] Garantire che ogni chiamata `ApiTable.update/delete()` abbia una route backend corrispondente (es. `PUT/DELETE /api/<resource>/:id`).
- [ ] Allineare le interfacce TypeScript in `lib/db.ts` con lo schema SQLite in `lib/schema.ts` (evitare "campi fantasma").
- [ ] Rimuovere/sostituire patch schema runtime con migrazioni Drizzle esplicite (evoluzione DB tracciabile).
- [x] Eseguire la sequenza di stabilizzazione web/core pre-version-bump fissata in [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./docs/adr/0024-web-core-stabilization-before-next-version-bump.md): helper condiviso route paziente, helper shared fields paziente, gate `typecheck`, split incrementale `SecurityProvider`/`SettingsPage`.

### 7) DX / Igiene repository
- [x] Aggiungere script `typecheck` (es. `tsc --noEmit`) e documentare il loop di verifica.
- [x] Garantire onboarding docs autorevoli e aggiornati (README + CONTRIBUTING + ARCHITECTURE). Snapshot WUL-203: 2026-04-26.

---

## Next (dopo il focus corrente)

- [x] Continuare il filone backup dopo la thin slice `WUL-30` con `WUL-31`: retention automatica limitata ai backup scheduler-owned (`keep-last-N` + dry-run/apply) nella cartella utente selezionata.
- [ ] Estendere il ciclo `post-v0.6`: pairing UX/home-base, replica/fallback offline, runtime AI centralizzabile e hardening controllato del bundle Apple/home-base.
- [ ] Miglioramenti export dati (FHIR + human-readable) e validazione.
- [ ] CI: lint + build + controlli minimi su PR.

Nota operativa per il filone UI web `v0.5.0` (`WUL-98`, label Linear legacy `bucket/post-0.4`):
- la leadership autoriale di UI/UX puo essere delegata a Gemini quando il focus e strettamente di interfaccia
- Codex mantiene i guardrail su scope, regressioni comportamentali, accessibilita, compliance repo e gestione Linear
- direzione d'uso: intuitivita clinica, leggibilita alta e cockpit Kree8/root live come unica interfaccia ufficiale su `main`; Graphite/Clinical Workbench resta riferimento storico per il principio no-selector
- tesi visiva esplicita: unire ricercatezza e immediatezza in una sola shell operativa, con chrome caldo, layering sobrio e orientamento rapido sul caso
- la fase di confronto runtime `Clinico` / `Liquid` e chiusa: eventuali nuove esplorazioni visive non vivono come toggle persistiti sul prodotto reale
- principi da rispettare nella lane UI:
  - il layering glass resta grammatica di navigazione e focus, non una modalita alternativa separata
  - uso parco del glass nei controlli custom: evitare layering e overcrowding di superfici traslucide
  - separazione chiara tra contenuto clinico e chrome di navigazione
  - corner radius morbidi e concentrici, senza durezza geometrica gratuita
  - profondita multilayer `frosted` + `liquid` usata per gerarchia e focus, non come decorazione diffusa
  - colore giudizioso nei controlli per preservare leggibilita, contrasto e accessibilita
  - tono generale: sofisticato, leggibile, un po' giocoso, ma sempre operativo
- non esistono piu preview profile runtime su `main`: eventuali nuove sperimentazioni vivono come workstream espliciti, non come selector persistito nel prodotto

---

## Parking lot (idee, non impegnate)

- [ ] Prototipo sync local-only (computer home base <-> client iOS/iPad): discovery + pairing + cache + riconciliazione.
- [ ] Moduli clinici aggiuntivi (scale, report, interazioni) dopo stabilizzazione della base.

---

## Riferimenti

- Regole source-of-truth: [AGENTS.md](./AGENTS.md)
- Mappa documentale canonica: [docs/README.md](./docs/README.md)
- Inventario markdown completo: [docs/markdown-index.md](./docs/markdown-index.md)
- Visione architetturale: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Contributi / verify loop: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Policy sicurezza: [SECURITY.md](./SECURITY.md)
- ADR: [docs/adr/](./docs/adr/README.md)
- Walkthrough tecnico: [docs/walkthrough.md](./docs/walkthrough.md)
