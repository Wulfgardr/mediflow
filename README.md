# 🏥 MediFlow v0.3.0

> **Una cartella clinica fatta da un medico, per i medici.**  
> Funziona offline, rispetta la privacy, usa l'AI in locale.  
> Niente cloud, niente abbonamenti, niente sorprese.

---

## 👋 Ciao

Mi chiamo **Leo**, sono un medico di distretto (Community Care) italiano.
Ho costruito MediFlow perché ero stanco. Stanco di software lenti, stanco di dover avere internet per guardare una pressione, stanco di non sapere dove finiscono i dati dei miei pazienti.

Volevo qualcosa di **veloce, bello e blindato**.
Così l'ho programmato.

---

## 🌟 Perché MediFlow?

1. **I dati sono tuoi**: tutto vive in locale (Mac = home base), in un file SQLite cifrato. Se stacchi internet, funziona uguale.
2. **Privacy totale**: cifratura *zero-knowledge* (AES-256-GCM). Senza il PIN, nessuno legge i dati (nemmeno io).
3. **AI, ma privata**: modelli locali (Ollama) per OCR e sintesi cliniche. Nessun dato paziente viene inviato a servizi esterni per default.
4. **Semplice**: interfaccia pulita e clinica (zero fronzoli). Pensata per lavorare.

---

## 📚 Documentazione

### 🩺 Per il medico

Vuoi solo installarlo e usarlo?
- Manuale operativo: `docs/MANUALE.md`

### 🧑‍💻 Per sviluppatori / contributori

Inizia da qui (ordine consigliato):

1. **Come contribuire e come avviare il progetto**
   - `CONTRIBUTING.md`

2. **Visione e confini dell'architettura**
   - `ARCHITECTURE.md`

3. **Walkthrough end-to-end (web + native + servizi locali)**
   - `docs/walkthrough.md`

4. **Approfondimenti tecnici**
   - `docs/ARCHITETTURA.md`
   - `docs/system_architecture.md`

5. **Decisioni architetturali (ADR)**
   - `docs/adr/`

6. **Piano di lavoro in corso (engineering plan, non product roadmap)**
   - `PLANS.md`

7. **Sicurezza (policy, redaction, scanning, disclosure)**
   - `SECURITY.md`

### ⚖️ Compliance & privacy

GDPR, sicurezza dei dati e interoperabilità (FHIR R4):
- `docs/COMPLIANCE.md`

### 🍏 Client nativo macOS

- `docs/NATIVE.md`
- `docs/native-setup.md`
- `docs/native-launch.md`
- `docs/local-api-tls.md`

### 🗺 Roadmap prodotto

- `docs/ROADMAP.md`

---

## 🚀 Installazione rapida (macOS, local-first)

### Prerequisiti (minimi)

- Node.js (consigliato: **v20+**)
- Docker Desktop (**opzionale**, solo per ICD-11)
- Ollama (**opzionale**, solo per AI/OCR)

### Avvio "tutto-in-uno"

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow

npm install
./Start_MediFlow.command
```

Apri: `http://localhost:3000`

> Nota: lo script prova ad avviare (se presenti) Ollama e ICD-11 via Docker.  
> Se non li hai, MediFlow funziona comunque (con feature ridotte).

### Verifiche rapide (per dev)

```bash
npm run lint
npm run build
```

---

## ⚖️ Note legali & GDPR

MediFlow è un progetto open source rilasciato con licenza MIT.

È progettato per essere **Privacy by Design**, ma l'uso in ambiente clinico reale richiede che tu faccia le tue valutazioni di conformità (DPIA, registro trattamenti, misure organizzative, ecc.) come Titolare del Trattamento.

**I dati, per impostazione predefinita, non lasciano mai il tuo dispositivo.**  
La garanzia tecnica è qui. La garanzia legale la costruisci tu usandolo con responsabilità.

---

Fatto in Italia. ☕
