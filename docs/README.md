# Documentazione MediFlow — Indice Canonico

Questo file è il punto di ingresso unico: dove leggere, cosa aggiornare e quale documento prevale.

Ultimo aggiornamento: 2026-03-23

## Policy di consultazione (agent)

Documenti da consultare **sempre**:

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [docs/README.md](./README.md) (questo file)
4. [ARCHITECTURE.md](../ARCHITECTURE.md)
5. [SECURITY.md](../SECURITY.md)
6. [CONTRIBUTING.md](../CONTRIBUTING.md)
7. [PLANS.md](../PLANS.md) (se presente)
8. [docs/adr/](./adr/README.md) (partendo dai più recenti)

Documenti da consultare **al bisogno**:

- Mappa completa markdown: [docs/markdown-index.md](./markdown-index.md)
- Playbook orchestrazione lavoro con Linear/Codex: [docs/linear-codex-playbook.md](./linear-codex-playbook.md)
- Walkthrough operativo end-to-end: [docs/walkthrough.md](./walkthrough.md)
- Parity web/macOS: [docs/parity-matrix.md](./parity-matrix.md)
- Contratto OpenAPI `/api/v1`: [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml), [docs/openapi/README.md](./openapi/README.md), [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md)
- Setup/testing nativo: [docs/NATIVE.md](./NATIVE.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/native-testing.md](./native-testing.md), [docs/parity-smoke.md](./parity-smoke.md), [docs/parity-click-map-macos.md](./parity-click-map-macos.md)
- Test concorrenza cross-client sui pazienti: [docs/patient-concurrency-tests.md](./patient-concurrency-tests.md)
- Tooling documentale Apple (MCP): [docs/apple-docs-mcp.md](./apple-docs-mcp.md)
- Compliance e roadmap: [docs/COMPLIANCE.md](./COMPLIANCE.md), [docs/ROADMAP.md](./ROADMAP.md), [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md), [docs/clinical-facts-benchmark-observations.md](./clinical-facts-benchmark-observations.md), [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md), [docs/siss-baseline.md](./siss-baseline.md)
- Valutazioni comparative toolkit AI: [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md)
- Runbook benchmark OpenMed `redaction.v1`: [docs/openmed-redaction-benchmark.md](./openmed-redaction-benchmark.md)
- Runbook benchmark `clinical_entities.v1`: [docs/clinical-entities-benchmark.md](./clinical-entities-benchmark.md)
- Stato affidabilita stack AI e piano di hardening: [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md)
- Piano esecutivo work-package per affidabilita AI: [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md)

## Ordine di lettura consigliato

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [ARCHITECTURE.md](../ARCHITECTURE.md)
4. [SECURITY.md](../SECURITY.md)
5. [CONTRIBUTING.md](../CONTRIBUTING.md)
6. [docs/adr/](./adr/README.md) (partendo dai più recenti)
7. [PLANS.md](../PLANS.md)
8. [docs/walkthrough.md](./walkthrough.md)
9. [docs/markdown-index.md](./markdown-index.md)

## Convenzione stato documenti

- `CANONICAL`: fonte di verità da aggiornare quando cambia un tema.
- `SECONDARY`: approfondimento o sintesi; utile, ma non prevale se in conflitto.
- `LEGACY`: materiale storico/visuale; consultabile, non decisionale.

## Fonte autorevole per tema

| Tema | File canonico | Stato | Note |
| --- | --- | --- | --- |
| Regole agent e vincoli | [AGENTS.md](../AGENTS.md) | `CANONICAL` | Fonte primaria per processi e limiti operativi. |
| Onboarding progetto | [README.md](../README.md) | `CANONICAL` | Punto di ingresso generale. |
| Visione architetturale stabile | [ARCHITECTURE.md](../ARCHITECTURE.md) | `CANONICAL` | Confini e principi che cambiano raramente. |
| Sicurezza e redazione dati | [SECURITY.md](../SECURITY.md) | `CANONICAL` | Policy di sicurezza, threat model, logging rules. |
| Workflow di contribuzione | [CONTRIBUTING.md](../CONTRIBUTING.md) | `CANONICAL` | Definition of Done e routine verifica. |
| Orchestrazione delivery Linear + Codex | [docs/linear-codex-playbook.md](./linear-codex-playbook.md) | `CANONICAL` | Workflow operativo planning -> coding -> audit trail con issue linking e convenzioni branch/PR. |
| Decisioni architetturali | [docs/adr/*.md](./adr/README.md) | `CANONICAL` | Ogni scelta non banale deve vivere qui. |
| Contratto API locale `/api/v1` | [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml) | `CANONICAL` | Spec OpenAPI client-facing; processo/versioning governati da ADR 0010. |
| Runbook manutenzione OpenAPI | [docs/openapi/README.md](./openapi/README.md) | `SECONDARY` | Workflow operativo per mantenere aggiornata la spec durante lo sviluppo. |
| Piano engineering a breve termine | [PLANS.md](../PLANS.md) | `CANONICAL` | 2-6 settimane, operativo. |
| Matrice parity web/macOS | [docs/parity-matrix.md](./parity-matrix.md) | `CANONICAL` | Gate capability-by-capability (funzioni/campi/flessibilita/autonomia). |
| Roadmap prodotto | [docs/ROADMAP.md](./ROADMAP.md) | `CANONICAL` | Direzione prodotto/versioni, separata da `PLANS.md`. |
| Roadmap terminologie/FSE | [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | `CANONICAL` | Evoluzione codifiche cliniche e compliance documentale (coerente con ADR 0006). |
| Benchmark clinical facts osservazioni | [docs/clinical-facts-benchmark-observations.md](./clinical-facts-benchmark-observations.md) | `CANONICAL` | Decisione benchmark v1 per facts osservazionali `LOINC/UCUM`: `hybrid` default, `rules` fallback, `ai` non eseguito nella thin slice headless. |
| Matrice baseline ufficiale GTW/FSE | [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md) | `CANONICAL` | Gap analysis versionata tra artifact ministeriali `it-fse-support` e stato reale MediFlow. |
| Baseline SISS | [docs/siss-baseline.md](./siss-baseline.md) | `CANONICAL` | Stato attuale, target certificato, gap e sequenza `WUL-43` -> `WUL-45` -> `WUL-44` per l'integrazione SISS. |
| Valutazione toolkit AI esterni | [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md) | `SECONDARY` | Nota comparativa per valutare toolkit AI esterni rispetto ai vincoli MediFlow; oggi documenta il fit di OpenMed come possibile sidecar locale `PII/redaction`, non come sostituto del runtime generativo. |
| Runbook benchmark OpenMed redaction | [docs/openmed-redaction-benchmark.md](./openmed-redaction-benchmark.md) | `SECONDARY` | Guida operativa per lanciare il benchmark `WUL-96` contro un sidecar locale OpenMed, con env vars, healthcheck e metrica attesa della lane `redaction.v1`. |
| Runbook benchmark clinical entities | [docs/clinical-entities-benchmark.md](./clinical-entities-benchmark.md) | `SECONDARY` | Guida operativa per eseguire la thin slice `clinical_entities.v1` con adapter locali benchmark-only, a partire da `HUMADEX`, senza toccare il runtime applicativo. |
| Stato affidabilita stack AI | [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md) | `SECONDARY` | Dossier tecnico trasversale sullo stato reale delle lane AI, sui problemi incontrati, sui benchmark eseguiti e sul piano di hardening coerente con le ADR correnti. |
| Piano esecutivo affidabilita AI | [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md) | `SECONDARY` | Traduzione operativa del dossier AI in work package, dipendenze, exit criteria e stop-rules per portare a terra benchmarking, hardening e rollout delle lane AI. |
| Walkthrough end-to-end | [docs/walkthrough.md](./walkthrough.md) | `CANONICAL` | Mappa operativa web + native + servizi locali. |
| Topologia dati e flussi | [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | `CANONICAL` | Percorsi dati digitali end-to-end (cifratura, API, storage, trust boundaries). |
| Indice completo Markdown repo | [docs/markdown-index.md](./markdown-index.md) | `CANONICAL` | Elenco navigabile e descrittivo di tutti i `.md` tracciati nel repository. |
| Testing app macOS | [docs/native-testing.md](./native-testing.md) | `CANONICAL` | Strategia e workflow ufficiale test native (XCTest/Xcode). |
| Smoke test interattivi | [docs/e2e-smoke.md](./e2e-smoke.md) | `SECONDARY` | Harness operativo per run E2E isolati e uso in VM. |
| Test concorrenza pazienti cross-client | [docs/patient-concurrency-tests.md](./patient-concurrency-tests.md) | `SECONDARY` | Runner isolato web + `/api/v1` per conflitti `version` sui pazienti. |
| Parity smoke harness | [docs/parity-smoke.md](./parity-smoke.md) | `SECONDARY` | Runner unico web+native con report artifact e gating configurabile. |
| Click-map parity macOS | [docs/parity-click-map-macos.md](./parity-click-map-macos.md) | `SECONDARY` | Checklist manuale dei click-path macOS durante i parity sweep. |
| Deep dive tecnico architettura | [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | `SECONDARY` | Approfondimento tecnico esteso. |
| Sintesi operativa architettura | [docs/system_architecture.md](./system_architecture.md) | `SECONDARY` | Versione compatta/rapida. |
| Setup client macOS e TLS locale | [docs/NATIVE.md](./NATIVE.md), [docs/native-testing.md](./native-testing.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/local-api-tls.md](./local-api-tls.md) | `CANONICAL` | Materiale operativo nativo. Dopo `v0.4.0` descrive lo snapshot corrente e i vincoli da preservare durante il rebuild controllato della shell macOS. |
| Compliance/GDPR/FHIR | [docs/COMPLIANCE.md](./COMPLIANCE.md) | `CANONICAL` | Quadro compliance e interoperabilità. |
| Manuale utente medico | [docs/MANUALE.md](./MANUALE.md) | `CANONICAL` | Uso prodotto lato clinico. |
| ADR native token bootstrap secure-first | [docs/adr/0014-native-token-bootstrap-secure-first.md](./adr/0014-native-token-bootstrap-secure-first.md) | `CANONICAL` | Precedenza secure-first del token native (`Keychain -> config -> legacy`) e failure mode espliciti. |
| ADR audit taxonomy minima | [docs/adr/0015-audit-taxonomy-minimum-catalog.md](./adr/0015-audit-taxonomy-minimum-catalog.md) | `CANONICAL` | Catalogo audit `audit.v1`, schema evento minimo e confini PHI-safe per log e audit record. |
| ADR backup artifact v1 manifest/preflight | [docs/adr/0016-backup-artifact-v1-manifest-preflight.md](./adr/0016-backup-artifact-v1-manifest-preflight.md) | `CANONICAL` | Artifact backup JSON v1 con manifest, checksum e restore preflight server-side. |
| ADR backup notturno via `launchd` | [docs/adr/0022-nightly-backup-via-macos-launchd.md](./adr/0022-nightly-backup-via-macos-launchd.md) | `CANONICAL` | Thin slice `WUL-30`: schedulazione notturna macOS via LaunchAgent utente e runner headless locale. |
| ADR retention backup keep-last-N | [docs/adr/0023-backup-retention-policy-keep-last-n.md](./adr/0023-backup-retention-policy-keep-last-n.md) | `CANONICAL` | Thin slice `WUL-31`: retention automatica limitata ai backup scheduler-owned con preview dry-run e cleanup tracciato. |
| ADR policy lockout auth | [docs/adr/0017-auth-lockout-policy.md](./adr/0017-auth-lockout-policy.md) | `CANONICAL` | Policy lockout condivisa tra web e macOS: soglia, finestra, durata e contratto errori `401/423`. |
| ADR AI Patient Insight full-auto/manual Pro | [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./adr/0018-ai-insight-full-auto-and-pro-settings.md) | `CANONICAL` | Budget configurabili e persistenti per AI Patient Insight, con thin slice limitata a settings UI + runtime builder/generation. |
| ADR native patient insight markdown contract | [docs/adr/0019-native-patient-insight-markdown-contract.md](./adr/0019-native-patient-insight-markdown-contract.md) | `CANONICAL` | Il client macOS salva `aiSummary` in markdown con citazioni, mantenendo compatibilita col consumer web attuale e rinviando l'envelope raw persistito. |
| ADR AI insight source hierarchy and conflict rules | [docs/adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md) | `CANONICAL` | Formalizza la gerarchia delle fonti cliniche e le regole di conflitto/fallback per `AI Patient Insight`, gia applicate dal builder corrente. |
| ADR terminology registry locale in settings JSON | [docs/adr/0021-terminology-registry-in-settings-json.md](./adr/0021-terminology-registry-in-settings-json.md) | `CANONICAL` | Registry locale terminologie versionato in `settings`, senza migrazioni, con update admin auditabile e read-path usato da `systems/search/resolve`. |
| ADR web/core stabilization before next version bump | [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./adr/0024-web-core-stabilization-before-next-version-bump.md) | `CANONICAL` | Sequenza di consolidamento web/core prima del prossimo version bump: helper condivisi per patient payload/structured fields, `typecheck` canonico e split incrementale dei god files. |
| ADR SISS local adapter contract and error taxonomy | [docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md](./adr/0025-siss-local-adapter-contract-and-error-taxonomy.md) | `CANONICAL` | Foundation locale del filone SISS: azioni tipizzate, error taxonomy stabile, retry transiente e metadata audit redatti prima dell'integrazione UI. |
| ADR PIN rotation via client-side rewrap | [docs/adr/0026-pin-rotation-via-client-side-rewrap.md](./adr/0026-pin-rotation-via-client-side-rewrap.md) | `CANONICAL` | Cambio PIN zero-knowledge: il client riavvolge la stessa master key con un nuovo KEK derivato dal nuovo PIN, senza ricifrare i dati clinici. |
| ADR shared AI extraction envelope and local render separation | [docs/adr/0027-ai-task-extraction-envelope-and-local-render.md](./adr/0027-ai-task-extraction-envelope-and-local-render.md) | `CANONICAL` | Thin slice WUL-95: envelope condiviso `mediflow.ai.extract.v1` per insight/smart import/document synthesis e render locale compatto separato per stabilizzare benchmark/validator JSON. |
| ADR stack-aware AI model evaluation matrix | [docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md](./adr/0028-stack-aware-ai-model-evaluation-matrix.md) | `CANONICAL` | Estende WUL-95 con una matrice di valutazione stack-aware: benchmark immediato solo per candidati generativi `ollama`, mentre modelli PII/NER/encoder restano tracciati come lane dedicate con blocker espliciti. |
| ADR AI model parliament and local retention policy | [docs/adr/0029-ai-model-parliament-and-local-retention-policy.md](./adr/0029-ai-model-parliament-and-local-retention-policy.md) | `CANONICAL` | Governa la gara tra modelli generativi locali, il report unificato benchmark+retention e il pruning solo esplicito dei modelli ridondanti, tenendo protetti i ruoli AI attivi. |
| ADR OpenMed redaction first and separate Italian NER lane | [docs/adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md](./adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md) | `CANONICAL` | Fissa `WUL-96` come workstream lane-specific: `OpenMed` prima su `redaction.v1`, `HUMADEX` primo confronto NER italiano, `OpenMed NER` solo baseline secondaria e nessun confronto diretto con i generativi. |
| ADR clinical entities evidence-first medication/problem lane | [docs/adr/0031-clinical-entities-evidence-first-medication-problem-lane.md](./adr/0031-clinical-entities-evidence-first-medication-problem-lane.md) | `CANONICAL` | Apre la thin slice `clinical_entities.v1` limitata a `medication` e `problem`, con output evidence-first, corpus sintetico dedicato e harness benchmark separato prima degli adapter reali `HUMADEX/OpenMed NER`. |

## File sovrapposti o secondari

- [docs/product_roadmap.md](./product_roadmap.md): alias storico della roadmap prodotto, da considerare **deprecato**. La fonte attiva è [docs/ROADMAP.md](./ROADMAP.md).
- `docs/index.html`: pagina visuale legacy utile per consultazione rapida, ma non fonte di verità per decisioni architetturali.
- `docs/private/openhospital-alignment/*`: workspace operativo privato locale. Le decisioni persistenti vanno riallineate su [PLANS.md](../PLANS.md) e/o ADR pubblici.

## Regole rapide di mantenimento

1. Una decisione duratura deve finire in ADR.
2. Un cambio di priorità a breve finisce in [PLANS.md](../PLANS.md).
3. Un cambio di direzione prodotto finisce in [docs/ROADMAP.md](./ROADMAP.md).
4. Se un `.md` viene aggiunto/rimosso/rinominato, aggiorna [docs/markdown-index.md](./markdown-index.md).
5. Se cambia la fonte autorevole di un tema, aggiorna questa mappa.
6. Se due file dicono cose diverse, prevale la fonte canonica indicata sopra.
