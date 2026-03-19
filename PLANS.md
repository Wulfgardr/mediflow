# PLANS — MediFlow (Piano Engineering Attivo)

Questo è il **piano operativo engineering** (orizzonte settimane), non la roadmap prodotto.
Per direzione prodotto e release narrative, usa [docs/ROADMAP.md](./docs/ROADMAP.md).

> Aggiorna questo file ogni volta che cambia una priorità o la sequenza di esecuzione.

Ultimo aggiornamento: 2026-03-19

---

## Focus corrente (prossime 2-6 settimane)

### Release gate v0.4 (web/core only)
- [x] Chiudere i bug web/core che bloccano davvero `0.4`: `WUL-56` (ICD header), `WUL-58` (OCR smart su immagini/input non-PDF supportabili), `WUL-60` (placeholder anagrafici in import impegnativa).
- [x] Riallineare Linear sugli issue non bloccanti `0.4`, mantenendoli in `Backlog` senza mischiarli con il push release.
- [x] Chiudere la queue attiva non-macOS in Linear (`Todo`, `In Progress`, `In Review` a zero) lasciando solo backlog intenzionale, tracker e filone native congelato.
- [x] Eseguire la sequenza di stabilizzazione web/core pre-version-bump fissata in [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./docs/adr/0024-web-core-stabilization-before-next-version-bump.md).
- [ ] Completare push/tag/patch notes `0.4.0` sullo stato reale di `main`.

Nota operativa:
- il filone parity/macOS resta congelato fino al rebuild controllato della shell nativa
- i punti `P0b` e `P2`-`P6` sotto non bloccano il push `0.4`
- le issue native/miste restano tracciate in Linear ma fuori dal release gate corrente
- il residuo non-macOS ancora aperto in Linear e classificato come backlog `post-0.4`, future track o integrazione esterna, quindi non rientra nel gate `0.4`
- i tracker macro (`WUL-35`, `WUL-37`, `WUL-39`, `WUL-41`, `WUL-42`, `WUL-74`, `WUL-75`) restano aperti come contenitori, non come delivery queue attiva

### 0b) Terminologie cliniche e compliance FSE 2.0 (ADR 0006)
- [x] Portare `ATC` a first-class nei flussi terapia (`AIC + ATC` coerenti su web/native API).
- [x] Introdurre contratto minimo `terminology` su `/api/v1` (systems/search/resolve).
- [x] Introdurre validazione documentale pilota FSE (`error` + `warning`) prima dell'export.
- [x] Avviare thin slice osservazioni con `LOINC + UCUM` su un percorso clinico verticale.
- [x] Introdurre smart import reviewable nel profilo paziente da note/diario/documenti per diagnosi ICD-11 e terapie, mantenendo l'autofill automatico limitato ai soli ICD espliciti (ADR 0012).

### 0) Guardrail e operabilità minima (T00 + T05)
- [x] Formalizzare i controlli "never regress" (no default creds, no egress di default, no regressioni zero-knowledge).
- [x] Definire artifact backup v1 con manifest e metadati di integrità.
- [x] Definire preflight restore (compatibilità schema/versione, integrità, ownership) prima della fase scripting completa.

### 1) Integrità dati e concorrenza esplicita (T04)
- [x] Introdurre semantica di optimistic concurrency (`version`) su entità cliniche prioritarie.
- [x] Applicare compare-on-write a livello API e standardizzare risposta conflitto (`409` + metadata snapshot).
- [x] Coprire con test di scenari write concorrenti web/native.

### 2) Stabilizzazione contratto locale `/api/v1` (T02)
- [x] Definire strategia OpenAPI (`spec-first` vs `source annotations`) per la superficie `v1`. (`docs/adr/0010-openapi-spec-first-for-api-v1.md`)
- [x] Pubblicare baseline OpenAPI per endpoint `v1` stabili. (thin slice iniziale: `docs/openapi/mediflow-v1.yaml`)
- [x] Aggiungere contract checks per prevenire drift non documentato.

### 3) Audit minimo ad alto valore (T03)
- [x] Definire tassonomia eventi audit (auth + CRUD sensibili + settings admin). (`docs/adr/0015-audit-taxonomy-minimum-catalog.md`)
- [x] Implementare write path append-only con campi PHI-safe.
- [x] Assicurare attribuzione attore coerente per chiamate web/native.

### 4) Hardening auth prima di RBAC completo (T01)
- [x] Definire policy lockout/failed attempts e uniformare regole session/token tra web e native. (`docs/adr/0017-auth-lockout-policy.md`)
- [ ] Eseguire RBAC granulare in fase successiva, dopo i controlli base sopra.

### 5) Parità funzionale web/native (mandato)
- [ ] Definire e mantenere una matrice capability-by-capability (view/add/edit/delete/filter) per pazienti, diario clinico, terapie, appuntamenti, farmaci, esenzioni.
- [ ] Rendere `/api/v1/*` il contratto locale canonico per le funzioni condivise tra client.
- [ ] Chiudere i gap CRUD nativa rispetto al web, senza introdurre storage duplicato o percorsi separati per i dati.
- [ ] Applicare il modello ADR 0008: delivery web-first + parity sweep periodici su macOS, con backlog gap sempre esplicito.
- [ ] Garantire per i moduli core il target parity: stessa funzione, stessi campi, stessa flessibilita, stessa autonomia operativa tra web e macOS.

#### 5a) Sequenza esecutiva parity (step-by-step)
- [x] `P0` Baseline parity matrix versionata (web vs macOS) sui 6 moduli core, distinguendo chiaramente `contratto API` vs `UI disponibile`. (`docs/parity-matrix.md`)
- [ ] `P0b` Stabilizzare harness smoke parity (web Playwright + native XCTest/Xcode + click-map macOS) su ambiente isolato/VM.
- [x] `P0b.a` Introdurre runner unificato parity smoke + report artifacts (`scripts/parity-smoke.sh`, `docs/parity-smoke.md`).
- [x] `P0b.b` Definire checklist click-map macOS per run manuali ripetibili (`docs/parity-click-map-macos.md`).
- [ ] `P0b.c` Eseguire run VM "strict" (web+native required) con Playwright disponibile e checklist compilata.
- [x] `P1` Pazienti native: completare `edit/delete/archive/search/sort` e filtri stato (`attivi/archiviati`) in UI macOS.
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
- [x] Eseguire la sequenza di stabilizzazione web/core pre-version-bump fissata in [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./docs/adr/0024-web-core-stabilization-before-next-version-bump.md): helper condiviso route paziente, helper shared fields paziente, gate `typecheck`, split incrementale `SecurityProvider`/`SettingsPage`.

### 7) DX / Igiene repository
- [x] Aggiungere script `typecheck` (es. `tsc --noEmit`) e documentare il loop di verifica.
- [ ] Garantire onboarding docs autorevoli e aggiornati (README + CONTRIBUTING + ARCHITECTURE).

---

## Next (dopo il focus corrente)

- [x] Continuare il filone backup dopo la thin slice `WUL-30` con `WUL-31`: retention automatica limitata ai backup scheduler-owned (`keep-last-N` + dry-run/apply) nella cartella utente selezionata.
- [ ] Eseguire il pass finale di release hygiene `0.4.0`: changelog definitivo, patch notes, tag e push coerenti con `main`.
- [ ] Miglioramenti export dati (FHIR + human-readable) e validazione.
- [ ] CI: lint + build + controlli minimi su PR.

---

## Parking lot (idee, non impegnate)

- [ ] Prototipo sync local-only (computer home base <-> client iOS/iPad): discovery + pairing + cache + riconciliazione.
- [ ] Moduli clinici aggiuntivi (scale, report, interazioni) dopo stabilizzazione della base.

---

## Riferimenti

- Regole source-of-truth: [AGENTS.md](./AGENTS.md)
- Mappa documentale canonica: [docs/README.md](./docs/README.md)
- Inventario markdown completo: [docs/markdown-index.md](./docs/markdown-index.md)
- Visione architetturale: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Contributi / verify loop: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Policy sicurezza: [SECURITY.md](./SECURITY.md)
- ADR: [docs/adr/](./docs/adr/README.md)
- Walkthrough tecnico: [docs/walkthrough.md](./docs/walkthrough.md)
