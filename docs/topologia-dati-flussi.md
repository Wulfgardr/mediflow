---
summary: "Canonical MediFlow data-flow topology covering data origin, encryption, persistence, trust boundaries, and protected digital paths."
read_when:
  - "Reviewing data flow, encryption, trust boundaries, or PHI-safe routing."
  - "Changing APIs, document artifacts, local services, network home-base, or security-sensitive workflows."
---

# Topologia Dati e Flussi - MediFlow

> [!IMPORTANT]
> **Stato documento: CANONICAL (topologia dati e percorsi digitali end-to-end).**
> Per principi stabili e confini, prevale [ARCHITECTURE.md](../ARCHITECTURE.md).
> Per policy di sicurezza e redazione, prevale [SECURITY.md](../SECURITY.md).

Questo documento mappa in modo operativo:

- dove nasce il dato
- dove viene cifrato/decifrato
- dove viene persistito
- quali controlli di sicurezza lo proteggono

Riferimenti rapidi:
- [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)

---

## 🧱 1. Topologia end-to-end (componenti + confini)

```mermaid
flowchart TB
  subgraph "Client Layer"
    WebUI["Web UI (Browser)"]
    WebCrypto["Web Crypto AES-256-GCM"]
    NativeUI["Native macOS Client (SwiftUI arm64)"]
    NativeCrypto["SecuritySession + CryptoService (RAM only)"]
    PairedClient["Paired Apple client (iPhone/iPad/macOS)"]
  end
  subgraph "Transport"
    HttpLocal["HTTP localhost :3000"]
    TLSProxy["TLS Proxy https://127.0.0.1:3443"]
    LanTLS["HTTPS trusted LAN :3443"]
  end
  subgraph "Next.js Backend"
    AuthAPI["Auth API (/api/auth/*)"]
    WebAPI["Web API (/api/*)"]
    V1API["Native API v1 (/api/v1/*)"]
    NetworkAPI["Network API v1 (/api/v1/network/*)"]
    TokenSvc["Local API token service"]
  end
  subgraph "Local Services"
    Ollama["Ollama :11434"]
    ICD["ICD-11 Docker :8888"]
    OpenMed["OpenMed redaction :18080 (shadow)"]
  end
  subgraph "Local Filesystem"
    SQLite[("medical.db (SQLite)")]
    LocalToken[("local-api-token (0600)")]
    NativeCfg[("native-config.json")]
    TLSCert[("TLS cert.pem + key.pem")]
    Settings[("settings JSON")]
  end
  WebUI -->|"encrypt/decrypt"| WebCrypto
  WebUI -->|"session cookie"| HttpLocal
  HttpLocal --> WebAPI
  HttpLocal --> AuthAPI
  NativeUI -->|"encrypt/decrypt"| NativeCrypto
  NativeUI -->|"Bearer token"| TLSProxy
  TLSProxy -->|"forward"| V1API
  PairedClient -->|"paired creds + session"| LanTLS
  LanTLS -->|"forward"| NetworkAPI
  WebAPI --> SQLite
  AuthAPI --> SQLite
  V1API --> SQLite
  NetworkAPI --> SQLite
  V1API -->|"token check"| TokenSvc
  TokenSvc --> LocalToken
  WebAPI --> Ollama
  WebAPI --> ICD
  WebAPI --> OpenMed
  NativeUI --> NativeCfg
  TLSProxy --> TLSCert
  NetworkAPI --> Settings
```

Nota operativa: i client paired non accedono direttamente al database. Il nodo
autorevole resta il Mac `home-base`, che espone solo superfici documentate e
oggi ancora `read-only-first` nel disegno generale, con write online limitati e
versionati su profilo/status paziente, diario clinico, terapie, checkup e
osservazioni.

---

## 🔒 2. Topologia del dato a riposo

```mermaid
flowchart LR
  Plain["Dato clinico in chiaro"] --> Encrypt["Cifratura client-side AES-256-GCM"]
  Encrypt --> EncFmt["Formato ENC:iv_b64:cipher_b64"]
  EncFmt --> DB[("SQLite medical.db")]
  PIN["PIN utente"] --> KDF["PBKDF2-SHA256"]
  Salt["users.salt"] --> KDF
  KDF --> KEK["KEK in memoria"]
  KEK --> EMK["users.encrypted_master_key"]
  EMK --> MK["Master key in RAM"]
  MK --> Encrypt
```

Note operative: il PIN non viene salvato, la master key resta in RAM di sessione e i campi sensibili persistono cifrati.

---

## 🗄️ 3. Topologia relazionale del database (schema principale)

```mermaid
erDiagram
    AMBULATORIES ||--o{ PATIENTS : "default owner"
    PATIENTS ||--o{ PATIENTS_TO_AMBULATORIES : "assignment"
    AMBULATORIES ||--o{ PATIENTS_TO_AMBULATORIES : "assignment"
    PATIENTS ||--o{ ENTRIES : "clinical diary"
    PATIENTS ||--o{ THERAPIES : "therapies"
    PATIENTS ||--o{ OBSERVATIONS : "measurements"
    PATIENTS ||--o{ CHECKUPS : "appointments"
    PATIENTS ||--o{ ATTACHMENTS : "documents"
    CONVERSATIONS ||--o{ MESSAGES : "chat thread"
    USERS {
        text id PK
        text username UK
        text passwordHash
        text encryptedMasterKey
        text salt
    }
    AMBULATORIES {
        text id PK
        text name
        text parentId
        bool isDefault
    }
    PATIENTS {
        text id PK
        text firstName
        text lastName
        text taxCode
        text address "ENC"
        text phone "ENC"
        text notes "ENC"
        text aiSummary "ENC"
        text documentInsights "ENC compat projection"
        bool isArchived
        text ambulatoryId FK
    }
    PATIENTS_TO_AMBULATORIES {
        text patientId FK
        text ambulatoryId FK
        int assignedAt
    }
    ENTRIES {
        text id PK
        text patientId FK
        text type
        int date
        text content "ENC"
    }
    THERAPIES {
        text id PK
        text patientId FK
        text drugName
        text aic
        text atc
        text motivation "ENC"
    }
    OBSERVATIONS {
        text id PK
        text patientId FK
        text code
        text unitCode
        text value
        text notes "ENC"
        int observedAt
    }
    CHECKUPS {
        text id PK
        text patientId FK
        int date
        text status
        text notes "ENC"
    }
    ATTACHMENTS {
        text id PK
        text patientId FK
        text name "ENC"
        text data "ENC"
        text summarySnapshot "ENC"
        text parseEvidenceArtifactSnapshot "ENC"
    }
    CONVERSATIONS {
        text id PK
        text title "ENC"
    }
    MESSAGES {
        text id PK
        text conversationId FK
        text role
        text content "ENC"
    }
```

Nota operativa: stati `network.mode`, pairing intents, paired client trusted,
backup scheduler e alcuni guardrail AI vivono in `settings` JSON versionati.

Nota soft-delete (ADR 0066, WUL-306): la cancellazione paziente scrive un
tombstone reversibile (`deletedAt` / `deletionReason`) con version guard, non
orfana i figli clinici e lascia il contratto API invariato. Le sotto-risorse
cliniche (diario, terapie, checkup, osservazioni) seguono lo stesso ciclo
soft-delete (WUL-308); le liste escludono i record soft-deleted salvo
`includeDeleted`. L'erasure GDPR esplicita resta una azione admin separata
(`purge-patient` con dry-run e audit `patient.purged`, `restore-patient` con
audit `patient.restored`).

---

## ⚙️ 4. Flussi operativi principali

### 4.1 Setup/login e attivazione chiavi (web)

```mermaid
sequenceDiagram
    participant Clinician as Medico
    participant Browser as Web UI
    participant AuthAPI as Next.js Auth API
    participant DB as SQLite
    Clinician->>Browser: Inserisce username, PIN e profilo
    Browser->>Browser: Deriva KEK da PIN + salt locale
    Browser->>AuthAPI: POST /api/auth/setup
    AuthAPI->>DB: Salva user, passwordHash, encryptedMasterKey, salt
    AuthAPI-->>Browser: Setup OK + session cookie
    Clinician->>Browser: Login con PIN
    Browser->>AuthAPI: POST /api/auth/login
    AuthAPI->>DB: Verifica passwordHash
    AuthAPI-->>Browser: encryptedMasterKey + salt
    Browser->>Browser: Deriva KEK e decifra MasterKey in RAM
```

### 4.2 Scrittura clinica via web (`/api/*`)

```mermaid
sequenceDiagram
    participant UI as Web UI
    participant Sec as lib/security.ts
    participant API as Next.js Web API
    participant DB as SQLite
    UI->>Sec: encryptData(plainText, masterKey)
    Sec-->>UI: ENC:iv:cipher
    UI->>API: POST/PUT payload cifrato
    API->>DB: Persistenza record
    DB-->>API: OK
    API-->>UI: JSON response
```

### 4.3 Lettura/scrittura via client nativo (`/api/v1/*`)

```mermaid
sequenceDiagram
    participant NativeUI as SwiftUI
    participant Session as SecuritySession
    participant Client as LocalAPIClient
    participant TLS as TLS Proxy :3443
    participant V1 as Next.js API v1
    participant DB as SQLite
    NativeUI->>Session: encryptString(plainText)
    Session-->>NativeUI: ENC:iv:cipher
    NativeUI->>Client: create/update payload cifrato
    Client->>TLS: HTTPS + Bearer token
    TLS->>V1: Forward HTTP localhost
    V1->>V1: requireLocalApiToken()
    V1->>DB: Write/Read
    DB-->>V1: Result
    V1-->>TLS: JSON
    TLS-->>Client: JSON
    Client-->>NativeUI: DTO
```

### 4.4 Pipeline documento -> OCR -> sintesi -> storage

```mermaid
sequenceDiagram
    participant Clinician as Medico
    participant UI as Web UI
    participant API as Next.js API
    participant OCR as ocr-service
    participant LLM as Ollama/DeepSeek OCR
    participant Vision as Apple Vision (macOS-only)
    participant Synth as document-synthesis-service
    participant DB as SQLite
    Clinician->>UI: Carica PDF/immagine
    UI->>API: Upload documento
    API->>OCR: Estrai testo
    OCR->>LLM: Richiesta OCR multimodale primaria
    LLM-->>OCR: Testo estratto o output low-signal
    alt macOS + output OCR low-signal
        OCR->>Vision: Fallback locale Apple Vision
        Vision-->>OCR: Testo estratto
    else Windows/Linux o fallback non disponibile
        OCR-->>API: Failure esplicito se non c'e testo utile
    end
    OCR-->>API: OCR markdown
    API->>Synth: Analisi clinica strutturata
    Synth->>LLM: Prompt Qwen text-only
    LLM-->>Synth: Summary + quality + ICD espliciti
    Synth-->>API: Insight + autofill prudente + parse/evidence artifact
    API->>DB: Salva summary/parse-evidence sugli attachments + aggiorna documentInsights e diagnosi
    API-->>UI: Esito + dati
```

La filiera OCR certificata corrente e platform-aware:

- `Ollama/DeepSeek OCR` resta il motore OCR primario locale.
- `Apple Vision` e un fallback locale **solo macOS**, attivato quando l'output
  primario e vuoto o degenerato.
- Windows e Linux non hanno oggi un fallback OCR platform-specific equivalente
  in MediFlow; senza testo utile dal primario o dal documento, il flusso deve
  fallire in modo esplicito.
- Il fallback OCR cambia solo la recognition: Smart Import, nuova anagrafica da
  documento e Patient Insight restano reviewable e non scrivono dati clinici
  strutturati senza conferma.
- I documenti senza testo finiscono nella `Coda OCR` (WUL-237) con stati e motivi
  in italiano e riprocesso idempotente; nessuna proposta clinica parte finche il
  testo non basta.

### 4.5 Documento archiviato -> Patient Insight artifact-first

```mermaid
sequenceDiagram
    participant Upload as Document Upload
    participant Attach as attachments
    participant Artifact as parse/evidence artifact
    participant Insight as AI Patient Insight
    Upload->>Attach: Salva attachment + summarySnapshot cifrato
    Upload->>Artifact: Persiste parseEvidenceArtifactSnapshot cifrato
    Insight->>Attach: Legge allegati recenti
    Insight->>Artifact: Prova prima il context artifact-first
    Artifact-->>Insight: facts/evidence/provenance
    Insight-->>Insight: Fallback a documentInsights solo se l'artifact manca
```

### 4.6 Profilo paziente -> smart import reviewable

```mermaid
sequenceDiagram
    participant Clinician as Medico
    participant UI as Web UI
    participant AI as AIService
    participant ICD as ICD local proxy
    participant Drugs as AIFA local catalog
    participant DB as SQLite
    Clinician->>UI: Avvia smart import dal profilo paziente
    UI->>DB: Legge note, diario, documentInsights, terapie/diagnosi correnti
    UI->>AI: Prompt strutturato con fonti locali
    AI-->>UI: Suggerimenti reviewable (diagnosi + terapie)
    UI->>ICD: Match locale ICD-11 per diagnosi free-text
    UI->>Drugs: Match locale farmaci/AIC/ATC
    UI-->>Clinician: Mostra proposte con evidenze e selezione esplicita
    Clinician->>UI: Conferma solo i suggerimenti validi
    UI->>DB: Aggiorna diagnoses + therapies con dedupe
```

Nota operativa: questo flusso non sostituisce ADR 0011. L'autofill automatico
resta limitato ai soli ICD espliciti nei documenti; diagnosi free-text e terapie
richiedono sempre conferma umana in questa thin slice.

Nota aggiuntiva: se una fonte e solo referral/follow-up senza novita clinica e
una diagnosi o terapia e gia presente, il suggerimento viene soppresso per
ridurre rumore operativo.

### 4.7 Modalita `network-home-base` -> paired client read/write limitato

```mermaid
sequenceDiagram
    participant Client as Paired client
    participant Pair as /api/v1/network/pairing-intents
    participant Node as Nodo home-base
    participant Session as Sessione operatore
    participant Data as /api/v1/network/patients*
    participant Diary as /api/v1/network/patients/{id}/entries*
    participant Therapy as /api/v1/network/patients/{id}/therapies*
    participant Checkup as /api/v1/network/patients/{id}/checkups*
    participant Observation as /api/v1/network/patients/{id}/observations*
    Client->>Pair: POST pairing intent (bootstrap PHI-safe)
    Node-->>Client: pairing secret + intent pending
    Client->>Node: POST confirm intent
    Node-->>Client: paired client token
    Client->>Session: Login operatore sul nodo
    Client->>Data: GET patients / patient detail
    Data-->>Client: payload read-only se paired client + sessione sono validi
    Client->>Data: PUT patient profile/status con version + write capability
    Data-->>Client: success oppure 409 VERSION_CONFLICT
    Client->>Diary: POST/PUT diario con entries.version + diary capability
    Diary-->>Client: success oppure 409 VERSION_CONFLICT
    Client->>Therapy: POST/PUT terapie con therapies.version + therapy capability
    Therapy-->>Client: success oppure 409 VERSION_CONFLICT
    Client->>Checkup: POST/PUT checkup con checkups.version + checkup capability
    Checkup-->>Client: success oppure 409 VERSION_CONFLICT
    Client->>Observation: POST/PUT osservazione con observations.version + observation capability
    Observation-->>Client: success oppure 409 VERSION_CONFLICT
```

Nota operativa (WUL-307): con `network-home-base` spenta i token paired non
leggono ne scrivono e ricevono `403 NETWORK_MODE_DISABLED`, mentre i pairing gia
registrati restano. Fuori scope su questo canale: hard delete remoto, sync
completo, attachment remoti, cataloghi remoti, campi AI/documentali.

---

## 🔌 5. Superfici API e protezione

| Superficie | Consumer | Auth | Trasporto | Scopo |
| --- | --- | --- | --- | --- |
| `/api/auth/*` | Web UI e bootstrap client native | Credenziali + session cookie | HTTP localhost | Setup/login/check/logout |
| `/api/*` | Web UI | Session cookie server | HTTP localhost | CRUD web + proxy locali |
| `/api/v1/*` | Client nativo macOS | `Authorization: Bearer <token>` | HTTPS locale via TLS proxy | Contratto stabile native |
| `/api/v1/network/*` | Client paired trusted | Paired client credential + sessione operatore | HTTPS trusted LAN via TLS proxy | Home-base read-only-first + write versionati su ciclo di vita paziente, diario, terapie, checkup, osservazioni, prestazioni e protesica, piu export FHIR lato client, validazione FSE, revisione e discovery; cataloghi in sola lettura |
| `/api/proxy/ai/*` | Web UI (tool native via backend) | Sessione/token + allowlist localhost | HTTP localhost | AI/OCR locale |
| `/api/icd/proxy` | Web UI | Sessione + allowlist localhost | HTTP localhost | Lookup ICD-11 |

Nota auth: il token locale non porta privilegi admin web. Le route di sistema
ad alto impatto richiedono una sessione admin web; le eccezioni token-aware fuori
da `/api/v1/*` restano limitate a bootstrap/supporto locale e diagnostica
read-only esplicitamente documentati in [SECURITY.md](../SECURITY.md).

---

## 📚 6. Mappa file autorevoli per i flussi

- Schema e topologia DB: `lib/schema.ts`
- Accesso DB server: `lib/db-server.ts`
- Facade web + cifratura client: `lib/db.ts`
- Cifratura web: `lib/security.ts`
- Auth web: `app/api/auth/*`
- API native v1: `app/api/v1/*`
- Controllo token locale: `lib/local-api-auth.ts`, `lib/local-api-token.ts`
- Proxy TLS locale: `scripts/local-api-tls-proxy.mjs`
- Pipeline OCR/sintesi: `lib/ocr-service.ts`, `lib/document-synthesis-service.ts`

---

## ⚠️ 7. Invarianti operativi da non rompere

- Nessun egress cloud di default per dati clinici.
- Nessun campo sensibile in chiaro su SQLite.
- `/api/v1/*` resta versionata e compatibile per client native.
- `network-home-base` resta opt-in, paired e read-only-first, con write paziente, diario, terapie, checkup e osservazioni limitati/versionati.
- Token locale e sessione devono restare separati (web cookie vs native bearer).
- Token locale e sessione admin web non sono intercambiabili: un token valido
  non deve autorizzare audit, backup/restore, scheduler, repair DB o lifecycle
  MLX.
- Proxy verso servizi locali sempre allowlist localhost.
- `summarySnapshot` e `parseEvidenceArtifactSnapshot` restano dati clinici
  cifrati, non log di debug.
- Il placeholder `[LOCKED DATA]` resta solo di presentazione (WUL-323): non deve
  mai sovrascrivere il dato cifrato a riposo.
- La cancellazione clinica passa sempre per soft-delete con version guard
  (ADR 0066, WUL-306, WUL-308); la hard delete resta una erasure GDPR admin
  esplicita.
