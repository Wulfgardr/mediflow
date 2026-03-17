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
- [docs/walkthrough.md](./walkthrough.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)

---

## 1. Topologia end-to-end (componenti + confini)

```mermaid
flowchart TB
  subgraph "Client Layer"
    WebUI["Web UI (Browser)"]
    WebCrypto["Web Crypto AES-256-GCM"]
    NativeUI["Native macOS Client (SwiftUI arm64)"]
    NativeCrypto["SecuritySession + CryptoService (RAM only)"]
  end
  subgraph "Transport"
    HttpLocal["HTTP localhost :3000"]
    TLSProxy["TLS Proxy https://127.0.0.1:3443"]
  end
  subgraph "Next.js Backend"
    AuthAPI["Auth API (/api/auth/*)"]
    WebAPI["Web API (/api/*)"]
    V1API["Native API v1 (/api/v1/*)"]
    TokenSvc["Local API token service"]
  end
  subgraph "Local Services"
    Ollama["Ollama :11434"]
    ICD["ICD-11 Docker :8888"]
  end
  subgraph "Local Filesystem"
    SQLite[("medical.db (SQLite)")]
    LocalToken[("local-api-token (0600)")]
    NativeCfg[("native-config.json")]
    TLSCert[("TLS cert.pem + key.pem")]
  end
  WebUI -->|"encrypt/decrypt"| WebCrypto
  WebUI -->|"session cookie"| HttpLocal
  HttpLocal --> WebAPI
  HttpLocal --> AuthAPI
  NativeUI -->|"encrypt/decrypt"| NativeCrypto
  NativeUI -->|"Bearer token"| TLSProxy
  TLSProxy -->|"forward"| V1API
  WebAPI --> SQLite
  AuthAPI --> SQLite
  V1API --> SQLite
  V1API -->|"token check"| TokenSvc
  TokenSvc --> LocalToken
  WebAPI --> Ollama
  WebAPI --> ICD
  NativeUI --> NativeCfg
  TLSProxy --> TLSCert
```

---

## 2. Topologia del dato a riposo

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

## 3. Topologia relazionale del database (schema principale)

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

---

## 4. Flussi operativi principali

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
    participant LLM as Ollama
    participant Synth as document-synthesis-service
    participant DB as SQLite
    Clinician->>UI: Carica PDF/immagine
    UI->>API: Upload documento
    API->>OCR: Estrai testo
    OCR->>LLM: Richiesta OCR multimodale
    LLM-->>OCR: Testo estratto
    OCR-->>API: OCR markdown
    API->>Synth: Analisi clinica strutturata
    Synth->>LLM: Prompt Qwen text-only
    LLM-->>Synth: Summary + quality + ICD espliciti
    Synth-->>API: Insight + autofill prudente
    API->>DB: Salva documentInsights cifrato + aggiorna diagnosi
    API-->>UI: Esito + dati
```

### 4.5 Profilo paziente -> smart import reviewable

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

---

## 5. Superfici API e protezione

| Superficie | Consumer | Auth | Trasporto | Scopo |
| --- | --- | --- | --- | --- |
| `/api/auth/*` | Web UI e bootstrap client native | Credenziali + session cookie | HTTP localhost | Setup/login/check/logout |
| `/api/*` | Web UI | Session cookie server | HTTP localhost | CRUD web + proxy locali |
| `/api/v1/*` | Client nativo macOS | `Authorization: Bearer <token>` | HTTPS locale via TLS proxy | Contratto stabile native |
| `/api/proxy/ai/*` | Web UI (tool native via backend) | Sessione/token + allowlist localhost | HTTP localhost | AI/OCR locale |
| `/api/icd/proxy` | Web UI | Sessione + allowlist localhost | HTTP localhost | Lookup ICD-11 |

---

## 6. Mappa file autorevoli per i flussi

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

## 7. Invarianti operativi da non rompere

- Nessun egress cloud di default per dati clinici.
- Nessun campo sensibile in chiaro su SQLite.
- `/api/v1/*` resta versionata e compatibile per client native.
- Token locale e sessione devono restare separati (web cookie vs native bearer).
- Proxy verso servizi locali sempre allowlist localhost.
