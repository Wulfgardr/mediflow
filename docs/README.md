# Documentazione MediFlow — Indice Canonico

Questo file è il punto di ingresso unico: dove leggere, cosa aggiornare e quale documento prevale.

Ultimo aggiornamento: 2026-05-02

> [!NOTE]
> La repo OSS omette i documenti interni di orchestrazione, attribution, piano operativo a breve e workspace privati. In pubblico devono restare leggibili soprattutto `README`, `docs/FAQ.md`, `docs/ROADMAP.md`, `ARCHITECTURE.md`, `docs/walkthrough.md` e i documenti canonici di prodotto/architettura che descrivono solo cio che e davvero esposto.

## Policy di consultazione (agent)

Documenti da consultare **sempre**:

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [docs/README.md](./README.md) (questo file)
4. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
5. [ARCHITECTURE.md](../ARCHITECTURE.md)
6. [SECURITY.md](../SECURITY.md)
7. [CONTRIBUTING.md](../CONTRIBUTING.md)
8. [PLANS.md](../PLANS.md) (se presente)
9. [docs/adr/](./adr/README.md) (partendo dai più recenti)

Documenti da consultare **al bisogno**:

- Mappa completa markdown: [docs/markdown-index.md](./markdown-index.md)
- Lettura completa dello stato corrente: [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
- FAQ pubbliche e stato sintetico del prodotto: [docs/FAQ.md](./FAQ.md)
- Playbook orchestrazione lavoro con Linear/Codex: [docs/linear-codex-playbook.md](./linear-codex-playbook.md)
- Walkthrough operativo end-to-end: [docs/walkthrough.md](./walkthrough.md)
- Parity web/macOS: [docs/parity-matrix.md](./parity-matrix.md)
- Contratto OpenAPI `/api/v1`: [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml), [docs/openapi/README.md](./openapi/README.md), [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md)
- Setup/testing nativo: [docs/NATIVE.md](./NATIVE.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/native-testing.md](./native-testing.md), [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md), [docs/parity-smoke.md](./parity-smoke.md), [docs/parity-click-map-macos.md](./parity-click-map-macos.md)
- Test concorrenza cross-client sui pazienti: [docs/patient-concurrency-tests.md](./patient-concurrency-tests.md)
- Tooling documentale Apple (MCP): [docs/apple-docs-mcp.md](./apple-docs-mcp.md)
- Compliance e roadmap: [docs/COMPLIANCE.md](./COMPLIANCE.md), [docs/ROADMAP.md](./ROADMAP.md), [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md), [docs/clinical-facts-benchmark-observations.md](./clinical-facts-benchmark-observations.md), [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md), [docs/siss-baseline.md](./siss-baseline.md), [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md), [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md), [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md), [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md), [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md), [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md)
- Corpus documentale SISS/FSE 2.0: [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- Tooling MCP corpus SISS/FSE: [docs/siss-fse-corpus-mcp.md](./siss-fse-corpus-mcp.md)
- Valutazioni comparative toolkit AI: [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md)
- Runbook benchmark OpenMed `redaction.v1`: [docs/openmed-redaction-benchmark.md](./openmed-redaction-benchmark.md)
- Runbook benchmark `clinical_entities.v1`: [docs/clinical-entities-benchmark.md](./clinical-entities-benchmark.md)
- Runbook benchmark `patient_insight`: [docs/patient-insight-benchmark.md](./patient-insight-benchmark.md)
- Runbook benchmark resolver WHO/AIFA: [docs/resolver-benchmark.md](./resolver-benchmark.md)
- Troubleshooting documentale `AI Patient Insight`: [docs/patient-insight-document-troubleshooting.md](./patient-insight-document-troubleshooting.md)
- Stato affidabilita stack AI e piano di hardening: [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md)
- Piano esecutivo work-package per affidabilita AI: [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md)
- Runbook governance rollout AI: [docs/ai-rollout-governance.md](./ai-rollout-governance.md)
- Runbook `cloud comparator shadow eval`: [docs/cloud-comparator-shadow-eval.md](./cloud-comparator-shadow-eval.md)
- Protocollo dialogo design-time Codex/Opus: [docs/codex-opus-dialogue.md](./codex-opus-dialogue.md)

## Ordine di lettura consigliato

1. [README.md](../README.md)
2. [AGENTS.md](../AGENTS.md)
3. [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md)
4. [ARCHITECTURE.md](../ARCHITECTURE.md)
5. [SECURITY.md](../SECURITY.md)
6. [CONTRIBUTING.md](../CONTRIBUTING.md)
7. [docs/adr/](./adr/README.md) (partendo dai più recenti)
8. [PLANS.md](../PLANS.md)
9. [docs/walkthrough.md](./walkthrough.md)
10. [docs/markdown-index.md](./markdown-index.md)

## Convenzione stato documenti

- `CANONICAL`: fonte di verità da aggiornare quando cambia un tema.
- `SECONDARY`: approfondimento o sintesi; utile, ma non prevale se in conflitto.
- `LEGACY`: materiale storico/visuale; consultabile, non decisionale.

## Fonte autorevole per tema

| Tema | File canonico | Stato | Note |
| --- | --- | --- | --- |
| Regole agent e vincoli | [AGENTS.md](../AGENTS.md) | `CANONICAL` | Fonte primaria per processi e limiti operativi. |
| Onboarding progetto | [README.md](../README.md) | `CANONICAL` | Punto di ingresso generale. |
| Stato completo del sistema | [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | `CANONICAL` | Lettura unificata corrente: prodotto, runtime, boundary, AI/document intelligence, Apple clients e split private/OSS. |
| Visione architetturale stabile | [ARCHITECTURE.md](../ARCHITECTURE.md) | `CANONICAL` | Confini e principi che cambiano raramente. |
| Sicurezza e redazione dati | [SECURITY.md](../SECURITY.md) | `CANONICAL` | Policy di sicurezza, threat model, logging rules. |
| Workflow di contribuzione | [CONTRIBUTING.md](../CONTRIBUTING.md) | `CANONICAL` | Definition of Done e routine verifica. |
| Orchestrazione delivery Linear + Codex | [docs/linear-codex-playbook.md](./linear-codex-playbook.md) | `CANONICAL` | Workflow operativo planning -> coding -> audit trail con issue linking e convenzioni branch/PR. |
| Decisioni architetturali | [docs/adr/*.md](./adr/README.md) | `CANONICAL` | Ogni scelta non banale deve vivere qui. |
| Contratto API locale `/api/v1` | [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml) | `CANONICAL` | Spec OpenAPI client-facing; processo/versioning governati da ADR 0010. |
| Runbook manutenzione OpenAPI | [docs/openapi/README.md](./openapi/README.md) | `SECONDARY` | Workflow operativo per mantenere aggiornata la spec durante lo sviluppo. |
| Piano engineering a breve termine | [PLANS.md](../PLANS.md) | `CANONICAL` | 2-6 settimane, operativo. Dopo `v0.5.0` governa hardening `home-base` read-only, verify loop `0.5.x`, document intelligence artifact-first e rebuild Apple condiviso. |
| Matrice parity web/macOS | [docs/parity-matrix.md](./parity-matrix.md) | `CANONICAL` | Gate capability-by-capability (funzioni/campi/flessibilita/autonomia). |
| Roadmap prodotto | [docs/ROADMAP.md](./ROADMAP.md) | `CANONICAL` | Direzione prodotto/versioni, separata da `PLANS.md`. `v0.5.0` e la release corrente; il ciclo prodotto attivo e `post-v0.5`, senza preview profiles runtime su `main`. |
| FAQ pubbliche | [docs/FAQ.md](./FAQ.md) | `SECONDARY` | Sintesi rapida per chi deve capire in poche righe cosa fa oggi MediFlow, cosa cambia tra `v0.3` e `v0.5`, quali sono i boundary dichiarati e perche alcune note restano private. |
| Roadmap terminologie/FSE | [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | `CANONICAL` | Evoluzione codifiche cliniche e compliance documentale (coerente con ADR 0006). |
| Benchmark clinical facts osservazioni | [docs/clinical-facts-benchmark-observations.md](./clinical-facts-benchmark-observations.md) | `CANONICAL` | Decisione benchmark v1 per facts osservazionali `LOINC/UCUM`: `hybrid` default, `rules` fallback, `ai` non eseguito nella thin slice headless. |
| Matrice baseline ufficiale GTW/FSE | [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md) | `CANONICAL` | Gap analysis versionata tra artifact ministeriali `it-fse-support` e stato reale MediFlow. |
| Baseline SISS | [docs/siss-baseline.md](./siss-baseline.md) | `CANONICAL` | Stato attuale, fonti ufficiali, matrice del prototipo contestuale e sequenza `WUL-43` -> `WUL-45` -> `WUL-44` -> `WUL-178` -> `WUL-180` per l'integrazione SISS. |
| Fattibilita SSI/A2A SISS oltre `portal-handoff` | [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md) | `CANONICAL` | Boundary ufficiale del filone `WUL-180`: cosa e integrabile davvero con `SSI`, `A2A`, `webapp` e onboarding regionale, e cosa non e ancora dimostrabile con sole fonti pubbliche. |
| Modulo Prescrittivo Regionale | [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md) | `CANONICAL` | Nota scenario-specific `WUL-181`: chiarisce per il prescrittivo il boundary tra handoff, richiamo della webapp ufficiale, uso di WS/API e UI custom non ancora dimostrata. |
| FSE consultazione e consenso | [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md) | `CANONICAL` | Nota scenario-specific che chiarisce per FSE il boundary tra launcher ufficiale, consenso, ruoli/audit, SEB/eventi e viewer/feed embedded non ancora dimostrato. |
| NAR / Anagrafe Regionale read-only | [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md) | `CANONICAL` | Blueprint scenario-specific per lookup assistito, eligibility, esenzioni, medici prescrittori e ricettari in modalita read-only, senza sync o write regionali. |
| SGDT/PAI e COT per MMG/SSI | [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md) | `CANONICAL` | Nota scenario-specific che restringe SGDT ai casi PAI/CE-MMG e COT/transizioni documentati, distinguendoli da launcher generici, feed PAI o dispatch COT non dimostrati. |
| Certificati di malattia | [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md) | `CANONICAL` | Nota scenario-specific che separa Web Application / handoff governato da una UI custom o backend-first non ancora dimostrati. |
| Corpus documentale SISS/FSE | [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md) | `CANONICAL` | Governa `WUL-176` e `WUL-179`: catalogo sorgenti, fetch/sync locale fuori Git, placeholder `manual-import` e report di freshness come base documentale delle integrazioni regionali. |
| Tooling MCP corpus SISS/FSE | [docs/siss-fse-corpus-mcp.md](./siss-fse-corpus-mcp.md) | `SECONDARY` | Guida operativa per esporre in read-only il corpus locale gia sincronizzato a client MCP compatibili, senza fetch live o dati paziente. |
| Valutazione toolkit AI esterni | [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md) | `SECONDARY` | Nota comparativa per valutare toolkit AI esterni rispetto ai vincoli MediFlow; oggi documenta il fit di OpenMed come possibile sidecar locale `PII/redaction`, non come sostituto del runtime generativo. |
| Runbook benchmark OpenMed redaction | [docs/openmed-redaction-benchmark.md](./openmed-redaction-benchmark.md) | `SECONDARY` | Guida operativa per lanciare il benchmark `WUL-96` contro un sidecar locale OpenMed, con env vars, healthcheck e metrica attesa della lane `redaction.v1`. |
| ADR OpenMed redaction shadow adapter | [docs/adr/0041-openmed-redaction-shadow-adapter.md](./adr/0041-openmed-redaction-shadow-adapter.md) | `CANONICAL` | Fissa il primo contratto interno autenticato `redaction.v1` verso OpenMed, tenendolo fuori da `/api/v1` e dai write path clinici autoritativi. |
| Runbook benchmark clinical entities | [docs/clinical-entities-benchmark.md](./clinical-entities-benchmark.md) | `SECONDARY` | Guida operativa per eseguire la thin slice `clinical_entities.v1` con adapter locali benchmark-only, a partire da `HUMADEX`, senza toccare il runtime applicativo. |
| Runbook benchmark runtime MLX TurboQuant | [docs/turboquant-runtime-benchmark.md](./turboquant-runtime-benchmark.md) | `SECONDARY` | Guida operativa per eseguire la thin slice `WUL-114` su `MLX`, confrontando `baseline` e varianti `kv_bits` con corpus sintetico dedicato e senza toccare il runtime applicativo. |
| Runbook benchmark patient insight | [docs/patient-insight-benchmark.md](./patient-insight-benchmark.md) | `SECONDARY` | Guida operativa per misurare `AI Patient Insight` su corpus sintetico dedicato, con scoring su focus, citation discipline e leakage da fonti stale. |
| Runbook benchmark resolver WHO/AIFA | [docs/resolver-benchmark.md](./resolver-benchmark.md) | `SECONDARY` | Guida operativa per benchmarkare i resolver reali WHO ICD-11 e AIFA su corpus sintetici, con metriche su recall, ambiguita, latenza e mismatch di dosage/packaging. |
| Troubleshooting documentale `AI Patient Insight` | [docs/patient-insight-document-troubleshooting.md](./patient-insight-document-troubleshooting.md) | `SECONDARY` | Runbook locale per diagnosticare e recuperare i casi in cui allegati PDF o diario clinico non entrano correttamente nel contesto o nel render finale di `Patient Insight`. |
| Document intelligence lab | [docs/document-intelligence-lab.md](./document-intelligence-lab.md) | `SECONDARY` | Nota operativa per strutturare corpus documentali multi-archetipo e distinguere il corpus canonico `synthetic-only` dal vault locale privato di shadow evaluation. |
| Runbook cloud comparator shadow eval | [docs/cloud-comparator-shadow-eval.md](./cloud-comparator-shadow-eval.md) | `SECONDARY` | Workflow opt-in per confrontare baseline locale e `gpt-5.4` su case pack privati redatti/minimizzati, con report lane-specific, tassonomia di distillazione, `localEvolutionAgenda` e review strutturato dell approccio documentale. |
| Protocollo dialogo Codex/Opus | [docs/codex-opus-dialogue.md](./codex-opus-dialogue.md), [docs/dialogue/](./dialogue/2026-04-24-ai-intelligence-stack-optimization.md) | `SECONDARY` | Protocollo design-time per usare Opus/Claude come reviewer dello stack intelligence senza introdurre dipendenze runtime, PHI in repo o promozioni fuori benchmark. |
| Stato affidabilita stack AI | [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md) | `SECONDARY` | Dossier tecnico trasversale sullo stato reale delle lane AI, sui problemi incontrati, sui benchmark eseguiti e sul piano di hardening coerente con le ADR correnti. |
| Piano esecutivo affidabilita AI | [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md) | `SECONDARY` | Traduzione operativa del dossier AI in work package, dipendenze, exit criteria e stop-rules per portare a terra benchmarking, hardening e rollout delle lane AI. |
| Governance rollout AI | [docs/ai-rollout-governance.md](./ai-rollout-governance.md) | `CANONICAL` | Runbook lane-aware per shadow mode, fallback, rollback e kill-switch delle lane AI locali prima di qualunque promozione prudente. |
| Walkthrough end-to-end | [docs/walkthrough.md](./walkthrough.md) | `CANONICAL` | Mappa operativa web + native + servizi locali, inclusi `home-base` read-only, document intelligence artifact-first e guard di revisione shell. |
| Topologia dati e flussi | [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | `CANONICAL` | Percorsi dati digitali end-to-end (cifratura, API, storage, trust boundaries), inclusi artifact documentali cifrati e boundary `network-home-base`. |
| Indice completo Markdown repo | [docs/markdown-index.md](./markdown-index.md) | `CANONICAL` | Elenco navigabile e descrittivo di tutti i `.md` tracciati nel repository. |
| Testing app macOS | [docs/native-testing.md](./native-testing.md) | `CANONICAL` | Strategia e workflow ufficiale test native (XCTest/Xcode). |
| Smoke paired mobile home-base | [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md) | `SECONDARY` | Runbook operativo per smoke iPhone/iPad contro `home-base` reale con pairing temporaneo e sessione operatore. |
| Smoke test interattivi | [docs/e2e-smoke.md](./e2e-smoke.md) | `SECONDARY` | Harness operativo per run E2E isolati e uso in VM. |
| Test concorrenza pazienti cross-client | [docs/patient-concurrency-tests.md](./patient-concurrency-tests.md) | `SECONDARY` | Runner isolato web + `/api/v1` per conflitti `version` sui pazienti. |
| Parity smoke harness | [docs/parity-smoke.md](./parity-smoke.md) | `SECONDARY` | Runner unico web+native con report artifact e gating configurabile. |
| Click-map parity macOS | [docs/parity-click-map-macos.md](./parity-click-map-macos.md) | `SECONDARY` | Checklist manuale dei click-path macOS durante i parity sweep. |
| Deep dive tecnico architettura | [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | `SECONDARY` | Approfondimento tecnico esteso. |
| Sintesi operativa architettura | [docs/system_architecture.md](./system_architecture.md) | `SECONDARY` | Versione compatta/rapida del sistema reale su `main`, con overview su Clinical Workbench, home-base, document intelligence, SISS/FSE e guardrail locali. |
| Setup client macOS e TLS locale | [docs/NATIVE.md](./NATIVE.md), [docs/native-testing.md](./native-testing.md), [docs/native-setup.md](./native-setup.md), [docs/native-launch.md](./native-launch.md), [docs/local-api-tls.md](./local-api-tls.md) | `CANONICAL` | Materiale operativo nativo. Dopo `v0.5.0` descrive lo snapshot corrente e i vincoli da preservare durante il rebuild controllato della shell macOS. |
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
| ADR boundary integrazione nativa SISS oltre `portal-handoff` | [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md) | `CANONICAL` | Fissa il boundary `WUL-180`: la vera integrazione nativa SISS/FSE richiede scenari approvati, qualifica/provisioning coerenti col contesto `SSI`, e non puo essere trattata come semplice consumo libero del backend regionale. |
| ADR first slice prescrittivo regionale `webapp-assisted` | [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md) | `CANONICAL` | Fissa la decisione `WUL-181`: il primo step oltre l'handoff per il prescrittivo usa il percorso ufficiale della webapp regionale e non una UI custom MediFlow. |
| ADR Graphite workbench come unica shell web ufficiale | [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md) | `CANONICAL` | Fissa `WUL-196`: la shell Graphite/Clinical Workbench diventa il solo runtime UI supportato su `main`, senza chooser visuale persistito o shell concorrenti. |
| ADR ritiro preview profiles funzionali su `main` | [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md) | `CANONICAL` | Fissa `WUL-199`: il workbench ufficiale non espone piu preview profiles runtime; AI e Smart Import restano live e il contesto paziente SISS diventa stabile nella scheda paziente. |
| ADR architettura shared Apple client e runtime `home-base` packaged | [docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md) | `CANONICAL` | Governa `WUL-188`: core Apple condiviso, shell distinte per macOS/iPhone/iPad, Mac packaged come nodo `home-base` autorevole, client mobili paired senza accesso diretto a SQLite e parity non-AI estesa via `/api/v1/network/*`. |
| ADR corpus documentale SISS/FSE locale | [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md) | `CANONICAL` | Fissa `WUL-176`: prima corpus locale/versionato e fetch/sync controllato, poi eventuale MCP solo sopra un corpus approvato, non scraping live come sorgente primaria. |
| ADR PIN rotation via client-side rewrap | [docs/adr/0026-pin-rotation-via-client-side-rewrap.md](./adr/0026-pin-rotation-via-client-side-rewrap.md) | `CANONICAL` | Cambio PIN zero-knowledge: il client riavvolge la stessa master key con un nuovo KEK derivato dal nuovo PIN, senza ricifrare i dati clinici. |
| ADR shared AI extraction envelope and local render separation | [docs/adr/0027-ai-task-extraction-envelope-and-local-render.md](./adr/0027-ai-task-extraction-envelope-and-local-render.md) | `CANONICAL` | Thin slice WUL-95: envelope condiviso `mediflow.ai.extract.v1` per insight/smart import/document synthesis e render locale compatto separato per stabilizzare benchmark/validator JSON. |
| ADR stack-aware AI model evaluation matrix | [docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md](./adr/0028-stack-aware-ai-model-evaluation-matrix.md) | `CANONICAL` | Estende WUL-95 con una matrice di valutazione stack-aware: benchmark immediato solo per candidati generativi `ollama`, mentre modelli PII/NER/encoder restano tracciati come lane dedicate con blocker espliciti. |
| ADR AI model parliament and local retention policy | [docs/adr/0029-ai-model-parliament-and-local-retention-policy.md](./adr/0029-ai-model-parliament-and-local-retention-policy.md) | `CANONICAL` | Governa la gara tra modelli generativi locali, il report unificato benchmark+retention e il pruning solo esplicito dei modelli ridondanti, tenendo protetti i ruoli AI attivi. |
| ADR OpenMed redaction first and separate Italian NER lane | [docs/adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md](./adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md) | `CANONICAL` | Fissa `WUL-96` come workstream lane-specific: `OpenMed` prima su `redaction.v1`, `HUMADEX` primo confronto NER italiano, `OpenMed NER` solo baseline secondaria e nessun confronto diretto con i generativi. |
| ADR clinical entities evidence-first medication/problem lane | [docs/adr/0031-clinical-entities-evidence-first-medication-problem-lane.md](./adr/0031-clinical-entities-evidence-first-medication-problem-lane.md) | `CANONICAL` | Apre la thin slice `clinical_entities.v1` limitata a `medication` e `problem`, con output evidence-first, corpus sintetico dedicato e harness benchmark separato prima degli adapter reali `HUMADEX/OpenMed NER`. |
| ADR document intelligence corpus and private shadow vault | [docs/adr/0032-document-intelligence-corpus-and-private-shadow-vault.md](./adr/0032-document-intelligence-corpus-and-private-shadow-vault.md) | `CANONICAL` | Formalizza la strategia a due livelli per la document intelligence: corpus canonico `synthetic-only` in repo e vault locale privato fuori Git per shadow evaluation e failure analysis. |
| ADR AI rollout governance lane-aware shadow mode | [docs/adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md](./adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md) | `CANONICAL` | Definisce la governance lane-aware di rollout AI con shadow mode, fallback, rollback e kill-switch prima di qualsiasi promozione nel runtime. |
| ADR local-only default e network home-base opt-in | [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md) | `CANONICAL` | Governa `WUL-117`: `local-only` resta il default, `network home-base` diventa una modalita esplicita su LAN fidata, il nodo paired e autorevole solo in modalita network e la first thin slice resta read-only prima di replica/sync. |
| ADR thin slice replica network home-base come snapshot mirror | [docs/adr/0035-network-replica-thin-slice-snapshot-mirror.md](./adr/0035-network-replica-thin-slice-snapshot-mirror.md) | `CANONICAL` | Governa `WUL-120`: la first thin slice di replica resta uno snapshot mirror governato con fallback locale esplicito e manual review, senza introdurre ancora sync record-level o multi-master. |
| ADR thin slice identity network con credenziali nodo e scope esplicito | [docs/adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md](./adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md) | `CANONICAL` | Governa `WUL-122`: pairing device e login operatore restano separati, l'identita minima riusa i `users` locali del nodo e lo scope clinico `network` viene risolto come `session-context-else-node-default`. |
| ADR AI plane separato con runtime centralizzato opzionale | [docs/adr/0037-network-ai-plane-optional-central-runtime-on-trusted-lan.md](./adr/0037-network-ai-plane-optional-central-runtime-on-trusted-lan.md) | `CANONICAL` | Governa `WUL-121`: `AI locale` resta il default, il runtime centralizzato e solo una capability opzionale su LAN fidata paired, separata dal data plane e ancora gated da benchmark/rollout governance prima di qualunque routing remoto reale. |
| ADR boundary auth del primo data plane network read-only | [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md) | `CANONICAL` | Governa `WUL-150`: bootstrap pairing PHI-safe, conferma locale esplicita, credenziale dedicata del device paired e primo accesso read-only ai pazienti che richiede sempre paired client + sessione operatore. |
| ADR cloud comparator shadow eval opt-in | [docs/adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md](./adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md) | `CANONICAL` | Governa `WUL-151`: comparatore cloud `gpt-5.4` solo opt-in, su case pack privati redatti/minimizzati fuori Git, con audit trail locale e tassonomia di distillazione obbligatoria verso benchmark sintetici e miglioramenti dello stack locale. |
| ADR document intelligence evidence ledger | [docs/adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md](./adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md) | `CANONICAL` | Fissa la north star della document intelligence: documento come `evidence ledger`, con separazione tra recognition, source governance, decision layer e render/projection. |
| ADR nuova anagrafica da documento reviewable | [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md) | `CANONICAL` | Fissa il create-flow document-driven della nuova anagrafica: review esplicita prima del salvataggio, riconciliazione locale ICD/AIFA e persistenza strutturata solo per le terapie abbastanza confermate. |
| ADR TurboQuant come tema di runtime benchmark-only | [docs/adr/0044-turboquant-feasibility-and-benchmark-only-runtime-prototype.md](./adr/0044-turboquant-feasibility-and-benchmark-only-runtime-prototype.md) | `CANONICAL` | Fissa `WUL-114`: TurboQuant non entra come semplice challenger modello; oggi e solo un possibile prototipo benchmark-only di serving/KV-cache quantization su runtime isolati `Ollama` o `MLX`. |
| ADR patient import decision contract | [docs/adr/0051-patient-import-decision-contract-between-review-and-persistence.md](./adr/0051-patient-import-decision-contract-between-review-and-persistence.md) | `CANONICAL` | Formalizza la thin slice `WUL-167`: contratto `patient import decision` tra review documentale e apply prudente, distinguendo target `create/merge/review` e write strutturate vs note-only. |

## File sovrapposti o secondari

- [docs/product_roadmap.md](./product_roadmap.md): alias storico della roadmap prodotto, da considerare **deprecato**. La fonte attiva è [docs/ROADMAP.md](./ROADMAP.md).
- `docs/index.html`: pagina visuale legacy utile per consultazione rapida, ma non fonte di verità per decisioni architetturali.
- `docs/private/openhospital-alignment/*`: workspace operativo privato locale. Le decisioni persistenti vanno riallineate su [PLANS.md](../PLANS.md) e/o ADR pubblici.
- Alcuni documenti interni restano volutamente fuori dall'export OSS: playbook di orchestrazione, attribution agent, piano operativo di breve e workspace privati locali.

## Regole rapide di mantenimento

1. Una decisione duratura deve finire in ADR.
2. Un cambio di priorità a breve finisce in [PLANS.md](../PLANS.md).
3. Un cambio di direzione prodotto finisce in [docs/ROADMAP.md](./ROADMAP.md).
4. Se un `.md` viene aggiunto/rimosso/rinominato, aggiorna [docs/markdown-index.md](./markdown-index.md).
5. Se cambia la fonte autorevole di un tema, aggiorna questa mappa.
6. Se due file dicono cose diverse, prevale la fonte canonica indicata sopra.
