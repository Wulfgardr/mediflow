---
summary: "Run record della wave PK-1: adozione Fabric su patient insight, emendamento etichette provenance, quattro round writer/verifica, verdetto GO — VERIFIED, HOLD_REMOTE_PROMOTION invariato."
read_when:
  - "Si riprende, verifica o estende l'adozione Fabric di patient insight (PK-1)."
  - "Si prepara la slice PK-2 Smart Import o un packet successivo del DAG post-Horizon."
---

# Intelligence Fabric: wave PK-1 (patient insight)

Stato documento: `SECONDARY / RUN RECORD`

Run ID: `MFP-IF-PK1-20260806-01`

Data: 2026-08-06

Controller: Fable 5 + UltraCode (giudizio, adjudicazioni, fix terminale, closeout);
lane delegate GPT-5.6 pinnate per modello ed effort. Meter quota Fable non
esposto nell'harness: registrato `CAPACITY_UNKNOWN` come dato, sessione avviata
su mandato esplicito dell'utente.

## 1. Mandato e selezione

Ingresso: `NEXT_PERMITTED_ACTION` dell'handoff terminale Fable
(`2026-07-30-intelligence-fabric-horizon-run.md`, §15). CoS Sol high read-only:

- identita' verificata (base `ad54655ed`, runtime `aa3de4c46` antenato);
- branch `codex/WUL-522-if-provider-admission` e `codex/WUL-522-if-status-projection`
  dichiarati SUPERSEDED (patch-id/file identici in Horizon, nessun salvage);
- slice selezionata: **PK-1 patient insight** (`lib/ai-summary-service.ts`, 264
  righe, catalogo coerente, un solo seam); PK-2 respinta per entry point del
  catalogo incoerente (punta all'apply route: decisione contrattuale aperta,
  registrata per il packet PK-2).

## 2. Wave record

Branch: `codex/WUL-522-pk1-patient-insight-fabric` (base `ad54655ed`).
Ownership esclusiva: `lib/ai-summary-fabric.ts` (nuovo),
`lib/ai-summary-service.ts`, `lib/ai-context.test.ts`.

| Round | Esito | Contenuto |
|---|---|---|
| W1 (Terra high) | STOP legittimo | `source_hierarchy` fuori dal vocabolario chiuso `FABRIC_PREPROCESSING_LABELS`; correzione avrebbe toccato il contratto (fuori ownership). |
| Emendamento (Fable) | Packet emendato | Preprocessing = `['context_minimization','envelope_validation']`; vocabolario invariato; parita' col pattern document_synthesis. Falsificatore futuro: un consumer reale che richieda la distinzione gerarchica apre un ADR di vocabolario. |
| W1r (Terra, resume) | `34b59b1aa` | Adapter + seam + test; gate verdi. |
| V1 (Sol fresco) | HOLD_FIX | P1 health-throw oltre il fail-closed; P2 lifecycle (adjudicato: parita' col pattern, chiusura reale = PK-5); P2 receipt parziale; P2 provenance (nullo: verificatore senza emendamento); P3 attach su info frozen. |
| W2 (Terra, resume) | `61883c488` | Health-throw fail-closed; receipt hardening; test confine lifecycle; attach anticipato pre-side-effect. Incidente: resume dalla cwd errata, commit recuperato via fast-forward, branch spurio eliminato. |
| V2 (Sol fresco) | HOLD_FIX | P2 residuo: validazione receipt incompleta (`authorityPlane`, `runtimeReadiness`, `class`, `fallbackCount`, nested schema, identita' decision/resolution). |
| W3 (Terra, resume) | `fdbf7c7e5` | Validazione integrale `ProviderSelectionReceipt`; identita' referenziale decision/resolution; `runtimeReadiness='required'` confermato dal registry. |
| V3 (Sol fresco) | HOLD_FIX | P2 finale: receipt root non snapshotted (getter stateful oltre l'ammissione; `egressProfile` null -> TypeError). |
| W4 (Fable diretto) | `88744fd86` | Snapshot strutturale unico (una lettura per campo, copia congelata); decision/resolution/provenance ricostruite attorno allo snapshot (raw mai nel metadato); shape malformate -> denial, mai throw. Regola applicata: dopo due round delegati falliti il controller esegue direttamente. |
| V4 (Sol fresco) | **GO — VERIFIED** | Probe indipendente 6/6 (prima-lettura coerente, conteggio 1 per campo, denial su divergenza/shape); regressione falsificatori 12/12; gate verdi. |

## 3. Gate finali (V4 su `88744fd86`)

`test:ai-context` 71/71; `test:unit` 1011/1011; suite Fabric mirata 43/43;
typecheck, lint, build + standalone bundle, claims (484 file, 0 high-risk),
never-regress, OpenAPI drift, schema drift (21 tabelle/22 indici),
`git diff --check ad54655ed..HEAD`: tutti PASS. Diff limitato ai tre file di
ownership.

## 4. Decision audit della wave

- Emendamento etichette provenance: **accepted** (vocabolario chiuso, parita'
  col pattern consegnato).
- Lifecycle derivato per richiesta: **accepted** (assunzione dichiarata del
  candidato Horizon; chiusura reale = PK-5); test di confine router aggiunto.
- Nessun `writesPerformed: 0` nel metadato PK-1: **accepted** (patient insight
  persiste `aiSummary` per invariante esistente; dichiararlo zero sarebbe falso).
- `retention: 'not_persisted'` nella policy: **accepted** (semantica lato
  registry/provider, `not_persisted_by_registry`; la persistenza applicativa
  review-first resta separata e invariata).
- `chatTimeoutMs: 1_000` nella request di routing: **accepted** (solo adapter
  temporaneo di risoluzione; generazione reale con timeout del servizio).
- Parametro `routeCandidate` iniettabile: **accepted, bounded** (default
  canonico, uso solo test; postcondizioni ora validate integralmente).
- Snapshot da lato canonico tipizzato per i campi union: **accepted**
  (uguaglianza gia' provata sulla lettura singola del raw).
- Sforamento soft della stop rule LOC (~336 gross runtime vs ~300): adjudicato
  **non bloccante** da V4 (hardening richiesto dalla verifica, nessun secondo
  confine architetturale).

## 5. Verdetto

`PK1_HARDENED_LOCAL_CANDIDATE_READY / HOLD_REMOTE_PROMOTION`

HEAD candidato: `88744fd86`. Nessun push, PR, merge remoto, tag, release o
mutazione Linear eseguiti. La promozione remota richiede mandato esplicito
dell'utente.

## 6. Residuo e DAG

- Non provati (invariati dal candidato Horizon): daemon Ollama reale, smoke
  browser dei consumer, runtime Apple (`BLOCKED_TOOLCHAIN`), device/LAN,
  provider reali.
- PK-2 Smart Import: bloccata dalla decisione contrattuale sull'entry point del
  catalogo (`smart_import` punta alla route apply, non al call path generativo
  `patient-smart-import-service.ts`). Serve un packet dedicato di correzione
  catalogo prima dell'adozione.
- Il resto del DAG post-Horizon (PK-3..PK-6, paired, provider reali) resta come
  ordinato nell'handoff §15.
