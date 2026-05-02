# Walkthrough MediFlow (Web + Native)

> [!IMPORTANT]
> **Stato documento: CANONICAL (walkthrough operativo end-to-end).**
> Se altri documenti tecnici secondari divergono su dettagli di flusso, prevale questo file.

Questo documento offre la vista end-to-end del progetto: web app Next.js, backend locale SQLite, servizi AI/OCR e client nativo macOS.
Serve per onboarding tecnico, manutenzione e verifica rapida dei flussi principali.

> [!IMPORTANT]
> Dopo `v0.4.0` la delivery macOS e congelata per un rebuild controllato della shell nativa.
> Le sezioni native qui sotto descrivono lo snapshot corrente e i confini da preservare (`/api/v1`, TLS locale, security/sessione), non una roadmap di estensione del client storico.

> [!IMPORTANT]
> Su `main` esistono gia due slice post-`v0.5.0` che cambiano il quadro operativo:
> `network home-base` paired su `/api/v1/network/*` con read pazienti e primo
> `PUT` profilo/status paziente, e il primo artifact
> `parse/evidence` per documento allegato, consumato in priorita da `AI Patient Insight`.

---

## Scopo e obiettivi

- Dare una mappa unica dell'architettura e dei flussi principali.
- Chiarire file chiave e responsabilità dei moduli.
- Esplicitare il contratto API tra web e client macOS.
- Riassumere sicurezza, cifratura e trasporto locale.

Se serve il dettaglio di singoli moduli, consulta anche:
- [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
- [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md)
- [docs/system_architecture.md](./system_architecture.md)
- [docs/native-setup.md](./native-setup.md)
- [docs/native-launch.md](./native-launch.md)
- [docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md)

---

## Topologia del sistema

```mermaid
graph TB
    subgraph "macOS Native App"
        UI[SwiftUI Views]
        SEC[SecuritySession]
        CRYPTO[CryptoService]
        KC[KeychainService]
        API[LocalAPIClient]
    end

    subgraph "Paired LAN Client"
        PEER["Trusted client (macOS/iPhone/iPad)"]
    end

    subgraph "Transport Layer"
        TLS["TLS Proxy :3443"]
    end

    subgraph "Next.js Backend :3000"
        AUTH["/api/auth/*"]
        V1["/api/v1/*"]
        NET["/api/v1/network/*"]
        WEBAPI["/api/* (web UI)"]
        DB[(SQLite DB)]
    end

    subgraph "Local Services"
        OLLAMA["Ollama :11434"]
        ICD["ICD-11 Docker :8888"]
        OPENMED["OpenMed redaction :18080 (shadow)"]
    end

    UI --> SEC
    SEC --> CRYPTO
    SEC --> API
    API --> KC
    API -->|HTTPS + Pinning| TLS
    PEER -->|HTTPS + paired creds| TLS
    TLS -->|HTTP localhost| V1
    TLS -->|HTTP localhost| NET
    TLS -->|HTTP localhost| AUTH
    WEBAPI --> DB
    V1 --> DB
    NET --> DB
    AUTH --> DB
    WEBAPI --> OLLAMA
    WEBAPI --> ICD
    WEBAPI --> OPENMED
```

---

## Porte e servizi locali

| Servizio | Porta | Scopo |
| --- | --- | --- |
| Next.js | `3000` | UI web + API locali |
| TLS Proxy | `3443` | HTTPS locale per il client macOS |
| Ollama | `11434` | AI clinica + OCR |
| ICD-11 (Docker) | `8888` | Diagnosi ICD-11 |
| OpenMed redaction (shadow) | `18080` | Sidecar locale benchmark/shadow per `redaction.v1` |

---

## Stack web (Next.js)

- **Frontend**: Next.js App Router, React, Tailwind.
- **API**: Route handlers in `app/api/*`.
- **DB**: SQLite locale (`medical.db`) con Drizzle (`lib/schema.ts`, `lib/db-server.ts`).
- **Client DB**: `lib/db.ts` è la facciata (fetch REST + cifratura per campo).

### Directory principali

| Path | Contenuto |
| --- | --- |
| `app/` | pagine Next.js e route API |
| `components/` | componenti UI e logica client |
| `lib/` | servizi, DB, cifratura, AI/OCR |
| `drizzle/` | migrazioni DB |
| `native/` | app macOS SwiftUI |
| `scripts/` | avvio, TLS proxy, build native |

## Shell ufficiale e superfici integrate

Nel checkout web esiste oggi una sola shell ufficiale del prodotto:

1. `Clinical Workbench / Graphite`: runtime stabile del checkout corrente.

Le superfici AI, Smart Import e contesto paziente SISS non vivono piu dietro un
selector locale di preview: quando sono considerate mature per `main`, vengono
integrate direttamente nel workbench ufficiale.

In pratica:

- `AI`: resta parte della shell ufficiale come stack locale governato;
- `Smart Import`: resta reviewable dentro i flussi normali del paziente;
- `SISS`: il pannello contestuale paziente e parte stabile della scheda
  clinica, mantenendo il boundary `webapp-assisted` verso i moduli regionali.
- `Protesica`: la scheda paziente include un diario locale delle prescrizioni
  protesiche e un handoff `Protesica-RL` con codice fiscale pronto da incollare.

Implementazione principale:

- `app/patients/[id]/page.tsx`
- `components/siss-patient-context-panel.tsx`
- `components/prosthetic-prescription-manager.tsx`
- `app/settings/page.tsx`

Questo non cambia i boundary canonici: AI, import e contesto SISS sono integrati
nel runtime ufficiale, ma non dichiarano scorciatoie architetturali oltre quelle
gia formalizzate nelle ADR e nei documenti SISS. Il diario protesico resta un
registro locale document-backed: non invia prescrizioni al sistema regionale e
non dichiara un canale certificato.

### Diario protesico da documenti Assistente RL

Quando l'operatore produce un pacchetto documentale `Protesica-RL`, MediFlow lo
tratta come fonte documentale per una bozza revisionabile del diario protesico,
non come scrittura automatica certificata verso il sistema regionale.

Fonti attese:

- `PRESCRIZIONE DI PROTESICA`: analisi funzionale, diagnosi/razionale, tabella
  dei presidi ISO prescritti, significato terapeutico-riabilitativo e tempi
  d'impiego.
- `MODELLO 03`: numero pratica/domanda, data presentazione, diritto, area
  fornitore/prezzi, requisito di collaudo e sezione consegna.
- `SchedaTecnica`: conferma tecnica della fornitura, data prescrizione, codice
  ISO, quantita, descrizione del presidio, prescrittore e struttura.

Regole di import reviewable:

- una voce `prosthetic_prescriptions` per ogni presidio ISO documentato;
- `regionalPrescriptionId` da `NUMERO PRESCRIZIONE` / `NUMERO PRATICA`;
- `prescribedAt` da `DATA PRESCRIZIONE`, conservando eventuale data domanda
  nelle note se diversa;
- `status=prescribed` quando esiste solo la prescrizione clinica,
  `status=submitted` quando il modello regionale documenta la domanda
  presentata, e stati `authorized`, `delivered`, `tested` solo con evidenza
  esplicita;
- `collaudoAt` solo con data di collaudo effettiva; `Prescrizione soggetta a
  collaudo: NO` e una informazione di requisito, non un collaudo completato;
- `measures` solo per misure, configurazioni, quantita o tempi d'impiego
  espliciti, senza inventare dettagli tecnici dalla narrativa;
- `clinicalReason` solo da diagnosi, analisi funzionale e significato
  terapeutico-riabilitativo documentati.

Il matching resta paziente-scoped: codice fiscale prima, poi nome/data di
nascita come controllo secondario. Se i documenti del pacchetto divergono su
identita, numero pratica o data, l'import deve fermarsi e lasciare una bozza da
revisione operatore.

---

## Data layer e cifratura

### DB locale

- File: `medical.db`
- Schema: `lib/schema.ts`
- Accesso server: `lib/db-server.ts`
- `patients.documentInsights` resta la projection compatibile dei documenti analizzati
- `attachments.summarySnapshot` e `attachments.parseEvidenceArtifactSnapshot`
  sono snapshot clinici cifrati associati al singolo allegato

### Cifratura lato client (web)

Il server non vede i dati in chiaro. La cifratura avviene nel browser prima della scrittura:

```
Dato originale -> AES-256-GCM -> "ENC:<iv_b64>:<cipher_b64>" -> DB
```

I campi cifrati sono definiti in `lib/db.ts` (ENCRYPTED_FIELDS). Lo schema reale va verificato in `lib/schema.ts`.

### Chiavi

| Chiave | Derivazione | Storage | Scopo |
| --- | --- | --- | --- |
| PIN | input utente | mai salvato | deriva KEK |
| Salt | random 16 bytes | DB `users.salt` | PBKDF2 |
| KEK | PBKDF2(PIN, salt, 100k) | memoria | decifra master key |
| MasterKey | random 256 bit | DB (cifrata) + RAM (chiaro) | cifra/decifra dati |

Implementazioni:
- Web: `lib/security.ts`
- macOS: `native/MediFlowMac/.../CryptoService.swift`

---

## Autenticazione e sessione

### Web (setup e login)

- Setup iniziale in `app/api/auth/setup/route.ts`
- Login in `app/api/auth/login/route.ts`
- Sessione client gestita in `components/security-provider.tsx`

### Native (login con PIN)

Flusso identico al web, ma interamente lato app macOS.

```mermaid
sequenceDiagram
    participant App as MediFlowMac
    participant TLS as TLS Proxy
    participant API as Next.js
    participant DB as SQLite

    App->>TLS: POST /api/auth/login {username, password}
    TLS->>API: Forward
    API->>DB: SELECT user WHERE username=?
    DB-->>API: {passwordHash, encryptedMasterKey, salt}
    API-->>TLS: {encryptedMasterKey, salt}
    TLS-->>App: Response
    Note over App: Deriva KEK, decifra MasterKey, sessione in RAM
```

---

## API layer: Web vs Native

### API per web UI

Percorso: `app/api/*`  
Usata dal client web tramite `lib/db.ts`.
Include pre-check FSE per export paziente: `app/api/fse/validate-patient/route.ts`.

### API v1 per client nativo

Percorso: `app/api/v1/*`  
Usata da `LocalAPIClient` nel client nativo macOS. Richiede token:

```
Authorization: Bearer <MEDIFLOW_LOCAL_API_TOKEN>
```

Bootstrap token lato macOS:
- ordine canonico `Keychain -> native-config.json -> local-api-token`
- fallback secondari ammessi solo se il token nel Portachiavi non esiste; errori Keychain restano espliciti
- `LocalAPIClient` prefligge il bootstrap secure-first prima della rete sugli endpoint autenticati; vedi ADR 0014

Endpoint principali:
- `app/api/v1/ambulatories/route.ts`
- `app/api/v1/patients/route.ts`
- `app/api/v1/patients/[id]/route.ts`
- `app/api/v1/patients/[id]/entries/route.ts`
- `app/api/v1/patients/[id]/entries/[entryId]/route.ts`
- `app/api/v1/patients/[id]/therapies/route.ts`
- `app/api/v1/patients/[id]/therapies/[therapyId]/route.ts`
- `app/api/v1/patients/[id]/checkups/route.ts`
- `app/api/v1/patients/[id]/checkups/[checkupId]/route.ts`
- `app/api/v1/patients/[id]/observations/route.ts`
- `app/api/v1/patients/[id]/observations/[observationId]/route.ts`
- `app/api/v1/drugs/route.ts`
- `app/api/v1/exemptions/route.ts`

Tipi condivisi:
- `lib/api/v1/types.ts`

### API v1/network per `home-base` paired

La first thin slice `network home-base` si attiva solo in modalita
`network-home-base` dal pannello Settings.

Surface attuale:

- summary PHI-safe di nodo, sessione, capability, identita e AI runtime
- pairing bootstrap/confirm
- primo data plane remoto read-only su pazienti (`/api/v1/network/patients*`)
- primo write remoto limitato a `PUT /api/v1/network/patients/{id}` per profilo/status paziente

Boundary attuale:

- `POST /api/v1/network/pairing-intents` e bootstrap PHI-safe
- read e write remoto richiedono `paired client` + sessione operatore valida
- il write richiede capability `network.replica.write-patient-profile` e `version`
- delete remoto, child CRUD, sync record-level e fallback automatico restano fuori scope

### Backup e restore artifact v1

La voce `Backup` in `app/settings/page.tsx` usa `components/backup-restore-ui.tsx`
per esportare un artifact JSON `.mediflow` v1 con manifest e checksum.

La thin slice `WUL-30` aggiunge anche `components/backup-scheduler-ui.tsx`, che
permette di configurare un backup automatico notturno macOS via `launchd`
utente. Il job usa `scripts/run-scheduled-backup.mjs`, scrive un artifact `.mediflow`
v1 nella cartella destinazione e aggiorna in `settings` lo stato dell'ultimo run.
La thin slice `WUL-31` completa il lifecycle minimo con retention `keep-last-N`
solo sui file `mediflow-backup-v1-*` generati dallo scheduler, piu anteprima
dry-run e apply manuale dalla stessa UI.

Flusso:

1) il client web richiama `GET /api/system/backup-restore`
2) il server legge direttamente SQLite, costruisce lo snapshot canonico e
   arricchisce `patients` con `assignedAmbulatoryIds` quando esistono link
   many-to-many aggiuntivi
3) il server serializza l'artifact con manifest, counts e checksum `sha256`
4) il restore invia il file alla stessa route server-side
5) il server valida format, versione, scope, checksum e riferimenti interni
6) il server svuota le tabelle supportate e reinserisce i record direttamente in SQLite

Per il backup automatico:

1) la UI salva `enabled`, orario e cartella destinazione in `settings`
2) `app/api/system/backup-scheduler/route.ts` installa o rimuove il `LaunchAgent`
3) `launchd` esegue il runner headless locale all'orario scelto
4) il runner legge `medical.db`, genera l'artifact v1, applica la retention sui
   soli file scheduler-owned e salva esito/path ultimo run

Nota: `patients.ambulatoryId` e gli eventuali `assignedAmbulatoryIds` vengono
re-materializzati in `patients_to_ambulatories`; le preferenze non esportabili
restano follow-up. Vedi anche [docs/adr/0016-backup-artifact-v1-manifest-preflight.md](./adr/0016-backup-artifact-v1-manifest-preflight.md).

---

## AI e OCR

### Servizi

- `lib/ai-service.ts`: wrapper LLM (Ollama / MLX)
- `app/api/proxy/ai/chat/route.ts`: proxy locale verso provider
- `lib/ocr-service.ts`: OCR multimodale
- `lib/pdf-service.ts`: estrazione testo PDF (fallback regex)
- `lib/document-synthesis-service.ts`: sintesi clinica + salvataggio
- `lib/document-parse-evidence-artifact.ts`: artifact canonico `parse/evidence`
  per allegato, con `sectionMap` opzionale per sezioni classificate, ancore
  fact `page/section/snippet` e conflitti reviewable
- `lib/openmed-redaction.ts` + `app/api/system/redaction/route.ts`: adapter
  locale shadow-only per la lane `redaction.v1`

### Flusso OCR + Sintesi

1) Utente carica PDF/immagine
2) Normalizzazione input locale (PDF/immagine/CDA/CCD quando presente)
3) OCR via DeepSeek-OCR (Ollama)
4) Analisi testuale e sintesi via Qwen (`qwen3.5:35b-a3b` di default)
5) Costruzione di:
   - `summarySnapshot` leggibile
   - `parse/evidence artifact` canonico per l'allegato, incluse le ancore
     sezionali quando disponibili
   - `documentInsights` come projection/compat layer iniziale
6) Estrazione prudente di eventuali diagnosi con codice ICD esplicito
7) Persistenza cifrata sugli allegati + refresh di `AI Patient Insight`

### Import documento nella nuova anagrafica

Nel create-flow `Nuova Anagrafica`, `components/pdf-importer.tsx` usa lo stesso
OCR locale ma aggiunge una review intermedia esplicita prima del salvataggio.
La decisione operativa e fissata in [ADR 0042](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
e viene ora resa esplicita dal contratto `patient import decision` di
[ADR 0051](./adr/0051-patient-import-decision-contract-between-review-and-persistence.md).

Il flusso:

1) OCR + analisi clinica del documento su un excerpt piu ampio del testo utile
2) estrazione di:
   - diagnosi con codice ICD esplicito
   - problemi clinici reviewable senza codice esplicito
   - terapie candidate reviewable
3) riconciliazione locale reviewable:
   - match ICD-11 per i problemi candidati
   - match AIFA/ATC o fallback manuale per le terapie candidate
4) costruzione di un `patient import decision` esplicito:
   - target dell import (`create_new_patient`, `merge_existing_patient`,
     `review_identity`)
   - field decisions
   - diagnosi `apply_structured|review_only|ignore`
   - terapie `persist_structured|append_note|ignore`
5) review operatore su anagrafica, diagnosi e terapie prima di applicare i
   default al form
6) alla creazione della scheda, le terapie confermate e attive con posologia
   sufficiente vengono persistite come record strutturati in `therapies`; i casi
   incompleti o non attivi possono restare come nota documentale di supporto

Vincoli:

- anche in questo flusso non esiste import silenzioso da free-text a ICD o
  terapia
- la riconciliazione resta sempre locale e reviewable
- una terapia manual-only o senza posologia sufficiente non viene promossa a
  record strutturato solo perche compare nel documento

### Smart Import reviewable nel profilo paziente

Nel profilo paziente il web client espone anche una CTA persistente di smart import
quando esistono fonti utili (`patient.notes`, diario clinico, `documentInsights`,
summary di allegati).

Il flusso:

1) raccoglie le fonti cliniche locali gia presenti  
2) le invia al modello clinico locale piu capace configurato  
3) produce suggerimenti reviewable per:
   - diagnosi candidate con match ICD-11 locale
   - terapie candidate con match catalogo AIFA/ATC o fallback manuale
4) applica solo gli elementi confermati dall'operatore su `patients.diagnoses`
   e `therapies`, con dedupe esplicito
5) se la fonte e solo referral/follow-up senza novita clinica e la diagnosi o
   terapia e gia presente, il suggerimento viene soppresso invece di essere
   riproposto come rumore operativo

Vincolo: l'autofill automatico dei documenti non cambia e resta limitato ai soli
ICD espliciti previsti da ADR 0011; patologie free-text e terapie richiedono sempre
review umana in questa slice.

### Guard revisione shell web

La shell web espone un fingerprint stabile della sorgente locale tramite
`lib/app-revision.ts` e `/api/system/revision`.

Comportamento:

- `AppRevisionGuard` controlla il fingerprint quando la tab torna visibile e a
  intervalli regolari
- se branch/revision/worktree cambiano, la tab fa un reload soft una sola volta
- `Start_MediFlow.command` resetta `.next` quando la sorgente cambia e rifiuta
  di riusare la porta `3000` se occupata da un worktree diverso

---

## Integrazione nativa macOS

### TLS Proxy locale

Script: `scripts/native-setup.sh`  
Proxy: `scripts/local-api-tls-proxy.mjs`

Flusso:
1) Genera certificato self-signed  
2) Avvia proxy HTTPS su `:3443`  
3) Scrive `~/Library/Application Support/MediFlow/native-config.json`

La app macOS usa TLS pinning in `LocalAPIClient`.

### Avvio rapido

- Web + servizi: `./Start_MediFlow.command`
- Native: `./scripts/Launch_MediFlowMac.command`

---

## Flusso dati cifrati (native)

```mermaid
sequenceDiagram
    participant UI as SwiftUI View
    participant SEC as SecuritySession
    participant CRYPTO as CryptoService
    participant API as LocalAPIClient

    UI->>API: fetchPatient(id)
    API-->>UI: PatientDetail {notes: "ENC:..."}
    UI->>SEC: decryptString("ENC:...")
    SEC->>CRYPTO: AES-GCM open
    CRYPTO-->>SEC: testo in chiaro
    SEC-->>UI: testo in chiaro
```

Scrittura:

```mermaid
sequenceDiagram
    participant UI as SwiftUI View
    participant SEC as SecuritySession
    participant CRYPTO as CryptoService
    participant API as LocalAPIClient

    UI->>SEC: encryptString("Via Roma 123")
    SEC->>CRYPTO: AES-GCM seal
    CRYPTO-->>SEC: "ENC:..."
    SEC-->>UI: "ENC:..."
    UI->>API: createPatient({address: "ENC:..."})
```

---

## Mappa file (rapida)

| Area | File chiave |
| --- | --- |
| Schema DB | `lib/schema.ts` |
| DB server | `lib/db-server.ts` |
| Client DB web | `lib/db.ts` |
| Sicurezza web | `lib/security.ts`, `components/security-provider.tsx` |
| API auth | `app/api/auth/*` |
| API web | `app/api/*` |
| API v1 | `app/api/v1/*` |
| AI/OCR | `lib/ai-service.ts`, `lib/ocr-service.ts`, `lib/pdf-service.ts` |
| Proxy AI | `app/api/proxy/ai/chat/route.ts` |
| ICD | `app/api/icd/proxy/route.ts` |
| Native app | `native/MediFlowMac/Sources/MediFlowMac/*` |
| TLS proxy | `scripts/local-api-tls-proxy.mjs` |

---

## Checklist operativa

1) Avvia `npm run dev` (o `Start_MediFlow.command`)  
2) Avvia ICD-11 Docker (`docker compose up -d icd-api`)  
3) Avvia TLS proxy (`scripts/native-setup.sh` o `Launch_MediFlowMac.command`)  
4) Apri web app e completa il setup PIN  
5) Avvia app macOS e fai login con PIN  

---

## Limitazioni attuali

- `home-base` e ancora read-only-first: esiste solo il primo `PUT` profilo/status
  paziente; child CRUD, delete remoto, sync record-level e fallback automatico
  promotable restano fuori.
- `documentInsights` resta un compat layer: il `document evidence ledger` ha
  ora una base runtime con artifact e prime ancore sezionali, ma i decision
  layer completi restano incrementali.
- Il vecchio shell macOS resta congelato: la parity non riparte su quello
  snapshot.
- Il pairing multi-device e la UX iPhone/iPad sono ancora workstream aperti.

---

## Prossimi passi suggeriti

1) Estendere la UX `home-base`: pairing guidato, replica governata e fallback
   dichiarato senza rompere il local-first
2) Portare altri consumer sul `parse/evidence artifact` prima di cambiare i
   contratti persistiti piu ampi
3) Riavviare il filone native sul nuovo shell, non su quello storico
4) Aprire i target iPhone/iPad coerenti con il boundary paired/read-only-first
   e con il write paziente limitato/versionato
