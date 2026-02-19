# PLANS — MediFlow (Piano Engineering Attivo)

Questo è il **piano operativo engineering** (orizzonte settimane), non la roadmap prodotto.
Per direzione prodotto e release narrative, usa `docs/ROADMAP.md`.

> Aggiorna questo file ogni volta che cambia una priorità o la sequenza di esecuzione.

Ultimo aggiornamento: 2026-02-19

---

## Focus corrente (prossime 2-6 settimane)

### 0b) Terminologie cliniche e compliance FSE 2.0 (ADR 0006)
- [x] Portare `ATC` a first-class nei flussi terapia (`AIC + ATC` coerenti su web/native API).
- [x] Introdurre contratto minimo `terminology` su `/api/v1` (systems/search/resolve).
- [x] Introdurre validazione documentale pilota FSE (`error` + `warning`) prima dell'export.
- [x] Avviare thin slice osservazioni con `LOINC + UCUM` su un percorso clinico verticale.

### 0) Guardrail e operabilità minima (T00 + T05)
- [ ] Formalizzare i controlli "never regress" (no default creds, no egress di default, no regressioni zero-knowledge).
- [ ] Definire artifact backup v1 con manifest e metadati di integrità.
- [ ] Definire preflight restore (compatibilità schema/versione, integrità, ownership) prima della fase scripting completa.

### 1) Integrità dati e concorrenza esplicita (T04)
- [ ] Introdurre semantica di optimistic concurrency (`version`) su entità cliniche prioritarie.
- [ ] Applicare compare-on-write a livello API e standardizzare risposta conflitto (`409` + metadata snapshot).
- [ ] Coprire con test di scenari write concorrenti web/native.

### 2) Stabilizzazione contratto locale `/api/v1` (T02)
- [ ] Definire strategia OpenAPI (`spec-first` vs `source annotations`) per la superficie `v1`.
- [ ] Pubblicare baseline OpenAPI per endpoint `v1` stabili.
- [ ] Aggiungere contract checks per prevenire drift non documentato.

### 3) Audit minimo ad alto valore (T03)
- [ ] Definire tassonomia eventi audit (auth + CRUD sensibili + settings admin).
- [ ] Implementare write path append-only con campi PHI-safe.
- [ ] Assicurare attribuzione attore coerente per chiamate web/native.

### 4) Hardening auth prima di RBAC completo (T01)
- [ ] Definire policy lockout/failed attempts e uniformare regole session/token tra web e native.
- [ ] Eseguire RBAC granulare in fase successiva, dopo i controlli base sopra.

### 5) Parità funzionale web/native (mandato)
- [ ] Definire e mantenere una matrice capability-by-capability (view/add/edit/delete/filter) per pazienti, diario clinico, terapie, appuntamenti, farmaci, esenzioni.
- [ ] Rendere `/api/v1/*` il contratto locale canonico per le funzioni condivise tra client.
- [ ] Chiudere i gap CRUD nativa rispetto al web, senza introdurre storage duplicato o percorsi separati per i dati.
- [ ] Applicare il parity gate ADR 0007: stessa funzione, stessi campi, stessa flessibilita, stessa autonomia operativa tra web e macOS.

#### 5a) Sequenza esecutiva parity (step-by-step)
- [x] `P0` Baseline parity matrix versionata (web vs macOS) sui 6 moduli core, distinguendo chiaramente `contratto API` vs `UI disponibile`. (`docs/parity-matrix.md`)
- [ ] `P1` Pazienti native: completare `edit/delete/archive/search/sort` e filtri stato (`attivi/archiviati`) in UI macOS.
- [ ] `P2` Esenzioni native: aggiungere selector/search su `/api/v1/exemptions` e salvataggio in create/update paziente.
- [ ] `P3` Osservazioni native: esporre in UI macOS il CRUD `LOINC + UCUM` già disponibile a contratto (`/api/v1/patients/:id/observations`).
- [ ] `P4` Diario clinico: allineare semantica delete web/native (soft delete + restore + reason) per evitare drift comportamentale.
- [ ] `P5` Cataloghi farmaci/esenzioni: definire la minima operabilità native in Settings (import/clear/stato) senza storage duplicato.
- [ ] `P6` Chiusura parity: smoke test manuale capability-by-capability su web/native + aggiornamento `docs/walkthrough.md`.

Ordine di consegna consigliato (incrementale):
1. `P0` + `P1`
2. `P2`
3. `P3`
4. `P4`
5. `P5`
6. `P6`

### 6) Hardening: coerenza API <-> UI
- [ ] Garantire che ogni chiamata `ApiTable.update/delete()` abbia una route backend corrispondente (es. `PUT/DELETE /api/<resource>/:id`).
- [ ] Allineare le interfacce TypeScript in `lib/db.ts` con lo schema SQLite in `lib/schema.ts` (evitare "campi fantasma").
- [ ] Rimuovere/sostituire patch schema runtime con migrazioni Drizzle esplicite (evoluzione DB tracciabile).

### 7) DX / Igiene repository
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
