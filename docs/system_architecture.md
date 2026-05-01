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

## Snapshot corrente

1. **Local-first di default**: il dato resta sul computer locale e nessun cloud
   entra nel runtime operativo per default.
2. **Zero-knowledge a riposo**: i campi clinici e gli artifact documentali
   persistono cifrati lato client.
3. **Home-base opt-in**: esiste una first slice `network-home-base` read-only su
   `/api/v1/network/*`, ma pairing, replica e sync restano governati e separati.
4. **Document intelligence prudente**: `documentInsights` resta compat layer,
   mentre gli allegati possono gia persistere un artifact `parse/evidence`
   cifrato consumato in priorita da `AI Patient Insight`.
5. **Clinical Workbench unico**: Graphite e la shell web ufficiale su `main`;
   AI, Smart Import e contesto paziente SISS/FSE non dipendono piu da preview
   profiles runtime.
6. **Direzione Apple piu chiara**: web app primaria oggi, shell macOS storica
   congelata per rebuild e filone iPadOS/iOS ricondotto allo stesso boundary
   `home-base + /api/v1`.
7. **SISS/FSE documentale governato**: il corpus locale con sync/freshness
   prepara integrazioni future senza dichiarare una catena regionale certificata.

---

## Componenti chiave

| Componente | Stato attuale | Note |
| --- | --- | --- |
| Web app Next.js | Superficie primaria | UI, `/api/*`, `/api/v1/*`, overview `home-base`, coordinamento AI locale |
| SQLite + Drizzle | Storage autorevole | `medical.db`, schema in `lib/schema.ts` |
| Ollama | Runtime AI/OCR locale | Default text-only `qwen3.5:35b-a3b`, OCR locale separato |
| ICD-11 Docker | Servizio locale opzionale | Resolver diagnostico OMS |
| OpenMed redaction | Sidecar shadow opzionale | Lane `redaction.v1` benchmark/shadow, non client-facing |
| TLS proxy `:3443` | Trasporto locale fidato | Base di `/api/v1` per native e `home-base` |

---

## Dati e cifratura

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
sessione attiva del browser/client.

---

## API e boundary

| Surface | Auth | Scopo |
| --- | --- | --- |
| `/api/auth/*` | credenziali + session cookie | setup/login/logout |
| `/api/*` | session cookie | CRUD web, proxy locali, overview shell |
| `/api/v1/*` | bearer token locale | contratto condiviso native |
| `/api/v1/network/*` | paired client credential + sessione operatore | `home-base` read-only first |

Boundary importanti:

- `local-only` resta il default
- `network-home-base` si attiva esplicitamente in Settings
- il pairing bootstrap e PHI-safe
- non esistono ancora write remoti, sync record-level o multi-master

---

## AI e document intelligence

Pipeline corrente:

1. upload documento
2. normalizzazione input locale
3. OCR locale
4. estrazione/sintesi con runtime generativo locale
5. persistenza di:
   - `summarySnapshot`
   - artifact `parse/evidence`
   - `documentInsights` come projection compatibile
6. refresh dei consumer reviewable (`AI Patient Insight`, smart import, create
   flow document-driven)

Nota: `Smart Import` resta reviewable e filtra il rumore da fonti senza novita
clinica quando diagnosi/terapie sono gia presenti.

---

## Guardrail operativi

- `AppRevisionGuard` + `/api/system/revision` evitano tab stale dopo cambi di
  branch/revision/worktree.
- `Start_MediFlow.command` puo resettare `.next` quando cambia il fingerprint
  della sorgente locale.
- Il `Clinical Workbench` e l'unico runtime UI supportato su `main`; nuove
  sperimentazioni non vivono come selector persistito in Settings.
- I benchmark/shadow lane (`OpenMed`, comparator cloud, NER benchmark-only)
  restano separati dal runtime clinico.

---

## Riferimenti rapidi

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/walkthrough.md](./walkthrough.md)
- [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md)
- [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md)
- [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md)
- [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md)
- [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md)
- [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

---

*Ultimo aggiornamento: 2026-05-01 — main corrente*
