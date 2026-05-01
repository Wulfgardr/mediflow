# Changelog

Questo file raccoglie i cambiamenti rilevanti di MediFlow.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
e questo progetto aderisce al [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-05-01

### ✨ Aggiunto

- **Home-base read-only eseguibile**: modalita `network-home-base`, overview Settings, pairing PHI-safe e primo data plane `/api/v1/network/patients*` protetto da `paired client + sessione operatore`.
- **Document intelligence piu esplicita**: first slice runtime del `document evidence ledger` con artifact `parse/evidence` cifrato sugli allegati e primo consumer artifact-first in `AI Patient Insight`.
- **Nuova anagrafica document-driven reviewable**: create-flow da documento con review esplicita, riconciliazione locale ICD/AIFA e persistenza prudente delle terapie confermate.
- **Clinical Workbench unico su `main`**: preview profiles runtime ritirati; AI, Smart Import e contesto paziente SISS/FSE vivono nella shell ufficiale.
- **Corpus SISS/FSE locale**: manifest sorgenti, sync incrementale e report di freschezza preparano le integrazioni regionali future senza entrare nel runtime clinico.
- **Lane AI opt-in e shadow-only piu disciplinate**: comparator cloud `gpt-5.4` per engineering interno e adapter OpenMed `redaction.v1` separato dal runtime clinico.

### 🧪 Migliorato

- **Smart Import piu prudente**: normalizzazione therapy-state, guard su terapie `manual-only` o senza posologia sufficiente e soppressione dei duplicati referral-only quando la fonte non introduce novita clinica.
- **Input documentali piu robusti**: normalizzazione condivisa per PDF/CDA/CCD e riuso della stessa recovery path nei consumer documentali principali.
- **Resolver clinici benchmarkabili**: runner dedicati WHO ICD-11 e AIFA per misurare recall, latenza e mismatch reali sul catalogo locale.

### 🔒 Hardening

- **Shell locale piu resiliente ai drift di revisione**: fingerprint di sorgente, endpoint `/api/system/revision`, reload soft delle tab attive e reset `.next` source-aware nello start script.

### 📚 Documentazione

- **Lettura completa dello stato sistema**: aggiunto `docs/STATE_OF_THE_SYSTEM.md` come punto canonico unico per prodotto, runtime, dati, sicurezza, AI/document intelligence, home-base, SISS/FSE, Apple clients e split private/OSS.
- **Repo/GitHub riallineati al runtime reale**: README, piani, walkthrough, topologia dati, roadmap e sintesi architetturale descrivono ora `home-base` read-only, artifact `parse/evidence`, comparator/shadow lane e guard di revisione della shell locale.
- **Narrativa `v0.5` piu chiara**: README, FAQ, roadmap, architettura e mappe documentali raccontano lo stato corrente senza confronti interni, con Clinical Workbench unico, boundary SISS attuale e direzione `macOS + iPadOS/iPhone` tramite `home-base`.
- **Sweep WUL-203**: riferimento, supporto e overview docs riallineati allo stato corrente di `main`, con rimozione dei residui che presentavano i preview profiles come runtime disponibile.
- **Copy pubblico piu armonico**: le superfici GitHub privilegiano prodotto, architettura e uso reale, senza rimandi a processi interni o screenshot non piu rappresentativi.

## [0.5.0] - 2026-03-29

> Nota release: `v0.5.0` consolida il lavoro UI/AI entrato su `main` dopo `v0.4.0`. La shell macOS storica resta fuori scope e continua la **riscrittura controllata**; restano invarianti il contratto locale `/api/v1`, il trasporto TLS e i vincoli security/local-first.

### ✨ Aggiunto

- **Governance AI locale più esplicita**: envelope condiviso `mediflow.ai.extract.v1`, benchmark headless sui task contract, benchmark `smart import`, registro candidati `model stack` e `model parliament` con artifact locali versionabili.
- **Lane benchmark-only separate per toolkit clinici esterni**: benchmark `redaction.v1` e `clinical_entities.v1` con adapter locali `OpenMed`/`HUMADEX`, runbook dedicati e stop-rules esplicite senza toccare il runtime applicativo.

### 🧪 Migliorato

- **Interfaccia clinica web**: scheda paziente, lista, form e shell impostazioni convergono verso una gerarchia visiva più leggibile, con linguaggio `liquid glass` più disciplinato e first fold più operativo.
- **Coerenza operativa web/native**: attribuzione audit per i client native preservata sul mainline e refresh auth/preview più affidabile dopo sblocco o bootstrap locale.

### 🐛 Risolto

- **Verify loop locale**: `eslint` torna confinato ai sorgenti e non attraversa più gli artifact generati locali in `tmp/**` e `.venv_openmed/**`.
- **Benchmark CLI generativi**: i runner TypeScript usati con `node --experimental-strip-types` risolvono di nuovo correttamente i moduli relativi, evitando il fail immediato in module resolution.

### 📚 Documentazione

- **Narrativa release riallineata**: README, roadmap, piano engineering e mappa documentale canonica raccontano ora `v0.5.0` come release corrente, lasciando `v0.4.0` come baseline storica e spostando home-base/native rebuild nel `post-v0.5`.

## [0.4.0] - 2026-03-19

> Nota release: dopo `v0.4.0` il filone `macOS/parity` viene sospeso e spostato in **riscrittura controllata** della shell nativa. Restano fonte di verita il contratto locale `/api/v1`, il trasporto TLS e i vincoli security/local-first; la delivery native sul vecchio client non continua oltre questo snapshot.

### ✨ Aggiunto

- **Smart import reviewable nel profilo paziente**: suggerimenti locali e confermabili per diagnosi ICD-11 e terapie a partire da note, diario clinico e documenti già analizzati.
- **Pipeline documentale OCR-first strutturata**: archivio intelligente con sintesi, qualità documento e autofill prudente delle sole diagnosi ICD esplicite.
- **Contratto `/api/v1` esplicito e conflict-aware**: baseline OpenAPI versionata, guard anti-drift, `version` ottimistico sui pazienti e risposta `409 VERSION_CONFLICT` coerente tra web e superfici condivise.
- **AI Patient Insight spiegabile**: citazioni claim-level, sezione `Fonti usate per i claim`, limiti noti espliciti, esclusione di note narrative contaminate e guardrail su output deboli o inconsistenti.
- **AI Patient Insight configurabile**: nuovi mode `full-auto` / `pro`, preset hardware e tuning locale dalle impostazioni senza dipendenze cloud.
- **Lifecycle backup v1 completo**: artifact con manifest e preflight restore, scheduler notturno locale via `launchd` e retention `keep-last-N` con anteprima dry-run/apply.
- **Cambio PIN zero-knowledge**: rotazione delle credenziali con re-wrap client-side della master key, senza ricifrare il dato clinico lato server.
- **Terminology registry locale**: versione attiva dei sistemi terminologici persistita in `settings` e letta dalle route `/api/v1/terminology/*`.
- **Integrazione SISS foundation**: baseline canonica, adapter locale con error taxonomy/correlation ID e handoff controllato dal pannello prescrizione.
- **Audit trail operativo**: writer append-only PHI-safe, attribuzione attore coerente e primo riepilogo analytics da eventi audit.

### 🧪 Migliorato

- **Operabilità documentale**: l'Archivio Intelligente può essere ripulito per singolo documento o completamente, con refresh coerente di `AI Patient Insight`, e ora persiste anche le terapie estratte dai documenti in `documentInsights`.
- **Patient PDF report**: report esteso con sezioni cliniche più complete e copertura automatica sulle sezioni generate.
- **Clinical facts benchmark**: introdotto il corpus sintetico per osservazioni `LOINC/UCUM`, con decisione `hybrid` di default e fallback `rules` tracciato.
- **Stabilizzazione web/core pre-version-bump**: normalizzazione condivisa dei payload paziente, parsing condiviso dei campi strutturati, gate `typecheck` stabile e scomposizione incrementale dei file più densi (`SecurityProvider`, `SettingsPage`).
- **Tooling di progetto**: strumenti di manutenzione piu ordinati, import backlog automatizzato e controllo piu esplicito della pubblicazione.

### 🐛 Risolto

- **Header diagnosi ICD in scheda paziente**: i campi JSON del paziente vengono di nuovo deserializzati correttamente lato web e l'intestazione mostra chip ICD leggibili con stato vuoto esplicito.
- **OCR smart su immagini e input localmente supportabili**: upload, import e diario condividono ora la stessa detection documentale; immagini comuni passano nel flusso OCR senza rifiuti ambigui.
- **Import da impegnativa più prudente**: nome e cognome non vengono più popolati con placeholder template come `NOME` e `COGNOME` quando il dato reale non è affidabile.
- **Warning build `pdfjs-dist/canvas`**: caricamento server-side differito per eliminare il rumore in `next build` senza introdurre dipendenze extra.
- **Restore backup artifact**: ripristino reso sincrono e protetto da un gate preflight esplicito prima della fase distruttiva.
- **Drift di review/stato**: riallineati branch, worktree e issue principali per ridurre falsi `In Review` o `Done` non supportati da `main`.

### 🔒 Hardening

- **Contract checks** su `/api/v1` per prevenire modifiche non documentate o breaking change silenziosi.
- **Integrity guardrails** su write path paziente con semantica conflict-aware e payload PHI-safe.
- **Never-regress policy eseguibile**: check automatici contro credenziali di default, egress non voluto, telemetria e regressioni zero-knowledge.
- **Policy auth più robuste**: lockout persistito sui tentativi falliti e bootstrap secure-first per i token locali.

### 📚 Documentazione

- **Walkthrough e mappe canoniche aggiornate** per flusso OCR-first, smart import reviewable, backup scheduler/retention, parity sweep e governance OpenAPI.
- **Baseline e matrici canoniche** aggiunte per GTW/FSE, SISS certificato, benchmark clinical facts e stabilizzazione web/core pre-release.
- **Freeze esplicito del filone macOS**: patch notes, roadmap e guide native chiariscono che la parity macOS entra in rebuild controllato dopo `v0.4.0`, senza bloccare l'evoluzione web/core.
- **Indice markdown e playbook operativi** estesi per rendere ricostruibile il lavoro tra repository, documentazione e verifiche.

## [0.3.1] - 2026-02-18

### ✨ Aggiunto

- **Terminology v1 (thin slice)**: endpoint versionati `/api/v1/terminology` (`systems`, `search`, `resolve`) per codifiche cliniche estendibili.
- **Osservazioni cliniche (LOINC + UCUM)**: Primo percorso verticale completo su schema, API web/v1 e contratti client native.
- **Pre-check export FSE**: Validazione documentale pre-export con semantica `error` (bloccante) e `warning` (confermabile).
- **Export FHIR più visibile**: CTA esplicita in scheda paziente e labeling utente più chiaro.

### 🧪 Migliorato

- **Terapie first-class AIC + ATC**: allineamento su schema, API web, API v1 e client native.
- **Live query più efficienti**: ottimizzato refresh e caricamento su percorsi ad alta frequenza di update.
- **Coerenza UX FHIR/FSE**: nomenclatura e percorso export resi espliciti in UI.

### 🔒 Hardening

- **Validazione payload più stretta** su ambulatori e operazioni bulk pazienti (`assign`, `unassign`, `move`, `duplicate`).
- **Status normalization + 404 coerenti** su route item (`entries`, `therapies`, `checkups`) in superficie web e v1.
- **Regole ambulatori più robuste**: vincolo single-default e protezioni su cancellazione con pazienti collegati.

### 📚 Documentazione

- **Mappa canonica documentazione** (`docs/README.md`) con ordine fonti e responsabilità per tema.
- **Classificazione documenti** con stato `CANONICAL`, `SECONDARY`, `LEGACY`.
- **Allineamento release docs**: intestazioni versione, roadmap e metadati documentali.

### 🙏 Tributo OpenHospital

- Questo rilascio è anche un tributo a OpenHospital: non una copia 1:1, ma un percorso di apprendimento e adattamento di pratiche mature (guardrail, integrità dati, contratti API espliciti, auditabilità) al modello local-first/zero-knowledge di MediFlow.
- La traiettoria di allineamento resta esplicita e incrementale, con evidenza operativa mantenuta separata dal racconto di prodotto.

### 🗓 Timeline (ieri e oggi)

- **2026-02-17**: snapshot di sicurezza pre-riordino (`0fb40c1`) per congelare lo stato prima degli interventi strutturali.
- **2026-02-18**: delivery di thin slice terminologie/FSE, hardening API, ottimizzazioni live query, UX export FHIR/FSE e riordino documentazione strategica.

## [0.3.0] - 2026-01-21

### ✨ Aggiunto

- **Onboarding Wizard**: Nuova procedura guidata al primo avvio per la configurazione del Profilo Utente (Nome Medico, Clinica) e consenso Privacy.
- **Profilo Utente Dinamico**: La Sidebar e l'intestazione ora mostrano i dati configurati dall'utente invece di placeholder statici.
- **Backup & Restore**:
  - Esportazione completa del database e delle chiavi di sicurezza in formato JSON cifrato (`.mediflow`).
  - Procedura di ripristino (distruttiva) per recuperare i dati su una nuova installazione.
- **Tabella Impostazioni**: Nuova tabella `settings` nel database IndexedDB per gestire le preferenze utente.
- **GDPR Compliance**:
  - Aggiunto disclaimer chiaro nel README sullo stato "Best Effort" della compliance.
  - Implementato "Privacy by Design" tramite crittografia locale.

### 🔒 Sicurezza

- **App Lock**: Sistema di blocco automatico con PIN.
- **Encryption at Rest**: Tutti i dati sensibili (note, diario, contatti) sono cifrati con AES-GCM-256 prima di essere salvati su disco.
- **Zero Knowledge**: Le chiavi di cifratura sono derivate dal PIN utente e non lasciano mai il dispositivo.

### 🐛 Risolto

- **Fix Duplicati Cursore**: Corretto un bug critico in `lib/db.ts` che causava loop infiniti e duplicati visivi nelle liste paginated quando il cursore raggiungeva la fine (EOF).
- **Fix Build Types**: Risolti errori TypeScript relativi all'interfaccia `DBCoreMutateRequest` e `AppSetting`.

### 📦 Infrastruttura

- **Docker All-in-One**: Nuovo `docker-compose.yml` che avvia App (Next.js), ICD-API e Ollama.
- **Script di Avvio**: `Start_MediFlow.command` semplificato per macOS ("Click & Run").
