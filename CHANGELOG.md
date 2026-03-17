# Changelog

Questo file raccoglie i cambiamenti rilevanti di MediFlow.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
e questo progetto aderisce al [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-03-17

### ✨ Aggiunto

- **Smart import reviewable nel profilo paziente**: suggerimenti locali e confermabili per diagnosi ICD-11 e terapie a partire da note, diario clinico e documenti già analizzati.
- **Pipeline documentale OCR-first strutturata**: archivio intelligente con sintesi, qualità documento e autofill prudente delle sole diagnosi ICD esplicite.
- **Contratto `/api/v1` esplicito**: baseline OpenAPI versionata e guard anti-drift per mantenere stabile la superficie condivisa tra web e client native.
- **Concorrenza esplicita sui pazienti**: `version`, compare-on-write e risposta `409 VERSION_CONFLICT` coerente su web e `/api/v1`.

### 🧪 Migliorato

- **Verifiche parity e qualità**: smoke harness web/macOS, click-map macOS e suite dedicata per conflitti di scrittura cross-client.
- **Operabilità documentale**: l'Archivio Intelligente ora può essere ripulito per singolo documento o completamente, con refresh coerente di `AI Patient Insight`.
- **Tooling di progetto**: playbook Linear/Codex, import backlog automatizzato e controllo più esplicito del flusso OSS/private.

### 🐛 Risolto

- **Warning build `pdfjs-dist/canvas`**: caricamento server-side differito per eliminare il rumore in `next build` senza introdurre dipendenze extra.
- **Drift di review/stato**: riallineati branch, worktree e issue principali per ridurre falsi `In Review` o `Done` non supportati da `main`.

### 🔒 Hardening

- **Contract checks** su `/api/v1` per prevenire modifiche non documentate o breaking change silenziosi.
- **Integrity guardrails** su write path paziente con semantica conflict-aware e payload PHI-safe.

### 📚 Documentazione

- **Walkthrough e mappe canoniche aggiornate** per flusso OCR-first, smart import reviewable, parity sweep e governance OpenAPI.
- **Indice markdown e playbook operativi** estesi per rendere ricostruibile il lavoro tra Git, Linear, docs e repo OSS.

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
- **Allineamento release docs**: intestazioni versione, roadmap e metadati `PLANS`.

### 🙏 Tributo OpenHospital

- Questo rilascio è anche un tributo a OpenHospital: non una copia 1:1, ma un percorso di apprendimento e adattamento di pratiche mature (guardrail, integrità dati, contratti API espliciti, auditabilità) al modello local-first/zero-knowledge di MediFlow.
- La traiettoria di allineamento resta esplicita e incrementale, con evidenza operativa nel workspace locale `docs/private/openhospital-alignment/`.

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

- **Docker All-in-One**: Nuovo `docker-compose.yml` che orchestra App (Next.js), ICD-API e Ollama.
- **Script di Avvio**: `Start_MediFlow.command` semplificato per macOS ("Click & Run").
