# Roadmap MediFlow

> **Dove siamo e dove vogliamo andare.**
> v0.4.0 (release corrente) — Marzo 2026
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

`v0.5.0` non e pensata come semplice patch o raccolta feature.
E la release in cui MediFlow deve rendere credibili e coerenti due cose insieme:

* **interfaccia clinica web** piu leggibile, piu gerarchica e piu orientata all'azione
* **stack AI locale** piu disciplinato, benchmarkabile e governato nel rollout

### Consolidamento AI/UI

* [ ] **First fold clinico e superfici chiave**: scheda paziente, shell/sidebar, lista pazienti e form devono convergere verso un linguaggio `liquid glass` disciplinato e operativo.
* [ ] **Affidabilita AI locale**: completare benchmark resolver WHO/AIFA, normalizzazione input documentali e regole di rollout/fallback/stop-rules prima di raccontare lo stack come consolidato.
* [ ] **Release hygiene minima**: `lint`, `build` e benchmark CLI rilevanti devono tornare a essere segnali affidabili del prodotto, non del rumore del workspace.
* [ ] **Miglioramenti export**: export FHIR/human-readable e validazione documentale piu completi.
* [ ] **CI minima**: lint, build e controlli essenziali stabili su PR.

### Esplicitamente fuori da v0.5.0

* [ ] **No retro-rewrite di v0.4.0**: la `0.4.0` resta la baseline storica gia rilasciata.
* [ ] **No promozione prematura delle lane benchmark-only**: redaction/NER/challenger generativi restano fuori dal claim principale finche non superano benchmark e governance.

---

## Dopo v0.5.0

### Modalita network home-base

* **Nodo centrale locale**: pairing esplicito, capability discovery e lavoro su piu macchine senza rompere il local-first.
* **Replica e fallback offline**: continuita operativa tra dispositivi con riconciliazione esplicita.
* **Runtime AI centralizzabile**: opzione locale di studio per client meno potenti, senza egress cloud.

### Esperienza nativa

* **Nuova shell macOS**: rebuild controllato dell'app nativa, preservando `/api/v1`, TLS locale e semantica security/sessione.
* **Parita futura per sweep**: riaprire il filone parity solo dopo il nuovo shell, non sul client storico.
* **App iPad/iPhone**: consultazione rapida in mobilita coerente con il modello home-base.

### Interazione vocale

* **Dettatura**: Usare Whisper (locale) per dettare la visita invece di scrivere.
* **Chat**: Chiedere al sistema: *"Fammi un grafico della glicemia di Mario dell'ultimo anno"*.

---

## Visione (v1.0.0)

Un ecosistema clinico open source, locale e affidabile, che un medico possa installare e usare senza complicazioni infrastrutturali.

Hai idee o critiche? Apri una issue su GitHub.
