# MediFlow v0.5.0

> Cartella clinica local-first, progettata da un medico per il lavoro di tutti i giorni.
> Offline, privata, veloce.

---

## Perché esiste

Sono **Leo**, medico di distretto.
MediFlow nasce da un problema semplice: i software clinici spesso sono lenti, opachi e troppo dipendenti da internet.

Qui l'obiettivo è l'opposto: lavorare bene, in locale, con controllo pieno dei dati.

---

## Cosa garantisce

1. **Dati sotto controllo**: tutto resta sul tuo computer (SQLite cifrato), anche senza connessione.
2. **Privacy reale**: cifratura *zero-knowledge* (AES-256-GCM). Senza PIN i dati non sono leggibili.
3. **AI locale**: OCR e sintesi cliniche via modelli locali (Ollama), senza egress verso servizi esterni di default.
4. **Focus operativo**: interfaccia clinica pulita, pensata per fare in fretta e con meno attrito.

---

## 📚 Documentazione

### 🩺 Per il medico

Vuoi solo installarlo e usarlo?
- Manuale operativo: [docs/MANUALE.md](./docs/MANUALE.md)

### 🧑‍💻 Per sviluppatori / contributori

Inizia da qui (ordine consigliato):

1. **Indice canonico della documentazione (cosa è fonte di verità)**
   - [docs/README.md](./docs/README.md)
   - [docs/markdown-index.md](./docs/markdown-index.md) (inventario completo markdown + sintesi)

2. **Visione e confini dell'architettura**
   - [ARCHITECTURE.md](./ARCHITECTURE.md)

3. **Sicurezza (policy, redaction, scanning, disclosure)**
   - [SECURITY.md](./SECURITY.md)

4. **Come contribuire e come avviare il progetto**
   - [CONTRIBUTING.md](./CONTRIBUTING.md)

5. **Decisioni architetturali (ADR)**
   - [docs/adr/](./docs/adr/README.md)

6. **Piano di lavoro in corso (engineering plan, non product roadmap)**
   - [PLANS.md](./PLANS.md)

7. **Walkthrough end-to-end (web + native + servizi locali)**
   - [docs/walkthrough.md](./docs/walkthrough.md)

8. **Approfondimenti tecnici**
   - [docs/topologia-dati-flussi.md](./docs/topologia-dati-flussi.md)
   - [docs/ARCHITETTURA.md](./docs/ARCHITETTURA.md)
   - [docs/system_architecture.md](./docs/system_architecture.md)
   - [docs/FSE2-terminology-roadmap.md](./docs/FSE2-terminology-roadmap.md)

### ⚖️ Compliance & privacy

GDPR, sicurezza dei dati e interoperabilità (FHIR R4):
- [docs/COMPLIANCE.md](./docs/COMPLIANCE.md)

### 🍏 Client nativo macOS

> [!IMPORTANT]
> Nel ciclo `v0.5.0` il filone macOS/parity resta sospeso: la shell nativa continua la **riscrittura controllata** ("demolizione controllata").
> Il contratto locale `/api/v1`, il trasporto TLS e i vincoli di sicurezza restano validi; la delivery di nuove feature native sul vecchio shell e congelata fino al rebuild.

- [docs/NATIVE.md](./docs/NATIVE.md)
- [docs/native-testing.md](./docs/native-testing.md)
- [docs/parity-smoke.md](./docs/parity-smoke.md)
- [docs/parity-click-map-macos.md](./docs/parity-click-map-macos.md)
- [docs/native-setup.md](./docs/native-setup.md)
- [docs/native-launch.md](./docs/native-launch.md)
- [docs/local-api-tls.md](./docs/local-api-tls.md)

### 🗺 Roadmap prodotto

- [docs/ROADMAP.md](./docs/ROADMAP.md)

---

## Installazione rapida (computer)

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
