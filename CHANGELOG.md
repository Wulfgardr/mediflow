# Changelog

Tutti i cambiamenti notevoli a questo progetto saranno documentati in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
e questo progetto aderisce al [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
