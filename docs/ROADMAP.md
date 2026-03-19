# Roadmap MediFlow

> **Dove siamo e dove vogliamo andare.**
> v0.4.0 (Corrente) — Marzo 2026
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

## Fatto (v0.4.0)

Base tecnica più solida, con flussi documentali e contratti locali molto più espliciti.

* **API locale più governata**: baseline OpenAPI `/api/v1`, guard anti-drift e concorrenza ottimistica sui pazienti.
* **Import clinico più utile**: pipeline OCR-first strutturata e smart import reviewable verso diagnosi ICD-11 e terapie.
* **Archivio intelligente più operabile**: pulizia per singolo documento o completa, persistenza farmaci estratti e riallineamento dell'insight AI.
* **Sicurezza e continuita operative**: audit append-only, lockout auth, cambio PIN zero-knowledge, backup artifact/preflight, scheduler notturno e retention automatica.
* **Compliance locale piu esplicita**: terminology registry locale, baseline GTW/FSE, baseline SISS e pannello prescrizione con handoff controllato.
* **Stabilizzazione web/core**: `typecheck` canonico, normalizzazione condivisa dei payload paziente e riduzione del carico nei file piu densi.

> Nota: il filone `macOS/parity` non prosegue come delivery incrementale oltre `v0.4.0`.
> Entra in **riscrittura controllata** della shell nativa, preservando `/api/v1`, TLS locale, cifratura e regole security/local-first.

---

## In corso (v0.5.0)

Priorita per consolidare UX web, finishing release e preparare il nuovo ciclo native.

### Web e UX

* [ ] **Leggibilita e accessibilita**: refresh mirato di tipografia, spaziatura, contrasto e percorsi clinici piu usati.
* [ ] **Miglioramenti export**: export FHIR/human-readable e validazione documentale piu completi.
* [ ] **CI minima**: lint, build e controlli essenziali stabili su PR.

### Native reboot

* [ ] **Demolizione controllata macOS**: ricostruire la shell nativa "from the ground up" senza perdere il contratto `/api/v1`, il trasporto TLS locale e la semantica security/sessione.
* [ ] **Parita futura per sweep**: riaprire il filone parity solo dopo il nuovo shell, non sul client storico.

---

## Futuro (v0.5.0+)

### Interazione vocale

* **Dettatura**: Usare Whisper (locale) per dettare la visita invece di scrivere.
* **Chat**: Chiedere al sistema: *"Fammi un grafico della glicemia di Mario dell'ultimo anno"*.

### Esperienza nativa

* **App Mac Completa**: Nuova app 100% nativa (SwiftUI) costruita sul contratto locale gia stabilizzato.
* **App iPad/iPhone**: Consultazione rapida in mobilità (sulla stessa rete WiFi).

---

## Visione (v1.0.0)

Un ecosistema clinico open source, locale e affidabile, che un medico possa installare e usare senza complicazioni infrastrutturali.

Hai idee o critiche? Apri una issue su GitHub.
