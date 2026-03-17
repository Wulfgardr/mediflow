# Roadmap MediFlow

> **Dove siamo e dove vogliamo andare.**
> v0.3.1 (Corrente) — Febbraio 2026
> Fonte roadmap prodotto canonica (vedi anche [docs/README.md](./README.md) per mappa completa documenti).

---

## Fatto (v0.3.0)

Le fondamenta sono solide e usabili in produzione locale.

* **Database solido**: migrazione completa a SQLite cifrato.
* **Privacy Totale**: Cifratura Zero-Knowledge attiva. Nemmeno io leggo i tuoi dati.
* **AI Locale**: Integrazione di Qwen text-only (sintesi/insight) e DeepSeek OCR via Ollama.
* **ICD-11**: Diagnosi standardizzate OMS.
* **Multi-ambulatorio**: gestione sedi con identificazione visiva rapida.

---

## In corso (v0.4.0)

Priorità per consolidare sicurezza, continuità operativa e UX.

### Sicurezza & Compliance

* [ ] **Log degli Accessi**: Chi ha visto cosa? (Essenziale per GDPR).
* [ ] **Cambio PIN**: Al momento il PIN è eterno. Dobbiamo poterlo cambiare.
* [ ] **Pulizia Automatica**: Policy di retention (es. cancella dati > 10 anni).

### Usabilità

* [ ] **Backup Automatico**: "Set and forget". Il backup si fa da solo ogni notte.
* [ ] **Notifiche aggiornamenti**: segnalazione nuova release disponibile.

---

## Futuro (v0.5.0+)

### Interazione vocale

* **Dettatura**: Usare Whisper (locale) per dettare la visita invece di scrivere.
* **Chat**: Chiedere al sistema: *"Fammi un grafico della glicemia di Mario dell'ultimo anno"*.

### Esperienza nativa

* **App Mac Completa**: Abbandonare il browser per un'app 100% nativa (SwiftUI).
* **App iPad/iPhone**: Consultazione rapida in mobilità (sulla stessa rete WiFi).

---

## Visione (v1.0.0)

Un ecosistema clinico open source, locale e affidabile, che un medico possa installare e usare senza complicazioni infrastrutturali.

Hai idee o critiche? Apri una issue su GitHub.
