# PLANS — MediFlow (Piano Engineering Attivo)

Questo è il **piano operativo engineering** (orizzonte settimane), non la roadmap prodotto.
Per direzione prodotto e release narrative, usa [docs/ROADMAP.md](./docs/ROADMAP.md).

> Aggiorna questo file ogni volta che cambia una priorità o la sequenza di esecuzione.

Ultimo aggiornamento: 2026-04-02

---

## Focus corrente (prossime 2-6 settimane)

### Post-v0.5.0 (stabilizzazione sul campo + home-base discovery)
- [ ] Eseguire validazione sul campo delle superfici UI/AI rilasciate in `v0.5.0` e riversare bug/regressioni in Linear con priorita esplicite.
- [ ] Mantenere affidabile il verify loop per le patch `0.5.x`: `lint`, `typecheck`, `build` verdi e benchmark CLI generativi eseguibili su `main`.
- [ ] Preparare ADR + thin slice del nodo locale `home-base`: discovery, pairing esplicito e capability contract `/api/v1/network`.
- [ ] Definire la prima slice read-only multi-device (Mac host -> iPhone/iPad client) senza rompere il modello local-first.
- [ ] Tenere fuori dal runtime operativo le lane ancora `benchmark-only` o di ricerca: `WUL-96`, `WUL-113`, `WUL-114`, `WUL-115`, salvo promozione esplicita sostenuta da benchmark e stop-rules.

Nota operativa:
- `v0.5.0` e la release corrente formalizzata su `main` il `2026-03-29`
- `v0.4.0` resta la baseline storica taggata su `main` il `2026-03-19`
- `WUL-95` resta la thin slice gia acquisita che ha disciplinato il task contract AI; il ciclo successivo sposta il focus su uso reale, rollout governance e architettura home-base
- il label Linear `bucket/post-0.4` resta etichetta legacy da separare progressivamente tra backlog `post-v0.5` e residui storici

### Contesto storico chiuso: Release gate v0.5.0 (consolidamento AI/UI)
- [x] Chiudere il pacchetto UI web orientato alla leggibilita clinica e al first fold operativo: `WUL-94`, `WUL-98`, `WUL-106`, `WUL-107`, `WUL-108`.
- [x] Portare le lane AI core a una baseline release-ready di consolidamento, con focus su task contract condiviso, benchmark generativi eseguibili e governance esplicita del runtime locale.
- [x] Ripristinare il verify loop minimo della release: `lint` confinato ai file sorgente, `typecheck`/`build` verdi e harness CLI dei benchmark generativi di nuovo eseguibili su `main`.
- [x] Tenere fuori dal gate `v0.5.0` le lane ancora `benchmark-only` o di ricerca: `WUL-96`, `WUL-113`, `WUL-114`, `WUL-115`.
- [x] Chiudere la narrativa release in modo coerente e documentato: `v0.4.0` come baseline storica, `v0.5.0` come release di consolidamento AI/UI, `post-v0.5` per nodo centrale locale, replica tra macchine e reboot native.

Nota operativa:
- la validazione manuale desktop/mobile continua nel focus post-release e non va retro-proiettata come gate bloccante ormai chiuso
- `WUL-109`, `WUL-110` e `WUL-111` restano la coda esplicita di hardening AI sul campo, non il motivo per tenere `v0.5.0` in uno stato narrativo indefinito

### Contesto storico chiuso: Release gate v0.4 (web/core only)
- [x] Chiudere i bug web/core che bloccano davvero `0.4`: `WUL-56` (ICD header), `WUL-58` (OCR smart su immagini/input non-PDF supportabili), `WUL-60` (placeholder anagrafici in import impegnativa).
- [x] Riallineare Linear sugli issue non bloccanti `0.4`, mantenendoli in `Backlog` senza mischiarli con il push release.
- [x] Chiudere la queue attiva non-macOS in Linear (`Todo`, `In Progress`, `In Review` a zero) lasciando solo backlog intenzionale, tracker e filone native congelato.
- [x] Eseguire la sequenza di stabilizzazione web/core pre-version-bump fissata in [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./docs/adr/0024-web-core-stabilization-before-next-version-bump.md).
- [x] Completare push/tag/patch notes `0.4.0` sullo stato reale di `main`.

Nota operativa:
- il filone parity/macOS resta congelato fino al rebuild controllato della shell nativa
- i punti `P0b` e `P2`-`P6` sotto non bloccano il push `0.4`
- le issue native/miste restano tracciate in Linear ma fuori dal release gate corrente
- il residuo aperto in Linear e composto solo da backlog intenzionale `bucket/post-0.4`, macro/tracker e `bucket/frozen-native`, quindi non rientra nel gate `0.4`
- i tracker macro (`WUL-35`, `WUL-37`, `WUL-39`, `WUL-41`, `WUL-42`, `WUL-74`, `WUL-75`) restano aperti come contenitori, non come delivery queue attiva

### 0b) Terminologie cliniche e compliance FSE 2.0 (ADR 0006)
- [x] Portare `ATC` a first-class nei flussi terapia (`AIC + ATC` coerenti su web/native API).
- [x] Introdurre contratto minimo `terminology` su `/api/v1` (systems/search/resolve).
- [x] Introdurre validazione documentale pilota FSE (`error` + `warning`) prima dell'export.
- [x] Avviare thin slice osservazioni con `LOINC + UCUM` su un percorso clinico verticale.
- [x] Introdurre smart import reviewable nel profilo paziente da note/diario/documenti per diagnosi ICD-11 e terapie, mantenendo l'autofill automatico limitato ai soli ICD espliciti (ADR 0012).

### 0c) Affidabilita stack AI locale
- [ ] Eseguire `AI-01`: benchmark headless dei resolver reali WHO ICD-11 e AIFA, con corpora sintetici e metriche top-k/latency/ambiguity.
- [ ] Eseguire `AI-02`: hardening Smart Import sui casi di switch terapeutico, applicabilita suggerimenti e policy `manual|blocked|uncertain`.
- [ ] Eseguire `AI-03`: introdurre corpus e scoring dedicati per `AI Patient Insight` (recency, focus, citation discipline, anti-moralizing).
- [ ] Eseguire `AI-04`: preparare ADR e thin slice lane `PII/redaction` locale in shadow mode, coerente con la valutazione OpenMed. Stato `WUL-96`: benchmark stack chiuso, ma `OpenMed redaction` resta `benchmark-only / not shadow-ready` per leak critici sulle email/mailbox (`email recall = 0.333` sul corpus v3, `0.143` sul corpus email-focused).
- [ ] Eseguire `AI-05`: aggiungere input normalization tollerante per PDF e CDA/CCD prima delle lane semantiche.
- [ ] Eseguire `AI-06`: benchmarkare una lane NER clinica italiana deterministica (`HUMADEX`) solo se migliora auditabilita o coding. Stato `WUL-96`: corpus `clinical_entities.v2`, confronto reale, repeatability a 5 run e promotion gate completati; `HUMADEX` resta davanti a `OpenMed NER` (`0.6/0.7` precision/recall vs `0.5/0.6`), ma entrambi falliscono il gate (`promotionReady = false`) per leak sui case negativi e under-span su problemi composti, quindi la lane resta `benchmark-only`.
- [ ] Eseguire `AI-07`: valutare challenger generativi solo dopo baseline e resolver stabili, senza cambiare il default per intuizione.
- [ ] Eseguire `AI-08`: formalizzare rollout/shadow mode/stop-rules delle lane AI prima di qualunque attivazione operativa.

Nota operativa:
- la sequenza esecutiva dettagliata e in [docs/ai-stack-execution-plan.md](./docs/ai-stack-execution-plan.md)
- il contesto tecnico e i benchmark gia eseguiti restano documentati in [docs/ai-stack-reliability-review.md](./docs/ai-stack-reliability-review.md)
- `AI-03` e ora tracciato in `WUL-123` come harness locale dedicato per corpus, scoring e validator di `Patient Insight`
- `WUL-131` apre la governance del `document intelligence lab`: corpus
  canonico `synthetic-only` in repo + vault locale privato per shadow
  evaluation, come ponte tra `WUL-129` e `WUL-111`
- nuove lane o sidecar AI richiedono corpus sintetico, benchmark dedicato e, se cambiano l'architettura, ADR esplicita prima dell'implementazione

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
- [ ] Pianificare il ciclo `post-v0.5`: nodo centrale locale/home-base, contratto `/api/v1/network`, pairing esplicito, replica/fallback offline, runtime AI centralizzabile e rebuild controllato della shell macOS.
- [ ] Miglioramenti export dati (FHIR + human-readable) e validazione.
- [ ] CI: lint + build + controlli minimi su PR.

Nota operativa per il filone UI web `v0.5.0` (`WUL-98`, label Linear legacy `bucket/post-0.4`):
- la leadership autoriale di UI/UX puo essere delegata a Gemini quando il focus e strettamente di interfaccia
- Codex mantiene i guardrail su scope, regressioni comportamentali, accessibilita, compliance repo e gestione Linear
- direzione d'uso: intuitivita clinica, sleekness adatta al contesto medico, linguaggio `liquid glass` leggibile e credibile anche per medici digitalmente fluenti
- tesi visiva esplicita: unire ricercatezza e immediatezza secondo principi Apple `Liquid Glass`, mantenendo un'interfaccia quotidianamente usabile e senza barriere
- nuova esplorazione controllata `WUL-112`: affiancare alla baseline `Clinico` una modalita `Liquid` piu massimalista e playful, persistita come preferenza locale e usata come laboratorio di art direction senza compromettere la baseline operativa
- principi da rispettare nella lane UI:
  - `Liquid Glass` come layer funzionale superiore per navigazione, controlli chiave, sheet e CTA
  - uso parco del glass nei controlli custom: evitare layering e overcrowding di superfici traslucide
  - separazione chiara tra contenuto clinico e chrome di navigazione
  - corner radius morbidi e concentrici, senza durezza geometrica gratuita
  - profondita multilayer `frosted` + `liquid` usata per gerarchia e focus, non come decorazione diffusa
  - colore giudizioso nei controlli per preservare leggibilita, contrasto e accessibilita
  - tono generale: sofisticato, leggibile, un po' giocoso, ma sempre operativo
  - se vengono mantenute due grammatiche UI, `Clinico` resta sempre la baseline affidabile e `Liquid` deve distinguersi per materialita, profondita e delight senza toccare il significato clinico dei colori o rompere scanning e affordance

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
