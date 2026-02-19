> [!WARNING]
> Documento storico mantenuto per compatibilità.
> La roadmap prodotto canonica e aggiornata è: `docs/ROADMAP.md`.
> Aggiorna solo `docs/ROADMAP.md`.

# Roadmap MediFlow (storica)

> Snapshot storico pre-riordino roadmap.

Questa versione è mantenuta solo come riferimento storico.
Per la versione attiva consulta `docs/ROADMAP.md`.

---

## Fatto (v0.3.0)

Quello che c'è e funziona oggi:

- **Database serio**: Addio IndexedDB, ora uso SQLite. I dati stanno in un file `.db` che posso backuppare.
- **AI locale vera**: MedGemma gira su Ollama, niente cloud. I dati paziente non escono mai dal Mac.
- **OCR con DeepSeek**: Carico un PDF o una foto di un referto → viene letto e estratto il testo.
- **Archivio Intelligente**: Ogni documento caricato viene riassunto dall'AI. Vedo gli ultimi 3 nella scheda paziente.
- **ICD-11**: Le diagnosi usano lo standard WHO ufficiale, non più il vecchio ICD-9.
- **Cifratura**: Tutto cifrato con AES-256. Senza PIN non si legge nulla, nemmeno io.
- **Multi-ambulatorio**: Posso gestire più sedi/reparti con colori diversi.

---

## Prossimo (v0.4.0)

Cose che mi servono per usarlo davvero ogni giorno:

### Sicurezza

- **Log degli accessi**: Chi ha visto cosa e quando. Serve per GDPR.
- **Cambio PIN**: Ora se perdi il PIN perdi tutto. Devo poterlo cambiare.
- **Pulizia automatica**: Cancellare dati vecchi dopo X anni (configurabile).

### Usabilità

- **Backup automatico**: Ogni notte esporta il DB su una cartella.
- **Avviso aggiornamenti**: Notifica quando esce una nuova versione su GitHub.
- **Sidebar più pulita**: È diventata troppo piena, va riorganizzata.

---

## 🔭 Dopo (v0.5.0)

Idee più ambiziose:

- **Chatta con la cartella**: Chiedere all'AI "come sta andando la glicemia di Mario?" e farle analizzare lo storico.
- **Interazioni farmaci**: L'AI controlla se la nuova ricetta confligge con la terapia cronica.
- **Dettatura**: Parlare invece di scrivere le note (Whisper locale).

---

## 🚀 Un giorno (v1.0.0)

Il sogno:

- **App desktop vera**: Non più browser, ma finestra dedicata (Tauri o Electron).
- **App iOS**: Consultare i pazienti dal telefono.
- **Sync locale**: Mac e iPhone si sincronizzano via Wi-Fi, senza passare da cloud.

---

Aggiornato: Febbraio 2026 (documento storico)
