# MediFlow v0.3.1

> Cartella clinica local-first, progettata da un medico per il lavoro clinico reale.
> Offline, privata, veloce.

---

## Perché esiste

Sono **Leo**, medico di distretto.
MediFlow nasce da un problema semplice: i software clinici spesso sono lenti, opachi e troppo dipendenti da internet.

Qui l'obiettivo è l'opposto: lavorare bene, in locale, con controllo pieno dei dati.

---

## Cosa garantisce

1. **Dati sotto controllo**: tutto resta sul tuo Mac (SQLite cifrato), anche senza connessione.
2. **Privacy reale**: cifratura *zero-knowledge* (AES-256-GCM). Senza PIN i dati non sono leggibili.
3. **AI locale**: OCR e sintesi cliniche via modelli locali (Ollama), senza egress verso servizi esterni di default.
4. **Focus operativo**: interfaccia clinica pulita, pensata per fare in fretta e con meno attrito.

---

## 📚 Documentazione

### 🩺 Per il medico

Vuoi solo installarlo e usarlo?
- Manuale operativo: `docs/MANUALE.md`

### 🧑‍💻 Per sviluppatori / contributori

Inizia da qui (ordine consigliato):

1. **Indice canonico della documentazione (cosa è fonte di verità)**
   - `docs/README.md`

2. **Visione e confini dell'architettura**
   - `ARCHITECTURE.md`

3. **Sicurezza (policy, redaction, scanning, disclosure)**
   - `SECURITY.md`

4. **Come contribuire e come avviare il progetto**
   - `CONTRIBUTING.md`

5. **Decisioni architetturali (ADR)**
   - `docs/adr/`

6. **Piano di lavoro in corso (engineering plan, non product roadmap)**
   - `PLANS.md`

7. **Walkthrough end-to-end (web + native + servizi locali)**
   - `docs/walkthrough.md`

8. **Approfondimenti tecnici**
   - `docs/ARCHITETTURA.md`
   - `docs/system_architecture.md`
   - `docs/FSE2-terminology-roadmap.md`

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

## Installazione rapida (macOS)

### Prerequisiti (minimi)

- Node.js (consigliato: **v20+**)
- Docker Desktop (**opzionale**, solo per ICD-11)
- Ollama (**opzionale**, solo per AI/OCR)

### Avvio tutto-in-uno

```bash
git clone https://github.com/Wulfgardr/mediflow
cd mediflow

npm install
./Start_MediFlow.command
```

Apri: `http://localhost:3000`

> Lo script avvia anche Ollama e ICD-11 (se disponibili).  
> Se non sono installati, MediFlow resta utilizzabile con funzionalità ridotte.

### Verifiche rapide (per dev)

```bash
npm run lint
npm run build
```

---

## Note legali e GDPR

MediFlow è un progetto open source rilasciato con licenza MIT.

È progettato per essere **Privacy by Design**, ma l'uso in ambiente clinico reale richiede che tu faccia le tue valutazioni di conformità (DPIA, registro trattamenti, misure organizzative, ecc.) come Titolare del Trattamento.

**Per impostazione predefinita, i dati non lasciano il dispositivo.**  
La garanzia tecnica è nel progetto; la conformità operativa dipende anche dal contesto in cui viene usato.

---

Progettato in Italia.
