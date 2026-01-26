# 🗺️ MediFlow Product Roadmap

> **Stato Attuale**: v0.2.0 "Brain Transplant" (Architettura Ibrida: Native + Docker + SQLite)

Questa roadmap traccia l'evoluzione di MediFlow da strumento personale a prodotto maturo per la classe medica.
Il recente passaggio a **SQLite** e **Docker** ha gettato le fondamenta solide su cui costruire il futuro.

---

## ✅ Completati (v0.2.0)

- [x] **Brain Transplant**: Abbandono di IndexedDB per SQLite (Persistenza robusta).
- [x] **Local AI Reale**: Integrazione diretta con Ollama e Apple MLX (Metal).
- [x] **ICD-11 Ufficiale**: Adozione dello standard WHO via Docker container.
- [x] **Crittografia Zero-Knowledge**: Dati cifrati at-rest con AES-256.

---

## 📅 Breve Termine: Consolidamento e Compliance (v0.3.0)

**Obiettivo**: Rendere l'app "Legal-Ready" e a prova di bomba per l'uso quotidiano.

### ⚖️ GDPR & Sicurezza Avanzata

- [ ] **Audit Logs Immutabili**: Registrare ogni accesso ("Chi ha visto cosa e quando") su un file di log protetto, essenziale per la compliance legale.
- [ ] **Key Rotation**: Funzionalità per cambiare il PIN (e quindi ricifrare la Master Key) senza perdere i dati.
- [ ] **Data Retention Policy**: Cancellazione automatica (o avvisi) per dati più vecchi di X anni (configurabile).

### 🛠️ Esperienza Utente (UX)

- [ ] **Backup Automatico**: Esportazione schedulata del file `medical.db` cifrato su cartella locale o cloud (iCloud/Dropbox).
- [ ] **Gestione Allegati Migliorata**: Anteprima PDF rapida integrata e OCR automatico in background.
- [ ] **Update Checker**: Avviso automatico quando è disponibile una nuova versione su GitHub.

---

## 🔭 Medio Termine: AI Avanzata e Multimodalità (v0.4.0)

**Obiettivo**: Trasformare l'AI da "Chatbot" a "Assistente Proattivo".

### 🧠 RAG (Retrieval Augmented Generation) Clinico

- [ ] **Chatta con la Cartella**: Non solo riassunti. L'AI potrà rispondere a domande tipo: *"Qual è il trend della glicemia di Mario negli ultimi 6 mesi?"* analizzando i dati storici strutturati.
- [ ] **Drug Interaction Checker**: Verifica automatica delle interazioni tra la terapia cronica e una nuova prescrizione usando il contesto del paziente.

### 🗣️ Multimodalità

- [ ] **Dettatura Vocale (Voice-to-Text)**: Trascrizione locale (Whisper) delle note cliniche. "Dettare la visita" invece di scriverla.
- [ ] **Analisi Immagini**: Scannerizzare referti cartacei o foto di lesioni dermatologiche per archiviarle con tag automatici.

---

## 🚀 Lungo Termine: Productization & Mobile (v1.0.0)

**Obiettivo**: Distribuzione di massa "Zero Config".

### 📦 Desktop App Nativa

- [ ] **Migrazione a Tauri/Electron**: Abbandonare il browser di sistema per una finestra applicativa dedicata.
- [ ] **Bundling Docker**: Nascondere la complessità di Docker (o sostituirlo con binari statici embedded) per un'installazione "One Click".

### 📱 Companion App Mobile

- [ ] **MediFlow Go (iOS)**: App "Satellite" per consultare i dati cifrati in mobilità.
- [ ] **Sync Sicuro P2P**: Sincronizzazione diretta Mac-iPhone via Wi-Fi locale (senza cloud intermediario).

---

*Ultimo aggiornamento: 25 Gennaio 2026*
