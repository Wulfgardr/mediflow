---
summary: "Compact operational architecture overview for the current MediFlow 0.8.5 candidate shell, home-base, AI/document lanes, SISS/FSE boundaries, and local guardrails."
read_when:
  - "Needing a fast technical architecture overview without reading the full walkthrough."
  - "Checking current 0.8.5 candidate boundaries before implementation or review."
---

# Architettura di MediFlow (sintesi operativa)

> [!NOTE]
> **Stato documento: SECONDARY (sintesi rapida).**
> La visione architetturale stabile resta [ARCHITECTURE.md](../ARCHITECTURE.md).
> Il walkthrough operativo canonico resta [docs/walkthrough.md](./walkthrough.md).

Panoramica tecnica rapida del candidato sorgente locale `0.8.5`. Non prova CI
remota, release readiness, tag o release.
Per la lettura completa e trasversale usa [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).
Per il dettaglio completo usa [docs/walkthrough.md](./walkthrough.md).
Per la mappa documentale completa usa [docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md).

---

## 🧭 Snapshot corrente

1. **Local-first di default**: lo storage autorevole resta sul nodo `home-base`;
   client paired, cache locali ed export/backup espliciti completano il
   perimetro. Nessun cloud entra nel runtime operativo per default.
2. **Cifratura clinica per campo a riposo**: i campi configurati e gli artifact
   documentali sensibili persistono cifrati lato client. Il file SQLite non è
   cifrato integralmente.
3. **Home-base opt-in**: esiste una slice `network-home-base` su
   `/api/v1/network/*` con read pazienti, write versionati su
   profilo/status, diario, terapie, checkup e osservazioni, mentre hard delete
   remoto, replica, cataloghi remoti e sync restano governati e separati.
4. **Document intelligence prudente**: `documentInsights` resta compat layer,
   mentre gli allegati possono gia persistere un artifact `parse/evidence`
   cifrato consumato in priorita da `AI Patient Insight`.
5. **Root Kree8 live e una sola shell supportata**: la home web `/` apre
   direttamente il cockpit Kree8 su `main` (ADR 0060), senza selector di shell;
   AI, Smart Import e contesto paziente SISS/FSE vivono nella shell ufficiale e
   non dipendono piu da preview profiles.
6. **Direzione Apple piu chiara**: web app primaria oggi, shell macOS storica
   congelata per rebuild e filone iPadOS/iOS ricondotto allo stesso boundary
   `home-base + /api/v1`.
7. **SISS/FSE documentale governato**: il corpus locale con sync/freshness
   prepara integrazioni future senza dichiarare una catena regionale certificata.
8. **Prestazioni separate dalle terapie**: prescrizioni di esami, visite,
   imaging, riabilitazione e screening hanno un dominio locale dedicato, con
   item figli e matching repertorio preparato ma sempre reviewable.

---

## 🧱 Componenti chiave

| Componente | Stato attuale | Note |
| --- | --- | --- |
| Web app Next.js | Superficie primaria | Root Kree8 live, UI clinica locale, `/api/*`, `/api/v1/*`, overview `home-base`, coordinamento AI locale |
| SQLite + Drizzle | Storage autorevole | `medical.db`, schema in `lib/schema.ts` |
| Ollama | Runtime generativo locale configurabile | Serve Patient Insight, Smart Import e Document Synthesis quando host e modello locali superano la readiness; non e un runtime OCR della 0.8.5 |
| ATHENA/MLX | Runtime locale configurabile | Serve Treatment Reasoning solo con modello e runner `mlx_lm.generate` pre-provisionati; assenza o configurazione incompleta falliscono in modo chiuso |
| AnyDoc | Estrazione documentale locale | Primo passaggio per formati con testo estraibile, con provenienza e currentness |
| Core OCR selettivo | Integrato senza runtime adapter | Routing, manifest, materializzazione e rendering `needsOcr`; preflight DeepSeek con fake seam, senza prova live o benchmark E2E |
| Selector Fabric | Integrato | Discovery compatibile, smoke sintetico e binding atomico per cinque capability; nessuna qualifica runtime implicita |
| OpenAI / Anthropic | Adapter ufficiali `default OFF` | Probe review-only con transport fake; nessuna credenziale o rete live nel tree |
| MCP / Mini | Superficie figlia candidata | Terminology, Open Loops, follow-up proposal e query semantica bounded tramite RPC AIP ereditato; entrypoint production bloccato |
| Write checkup F10 | Candidato interno verificato | Core e composizione SQLite presenti; nessun binding launcher/MCP/Mini/UI, `AUTHORITY_UI_BINDING_BLOCKER` |
| Semantic planner | `STATIC_SURFACE_INTEGRATED / PRODUCTION_BRIDGE_BLOCKER` | Core, operazione read-only e superficie statica MCP/Mini integrati; production bridge senza callsite o test; nessun SQL libero |
| ICD-11 WHO | Application Service server-only opzionale | Output MediFlow data-only, egress e credenziali espliciti |
| OpenMed redaction | Sidecar shadow opzionale | Lane `redaction.v1` benchmark/shadow, non client-facing |
| TLS proxy `:3443` | Trasporto locale fidato | Base di `/api/v1` per native e `home-base` |

---

## 🔒 Dati e cifratura

I campi configurati come sensibili vengono cifrati lato client prima della
persistenza. Il mapping corrente include:

- campi paziente (`address`, `phone`, `notes`, `aiSummary`, `documentInsights`)
- contenuti del diario clinico
- note di controlli e motivazioni terapeutiche
- allegati e snapshot documentali (`summarySnapshot`,
  `parseEvidenceArtifactSnapshot`)

Formato at-rest:

```text
ENC:<iv_b64>:<cipher_b64>
```

Il server non possiede la chiave in chiaro; la master key vive solo nella
sessione attiva del browser/client. Identificativi e alcuni metadati restano
fuori dal mapping: il PIN non equivale a zero-knowledge sull'intero database.
Il soft-delete paziente (ADR 0066) scrive un
tombstone reversibile (`deletedAt` / `deletionReason`) con version guard e non
orfana i figli clinici; il dato cifrato non viene mai sovrascritto dal
placeholder `[LOCKED DATA]`, che resta solo di presentazione.

---

## 🔌 API e boundary

| Surface | Auth | Scopo |
| --- | --- | --- |
| `/api/auth/*` | credenziali + session cookie | setup/login/logout |
| `/api/*` | session cookie | CRUD web, proxy locali, overview shell |
| `/api/v1/*` | bearer token locale | contratto condiviso native |
| `/api/v1/network/*` | paired client credential + sessione operatore | `home-base` read-only-first + primi write limitati paziente/diario/terapie/checkup/osservazioni versionati |

Le sotto-risorse cliniche (diario, terapie, checkup, osservazioni) hanno un ciclo
di vita unificato (WUL-308): version guard con `409` sulle scritture, soft delete
su tutte le `DELETE`, liste che escludono i soft-deleted con opt-in
`includeDeleted`, audit che distingue eliminazione da aggiornamento. Il limite
default allegati e 25 MiB (`413` oltre soglia), con envelope cifrati lato client.

Boundary importanti:

- `local-only` resta il default
- `network-home-base` si attiva esplicitamente in Settings, opt-in su LAN fidata
- con `network-home-base` spenta i token paired non leggono ne scrivono
  (`403 NETWORK_MODE_DISABLED`), ma i pairing restano
- il pairing bootstrap e PHI-safe
- esistono solo write remoti limitati/versionati sui moduli gia documentati;
  sync record-level, multi-master e hard delete remoto restano fuori scope

> [!IMPORTANT]
> Il ciclo di vita unificato WUL-308 e BREAKING per il client nativo macOS ed e
> gated come blocker di release (WUL-333).

---

## 🤖 AI e document intelligence

Pipeline corrente:

1. upload e validazione locale del documento
2. estrazione AnyDoc per i formati con testo estraibile
3. registrazione di provenienza, hash e currentness della fonte estratta
4. classificazione delle sole pagine `needsOcr`, materializzazione e rendering
   bounded, poi preflight DeepSeek con fake seam; il runtime adapter non è
   integrato e gli altri esiti vanno a review manuale
5. estrazione/sintesi review-first con runtime generativo locale configurato
6. persistenza di:
   - `summarySnapshot`
   - artifact `parse/evidence` cifrato e tracciabile
   - `documentInsights` come projection compatibile
7. refresh dei consumer reviewable (`AI Patient Insight`, smart import, create
   flow document-driven)

`Smart Import` resta reviewable e filtra il rumore da fonti senza novita clinica
quando diagnosi/terapie sono gia presenti. L'estrazione identita e prudente
(niente data di nascita da data arbitraria, codice fiscale con omocodie) e gli
errori AI sono visibili e non attivano fallback impliciti.

L'AI locale è il default review-first. OpenAI e Anthropic hanno adapter HTTPS
ufficiali e probe review-only, ma restano `default OFF`. Ogni composizione
richiede lifecycle, secret reference e policy egress/retention host-owned. I
test usano transport fake: il tree non contiene credenziali o prove di rete
live. Le lane comparator e OpenMed `redaction.v1` restano benchmark-only.

Il launcher trusted avvia un processo figlio autenticato con RPC AIP ereditato.
MCP `stdio` e Mini espongono terminology search, Open Loops patient-scoped e
follow-up proposal, oltre alla query semantica bounded read-only, senza accesso
diretto a SQLite. Launcher production e quickstart restano
`PRODUCTION_BRIDGE_BLOCKER`. La topologia Supervisor
portabile come trusted parent su IPC ereditato è `DECIDED`; l'implementazione è
`SPLIT_REQUIRED`. La factory esaminata non chiude late-bind trusted-UI, owner
sincrono di `readHostContext`, lifecycle e revoca production o audit terminale
sincrono. Broker residente e UDS sono esclusi dalla `0.8.5`.

La transizione stato checkup F10 è verificata come candidato interno nel core e
nella composizione SQLite. Non è collegata a launcher, MCP, Mini o UI. La
conferma trusted-UI resta `AUTHORITY_UI_BINDING_BLOCKER` per il production
bridge.

Il core, l'operazione read-only e la superficie statica MCP/Mini del planner
semantico sono integrati:
`STATIC_SURFACE_INTEGRATED / PRODUCTION_BRIDGE_BLOCKER`. Il production bridge
selezionato non ha callsite o test. La registrazione visita è
`DEFER_NEXT_PATCH` e non è integrata nel runtime.

> [!NOTE]
> Il safety gate AI (WUL-358) espone un kill-switch per `patient-insight`,
> `smart-import` e `document-synthesis`, con model governance delle decisioni
> documentali. Nessuna scrittura clinica autonoma: le proposte restano sempre da
> rivedere.

---

## ⚠️ Guardrail operativi

- `AppRevisionGuard` + `/api/system/revision` evitano tab stale dopo cambi di
  branch/revision/worktree.
- `Start_MediFlow.command` puo resettare `.next` quando cambia il fingerprint
  della sorgente locale.
- Il cockpit Kree8 e la root web live su `main`; nuove sperimentazioni non
  vivono come selector persistito in Settings.
- Il selector Fabric sceglie binding di capability, non shell web. Discovery e
  smoke sintetico non dimostrano readiness.
- I benchmark/shadow lane (`OpenMed`, comparator cloud, NER benchmark-only)
  restano separati dal runtime clinico.
- SISS/FSE resta `portal-handoff` / webapp-assisted: niente integrazione
  regionale certificata nativa, niente generazione NRE, niente writeback FSE/SISS.

---

## 📚 Riferimenti rapidi

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md)
- [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md)
- [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md)
- [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
- [docs/adr/0059-macos-apple-vision-ocr-fallback.md](./adr/0059-macos-apple-vision-ocr-fallback.md)
- [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md)
- [docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md)
- [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

---

*Ultimo aggiornamento: 2026-09-02 - candidato sorgente locale v0.8.5*
