# MediFlow - Cartella Clinica Personale 🏥

Applicazione locale sicura per la gestione dei dati sanitari personali, con supporto AI e codifiche internazionali (ICD-9/ICD-11).

> **Nota:** Questo progetto richiede [Docker Desktop](https://www.docker.com/products/docker-desktop/) installato e attivo.

---

## 🚀 Guida all'Installazione (Scegli il tuo profilo)

### 🟢 Utente Standard (Voglio solo usare l'app)

Se vuoi iniziare subito senza preoccuparti di comandi e configurazioni.

1. **Prerequisito Unico**: Installa **Docker Desktop** sul tuo Mac.
    * Scaricalo dal sito ufficiale.
    * Aprilo e aspetta che si avvii (l'icona della balena in alto deve smettere di muoversi).
2. **Avvio**:
    * Fai doppio click sul file `Start_MediFlow.command`.
    * Aspetta qualche minuto (solo la prima volta deve scaricare un po' di cose).
    * Si aprirà da solo il browser.
3. **Finito!** Ora puoi creare il tuo profilo e inserire i dati.

### 🤓 Smanettoni (Voglio capire cosa succede)

Per chi vuole il controllo totale o vuole contribuire.

**Tech Stack:**

* **App:** Next.js 15 (React 19), TailwindCSS, Dexie.js (IndexedDB).
* **AI:** Ollama (default container, ma supporta host nativo).
* **Database:** WHO ICD-API (container locale).

**Workflow di Avvio:**
Lo script di avvio esegue un `docker-compose up -d` che orchestra tre container:

1. `app`: L'interfaccia web (porta 3000).
2. `icd-api`: Il server per le codifiche diagnosi (porta 8888).
3. `ollama`: Il server LLM (porta 11434).

**Comandi Manuali:**

```bash
# Avvio (da root del progetto)
docker-compose up -d

# Log streaming
docker-compose logs -f app

# Spegnimento
docker-compose down
```

**Configurazione Avanzata (AI):**
Se possiedi un Mac Apple Silicon (M1/M2/M3), il container Ollama potrebbe essere più lento della versione nativa (niente accesso diretto alla GPU Metal).
Per massimizzare le performance:

1. Commenta il servizio `ollama` nel `docker-compose.yml`.
2. Installa [Ollama per Mac](https://ollama.com).
3. Esegui `ollama run medgemma` (o il modello che preferisci).
4. MediFlow si collegherà automaticamente a `localhost:11434`.

---

## 🔒 Sicurezza e Privacy

* **Local First:** I dati risiedono *esclusivamente* nel browser (IndexedDB).
* **Cifratura:** Utilizziamo cifratura AES-GCM lato client. I dati sensibili (note, diario) vengono cifrati con una chiave derivata dal tuo PIN prima di essere salvati su disco.
* **AI Privacy:** L'AI gira in locale. Nessun dato paziente viene inviato a cloud esterni (OpenAI, Google, ecc.).

## ⚖️ Compliance & GDPR (Work in Progress)

Questa applicazione è progettata seguendo i principi di **Privacy by Design** e **Data Minimization**, implementando best practice tecniche all'avanguardia per la protezione dei dati (Crittografia AES-256, Local-First, Zero-Knowledge Storage).

Tuttavia, la piena conformità al **GDPR** (Regolamento Ue 2016/679) è un processo complesso che va oltre la sola tecnologia e coinvolge aspetti legali e organizzativi.
Attualmente, l'adesione agli standard GDPR è da considerarsi un **obiettivo in corso d'opera (Best Effort)**.

* L'utilizzo professionale in ambito sanitario richiede una validazione giuridica specifica da parte del Titolare del Trattamento (il Medico/Struttura).
* Il progetto punta a fornire tutti gli strumenti tecnici necessari (Audit Log, Export, Cancellazione Sicura) per facilitare questa compliance, ma non sostituisce la consulenza legale specializzata.

## Risoluzione Problemi Comuni

* **"Errore connessione ICD"**: Assicurati che Docker sia acceso. Se è la prima volta, il download dell'immagine da 300MB potrebbe richiedere tempo.
* **"Schermata Bianca"**: Prova a ricaricare la pagina con `Cmd + R`.
* **"Pin Smarrito"**: Purtroppo non è recuperabile. I dati cifrati andranno persi (feature di sicurezza by design).
