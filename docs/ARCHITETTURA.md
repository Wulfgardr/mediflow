# 🛠 Architettura di MediFlow

> **Sotto il cofano: Stack, Sicurezza e Data Flow.**
> Documentazione tecnica per sviluppatori e contributori.

---

## 1. Visione d'Insieme

MediFlow non è una semplice web app. È un **sistema ibrido locale** progettato per la massima privacy e persistenza dei dati.

### Topologia Ibrida

Il sistema è composto da tre layer che convivono sul `localhost` del medico:

```mermaid
graph TD
    subgraph "Layer 1: Interfaccia (Frontend)"
        Native[🖥️ App Nativa macOS]
        Web[🌐 Web App (Next.js)]
    end

    subgraph "Layer 2: Core & Dati (Backend Locale)"
        NextAPI["⚙️ Next.js Server (:3000)"]
        DB[(💾 SQLite: medical.db)]
    end

    subgraph "Layer 3: Motori AI (Servizi)"
        Ollama["🧠 Ollama (AI + OCR)"]
        ICD["🏥 ICD-11 Docker (:8888)"]
    end

    Native -->|HTTPS :3443| NextAPI
    Web -->|HTTP :3000| NextAPI
    NextAPI --> DB
    NextAPI --> Ollama
    NextAPI --> ICD
    
    style Native fill:#333,stroke:#fff,color:#fff
    style Web fill:#61dafb,stroke:#333
    style DB fill:#eee,stroke:#333
    style Ollama fill:#ff9900,stroke:#333
```

1. **Layer Interfaccia**: L'utente usa il browser (Chrome/Safari) o l'App Nativa (SwiftUI).
2. **Layer Core**: Next.js gestisce la logica, le API e parla con il database SQLite.
3. **Layer Servizi**: Container Docker e processi locali forniscono l'intelligenza (AI) e gli standard (ICD-11).

---

## 2. Lo Stack Tecnico

Una selezione pragmatica per performance e mantenibilità.

| Ruolo | Tecnologia | Versione | Perché? |
| :--- | :--- | :--- | :--- |
| **Frontend** | React / Next.js | 16 / 15 | Standard industriale, veloce, component-based. |
| **UI** | Tailwind CSS | v4 | Styling rapido e consistente. |
| **Database** | SQLite | 3.x | File singolo, zero config, perfetto per local-first. |
| **ORM** | Drizzle | Ultima | Type-safe, leggero, ottime migrazioni. |
| **AI Runtime** | Ollama | Locale | Esegue LLM (Gemma, Llama) su GPU Apple Silicon. |
| **Native** | SwiftUI | 5.0 | UI nativa performante per macOS. |

---

## 3. Sicurezza e Crittografia (Zero-Knowledge)

La sicurezza è il pilastro fondamentale. **Nessun dato chiaro tocca mai il disco.**

### Il Protocollo

1. **PIN Utente**: L'unica chiave che non viene mai salvata.
2. **Master Key (AES-256)**: Generata al setup, cifrata con il PIN.
3. **Sessione**: Quando l'utente fa login, il PIN decifra la Master Key in RAM.

### Flusso di Scrittura

Quando salvi una nota clinica:

1. Il Frontend prende il testo `"Paziente iperteso"`.
2. Usa la *Master Key* (in memoria) per cifrarlo con **AES-256-GCM**.
3. Genera una stringa: `ENC:base64(iv):base64(ciphertext)`.
4. Invia questa stringa al Database.

Il database `medical.db` contiene solo stringhe senza senso. Se rubano il file, non leggono nulla.

```mermaid
sequenceDiagram
    participant Medico
    participant Browser
    participant RAM as Memoria Volatile
    participant DB as Disco Fisso

    Medico->>Browser: Inserisce PIN
    Browser->>RAM: Deriva Chiave (PBKDF2)
    Browser->>DB: Legge Chiave Master Cifrata
    DB-->>Browser: OK
    Browser->>RAM: Decifra Chiave Master
    Note right of RAM: Ora la chiave è attiva (solo in RAM)
    
    Medico->>Browser: Scrive "Paziente OK"
    Browser->>RAM: Cifra con Chiave Master
    Browser->>DB: Salva "A8d%j9s..."
```

---

## 4. Pipeline AI & OCR

Non mandiamo PDF a ChatGPT. Facciamo tutto in casa.

### Flusso Documentale

1. **Upload**: Il medico carica un PDF/JPG.
2. **OCR (DeepSeek-VLM)**:
    * Il file passa a Ollama.
    * Il modello multimodale "guarda" l'immagine ed estrae il testo strutturato.
3. **Sintesi (MedGemma)**:
    * Il testo estratto viene passato a un LLM clinico (MedGemma).
    * Prompt: *"Sei un medico esperto. Riassumi questo referto..."*
4. **Salvataggio**:
    * Testo e Riassunto vengono cifrati e salvati nel DB.

---

## 5. Struttura del Database

Principali tabelle in `lib/schema.ts`:

* `patients`: Anagrafica base. Molti campi sono cifrati (`notes`, `phone`).
* `entries`: Il diario clinico. Visite, note, tutto cronologico.
* `therapies`: Farmaci attivi.
* `ambulatories`: Per gestire multi-sede.

---

## 6. API v1 (Per Client Nativo)

Questi endpoint restituiscono solo JSON puro (niente HTML/React Server Components) e sono ottimizzati per Swift.

| Endpoint | Metodo | Scopo |
| :--- | :--- | :--- |
| `/api/v1/patients` | GET/POST | Lista pazienti / Crea paziente |
| `/api/v1/patients/[id]` | GET | Dettaglio completo (cifrato) |
| `/api/v1/patients/[id]/entries` | GET/POST | Diario clinico |
| `/api/v1/patients/[id]/therapies` | GET/POST | Terapie attive |
| `/api/v1/ambulatories` | GET | Lista ambulatori (per i colori) |

---

## 7. Prossimi Passi (Roadmap Web)

* [ ] Backup automatico schedulato.
* [ ] Export GDPR-compliant (JSON/CSV leggibile).
