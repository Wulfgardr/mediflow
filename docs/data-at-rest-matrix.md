---
summary: "Versioned matrix of what MediFlow stores in clear or encrypted at rest, who holds the key and which threat each protection covers."
read_when:
  - "Changing the schema, the encrypted-field contract, backups, exports or browser storage."
  - "Writing or reviewing a statement about data protection."
---

# Matrice dei dati a riposo

**Versione 9.** C06 / [WUL-721](https://linear.app/wulfgardr/issue/WUL-721),
criterio 1. Aggiornata il 13 ottobre 2026 per i permessi del database adottato dalla cartella
dell’applicazione; l’11 ottobre per credenziali v3 e generazione dell’archivio, recupero cifrato completo e permessi delle copie di riparazione; la prima classificazione era su `main` `bcb7af46a`.

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
- **Involucro v3.** La passphrase (15–128 caratteri) deriva il materiale con
  PBKDF2-SHA256, 2.000.000 iterazioni; HKDF separa chiave di avvolgimento e
  verificatore di accesso. Il server conserva l’involucro e il salt in `users`,
  ma riceve soltanto il verificatore, non la passphrase. Il kit di recupero
  usa una chiave casuale separata (`lib/security/unlock-credential.ts`).
- **PIN transitorio.** Gli archivi non ancora migrati conservano l’avvolgimento
  PIN v1/v2 (100.000/600.000 iterazioni) e inviano il PIN al server locale.
  Il PIN separato rimane per le conferme dopo il passaggio a v3; non può più
  sbloccare né sostituire la protezione della master key.
- **Chiave sbloccata.** Per v3 è non estraibile e vive solo in memoria: il
  reload richiede un nuovo sblocco. Solo il profilo PIN transitorio conserva
  la chiave in chiaro nel `sessionStorage` come JWK
  (`components/security-provider.tsx`, `lib/security/client-security-session.ts`).

Il server non decifra i campi clinici. Per v3 il verificatore di accesso non
permette di derivare la chiave di avvolgimento; nel profilo PIN transitorio il
server riceve invece il PIN e possiede involucro e salt.

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

### `ambulatories`: sedi e contenitori di lavoro

- In chiaro: `id`, `name`, `address`, `parent_id`, `type`, `description`, `is_default`, `created_at`, `version`
- Leggibile senza chiave: nome e indirizzo delle sedi.

### `archive_generation` — identità della versione dell'archivio

- In chiaro: `id`, `generation`
- Leggibile senza chiave: identificatore casuale, senza contenuto clinico; non è una credenziale.

### `archive_session_generations` — legame fra sessione e archivio

- In chiaro: `session_ref`, `generation`, `expires_at`
- Leggibile senza chiave: hash SHA-256 dell'identificatore casuale di sessione, generazione e scadenza. Non contiene cookie né chiavi e non autentica una sessione.

### `attachments`: documenti allegati e loro estratti

- Cifrate: `name`, `path`, `data`, `summary_snapshot`, `parse_evidence_artifact_snapshot`
- In chiaro: `id`, `patient_id`, `type`, `size`, `created_at`, `ocr_queue_state`, `ocr_queue_reason`, `ocr_queue_updated_at`, `ocr_replay_artifact_snapshot`, `document_source_ref`, `document_revision`, `document_freshness_epoch`
- Leggibile senza chiave: tipo MIME, dimensione, stato della coda OCR e identificativo del paziente. `ocr_replay_artifact_snapshot` non ha oggi un writer e non è nel contratto.

### `audit_events`: registro di audit

- In chiaro: `event_id`, `schema_version`, `event_type`, `occurred_at`, `outcome`, `actor_type`, `actor_ref`, `subject_type`, `subject_ref`, `source_surface`, `request_id`, `redacted_metadata`, `created_at`
- Leggibile senza chiave: tipo di evento, attore, identificativo del soggetto e metadati minimizzati.

### `checkups`: controlli programmati

- Cifrate: `notes`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `date`, `title`, `status`, `created_at`, `source`, `version`, `updated_at`, `deleted_at`
- Leggibile senza chiave: titolo, data e stato del controllo.

### `conversations`: conversazioni con l'assistente

- Cifrate: `title`
- In chiaro: `id`, `updated_at`, `is_archived`, `created_at`, `is_deleted`
- Leggibile senza chiave: date e stato di archiviazione.

### `document_diagnosis_proposals`: proposte di diagnosi dai documenti

- In chiaro: `id`, `patient_id`, `source_document_key`, `attachment_id`, `document_insight_id`, `candidate_key`, `payload`, `status`, `confidence`, `decided_at`, `decision_actor_type`, `decision_actor_ref`, `decision_payload`, `version`, `created_at`, `updated_at`
- Leggibile senza chiave: la tabella non ha oggi un writer; `payload` e `decision_payload` non sono nel contratto.

### `drugs`: catalogo farmaci AIFA

- In chiaro: `aic`, `name`, `active_principle`, `company`, `packaging`, `class`, `price`, `atc`, `aic_search`, `name_search`, `active_principle_search`, `packaging_search`
- Leggibile senza chiave: dato pubblico di riferimento.

### `durable_review_command_operations`: comandi di revisione, idempotenza

- In chiaro: `id`, `review_id`, `idempotency_key`, `command_digest`, `result_snapshot`, `audit_event_id`, `created_at`
- Leggibile senza chiave: riferimenti, digest e istantanea del risultato.

### `durable_review_command_states`: comandi di revisione, stato

- In chiaro: `review_id`, `review_state`, `revision`, `action`, `created_at`
- Leggibile senza chiave: stato e revisione della revisione.

### `durable_review_operations`: operazioni di revisione durevole

- In chiaro: `id`, `review_id`, `idempotency_key`, `operation`, `expected_review_revision`, `operation_digest`, `record_snapshot`, `created_at`
- Leggibile senza chiave: riferimenti e digest; `record_snapshot` ripete il valore sigillato del record.

### `durable_review_patient_links`: collegamento fra revisione e paziente

- In chiaro: `review_id`, `patient_id`, `created_at`, `updated_at`
- Leggibile senza chiave: coppia revisione-paziente.

### `durable_review_records`: record di revisione durevole

- Altra protezione: `sealed_ciphertext`
- In chiaro: `id`, `patient_ref`, `review_id`, `review_revision`, `receipt_ref`, `provenance_ref`, `receipt_binding`, `provenance_binding`, `presentation_version`, `sealed_digest`, `created_at`
- Leggibile senza chiave: riferimenti, digest e versione di presentazione. Il contenuto è in `sealed_ciphertext`, che la validazione del backup accetta solo come valore `ENC:`.

### `entries`: diario clinico

- Cifrate: `title`, `content`, `metadata`, `attachments`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `type`, `date`, `created_at`, `setting`, `deleted_at`, `version`, `updated_at`
- Leggibile senza chiave: tipo, data e setting della nota; chi è il paziente.

### `exemption_import_receipts`: ricevute di import delle esenzioni

- In chiaro: `id`, `operation_key`, `receipt_json`
- Leggibile senza chiave: dato di riferimento.

### `exemptions`: catalogo esenzioni

- In chiaro: `code`, `description`, `type`, `source`, `start_date`, `end_date`, `is_pharma`, `is_specialist`, `is_national`, `updated_at`
- Leggibile senza chiave: dato pubblico di riferimento.

### `headless_checkup_active_role_attestations`: attestazione di ruolo per i controlli

- In chiaro: `attestation_ref`, `actor_ref`, `schema_version`, `role`, `operation_id`, `policy_version`, `status`, `attestation_version`, `issuer_ref`, `expires_at`, `activated_at`, `revocation_generation`, `revoked_at`, `created_at`, `updated_at`
- Leggibile senza chiave: stato e scadenze dell'abilitazione; nessun dato clinico.

### `headless_soap_active_role_attestations`: attestazione di ruolo SOAP

- In chiaro: `attestation_ref`, `actor_ref`, `schema_version`, `role`, `operation_id`, `policy_version`, `status`, `attestation_version`, `issuer_ref`, `expires_at`, `activated_at`, `revocation_generation`, `revoked_at`, `created_at`, `updated_at`
- Leggibile senza chiave: stato e scadenze dell'abilitazione; nessun dato clinico.

### `headless_soap_entry_commits`: registro dei commit SOAP headless

- In chiaro: `idempotency_key`, `approval_ref`, `authorization_proof_digest`, `command_id`, `entry_id`, `audit_event_id`, `receipt_ref`, `binding_snapshot`, `binding_digest`, `entry_digest`, `audit_snapshot`, `audit_digest`, `receipt_snapshot`, `receipt_digest`, `committed_at`
- Leggibile senza chiave: riferimenti, digest e istantanee di binding, audit e ricevuta. Il testo della nota resta nei campi cifrati di `entries`.

### `messages`: messaggi delle conversazioni

- Cifrate: `content`, `metadata`, `attachment_base64`
- In chiaro: `id`, `conversation_id`, `role`, `attachment_type`, `created_at`
- Leggibile senza chiave: ruolo e tipo di allegato.

### `observations`: osservazioni e valori di laboratorio

- Cifrate: `notes`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `code_system`, `code`, `display`, `unit_system`, `unit_code`, `value`, `observed_at`, `source`, `version`, `created_at`, `updated_at`, `deleted_at`, `ref_low`, `ref_high`, `ref_text`, `service_prescription_item_id`
- Leggibile senza chiave: codice, descrizione, valore, unità, intervallo di riferimento e data.

### `patient_duplicate_intents`: intenti di duplicazione

- In chiaro: `id`, `created_at`
- Leggibile senza chiave: identificativi tecnici.

### `patient_retired_ids`: identificativi ritirati

- In chiaro: `id`, `retired_at`
- Leggibile senza chiave: identificativi tecnici.

### `patients`: anagrafica e sintesi clinica

- Cifrate: `address`, `phone`, `caregiver`, `exemptions`, `diagnoses`, `status_reason`, `notes`, `ai_summary`, `document_insights`, `archive_reason`, `archive_note`, `deletion_reason`
- In chiaro: `id`, `first_name`, `last_name`, `tax_code`, `birth_date`, `is_adi`, `is_archived`, `ambulatory_id`, `created_at`, `updated_at`, `monitoring_profile`, `version`, `deleted_at`, `ai_summary_generated_at`, `ai_summary_context_hash`
- Leggibile senza chiave: nome, cognome, codice fiscale, data di nascita, profilo di monitoraggio, ADI e stato di archiviazione.

### `patients_to_ambulatories`: appartenenza dei pazienti alle sedi

- In chiaro: `patient_id`, `ambulatory_id`, `assigned_at`
- Leggibile senza chiave: coppia paziente-sede.

### `physician_review_attestations`: attestazione di revisione medica

- In chiaro: `actor_ref`, `schema_version`, `capability`, `status`, `attestation_version`, `policy_version`, `revoked_at`, `created_at`, `updated_at`
- Leggibile senza chiave: stato dell'abilitazione; nessun dato clinico.

### `prosthetic_prescriptions`: prescrizioni protesiche

- Cifrate: `description`, `measures`, `clinical_reason`, `regional_prescription_id`, `supplier`, `collaudo_outcome`, `document_refs`, `notes`
- In chiaro: `id`, `patient_id`, `prescribed_at`, `status`, `category`, `iso_code`, `collaudo_at`, `source`, `version`, `created_at`, `updated_at`, `catalog_snapshot`
- Leggibile senza chiave: categoria, codice ISO, stato, date e snapshot della voce scelta con descrizione, fonte e riferimenti agli originali. Lo snapshot collega una scelta al paziente ed è dato sanitario in chiaro.

### `prosthetics_catalog_entries`: repertorio della protesica

- In chiaro: `id`, `code_system`, `code`, `description`, `version`, `source`, `scope`, `start_date`, `end_date`, `source_sha256`, `operation_key`, `imported_at`, `source_id`
- Leggibile senza chiave: dati di repertorio dichiarati dall’operatore, anche interni.

### `prosthetics_catalog_receipts`: ricevute di import della protesica

- In chiaro: `id`, `operation_key`, `receipt_json`
- Leggibile senza chiave: metadati del repertorio dichiarato, anche interno.

### `prosthetics_catalog_sources`: fonti personali della protesica

- In chiaro: `id`, `name`, `authority`, `scope`, `version`, `date`, `sha256`, `notes`
- Leggibile senza chiave: provenienza dichiarata dall’operatore, senza attestazione normativa.

### `prosthetics_catalog_documents`: originali delle fonti protesiche

- In chiaro: `id`, `source_id`, `name`, `sha256`, `size`, `page`, `base64`
- Leggibile senza chiave: originali completi. Allegare soltanto documenti di repertorio privi di dati dei pazienti.

Gli originali sono conservati nel database SQLite sotto la data dir, separati
logicamente dai pazienti, senza copie in directory pubbliche. Database creato
con permessi 0600, directory predefinita 0700; per archivi esistenti l’allegato
verifica permessi e proprietà di database e sidecar su POSIX prima di scrivere.
Windows segue le autorizzazioni dell’account e della cartella. Base64 e SHA-256
non cifrano. Le route richiedono sessione attiva, rispondono no-store e verificano
hash/dimensione prima del download. Originali e fonti entrano nel backup web e
schedulato e nel ripristino atomico. Conservare i backup come gli altri dati sensibili.

### `service_catalog_entries`: repertorio delle prestazioni

- In chiaro: `id`, `code_system`, `service_code`, `display_name`, `category`, `branch_code`, `synonyms`, `source`, `version`, `active`, `imported_at`, `updated_at`
- Leggibile senza chiave: dato pubblico di riferimento.

### `service_prescription_items`: voci delle prescrizioni di prestazione

- Cifrate: `service_name`, `catalog_display_name`, `evidence`, `notes`, `outcome_note`
- In chiaro: `id`, `patient_id`, `prescription_id`, `ordinal`, `status`, `category`, `code_system`, `service_code`, `catalog_entry_id`, `match_status`, `confidence`, `scheduled_at`, `performed_at`, `report_received_at`, `version`, `created_at`, `updated_at`
- Leggibile senza chiave: categoria, codice della prestazione, stato e date.

### `service_prescriptions`: prescrizioni di prestazione

- Cifrate: `service_name`, `clinical_question`, `provider`, `outcome_note`, `request_reference`, `document_refs`, `notes`
- In chiaro: `id`, `patient_id`, `prescribed_at`, `status`, `category`, `priority`, `code_system`, `service_code`, `scheduled_at`, `performed_at`, `report_received_at`, `source`, `version`, `created_at`, `updated_at`
- Leggibile senza chiave: categoria, priorità, codice della prestazione, stato e date.

### `settings`: configurazione locale

- In chiaro: `key`, `value`
- Leggibile senza chiave: nome del medico e dello studio, indirizzi dei servizi AI locali, percorso dei backup, stato dell'abbinamento dei client (dei token conserva l'hash SHA-256).

### `siss_handoff_events`: passaggi verso SISS

- Cifrate: `reason`, `next_action`, `notes`, `correlation_id`
- In chiaro: `id`, `version`, `patient_id`, `action`, `module_label`, `started_at`, `completed_at`, `outcome`, `created_at`, `updated_at`
- Leggibile senza chiave: azione, modulo, esito e date.

### `therapies`: terapie farmacologiche

- Cifrate: `motivation`, `deletion_reason`
- In chiaro: `id`, `patient_id`, `drug_name`, `dosage`, `status`, `start_date`, `end_date`, `created_at`, `active_principle`, `diagnosis_code`, `diagnosis_name`, `version`, `updated_at`, `deleted_at`, `aic`, `atc`
- Leggibile senza chiave: farmaco, dosaggio, principio attivo, codice e nome della diagnosi, AIC, ATC, stato e date.

### `users`: account locale e involucro della chiave

- Altra protezione: `password_hash`, `encrypted_master_key`, `unlock_verifier_hash`, `recovery_wrapped_master_key`, `recovery_verifier_hash`
- In chiaro: `id`, `username`, `display_name`, `ambulatory_name`, `role`, `salt`, `created_at`, `failed_login_attempts`, `first_failed_login_at`, `locked_until`, `recovery_salt`
- Leggibile senza chiave: nome utente, nome visualizzato, studio, salt e contatori di blocco. `password_hash` è l'hash bcrypt del PIN di conferma; `encrypted_master_key` è la master key avvolta con la chiave derivata dalla passphrase negli account v3, dal PIN nel profilo transitorio.
- Le quattro colonne dell'[ADR 0143](adr/0143-strong-unlock-credential.md) restano vuote finché l'account sblocca con il PIN. Le scrivono, insieme al nuovo involucro, il primo avvio v3 e il passaggio alla passphrase (`POST /api/auth/passphrase`), offerti dall'interfaccia: gli hash SHA-256 dei due verificatori (`unlock_verifier_hash`, `recovery_verifier_hash`), la master key avvolta con la chiave di recupero (`recovery_wrapped_master_key`) e il salt di quell'involucro (`recovery_salt`). Da quel momento `encrypted_master_key` è avvolta con la chiave derivata dalla passphrase e `password_hash` resta come PIN di conferma.

## File e altri artefatti

| Artefatto | Dove | Che cosa contiene | Protezione | Fonte |
| --- | --- | --- | --- | --- |
| Database `medical.db` | Directory dati: `~/Library/Application Support/MediFlow` su macOS, `~/.mediflow` altrove, oppure `MEDIFLOW_DATA_DIR`. | Le tabelle sopra. | Campi cifrati; file `0600` sia quando nasce vuoto, sia quando il primo avvio adotta un `medical.db` storico dalla cartella dell’applicazione, sia quando una riparazione lo mette al suo posto o lo ripristina. Con le versioni precedenti l’adozione e la riparazione lo lasciavano con i permessi predefiniti del sistema (misurato `0644` con umask `022` sulla copia): un archivio già adottato o già riparato resta così, il prodotto non ne restringe i permessi. La directory predefinita è `0700`, anche se esisteva già; una directory scelta con `MEDIFLOW_DATA_DIR` resta com'è se esisteva, nasce `0700` se la crea il prodotto. Su Windows valgono le regole di accesso del sistema. | `lib/data-dir.ts`, `lib/sqlite-schema-open.ts`, `lib/sqlite-repair.ts` |
| `medical.db-wal`, `medical.db-shm` | Accanto al database. | Le stesse pagine, compresi valori precedenti finché non vengono riassorbiti. Il passaggio alla passphrase svuota il registro, che conserverebbe l'involucro del PIN. | Come il database. | SQLite, `lib/security/pin-era-residues.ts` |
| Originale dell'aggiornamento dello schema `medical.db.schema-original-v<N>-<uuid>.db` | Directory dati. | Copia integrale del database com'era prima dell'aggiornamento, compresi `users` e l'involucro della chiave. | Campi cifrati; file `0600`. Resta finché non viene rimossa; il passaggio alla passphrase elimina quelle in cui l'account ha ancora l'involucro del PIN. | `lib/sqlite-schema-open.ts`, `lib/security/pin-era-residues.ts` |
| Copia di riparazione `medical.db.bak-<data>-<ora>` | Directory dati. | Copia integrale del database com'era prima della riparazione, compresi `users` e l'involucro della chiave. | Campi cifrati; file `0600`. Le copie lasciate da versioni precedenti restano con i permessi con cui sono nate (misurato `0644` con umask `022`): verso gli altri account le protegge solo la directory dati. Resta finché non viene rimossa; il passaggio alla passphrase elimina quelle in cui l'account ha ancora l'involucro del PIN. | `app/api/system/repair-db/route.ts`, `lib/sqlite-repair.ts`, `lib/security/pin-era-residues.ts` |
| Istantanee della riparazione `medical.db.swap-recovery/` | Accanto al database. | Durante una riparazione: copia integrale del database di prima, copia di quello che lo sostituisce e registro dello scambio. La directory viene rimossa a riparazione conclusa; dopo un'interruzione resta finché l'avvio successivo non conclude il recupero. | Campi cifrati; directory `0700`, istantanee e registro `0600`. | `lib/sqlite-repair.ts` |
| Copie di manutenzione `medical.db.old-*`, `.repair-tmp*` | Directory dati. | Copie integrali del database. | Come il database; restano finché non vengono rimosse. | `lib/sqlite-repair.ts` |
| Backup pianificato `.mediflow` | `<directory dati>/backups` o la destinazione configurata. | Le collezioni cliniche in JSON: i valori `ENC:` restano tali, il resto è in chiaro. Non contiene `users` né `settings`, quindi nemmeno l'involucro della chiave. | Campi cifrati; file `0600`, compresi quelli lasciati da versioni precedenti; una destinazione nuova nasce `0700`, una già esistente resta com'è. | `scripts/run-scheduled-backup.mjs` |
| Export portabile scaricato dall'interfaccia | Dove lo salva il browser. | Come il backup pianificato. | Campi cifrati. | `app/api/system/backup-restore/route.ts` |
| Recupero completo `.mediflow-recovery` | Dove lo salva il browser. | Snapshot coerente di tutto SQLite, inclusi account, impostazioni e storico durevole. | Intero payload AES-256-GCM, chiave casuale per backup avvolta con la master key; kit corrispondente e chiave di recupero separati. | `lib/recovery-backup.ts`, `lib/recovery-backup-server.ts` |
| Snapshot del recupero | `.recovery-backup-*` e `.recovery-restore-*` nella radice dati. | Stessa protezione per campo dell’archivio; metadati e identificativi in chiaro. | File `0600`, radice posseduta rimossa a fine operazione; un arresto improvviso può lasciare residui sul volume cifrato. | `lib/recovery-backup-server.ts`, `scripts/restore-recovery-backup.ts` |
| Export FHIR del paziente | Dove lo salva il browser. | La scheda decifrata; il nome del file contiene cognome e nome. | Nessuna. | `app/patients/[id]/edit/page.tsx` |
| Moduli scaricati o condivisi | Dove li salva il browser. | Il modulo compilato, in chiaro. | Nessuna. | `app/patients/[id]/modules/page.tsx` |
| `localStorage` del browser | Profilo del browser. | Salt, involucro della master key, preferenze dell'interfaccia. | V3: involucro derivato dalla passphrase; profilo transitorio: protezione del PIN. Non contiene la master key v3 in chiaro. | `lib/security/security.ts` |
| `sessionStorage` del browser | Profilo del browser, per scheda. | Solo nel profilo PIN transitorio: master key in chiaro e dati dell'utente. Gli account v3 non li persistono e cancellano la precedente sessione. | Il profilo PIN non protegge questa copia; v3 conserva una chiave non estraibile solo in memoria e richiede sblocco dopo reload. | `lib/security/client-security-session.ts`, `components/security-provider.tsx` |
| Token dell'API locale | `local-api-token` nella directory dati. | Il segreto dei client locali. | File `0600`. | `lib/security/local-api-token.ts` |
| Testo estratto dai documenti | Memoria dei processi di estrazione. | I byte del documento arrivano ai processi figli sullo standard input; il risultato torna al browser, che lo cifra nelle colonne degli allegati. | Nessun file previsto. | `lib/domain/documents/anydoc-local-extraction-runner.ts`, `anydoc-pdf-child-process-owner.ts` |
| Radice temporanea dell'OCR | `mediflow-vision-ocr-*` nella directory temporanea del sistema. | Area di lavoro del riconoscimento Apple Vision; rimossa a fine corsa. | Sentinella non rilevata durante l’esecuzione reale Apple Vision, prima della pulizia, dopo successo ed errore; non è prova di cancellazione sicura. | `lib/domain/documents/anydoc-apple-vision-ocr.ts` |
| Copia della cronologia del browser | `mediflow-siss-atlas-history-*` nella directory temporanea del sistema. | Copia del file `History` usata per osservare la sessione SISS. | Nessuna. | `lib/siss-session-observer.ts` |
| Home dell'account ChatGPT | `mediflow-chatgpt-account-*` nella directory temporanea del sistema. | Configurazione isolata dell'integrazione facoltativa. | Directory `0700`, file `0600`. | `lib/chatgpt-account/account-host.ts` |
| Log | Output del processo; `<directory dati>/logs` per il backup pianificato su macOS; `.pm2/logs` per il runner MLX. | Ciò che il codice scrive, entro le regole di SECURITY.md. | Nessuna prova automatica che non contengano dati clinici. | `lib/backup-scheduler.ts`, `ecosystem.config.js`, [SECURITY.md](../SECURITY.md) |
| Chiavi dei provider remoti | Variabili d'ambiente `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. | Il prodotto le legge e non le scrive. | Fuori dal prodotto. | `lib/ai-providers/v2/provider-secret-broker.ts` |
| Stato della manutenzione | `medical.db.maintenance-admission/` accanto al database. | Lease e intent; nessun dato clinico. | Non serve | [ADR 0142](./adr/0142-sqlite-maintenance-admission.md) |

## Che cosa copre oggi

| Minaccia | Campi cifrati | Tutto il resto |
| --- | --- | --- |
| T1, T2 | Nel profilo PIN transitorio sono protetti quanto il PIN: con hash e involucro in mano, un segreto di pochi caratteri si prova per intero fuori dal computer. Gli account v3 usano la passphrase dell'ADR 0143. L’export portabile non contiene account o involucro; il backup completo cifra l’intero snapshot. | Leggibile: nomi, codici fiscali, date di nascita, farmaci e dosaggi, valori di laboratorio, titoli dei controlli. |
| T3 | Database nuovo e riparazioni correnti `0600`; archivi precedenti o adottati possono conservare permessi più ampi. | Directory dati predefinita `0700` e backup pianificati `0600` su macOS e Linux. Restano come le ha impostate l'operatore una directory dati o una destinazione dei backup scelte da lui e già esistenti. |
| T4 | Dipende dall’artefatto | Sentinelle provate sui confini reali SQLite/WAL, backup pianificato, export FHIR e temporanei Vision. Nessuna garanzia globale su log o residui di arresti improvvisi. |

## Esposizioni e disposizioni

Le disposizioni del criterio 2 sono rimedi del prodotto e prerequisiti
dell’installazione. Il volume cifrato non è cifratura applicativa: va verificato
sulla radice dati e sulle destinazioni di export/backup portabile. Su macOS
si controlla con `fdesetup status`; su Windows con `manage-bde -status` da
terminale amministrativo; su Linux con la catena `findmnt`/`lsblk` fino al
volume cifrato. La qualifica sintetica delle VM non ammette dati clinici su
un volume ospite non verificato. La chiave di ripristino del volume va
conservata separatamente secondo il sistema operativo.

1. **Identificativi e terapia in chiaro** nel database e negli export/backup portabili. Il recupero completo cifra invece tutto il payload.
   La decisione del 9 ottobre indica il volume cifrato verificato come
   prerequisito.
2. **PIN corto**: hash e involucro si attaccano fuori dal computer, e i limiti
   di lunghezza non coincidono fra sblocco e conferme di ruolo. È
   [WUL-722](https://linear.app/wulfgardr/issue/WUL-722).
3. **Master key nel `sessionStorage`**: tolta per gli account v3; resta nel
   profilo PIN transitorio, dichiarato nell'interfaccia.
4. **Il server riceve il PIN** negli accessi del profilo transitorio. Per v3
   riceve solo il verificatore; il PIN separato rimane nelle conferme.
5. **Permessi** dei backup pianificati e della directory dati: chiusi dalla
   versione 2 di questa matrice. Una destinazione scelta dall’operatore richiede permessi limitati al suo account; su Windows si verificano le ACL, non si deducono dai bit POSIX. Le copie e i database adottati o riparati dalle versioni precedenti conservano i permessi originari: verso altri account li protegge la directory dati riservata al proprietario.
6. **Export FHIR e moduli** in chiaro, con il nome del paziente nel nome del
   file. Destinazione controllata dall’operatore, volume cifrato e condivisione deliberata: nessuna cifratura dell’export è dichiarata.
7. **Le rotte Web locali non controllano l'involucro**: un client che invia
   un campo del contratto in chiaro lo vede salvato così.
8. **Contratto e schema non coincidono**:
   `attachments.ocr_replay_artifact_snapshot` e i `payload` delle proposte di
   diagnosi sono colonne senza writer e fuori dal contratto. Il campo
   `messages.reasoning`, nel contratto senza essere una colonna, è stato tolto
   nella versione 3.
9. **Copie del database e residui** (`.old-*`, originali dell'aggiornamento,
   copie di riparazione, WAL, pagine libere) conservano valori precedenti. Per
   l'involucro del PIN di un account passato alla passphrase, le copie del
   prodotto vengono rimosse quando identificabili. L’archivio attivo è
   compattato e il WAL svuotato soltanto quando la pulizia è completa. Le
   `.bak` già v3 restano conservate e segnalate come pendenti per controllo
   manuale: non si dichiara che siano prive di residui. Restano fuori dalla
   pulizia Time Machine, copie a mano e il vecchio `medical.db` nella
   cartella dell’applicazione.
10. **File temporanei e log**: le sentinelle reali coprono i confini nominati sopra. Copie SISS, log e residui di crash richiedono volume cifrato e accesso limitato; non si dichiara assenza generale di dati sensibili né cancellazione sicura.

## Come si aggiorna

Chi aggiunge una tabella, una colonna, un file scritto dal prodotto o un campo
al contratto aggiorna questa pagina nella stessa PR e alza la versione quando
cambia una classificazione.

| Versione | Che cosa è cambiato |
| --- | --- |
| 1 | Prima stesura sul codice di `main` `bcb7af46a`. |
| 2 | Backup pianificati `0600` e directory dati predefinita `0700`. |
| 3 | Tolto dal contratto `messages.reasoning`, che non era una colonna. |
| 4 | Quattro colonne nuove in `users` per l'ADR 0143, ancora vuote. |
| 5 | Aggiunti gli originali dell'aggiornamento dello schema e le copie di riparazione, che mancavano. Il passaggio alla passphrase elimina quelle con l'involucro del PIN e svuota il WAL. |
| 6 | Generazione e legame sessioni; chiave v3 solo in memoria; limiti espliciti della pulizia dei residui. |
| 7 | Recupero completo cifrato distinto dall’export portabile, snapshot temporanei e disposizioni verificabili delle esposizioni. |
| 8 | Copie e istantanee di riparazione `0600`, anche al ritorno; permessi storici e adozione distinti dalla nuova creazione. |
| 9 | Database adottato dalla cartella dell’applicazione `0600`, come ogni copia fatta attraverso SQLite; restano com'erano gli archivi adottati dalle versioni precedenti. |
