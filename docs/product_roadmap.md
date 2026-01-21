# MediFlow: Roadmap "Salto di Qualità" (Productization)

Questa lista traccia l'evoluzione di MediFlow da "Prototipo Dev" a "Prodotto Consumer" (installa e usa).
È un percorso parallelo allo sviluppo delle funzionalità cliniche: qui annotiamo le migliorie architetturali necessarie per la distribuzione di massa.

> **Filosofia**: "Zero Config". L'utente scarica un file, lo apre e funziona tutto. Nessun terminale, niente Docker, niente comandi separati.

---

## 🏗️ 1. Architettura Desktop (Browser → App)

Obiettivo: Eliminare la dipendenza dal browser di sistema e dai comandi di avvio (`npm run dev`).

- [ ] **Migrazione a Electron o Tauri**
  - *Perché*: Per avere un'icona nel dock, finestre native, accesso al file system più robusto e soprattutto per "nascondere" il server Node.js.
  - *Tecnologia consigliata*: **Tauri** (più leggero, usa Rust) o **Electron** (più maturo, usa JS). Dato che usiamo Next.js, Electron è spesso la via più semplice, ma Tauri v2 sta diventando molto forte.
- [ ] **Processo di Build Unificato**
  - Creazione di installer `.dmg` (macOS) e `.exe` (Windows).
  - Firma digitale dell'applicazione (Code Signing) per evitare avvisi di sicurezza.

## 🧠 2. AI "Invisibile" (Ollama Esterno → Embedded)

Obiettivo: L'AI deve funzionare "out of the box" senza installare Ollama separatamente e senza lanciarlo manualmente.

- [ ] **Bundling del Motore di Inferenza**
  - Includere un binario leggero (es. `llama.cpp` server) direttamente dentro l'app.
  - Avviare/fermare il server AI automaticamente quando l'app si apre/chiude ("Sidecar pattern").
- [ ] **Gestione Modelli**
  - Un "Model Manager" integrato nelle impostazioni per scaricare modelli (MedGemma, Llama3) direttamente dall'interfaccia utente, con barra di progresso.
  - Pre-configurazione di un modello "fall-back" molto piccolo (es. TinyLlama o Qwen-1.5B) che si scarica al primo avvio per garantire che l'AI funzioni subito.

## 📚 3. ICD "Zero Docker" (Container Local → File Locale)

Obiettivo: Rimuovere Docker, che è l'ostacolo più grande per un utente non tecnico.

- [ ] **Bye Bye Docker**
  - Docker serve solo per l'API ICD-11 WHO. È eccessivo per un singolo utente.
- [ ] **Soluzione A: Database Embedded**
  - Scaricare il dataset ICD-11 (se la licenza lo permette o se disponibile come open data semplificato) e convertirlo in un database locale (es. SQLite o un file JSON indicizzato massivo) interrogabile direttamente da Node.js.
- [ ] **Soluzione B: API Wrapper Leggero**
  - Se l'algoritmo di ricerca WHO è complesso, compilare solo quel pezzo di logica in un binario nativo (senza tutto il sistema operativo del container).

## 📦 4. Data Persistence & Backup

Obiettivo: Sicurezza dei dati a prova di bomba senza che l'utente debba copiare cartelle a mano.

- [ ] **Backup Automatico**
  - Sistema che crea zip crittografati del database `IndexedDB` e dei file allegati periodicamente.
  - Possibilità di salvare su cartelle cloud (iCloud Drive / Dropbox) automaticamente.
- [ ] **Portable Mode**
  - Possibilità di mettere l'app su una chiavetta USB e farla girare su qualsiasi computer portandosi dietro i dati.

## 📱 5. Versione Mobile (iOS)

Obiettivo: Estendere l'accesso ai dati in mobilità (es. visite a domicilio).

- [ ] **Strategia "Satellite" (Breve Termine)**
  - L'app iOS non è autonoma ma si collega al Mac (che fa da server) quando sono sulla stessa rete Wi-Fi.
  - *Tecnologia*: PWA (Progressive Web App) ottimizzata o app Capacitor che "punta" all'IP del Mac.
  - *Vantaggio*: Nessuna sincronizzazione complessa, i dati restano sul Mac.
  - *Svantaggio*: Funziona solo "in casa/studio" o via VPN.

- [ ] **Strategia "Standalone" (Lungo Termine)**
  - App iOS nativa (o React Native) con database locale replicato.
  - *Sincronizzazione*: Sistema robusto (es. via iCloud o Peer-to-Peer Encrypted) per allineare i dati tra Mac e iPhone quando si incontrano.
  - *Limitazioni AI*: L'iPhone non può far girare facilmente gli stessi modelli LLM enormi del Mac. Su mobile l'AI sarà disabilitata o userà modelli molto ridotti/cloud.
  - *Limitazioni ICD*: Niente Docker. Servirà un'API remota o il database ICD "statico" (vedi punto 3).

---

Ultimo aggiornamento: 16 Gennaio 2026
