---
summary: "Versioned matrix of what MediFlow stores in clear or encrypted at rest, who holds the key and which threat each protection covers."
read_when:
  - "Changing the schema, the encrypted-field contract, backups, exports or browser storage."
  - "Writing or reviewing a statement about data protection."
---

# Matrice dei dati a riposo

**Versione 2** — C06 / [WUL-721](https://linear.app/wulfgardr/issue/WUL-721),
criterio 1. Letta sul codice di `main` alla revisione `bcb7af46a`, il 10
ottobre 2026.

MediFlow cifra alcuni campi, non il database. Questa matrice dice, per ogni
colonna e per ogni file che il prodotto scrive, che cosa si legge senza la
chiave. Vale per il runtime da sorgente, localhost e headless; i client nativi
e la loro cache si qualificano nella 0.9.6 e qui non sono classificati.

La sezione [Colonne del database](#colonne-del-database) è verificata da
`lib/data-at-rest-matrix.test.ts` contro lo schema reale e contro
`ENCRYPTED_FIELDS`: una tabella o una colonna nuova fa fallire il test finché
non viene classificata qui. Le altre sezioni sono lette sul codice e indicano
il file; dove una proprietà non è ancora provata da un test, è scritto.

## Chiavi

- **Master key.** AES-256-GCM, generata nel browser. Cifra ogni valore
  `ENC:<iv>:<cifrato>`.
- **Involucro.** La master key è avvolta con una chiave derivata dal PIN
  (PBKDF2-SHA256, 600.000 iterazioni per gli involucri nuovi, 100.000 per
  quelli della prima versione) e salvata in `users.encrypted_master_key`, con
  una copia nel `localStorage` del browser (`lib/security/security.ts`).
- **PIN.** Almeno quattro caratteri allo sblocco (`components/lock-screen.tsx`);
  le conferme di ruolo ne accettano al massimo otto
  (`lib/security/headless-soap-active-role-enrollment.ts`). A ogni accesso il
  browser lo invia al server locale, che ne conserva l'hash bcrypt in
  `users.password_hash` (`lib/security/client-auth-api.ts`,
  `app/api/auth/setup/route.ts`).
- **Chiave sbloccata.** Finché l'applicazione è sbloccata, la master key sta
  nel `sessionStorage` del browser in formato JWK, in chiaro
  (`lib/security/client-security-session.ts`).

Il server non decifra i campi clinici. Il confine è una disciplina del codice:
il server riceve il PIN e possiede involucro e salt.

## Minacce considerate

| Sigla | Minaccia |
| --- | --- |
| T1 | Furto o copia del computer spento, o del suo disco. |
| T2 | Copia di un backup o di un export fuori dal computer. |
| T3 | Un altro account dello stesso computer. |
| T4 | Lettura di log, file temporanei e residui dopo un'operazione. |

Un sistema operativo compromesso o un computer sottratto mentre
l'applicazione è sbloccata restano fuori, come in
[SECURITY.md](../SECURITY.md).

## Colonne del database

Per ogni tabella: le colonne cifrate dal contratto del client, quelle protette
in altro modo, quelle in chiaro. "Cifrate" significa che il client le cifra
prima di inviarle; l'involucro è controllato dal server solo sulle scritture
dei client abbinati (`lib/network-*-write.ts`) e sulla sostituzione del
contenuto di un allegato (`lib/api-schemas/attachments.ts`). Le rotte Web
locali salvano ciò che ricevono.

### `ambulatories` — sedi e contenitori di lavoro

- In chiaro: `id`, `name`, `address`, `parent_id`, `type`, `description`, `is_default`, `created_at`, `version`
- Leggibile senza chiave: nome e indirizzo delle sedi.

### `attachments` — documenti allegati e loro estratti

- Cifrate: `name`, `path`, `data`, `summary_snapshot`, `parse_evidence_artifact_snapshot`
- In chiaro: `id`, `patient_id`, `type`, `size`, `created_at`, `ocr_queue_state`, `ocr_queue_reason`, `ocr_queue_updated_at`, `ocr_replay_artifact_snapshot`, `document_source_ref`, `document_revision`, `document_freshness_epoch`
- Leggibile senza chiave: tipo MIME, dimensione, stato della coda OCR e identificativo del paziente. `ocr_replay_artifact_snapshot` non ha oggi un writer e non è nel contratto.

### `audit_events` — registro di audit

- In chiaro: `event_id`, `schema_version`, `event_type`, `occurred_at`, `outcome`, `actor_type`, `actor_ref`, `subject_type`, `subject_ref`, `source_surface`, `request_id`, `redacted_metadata`, `created_at`
- Leggibile senza chiave: tipo di evento, attore, identificativo del soggetto e metadati minimizzati.

### `checkups` — controlli programmati

- Cifrate: `notes`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `date`, `title`, `status`, `created_at`, `source`, `version`, `updated_at`, `deleted_at`
- Leggibile senza chiave: titolo, data e stato del controllo.

### `conversations` — conversazioni con l'assistente

- Cifrate: `title`
- In chiaro: `id`, `updated_at`, `is_archived`, `created_at`, `is_deleted`
- Leggibile senza chiave: date e stato di archiviazione.

### `document_diagnosis_proposals` — proposte di diagnosi dai documenti

- In chiaro: `id`, `patient_id`, `source_document_key`, `attachment_id`, `document_insight_id`, `candidate_key`, `payload`, `status`, `confidence`, `decided_at`, `decision_actor_type`, `decision_actor_ref`, `decision_payload`, `version`, `created_at`, `updated_at`
- Leggibile senza chiave: la tabella non ha oggi un writer; `payload` e `decision_payload` non sono nel contratto.

### `drugs` — catalogo farmaci AIFA

- In chiaro: `aic`, `name`, `active_principle`, `company`, `packaging`, `class`, `price`, `atc`, `aic_search`, `name_search`, `active_principle_search`, `packaging_search`
- Leggibile senza chiave: dato pubblico di riferimento.

### `durable_review_command_operations` — comandi di revisione, idempotenza

- In chiaro: `id`, `review_id`, `idempotency_key`, `command_digest`, `result_snapshot`, `audit_event_id`, `created_at`
- Leggibile senza chiave: riferimenti, digest e istantanea del risultato.

### `durable_review_command_states` — comandi di revisione, stato

- In chiaro: `review_id`, `review_state`, `revision`, `action`, `created_at`
- Leggibile senza chiave: stato e revisione della revisione.

### `durable_review_operations` — operazioni di revisione durevole

- In chiaro: `id`, `review_id`, `idempotency_key`, `operation`, `expected_review_revision`, `operation_digest`, `record_snapshot`, `created_at`
- Leggibile senza chiave: riferimenti e digest; `record_snapshot` ripete il valore sigillato del record.

### `durable_review_patient_links` — collegamento fra revisione e paziente

- In chiaro: `review_id`, `patient_id`, `created_at`, `updated_at`
- Leggibile senza chiave: coppia revisione-paziente.

### `durable_review_records` — record di revisione durevole

- Altra protezione: `sealed_ciphertext`
- In chiaro: `id`, `patient_ref`, `review_id`, `review_revision`, `receipt_ref`, `provenance_ref`, `receipt_binding`, `provenance_binding`, `presentation_version`, `sealed_digest`, `created_at`
- Leggibile senza chiave: riferimenti, digest e versione di presentazione. Il contenuto è in `sealed_ciphertext`, che la validazione del backup accetta solo come valore `ENC:`.

### `entries` — diario clinico

- Cifrate: `title`, `content`, `metadata`, `attachments`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `type`, `date`, `created_at`, `setting`, `deleted_at`, `version`, `updated_at`
- Leggibile senza chiave: tipo, data e setting della nota; chi è il paziente.

### `exemption_import_receipts` — ricevute di import delle esenzioni

- In chiaro: `id`, `operation_key`, `receipt_json`
- Leggibile senza chiave: dato di riferimento.

### `exemptions` — catalogo esenzioni

- In chiaro: `code`, `description`, `type`, `source`, `start_date`, `end_date`, `is_pharma`, `is_specialist`, `is_national`, `updated_at`
- Leggibile senza chiave: dato pubblico di riferimento.

### `headless_checkup_active_role_attestations` — attestazione di ruolo per i controlli

- In chiaro: `attestation_ref`, `actor_ref`, `schema_version`, `role`, `operation_id`, `policy_version`, `status`, `attestation_version`, `issuer_ref`, `expires_at`, `activated_at`, `revocation_generation`, `revoked_at`, `created_at`, `updated_at`
- Leggibile senza chiave: stato e scadenze dell'abilitazione; nessun dato clinico.

### `headless_soap_active_role_attestations` — attestazione di ruolo SOAP

- In chiaro: `attestation_ref`, `actor_ref`, `schema_version`, `role`, `operation_id`, `policy_version`, `status`, `attestation_version`, `issuer_ref`, `expires_at`, `activated_at`, `revocation_generation`, `revoked_at`, `created_at`, `updated_at`
- Leggibile senza chiave: stato e scadenze dell'abilitazione; nessun dato clinico.

### `headless_soap_entry_commits` — registro dei commit SOAP headless

- In chiaro: `idempotency_key`, `approval_ref`, `authorization_proof_digest`, `command_id`, `entry_id`, `audit_event_id`, `receipt_ref`, `binding_snapshot`, `binding_digest`, `entry_digest`, `audit_snapshot`, `audit_digest`, `receipt_snapshot`, `receipt_digest`, `committed_at`
- Leggibile senza chiave: riferimenti, digest e istantanee di binding, audit e ricevuta. Il testo della nota resta nei campi cifrati di `entries`.

### `messages` — messaggi delle conversazioni

- Cifrate: `content`, `metadata`, `attachment_base64`
- In chiaro: `id`, `conversation_id`, `role`, `attachment_type`, `created_at`
- Leggibile senza chiave: ruolo e tipo di allegato. Il contratto elenca anche `reasoning`, che non è una colonna.

### `observations` — osservazioni e valori di laboratorio

- Cifrate: `notes`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `code_system`, `code`, `display`, `unit_system`, `unit_code`, `value`, `observed_at`, `source`, `version`, `created_at`, `updated_at`, `deleted_at`, `ref_low`, `ref_high`, `ref_text`, `service_prescription_item_id`
- Leggibile senza chiave: codice, descrizione, valore, unità, intervallo di riferimento e data.

### `patient_duplicate_intents` — intenti di duplicazione

- In chiaro: `id`, `created_at`
- Leggibile senza chiave: identificativi tecnici.

### `patient_retired_ids` — identificativi ritirati

- In chiaro: `id`, `retired_at`
- Leggibile senza chiave: identificativi tecnici.

### `patients` — anagrafica e sintesi clinica

- Cifrate: `address`, `phone`, `caregiver`, `exemptions`, `diagnoses`, `status_reason`, `notes`, `ai_summary`, `document_insights`, `archive_reason`, `archive_note`, `deletion_reason`
- In chiaro: `id`, `first_name`, `last_name`, `tax_code`, `birth_date`, `is_adi`, `is_archived`, `ambulatory_id`, `created_at`, `updated_at`, `monitoring_profile`, `version`, `deleted_at`, `ai_summary_generated_at`, `ai_summary_context_hash`
- Leggibile senza chiave: nome, cognome, codice fiscale, data di nascita, profilo di monitoraggio, ADI e stato di archiviazione.

### `patients_to_ambulatories` — appartenenza dei pazienti alle sedi

- In chiaro: `patient_id`, `ambulatory_id`, `assigned_at`
- Leggibile senza chiave: coppia paziente-sede.

### `physician_review_attestations` — attestazione di revisione medica

- In chiaro: `actor_ref`, `schema_version`, `capability`, `status`, `attestation_version`, `policy_version`, `revoked_at`, `created_at`, `updated_at`
- Leggibile senza chiave: stato dell'abilitazione; nessun dato clinico.

### `prosthetic_prescriptions` — prescrizioni protesiche

- Cifrate: `description`, `measures`, `clinical_reason`, `regional_prescription_id`, `supplier`, `collaudo_outcome`, `document_refs`, `notes`
- In chiaro: `id`, `patient_id`, `prescribed_at`, `status`, `category`, `iso_code`, `collaudo_at`, `source`, `version`, `created_at`, `updated_at`
- Leggibile senza chiave: categoria, codice ISO, stato e date.

### `prosthetics_catalog_entries` — repertorio della protesica

- In chiaro: `id`, `code_system`, `code`, `description`, `version`, `source`, `scope`, `start_date`, `end_date`, `source_sha256`, `operation_key`, `imported_at`
- Leggibile senza chiave: dato pubblico di riferimento.

### `prosthetics_catalog_receipts` — ricevute di import della protesica

- In chiaro: `id`, `operation_key`, `receipt_json`
- Leggibile senza chiave: dato di riferimento.

### `service_catalog_entries` — repertorio delle prestazioni

- In chiaro: `id`, `code_system`, `service_code`, `display_name`, `category`, `branch_code`, `synonyms`, `source`, `version`, `active`, `imported_at`, `updated_at`
- Leggibile senza chiave: dato pubblico di riferimento.

### `service_prescription_items` — voci delle prescrizioni di prestazione

- Cifrate: `service_name`, `catalog_display_name`, `evidence`, `notes`, `outcome_note`
- In chiaro: `id`, `patient_id`, `prescription_id`, `ordinal`, `status`, `category`, `code_system`, `service_code`, `catalog_entry_id`, `match_status`, `confidence`, `scheduled_at`, `performed_at`, `report_received_at`, `version`, `created_at`, `updated_at`
- Leggibile senza chiave: categoria, codice della prestazione, stato e date.

### `service_prescriptions` — prescrizioni di prestazione

- Cifrate: `service_name`, `clinical_question`, `provider`, `outcome_note`, `request_reference`, `document_refs`, `notes`
- In chiaro: `id`, `patient_id`, `prescribed_at`, `status`, `category`, `priority`, `code_system`, `service_code`, `scheduled_at`, `performed_at`, `report_received_at`, `source`, `version`, `created_at`, `updated_at`
- Leggibile senza chiave: categoria, priorità, codice della prestazione, stato e date.

### `settings` — configurazione locale

- In chiaro: `key`, `value`
- Leggibile senza chiave: nome del medico e dello studio, indirizzi dei servizi AI locali, percorso dei backup, stato dell'abbinamento dei client (dei token conserva l'hash SHA-256).

### `siss_handoff_events` — passaggi verso SISS

- Cifrate: `reason`, `next_action`, `notes`, `correlation_id`
- In chiaro: `id`, `version`, `patient_id`, `action`, `module_label`, `started_at`, `completed_at`, `outcome`, `created_at`, `updated_at`
- Leggibile senza chiave: azione, modulo, esito e date.

### `therapies` — terapie farmacologiche

- Cifrate: `motivation`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `drug_name`, `dosage`, `status`, `start_date`, `end_date`, `created_at`, `active_principle`, `diagnosis_code`, `diagnosis_name`, `version`, `updated_at`, `deleted_at`, `aic`, `atc`
- Leggibile senza chiave: farmaco, dosaggio, principio attivo, codice e nome della diagnosi, AIC, ATC, stato e date.

### `users` — account locale e involucro della chiave

- Altra protezione: `password_hash`, `encrypted_master_key`
- In chiaro: `id`, `username`, `display_name`, `ambulatory_name`, `role`, `salt`, `created_at`, `failed_login_attempts`, `first_failed_login_at`, `locked_until`
- Leggibile senza chiave: nome utente, nome visualizzato, studio, salt e contatori di blocco. `password_hash` è l'hash bcrypt del PIN; `encrypted_master_key` è la master key avvolta con la chiave derivata dal PIN.

## File e altri artefatti

| Artefatto | Dove | Che cosa contiene | Protezione | Fonte |
| --- | --- | --- | --- | --- |
| Database `medical.db` | Directory dati: `~/Library/Application Support/MediFlow` su macOS, `~/.mediflow` altrove, oppure `MEDIFLOW_DATA_DIR`. | Le tabelle sopra. | Campi cifrati; file creato `0600`. La directory predefinita è `0700`, anche se esisteva già; una directory scelta con `MEDIFLOW_DATA_DIR` resta com'è se esisteva, nasce `0700` se la crea il prodotto. Su Windows valgono le regole di accesso del sistema. | `lib/data-dir.ts`, `lib/sqlite-schema-open.ts` |
| `medical.db-wal`, `medical.db-shm` | Accanto al database. | Le stesse pagine, compresi valori precedenti finché non vengono riassorbiti. | Come il database. | SQLite |
| Copie di manutenzione `medical.db.old-*`, `.repair-tmp*` | Directory dati. | Copie integrali del database. | Come il database; restano finché non vengono rimosse. | `lib/sqlite-repair.ts` |
| Backup pianificato `.mediflow` | `<directory dati>/backups` o la destinazione configurata. | Le collezioni cliniche in JSON: i valori `ENC:` restano tali, il resto è in chiaro. Non contiene `users` né `settings`, quindi nemmeno l'involucro della chiave. | Campi cifrati; file `0600`, compresi quelli lasciati da versioni precedenti; una destinazione nuova nasce `0700`, una già esistente resta com'è. | `scripts/run-scheduled-backup.mjs` |
| Backup scaricato dall'interfaccia | Dove lo salva il browser. | Come il backup pianificato. | Campi cifrati. | `app/api/system/backup-restore/route.ts` |
| Export FHIR del paziente | Dove lo salva il browser. | La scheda decifrata; il nome del file contiene cognome e nome. | Nessuna. | `app/patients/[id]/edit/page.tsx` |
| Moduli scaricati o condivisi | Dove li salva il browser. | Il modulo compilato, in chiaro. | Nessuna. | `app/patients/[id]/modules/page.tsx` |
| `localStorage` del browser | Profilo del browser. | Salt, involucro della master key, preferenze dell'interfaccia. | L'involucro vale quanto il PIN. | `lib/security/security.ts` |
| `sessionStorage` del browser | Profilo del browser, per scheda. | Master key in chiaro e dati dell'utente, finché l'applicazione è sbloccata. | Nessuna. Il browser può scriverlo su disco per ripristinare la sessione. | `lib/security/client-security-session.ts` |
| Token dell'API locale | `local-api-token` nella directory dati. | Il segreto dei client locali. | File `0600`. | `lib/security/local-api-token.ts` |
| Testo estratto dai documenti | Memoria dei processi di estrazione. | I byte del documento arrivano ai processi figli sullo standard input; il risultato torna al browser, che lo cifra nelle colonne degli allegati. | Nessun file previsto. | `lib/domain/documents/anydoc-local-extraction-runner.ts`, `anydoc-pdf-child-process-owner.ts` |
| Radice temporanea dell'OCR | `mediflow-vision-ocr-*` nella directory temporanea del sistema. | Area di lavoro del riconoscimento Apple Vision; rimossa a fine corsa. | Contenuto non ancora provato da un test. | `lib/domain/documents/anydoc-apple-vision-ocr.ts` |
| Copia della cronologia del browser | `mediflow-siss-atlas-history-*` nella directory temporanea del sistema. | Copia del file `History` usata per osservare la sessione SISS. | Nessuna. | `lib/siss-session-observer.ts` |
| Home dell'account ChatGPT | `mediflow-chatgpt-account-*` nella directory temporanea del sistema. | Configurazione isolata dell'integrazione facoltativa. | Directory `0700`, file `0600`. | `lib/chatgpt-account/account-host.ts` |
| Log | Output del processo; `<directory dati>/logs` per il backup pianificato su macOS; `.pm2/logs` per il runner MLX. | Ciò che il codice scrive, entro le regole di SECURITY.md. | Nessuna prova automatica che non contengano dati clinici. | `lib/backup-scheduler.ts`, `ecosystem.config.js`, [SECURITY.md](../SECURITY.md) |
| Chiavi dei provider remoti | Variabili d'ambiente `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. | Il prodotto le legge e non le scrive. | Fuori dal prodotto. | `lib/ai-providers/v2/provider-secret-broker.ts` |
| Stato della manutenzione | `medical.db.maintenance-admission/` accanto al database. | Lease e intent; nessun dato clinico. | — | [ADR 0142](./adr/0142-sqlite-maintenance-admission.md) |

## Che cosa copre oggi

| Minaccia | Campi cifrati | Tutto il resto |
| --- | --- | --- |
| T1, T2 | Protetti quanto il PIN: con hash e involucro in mano, un segreto di pochi caratteri si prova per intero fuori dal computer. Il backup non contiene hash né involucro. | Leggibile: nomi, codici fiscali, date di nascita, farmaci e dosaggi, valori di laboratorio, titoli dei controlli. |
| T3 | Il database è `0600`. | Directory dati predefinita `0700` e backup pianificati `0600` su macOS e Linux. Restano come le ha impostate l'operatore una directory dati o una destinazione dei backup scelte da lui e già esistenti. |
| T4 | — | Non provato: manca il test con la sentinella del criterio 3. |

## Esposizioni da decidere

Sono l'ingresso del criterio 2: ciascuna deve arrivare a un rimedio, a un
prerequisito di installazione verificabile o a una sospensione decisa da
Leonardo.

1. **Identificativi e terapia in chiaro** nel database e in ogni backup.
   La decisione del 9 ottobre indica il volume cifrato verificato come
   prerequisito.
2. **PIN corto**: hash e involucro si attaccano fuori dal computer, e i limiti
   di lunghezza non coincidono fra sblocco e conferme di ruolo. È
   [WUL-722](https://linear.app/wulfgardr/issue/WUL-722).
3. **Master key nel `sessionStorage`**: la decisione del 9 ottobre la vuole
   solo in memoria.
4. **Il server riceve il PIN** a ogni accesso.
5. **Permessi** dei backup pianificati e della directory dati: chiusi dalla
   versione 2 di questa matrice. Resta da decidere se verificare, e come
   segnalare, una directory scelta dall'operatore e leggibile da altri account.
6. **Export FHIR e moduli** in chiaro, con il nome del paziente nel nome del
   file.
7. **Le rotte Web locali non controllano l'involucro**: un client che invia
   un campo del contratto in chiaro lo vede salvato così.
8. **Contratto e schema non coincidono**: `messages.reasoning` è nel contratto
   ma non è una colonna; `attachments.ocr_replay_artifact_snapshot` e i
   `payload` delle proposte di diagnosi sono colonne senza writer e fuori dal
   contratto.
9. **Copie del database e residui** (`.old-*`, WAL, pagine libere) conservano
   valori precedenti.
10. **File temporanei e log** non sono coperti da una prova.

## Come si aggiorna

Chi aggiunge una tabella, una colonna, un file scritto dal prodotto o un campo
al contratto aggiorna questa pagina nella stessa PR e alza la versione quando
cambia una classificazione.

| Versione | Che cosa è cambiato |
| --- | --- |
| 1 | Prima stesura sul codice di `main` `bcb7af46a`. |
| 2 | Backup pianificati `0600` e directory dati predefinita `0700`. |
