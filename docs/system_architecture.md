# Architettura di MediFlow (sintesi operativa)

> [!NOTE]
> **Stato documento: SECONDARY (sintesi rapida).**
> La visione architetturale stabile resta `ARCHITECTURE.md`.
> Il walkthrough operativo canonico resta `docs/walkthrough.md`.

Panoramica tecnica rapida per capire componenti, topologia e flussi principali.
Per il dettaglio end-to-end usa anche `docs/walkthrough.md`.

---

## Principi base

1. **Offline first**: Tutto gira in locale. Niente server remoti.
2. **Privacy by design**: I dati sensibili vengono cifrati prima di toccare il disco.
3. **AI locale**: I modelli girano su Ollama, nessuna chiamata a cloud esterni.

---

## Schema generale

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  React UI   │→ │ Encryption  │→ │  API Client (db.ts) │  │
│  │  (Next.js)  │  │  (AES-GCM)  │  │                     │  │
│  └─────────────┘  └─────────────┘  └──────────┬──────────┘  │
└───────────────────────────────────────────────┼─────────────┘
                                                │ REST
┌───────────────────────────────────────────────┼─────────────┐
│                      macOS                     │             │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────▼──────────┐  │
│  │   Ollama    │  │   SQLite    │← │  Next.js Server     │  │
│  │  :11434     │  │ medical.db  │  │      :3000          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐                                            │
│  │Docker: ICD  │                                            │
│  │   :8888     │                                            │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Database

SQLite in locale (`medical.db`). Schema gestito con Drizzle ORM.

### Tabelle principali

| Tabella | Cosa contiene | Campi cifrati |
| --- | --- | --- |
| `users` | Profilo medico, PIN hash, chiave master cifrata | passwordHash, encryptedMasterKey |
| `patients` | Anagrafica, diagnosi, note | address, phone, notes, aiSummary, documentInsights |
| `entries` | Diario clinico (visite, esami, note) | content |
| `therapies` | Piano terapeutico | motivation |
| `checkups` | Controlli programmati | notes |
| `ambulatories` | Sedi/reparti | — |
| `conversations` | Chat con AI | title |
| `messages` | Singoli messaggi AI | content, reasoning |
| `attachments` | PDF e immagini allegati | — (blob binario) |

### Cifratura

I campi marcati come "cifrati" vengono processati nel browser PRIMA di essere inviati al server:

```
Dato originale → AES-256-GCM → "ENC:base64iv:base64ciphertext" → Database
```

Il server vede solo stringhe cifrate. Non ha la chiave.

---

## AI: due modelli che collaborano

| Modello | Porta | Ruolo |
| --- | --- | --- |
| **MedGemma 4B** | 11434 (Ollama) | Analisi clinica, sintesi, supporto decisionale |
| **DeepSeek-OCR 3B** | 11434 (Ollama) | Lettura documenti, estrazione testo da PDF/immagini |

### Flusso OCR + Sintesi

```
1. Utente carica PDF/immagine
2. → DeepSeek-OCR estrae il testo (API multimodale)
3. → MedGemma genera sintesi clinica (max 150 parole)
4. → Salvato in patients.documentInsights (ultimi 3)
5. → Mostrato nel pannello "Archivio Intelligente"
```

Tutto avviene in locale. Zero chiamate esterne.

---

## Endpoint API

| Endpoint | Cosa fa |
| --- | --- |
| `/api/patients` | CRUD pazienti |
| `/api/entries` | Diario clinico |
| `/api/therapies` | Terapie |
| `/api/checkups` | Controlli |
| `/api/conversations` | Chat AI |
| `/api/messages` | Messaggi singoli |
| `/api/proxy/ai/chat` | Proxy verso Ollama |
| `/api/icd/proxy` | Proxy verso ICD-11 Docker |
| `/api/ocr/extract` | Estrazione OCR documenti |
| `/api/auth/login` | Login |
| `/api/auth/setup` | Setup iniziale |

---

## Cifratura: dettagli tecnici

| Parametro | Valore |
| --- | --- |
| Algoritmo | AES-256-GCM (Web Crypto API) |
| Key derivation | PBKDF2-SHA256, 100k iterazioni |
| IV | 12 byte random per operazione |
| Storage chiave | sessionStorage (volatile, RAM only) |
| Formato at-rest | `ENC:base64(iv):base64(ciphertext)` |

La Master Key viene derivata dal PIN, usata per cifrare/decifrare, e vive SOLO nella sessione browser. Al logout o chiusura tab, sparisce.

---

## Docker

Unico container necessario: ICD-11 API (WHO ufficiale).

```yaml
services:
  icd-api:
    image: whoicd/icd-api
    ports:
      - "8888:80"
    environment:
      - acceptLicense=true
      - saveAnalytics=false
```

Ollama gira nativo (non in Docker) per sfruttare GPU Metal.

---

## File di configurazione

| File | Cosa fa |
| --- | --- |
| `lib/schema.ts` | Schema database (Drizzle) |
| `lib/db.ts` | Client API + cifratura |
| `lib/ai-service.ts` | Wrapper Ollama/MLX |
| `lib/ocr-service.ts` | Estrazione documenti |
| `lib/document-synthesis-service.ts` | Sintesi AI documenti |
| `drizzle.config.ts` | Config migrazioni DB |

---

*Ultimo aggiornamento: Febbraio 2026 — MediFlow v0.3.0*
