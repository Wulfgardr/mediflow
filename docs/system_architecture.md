---
summary: "Compact operational architecture overview for the current MediFlow mainline shell, home-base, AI/document lanes, SISS/FSE boundaries, and local guardrails."
read_when:
  - "Needing a fast technical architecture overview without reading the full walkthrough."
  - "Checking current mainline runtime boundaries before implementation or review."
---

# Architettura di MediFlow (sintesi operativa)

> [!NOTE]
> **Stato documento: SECONDARY (sintesi rapida).**
> La visione architetturale stabile resta [ARCHITECTURE.md](../ARCHITECTURE.md).
> Il walkthrough operativo canonico resta [docs/walkthrough.md](./walkthrough.md).

Panoramica tecnica rapida aggiornata allo stato reale di `main`.
Per la lettura completa e trasversale usa [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md).
Per il dettaglio completo usa [docs/walkthrough.md](./walkthrough.md).
Per la mappa documentale completa usa [docs/README.md](./README.md) e [docs/markdown-index.md](./markdown-index.md).

---

## 🧭 Snapshot corrente

1. **Local-first di default**: il dato resta sul computer locale e nessun cloud
   entra nel runtime operativo per default.
2. **Zero-knowledge a riposo**: i campi clinici e gli artifact documentali
   persistono cifrati lato client.
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
| Web app Next.js | Superficie primaria | Root Kree8 live, UI clinica locale, `/api/*`, `/api/v1/*`, overview `home-base`, orchestrazione AI locale |
| SQLite + Drizzle | Storage autorevole | `medical.db`, schema in `lib/schema.ts` |
| Ollama | Runtime AI/OCR locale | Default text-only `qwen3.5:35b-a3b`, OCR primario locale separato |
| Apple Vision OCR | Fallback macOS-only | Seconda lettura locale quando l'OCR primario restituisce output vuoto/degenerato; nessun equivalente certificato Windows/Linux (ADR 0059) |
| ICD-11 Docker | Servizio locale opzionale | Resolver diagnostico OMS |
| OpenMed redaction | Sidecar shadow opzionale | Lane `redaction.v1` benchmark/shadow, non client-facing |
| TLS proxy `:3443` | Trasporto locale fidato | Base di `/api/v1` per native e `home-base` |

---

## 🔒 Dati e cifratura

Tutto cio che e clinicamente sensibile viene cifrato lato client prima della
persistenza. Questo include:

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
sessione attiva del browser/client. Il soft-delete paziente (ADR 0066) scrive un
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

1. upload documento
2. normalizzazione input locale
3. OCR locale primario via Ollama/DeepSeek OCR; i documenti senza testo finiscono
   in una `Coda OCR` con riprocesso idempotente e nessuna proposta clinica finche
   il testo non basta (WUL-237)
4. fallback Apple Vision solo su macOS se il primario produce testo low-signal;
   su Windows/Linux non esiste oggi un fallback platform-specific certificato
5. estrazione/sintesi con runtime generativo locale
6. persistenza di:
   - `summarySnapshot`
   - artifact `parse/evidence` cifrato, section-aware (`sectionMap`, ancore
     page/section/snippet)
   - `documentInsights` come projection compatibile
7. refresh dei consumer reviewable (`AI Patient Insight`, smart import, create
   flow document-driven)

`Smart Import` resta reviewable e filtra il rumore da fonti senza novita clinica
quando diagnosi/terapie sono gia presenti. L'estrazione identita e prudente
(niente data di nascita da data arbitraria, codice fiscale con omocodie) e gli
errori AI sono visibili, con timeout sull'OCR (WUL-324, WUL-325).

L'AI locale e il default review-first. Le lane comparator cloud (`gpt-5.4`) e
OpenMed `redaction.v1` sono opt-in / shadow / benchmark-only, separate dal runtime
clinico e non sono claim di prodotto. Il benchmark di assorbimento evidenza misura
questa direzione su corpus sintetico multi-fonte: recall delle fonti, disciplina
di citazione, recupero di fonti superate e contenimento del leakage da fonti
stale.

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
- [docs/adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md](./adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md)
- [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
- [docs/adr/0059-macos-apple-vision-ocr-fallback.md](./adr/0059-macos-apple-vision-ocr-fallback.md)
- [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md)
- [docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md)
- [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

---

*Ultimo aggiornamento: 2026-06-16 - v0.7.0 mainline*
