# PLANS — MediFlow (Piano Engineering Attivo)

Questo è il **piano engineering operativo** (settimane), non la roadmap prodotto.
Per la roadmap prodotto, vedi: `docs/ROADMAP.md`.

> Aggiorna questo file ogni volta che cambiano priorità o sequenza.

Ultimo aggiornamento: 2026-02-06

---

## Focus corrente (prossime 2-6 settimane)

### 0) Parità funzionale web/native (mandato)
- [ ] Definire e mantenere una matrice capability-by-capability (view/add/edit/delete/filter) per pazienti, diario clinico, terapie, appuntamenti, farmaci, esenzioni.
- [ ] Rendere `/api/v1/*` il contratto locale canonico per le funzioni condivise tra client.
- [ ] Chiudere i gap CRUD nativa rispetto al web, senza introdurre storage duplicato o percorsi separati per i dati.

### 1) Hardening: coerenza API <-> UI
- [ ] Garantire che ogni chiamata `ApiTable.update/delete()` abbia una route backend corrispondente (es. `PUT/DELETE /api/<resource>/:id`).
- [ ] Allineare le interfacce TypeScript in `lib/db.ts` con lo schema SQLite in `lib/schema.ts` (evitare "campi fantasma").
- [ ] Rimuovere/sostituire patch schema runtime con migrazioni Drizzle esplicite (evoluzione DB tracciabile).

### 2) Guardrail sicurezza & privacy
- [ ] Aggiungere una policy minima di **access log** (cosa loggare e cosa no) + regole di redazione.
- [ ] Definire il processo cambio PIN (richiede ADR) e implementare un flow sicuro di "re-encrypt master key".

### 3) Stabilizzazione thin slice native macOS
- [ ] Mantenere `/api/v1/*` piccolo, versionato e documentato.
- [ ] Migliorare error handling e contract test per la native API.
- [ ] Estendere `/api/v1/*` ai cataloghi condivisi (farmaci/esenzioni) e adottarlo nel client native.

### 4) DX / Igiene repository
- [ ] Aggiungere script `typecheck` (es. `tsc --noEmit`) e documentare il loop di verifica.
- [ ] Garantire onboarding docs autorevoli e aggiornati (README + CONTRIBUTING + ARCHITECTURE).

---

## Next (dopo il focus corrente)

- [ ] Policy e implementazione backup (schedulazione + retention + cartella utente selezionata).
- [ ] Miglioramenti export dati (FHIR + human-readable) e validazione.
- [ ] CI: lint + build + controlli minimi su PR.

---

## Parking lot (idee, non impegnate)

- [ ] Prototipo sync local-only (Mac home base <-> client iOS/iPad): discovery + pairing + cache + riconciliazione.
- [ ] Moduli clinici aggiuntivi (scale, report, interazioni) dopo stabilizzazione della base.

---

## Riferimenti

- Regole source-of-truth: `AGENTS.md`
- Visione architetturale: `ARCHITECTURE.md`
- Contributi / verify loop: `CONTRIBUTING.md`
- Policy sicurezza: `SECURITY.md`
- ADR: `docs/adr/`
- Walkthrough tecnico: `docs/walkthrough.md`
