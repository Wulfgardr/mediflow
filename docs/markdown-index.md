# Indice Completo Markdown (Repo)

> [!NOTE]
> GitHub mostra in alto solo alcuni file speciali (`README`, `CONTRIBUTING`, `SECURITY`, ecc.).
> Questo file elenca invece **tutti** i `.md` tracciati nella repository con una sintesi rapida d'uso.

Ultimo aggiornamento: 2026-05-16

## Come usare questo indice

- Se devi capire **quali file sono canonici**, parti da [docs/README.md](./README.md).
- Se devi trovare **dove sta un tema specifico**, usa le tabelle qui sotto.
- Se aggiungi/rimuovi/rinomini un `.md`, aggiorna subito questo file e [docs/README.md](./README.md).
- Nella repo OSS alcuni file interni non sono presenti: orchestrazione agent, attribution, piano operativo a breve e workspace privati restano nel workspace privato.

## Orchestrazione e governance (consultazione sempre)

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | Regole globali per agent, vincoli e processo decisionale. | Sempre, prima di qualsiasi task. |
| [README.md](../README.md) | Onboarding generale progetto e punti di accesso documentazione. | Sempre, in fase di avvio. |
| [docs/README.md](./README.md) | Mappa canonica della documentazione (fonte autorevole per tema). | Sempre, per decidere precedenze. |
| [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | Lettura completa dello stato corrente: prodotto, runtime, dati, AI/document intelligence, OCR macOS-only fallback, home-base, SISS/FSE, Apple clients e split private/OSS. | Sempre, quando serve una vista unica e aggiornata senza ricostruire il quadro da piu documenti. |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Visione architetturale stabile, confini e non-obiettivi. | Sempre, per cambi tecnici non banali. |
| [SECURITY.md](../SECURITY.md) | Policy sicurezza, threat model e regole redazione/logging. | Sempre, per qualunque cambio dati/API. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Workflow contributivo e Definition of Done. | Sempre, prima di chiudere un task. |
| [docs/linear-codex-playbook.md](./linear-codex-playbook.md) | Playbook operativo per orchestrare Linear, Codex e GitHub con tracciabilita end-to-end. | Quando imposti processi, naming issue/branch/PR e audit trail. |
| [PLANS.md](../PLANS.md) | Piano engineering operativo (2-6 settimane). | Sempre, per allineare priorità correnti. |
| [CHANGELOG.md](../CHANGELOG.md) | Storico release e cambiamenti rilevanti. | Al bisogno, per contesto versioni. |

## Architettura, flussi e parity

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/walkthrough.md](./walkthrough.md) | Walkthrough canonico end-to-end (web + native + servizi locali), con stato reale di `home-base`, document intelligence, fallback OCR macOS-only e shell locale. | Per capire flussi completi e integrazione moduli. |
| [docs/STATE_OF_THE_SYSTEM.md](./STATE_OF_THE_SYSTEM.md) | Stato canonico complessivo del sistema, pensato come lettura unica per onboarding profondo e review trasversale. | Quando devi capire cosa esiste davvero oggi, cosa e direzione e quali confini non vanno superati. |
| [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | Topologia dati, trust boundaries, cifratura e percorsi digitali, inclusi artifact documentali cifrati e boundary `network-home-base`. | Per analisi data flow e impatti sicurezza. |
| [docs/repository-topology.md](./repository-topology.md) | Mappa concisa delle aree top-level del repo: runtime clinico vs publication/site (`whitepaper/`) vs tooling. | Quando devi capire dove collocare codice/asset o se una cartella è clinical runtime. |
| [docs/parity-matrix.md](./parity-matrix.md) | Stato parity web/macOS su moduli core e gap operativi. | Per steering parity e release readiness. |
| [docs/apple-wide-parity-qa.md](./apple-wide-parity-qa.md) | Matrice QA Apple-wide WUL-194 con manifest verificabile capability-by-capability. | Quando si lavora su macOS home-base, iPhone/iPad paired, smoke simulator/device o claim di parity Apple-wide. |
| [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | Deep dive tecnico esteso dell'architettura MediFlow. | Per approfondimenti implementativi. |
| [docs/system_architecture.md](./system_architecture.md) | Sintesi rapida dell'architettura operativa aggiornata al `main` corrente: Clinical Workbench unico, home-base, document intelligence, OCR platform boundary, SISS/FSE e guardrail locali. | Per overview veloce in onboarding/review. |

## Native, setup e testing

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/NATIVE.md](./NATIVE.md) | Guida tecnica principale del client macOS SwiftUI, ora riferita allo snapshot pre-rebuild controllato. | Per capire il client esistente, il contratto da preservare e i vincoli del prossimo rebuild native. |
| [docs/native-setup.md](./native-setup.md) | Setup automatico ambiente client nativo. | Prima di avviare sviluppo/test native. |
| [docs/native-launch.md](./native-launch.md) | Avvio rapido app macOS via script/launcher. | Per esecuzione operativa locale. |
| [docs/local-api-tls.md](./local-api-tls.md) | TLS proxy locale e trasporto sicuro per native API. | Per debug networking/certificate pinning. |
| [docs/native-testing.md](./native-testing.md) | Strategia canonica test macOS (SwiftPM/XCTest/Xcode). | Per piani test e parity sweep. |
| [docs/apple-wide-qa-manifest.json](./apple-wide-qa-manifest.json) | Manifest machine-readable della QA Apple-wide. | Validato da `npm run check:apple-wide-qa`; ogni capability deve avere evidenza o gap esplicito. |
| [docs/mobile-home-base-smoke.md](./mobile-home-base-smoke.md) | Runbook smoke iPhone/iPad contro `home-base` reale con pairing temporaneo e sessione operatore. | Per verifiche mobili `home-base` paired su simulatori Apple. |
| [docs/e2e-smoke.md](./e2e-smoke.md) | Harness smoke test web Playwright in ambiente isolato. | Per verifica rapida web in CI/VM. |
| [docs/patient-concurrency-tests.md](./patient-concurrency-tests.md) | Suite smoke isolata per conflitti di scrittura pazienti tra lane web e `/api/v1`. | Quando tocchi `patients.version`, compare-on-write o payload `409 VERSION_CONFLICT`. |
| [docs/parity-smoke.md](./parity-smoke.md) | Runner parity unificato web+native con artifacts e gating. | Per esecuzioni `P0b` e smoke consolidati. |
| [docs/parity-click-map-macos.md](./parity-click-map-macos.md) | Checklist click-path macOS capability-by-capability. | Per validazione manuale parity UI su app native. |
| [docs/apple-docs-mcp.md](./apple-docs-mcp.md) | Guida integrazione del tooling MCP per consultare docs Apple durante sviluppo native. | Quando servono riferimenti API ufficiali Apple in task SwiftUI/network/security/testing. |
| [docs/icd-local-setup.md](./icd-local-setup.md) | Setup locale container ICD-11. | Quando si lavora su diagnostica ICD. |

## Prodotto, compliance e contesto clinico

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/ROADMAP.md](./ROADMAP.md) | Roadmap prodotto canonica. | Per direzione prodotto/release narrative. |
| [docs/product_roadmap.md](./product_roadmap.md) | Roadmap storica (deprecata). | Solo per contesto storico. |
| [docs/FAQ.md](./FAQ.md) | FAQ sintetiche pubbliche: salto `v0.3 -> v0.6`, boundary dichiarati, shell ufficiale unica e stato Apple/SISS. | Per onboarding rapido o lettura pubblica del progetto. |
| [docs/COMPLIANCE.md](./COMPLIANCE.md) | Quadro compliance GDPR/FHIR e interoperabilità. | Per requisiti normativi e policy operative. |
| [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | Roadmap codifiche cliniche FSE/EDS. | Per sviluppo terminologie e export documentale. |
| [docs/clinical-facts-benchmark-observations.md](./clinical-facts-benchmark-observations.md) | Benchmark v1 per facts osservazionali `LOINC/UCUM`, corpus sintetico e decisione `hybrid` default / `rules` fallback. | Quando si toccano osservazioni, import documentale codificato o decisioni di interoperabilità sui clinical facts. |
| [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md) | Matrice di allineamento tra baseline ufficiale GTW/FSE e stato MediFlow. | Per gap analysis ministeriale, priorità FSE e anti-drift tecnico. |
| [docs/siss-baseline.md](./siss-baseline.md) | Baseline canonica SISS: stato attuale, fonti ufficiali, matrice del prototipo contestuale, gap e sequenza di consegna. | Quando si lavora su `WUL-43`, `WUL-44`, `WUL-45`, `WUL-178` e `WUL-180`. |
| [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md) | Mappa canonica di fattibilità ufficiale oltre il `portal-handoff`: separa ciò che il SISS rende tecnicamente possibile da ciò che MediFlow può fare davvero solo dopo `SSI`, scenari approvati e onboarding regionale. | Quando si lavora su `WUL-180` o si valuta prescrittivo/FSE/SGDT/Anagrafe oltre l'handoff attuale. |
| [docs/siss-modulo-prescrittivo-regionale.md](./siss-modulo-prescrittivo-regionale.md) | Nota canonica `WUL-181` sul Modulo Prescrittivo Regionale: fissa il boundary tra richiamo della webapp ufficiale, possibile supporto WS/API e re-implementazione UI non ancora dimostrata. | Quando si lavora sul prescrittivo regionale oltre il launcher attuale. |
| [docs/siss-fse-consultation-consent.md](./siss-fse-consultation-consent.md) | Nota canonica su FSE consultazione e consenso: fissa il boundary tra launcher ufficiale, consenso, ruoli/audit, SEB/eventi e viewer/feed embedded non ancora dimostrato. | Quando si valuta la consultazione FSE contestuale oltre il launcher attuale. |
| [docs/siss-nar-anagrafe-readonly-blueprint.md](./siss-nar-anagrafe-readonly-blueprint.md) | Blueprint canonico NAR / Anagrafe Regionale read-only: capability matrix, contract locale, failure taxonomy e data-minimization per assistiti, eligibility, esenzioni, medici prescrittori e ricettari. | Quando si valuta NAR oltre il launcher Gaia e prima di qualunque runtime custom o sync anagrafica. |
| [docs/siss-sgdt-pai-feasibility.md](./siss-sgdt-pai-feasibility.md) | Nota canonica su SGDT/PAI e COT per MMG/SSI: restringe SGDT ai casi PAI/CE-MMG e COT/transizioni documentati e separa quel perimetro da launcher generici, feed PAI o dispatch COT non dimostrati. | Quando si valuta SGDT oltre il boundary SISS/FSE attuale. |
| [docs/siss-certificati-malattia-feasibility.md](./siss-certificati-malattia-feasibility.md) | Nota canonica sui Certificati di malattia: separa Web Application / handoff governato da UI custom o backend-first non ancora dimostrati. | Quando si valuta il dominio certificati oltre il boundary SISS attuale. |
| [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md) | Runbook canonico del corpus documentale locale SISS/FSE: manifest sorgenti, fetch/sync fuori Git, placeholder `manual-import` e report di freshness. | Quando si lavora su `WUL-176`, `WUL-179` o sulla base documentale delle integrazioni regionali. |
| [docs/siss-fse-corpus-mcp.md](./siss-fse-corpus-mcp.md) | Guida operativa del server MCP read-only sul corpus SISS/FSE locale gia sincronizzato. | Quando strumenti o agent compatibili MCP devono cercare/leggere fonti SISS/FSE senza fetch live e senza dati paziente. |
| [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md) | Valutazione comparativa tra OpenMed e lo stack AI locale MediFlow, con raccomandazione di fit per lane (`PII`, `NER`, runtime generativo). | Quando si esplorano toolkit AI esterni o si decide se introdurre sidecar locali specialistici. |
| [docs/openmed-redaction-benchmark.md](./openmed-redaction-benchmark.md) | Runbook operativo per eseguire il benchmark `WUL-96` della lane `redaction.v1` contro un sidecar locale OpenMed. | Quando serve avviare davvero il benchmark PII/redaction con healthcheck, env vars e comando benchmark dedicato. |
| [docs/clinical-entities-benchmark.md](./clinical-entities-benchmark.md) | Runbook operativo per eseguire la thin slice `clinical_entities.v1` con adapter benchmark-only locali, a partire da `HUMADEX`, e leggere le diagnostiche `missingEntities/unexpectedEntities`. | Quando serve misurare davvero `problem + medication` su corpus sintetico italiano senza toccare il runtime applicativo. |
| [docs/turboquant-runtime-benchmark.md](./turboquant-runtime-benchmark.md) | Runbook operativo per eseguire la thin slice `WUL-114` su `MLX`, confrontando baseline e varianti `kv_bits` con corpus sintetico dedicato e output JSON comparabile. | Quando serve misurare davvero il path runtime/KV-cache `benchmark-only` di TurboQuant senza toccare il runtime applicativo o il parliament. |
| [docs/mlx-operational-parity.md](./mlx-operational-parity.md) | Matrice operativa `WUL-165` che rende MLX benchmark-visible e diagnosticabile senza promuoverlo a runtime clinico. | Quando serve distinguere parity di visibilita/guardrail MLX da promozione runtime o dal boundary OCR primario Ollama/DeepSeek con fallback Apple Vision solo macOS. |
| [docs/resolver-benchmark.md](./resolver-benchmark.md) | Runbook operativo per benchmarkare i resolver reali WHO ICD-11 e AIFA su corpus sintetici, con metriche su recall, ambiguità, latenza e mismatch di dosage/packaging. | Quando serve misurare i resolver locali veri prima di ritoccare Smart Import, coding o rollout AI. |
| [docs/patient-insight-benchmark.md](./patient-insight-benchmark.md) | Runbook operativo per misurare `AI Patient Insight` con corpus sintetico dedicato, scoring su focus/citations e validator locale anti-regressione. | Quando si toccano prompt, guardrail o context builder dell'insight e serve un benchmark piu utile del solo controllo JSON. |
| [docs/patient-insight-document-troubleshooting.md](./patient-insight-document-troubleshooting.md) | Runbook operativo locale per diagnosticare e recuperare i casi in cui allegati PDF o diario clinico non entrano correttamente nel contesto o nel render finale di `AI Patient Insight`. | Quando un caso reale mostra fallback, follow-up documentale assente o mismatch tra qualita del PDF e resa finale dell'insight. |
| [docs/document-intelligence-lab.md](./document-intelligence-lab.md) | Nota operativa per organizzare il document intelligence lab: corpus canonico `synthetic-only` in repo, vault locale privato fuori Git e shape minima dei casi multi-archetipo. | Quando si progettano nuovi archetipi documentali, shadow evaluation locale o benchmark cross-lane su document intelligence. |
| [docs/cloud-comparator-shadow-eval.md](./cloud-comparator-shadow-eval.md) | Runbook operativo per confrontare baseline locale e `gpt-5.4` su case pack privati redatti/minimizzati, con prompt emessi localmente, run opt-in, report di distillazione tassonomica, `localEvolutionAgenda` e review strutturato dell approccio documentale. | Quando serve un confronto cloud disciplinato che non contamini il runtime operativo o il corpus canonico. |
| [docs/codex-opus-dialogue.md](./codex-opus-dialogue.md) | Protocollo design-time per usare Opus/Claude come reviewer strutturato dello stack intelligence senza introdurre dipendenze runtime o PHI in repo. | Quando serve trasformare un confronto Codex/Opus in decisioni, benchmark e slice implementative tracciabili. |
| [docs/dialogue/2026-04-24-ai-intelligence-stack-optimization.md](./dialogue/2026-04-24-ai-intelligence-stack-optimization.md) | Primo round Codex/Opus su ottimizzazione stack intelligence, con decisione Codex e follow-up sul document evidence ledger. | Per recuperare il razionale della slice `WUL-202` e la lista di opportunita accettate/deferite. |
| [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md) | Dossier tecnico trasversale sullo stato reale dello stack AI, sugli incidenti incontrati, sui benchmark gia eseguiti e sulle priorita di hardening. | Quando serve una vista unica su current state AI, colli di bottiglia, benchmark e prossime mosse affidabili. |
| [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md) | Piano operativo work-package per portare a terra benchmark resolver, hardening Smart Import/Insight, lane PII e rollout prudente dello stack AI. | Quando serve passare dal dossier AI alla sequenza concreta di implementazione con dipendenze ed exit criteria. |
| [docs/ai-rollout-governance.md](./ai-rollout-governance.md) | Runbook canonico per shadow mode, fallback, rollback e kill-switch delle lane AI locali. | Quando serve giudicare se una lane AI puo restare `hold`, entrare in `shadow mode` o richiedere rollback. |
| [docs/MANUALE.md](./MANUALE.md) | Manuale utente medico. | Per supporto operativo lato clinico. |
| [oss-assets/README.md](../oss-assets/README.md) | Presentazione OSS e posizionamento progetto. | Per contesto pubblico/comunicazione. |

## Tracciabilità agent e metadoc

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/agent-attribution.md](./agent-attribution.md) | Registro contributi agent (Codex, altri). | Quando si aggiungono cambi non banali da agent. |
| [docs/linear-completed-issues-archive-2026-05-21.md](./linear-completed-issues-archive-2026-05-21.md) | Snapshot operativo delle issue Linear `Done` da usare come base per igiene/archiviazione tracker. | Quando serve liberare spazio Linear o distinguere storico completato da backlog attivo. |
| [docs/linear-memory-workflow.md](./linear-memory-workflow.md) | Policy e CLI locale per consultare memoria issue completate, generare piani di archiviazione e applicare side effect Linear espliciti. | Prima di creare nuove issue o fare batch hygiene su Linear. |
| [docs/markdown-index.md](./markdown-index.md) | Indice completo markdown con sintesi. | Per navigazione completa e controllo copertura doc. |
| [docs/openapi/README.md](./openapi/README.md) | Runbook operativo per manutenzione della spec OpenAPI `/api/v1`. | Quando si cambia il contratto client-facing o si fa review di drift. |
| [docs/design/wul-271-kree8-visual-translation.md](./design/wul-271-kree8-visual-translation.md) | Traduzione visiva Kree8 → MediFlow per PIN gate, root entry live `/`, first real-patient cockpit slice e alias review `/mockups/kree8` (WUL-271/WUL-272/WUL-273/WUL-274). | Quando si rivede la nuova linea visuale Kree8, si verifica la root live con dati reali o si pianifica la migrazione delle superfici legacy. |

## ADR (decisioni architetturali)

| File | Tema |
| --- | --- |
| [docs/adr/README.md](./adr/README.md) | Regole operative ADR (quando, come, stati). |
| [docs/adr/0000-template.md](./adr/0000-template.md) | Template standard ADR. |
| [docs/adr/0001-native-macos-client.md](./adr/0001-native-macos-client.md) | Prototipo client macOS su API locale versionata. |
| [docs/adr/0002-native-security-and-modules.md](./adr/0002-native-security-and-modules.md) | Sicurezza native (PIN/crypto) + moduli clinici minimi. |
| [docs/adr/0003-native-write-clinical-ai.md](./adr/0003-native-write-clinical-ai.md) | Write operation native via `/api/v1` + strumenti clinici. |
| [docs/adr/0004-exemptions-catalog.md](./adr/0004-exemptions-catalog.md) | Catalogo esenzioni locale e mapping su paziente. |
| [docs/adr/0005-web-native-functional-parity.md](./adr/0005-web-native-functional-parity.md) | Parity web/native su contratto API condiviso. |
| [docs/adr/0006-terminology-plugin-and-fse-profiles.md](./adr/0006-terminology-plugin-and-fse-profiles.md) | Plugin terminologie unificato + profili FSE/EDS. |
| [docs/adr/0007-strict-web-native-parity-gate.md](./adr/0007-strict-web-native-parity-gate.md) | Gate parity stretta (poi superseded). |
| [docs/adr/0008-web-first-with-parity-sweeps.md](./adr/0008-web-first-with-parity-sweeps.md) | Modello operativo web-first + parity sweep. |
| [docs/adr/0009-native-testing-strategy-xcode-xctest.md](./adr/0009-native-testing-strategy-xcode-xctest.md) | Strategia test macOS con XCTest/Xcode separata dal web runner. |
| [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md) | Strategia spec-first OpenAPI e governance/versioning del contratto `/api/v1`. |
| [docs/adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md](./adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md) | Pipeline OCR-first con Qwen text-only e autofill prudente delle diagnosi ICD esplicite; la scelta del default modello e aggiornata da ADR 0013. |
| [docs/adr/0012-operator-reviewed-smart-import-from-patient-context.md](./adr/0012-operator-reviewed-smart-import-from-patient-context.md) | Smart import reviewable da note, diario e documenti verso diagnosi ICD-11 e terapie nel profilo paziente. |
| [docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md](./adr/0013-qwen35-default-text-only-medgemma-specialist.md) | Aggiorna il default text-only a `qwen3.5:35b-a3b` e mantiene MedGemma come opzione specialistica non-default. |
| [docs/adr/0014-native-token-bootstrap-secure-first.md](./adr/0014-native-token-bootstrap-secure-first.md) | Precedenza secure-first del token native (`Keychain -> config -> legacy`) e failure mode espliciti. |
| [docs/adr/0015-audit-taxonomy-minimum-catalog.md](./adr/0015-audit-taxonomy-minimum-catalog.md) | Catalogo audit `audit.v1`, schema evento minimo e confini PHI-safe per log e audit record. |
| [docs/adr/0016-backup-artifact-v1-manifest-preflight.md](./adr/0016-backup-artifact-v1-manifest-preflight.md) | Artifact backup JSON v1 con manifest, checksum e restore preflight server-side. |
| [docs/adr/0017-auth-lockout-policy.md](./adr/0017-auth-lockout-policy.md) | Policy canonica lockout auth: `5` tentativi, finestra `15m`, blocco `15m`, codici `401/423` e messaggi coerenti web/macOS. |
| [docs/adr/0018-ai-insight-full-auto-and-pro-settings.md](./adr/0018-ai-insight-full-auto-and-pro-settings.md) | Budget persistenti e configurabili per `AI Patient Insight`, limitati a settings web + context builder + generation runtime. |
| [docs/adr/0019-native-patient-insight-markdown-contract.md](./adr/0019-native-patient-insight-markdown-contract.md) | Il client macOS genera e salva `AI Patient Insight` in markdown con citazioni locali, compatibile col parser web attuale. |
| [docs/adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md](./adr/0020-ai-insight-source-hierarchy-and-conflict-rules.md) | Formalizza la gerarchia delle fonti cliniche e le regole di conflitto/fallback gia applicate dal builder corrente di `AI Patient Insight`. |
| [docs/adr/0021-terminology-registry-in-settings-json.md](./adr/0021-terminology-registry-in-settings-json.md) | Registry locale terminologie persistito in `settings` JSON, letto da `systems/search/resolve` e aggiornabile senza nuove tabelle o migrazioni. |
| [docs/adr/0022-nightly-backup-via-macos-launchd.md](./adr/0022-nightly-backup-via-macos-launchd.md) | Backup automatico notturno via `launchd` su macOS home-base, con runner headless locale e stato persistito in `settings`. |
| [docs/adr/0023-backup-retention-policy-keep-last-n.md](./adr/0023-backup-retention-policy-keep-last-n.md) | Retention automatica dei backup scheduler-owned con policy `keep-last-N`, preview dry-run e cleanup tracciato in `settings`. |
| [docs/adr/0024-web-core-stabilization-before-next-version-bump.md](./adr/0024-web-core-stabilization-before-next-version-bump.md) | Fissa la sequenza di stabilizzazione web/core prima del prossimo version bump, con helper condivisi, `typecheck` canonico e split incrementale dei god files. |
| [docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md](./adr/0025-siss-local-adapter-contract-and-error-taxonomy.md) | Introduce il foundation layer locale SISS con azioni tipizzate, error taxonomy stabile, retry sui transienti e metadata audit PHI-safe. |
| [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md) | Fissa il boundary ufficiale del filone `WUL-180`: oltre il `portal-handoff`, la vera integrazione nativa SISS/FSE richiede scenari approvati e un percorso coerente con `SSI` qualificata/provisioning ARIA. |
| [docs/adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md](./adr/0046-modulo-prescrittivo-regionale-first-slice-webapp-assisted.md) | Fissa la decisione `WUL-181`: il primo step credibile sul prescrittivo regionale oltre l'handoff e `webapp-assisted`, non la riscrittura della UI prescrittiva dentro MediFlow. |
| [docs/adr/0047-graphite-workbench-single-official-web-shell.md](./adr/0047-graphite-workbench-single-official-web-shell.md) | Decisione storica `WUL-196`: Graphite come shell unica; superata per la root entry da ADR 0060, ma conserva il principio no-selector. |
| [docs/adr/0060-kree8-cockpit-live-root-entry.md](./adr/0060-kree8-cockpit-live-root-entry.md) | Fissa `WUL-272`: la root web `/` mostra il cockpit Kree8 direttamente da `Start_MediFlow.command`, mantenendo sicurezza runtime e nessun selector visuale. |
| [docs/adr/0061-clinical-agenda-bridge-zimbra-icloud.md](./adr/0061-clinical-agenda-bridge-zimbra-icloud.md) | Fissa `WUL-275`: lettura locale read-only delle cache evento Zimbra/iCloud come candidati clinici/FBF reviewable nella cockpit Kree8, senza import cieco o scritture cliniche. |
| [docs/adr/0050-functional-preview-profiles-retired-on-mainline.md](./adr/0050-functional-preview-profiles-retired-on-mainline.md) | Fissa `WUL-199`: i preview profiles funzionali vengono ritirati da `main`, con AI e Smart Import gia live e il contesto paziente SISS promosso a parte stabile della scheda paziente. |
| [docs/adr/0048-apple-shared-client-architecture-and-home-base-runtime.md](./adr/0048-apple-shared-client-architecture-and-home-base-runtime.md) | Formalizza `WUL-188`: family Apple ricostruita con core Swift condiviso, shell distinte per macOS/iPhone/iPad, Mac packaged come `home-base` autorevole e mobile paired senza accesso diretto a SQLite. |
| [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md) | Formalizza `WUL-176`: corpus documentale locale SISS/FSE con manifest versionato, fetch/sync fuori Git e futuro MCP ammesso solo sopra un corpus approvato. |
| [docs/adr/0026-pin-rotation-via-client-side-rewrap.md](./adr/0026-pin-rotation-via-client-side-rewrap.md) | Definisce la rotazione zero-knowledge del PIN tramite re-wrap client-side della master key, senza ricifrare i dati clinici. |
| [docs/adr/0027-ai-task-extraction-envelope-and-local-render.md](./adr/0027-ai-task-extraction-envelope-and-local-render.md) | Introduce l'envelope condiviso `mediflow.ai.extract.v1` per insight/smart import/document synthesis, separando il render locale compatto e il benchmark contrattuale sui modelli Qwen target. |
| [docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md](./adr/0028-stack-aware-ai-model-evaluation-matrix.md) | Definisce una matrice stack-aware per i candidati AI: benchmark reale solo sui generativi `ollama` eseguibili, con stati espliciti per modelli PII/NER/encoder bloccati da integrazione, licenza o gating. |
| [docs/adr/0029-ai-model-parliament-and-local-retention-policy.md](./adr/0029-ai-model-parliament-and-local-retention-policy.md) | Introduce il parlamento dei modelli AI locali per unire benchmark, retention e pruning esplicito dei modelli ridondanti senza toccare automaticamente i ruoli attivi nei settings. |
| [docs/adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md](./adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md) | Separa `WUL-96` in lane benchmark dedicate: `OpenMed` prima su `redaction.v1`, `HUMADEX` primo confronto NER italiano e `OpenMed NER` solo baseline secondaria, senza gara diretta contro i generativi. |
| [docs/adr/0031-clinical-entities-evidence-first-medication-problem-lane.md](./adr/0031-clinical-entities-evidence-first-medication-problem-lane.md) | Apre la thin slice `clinical_entities.v1` limitata a `medication` e `problem`, con contratto evidence-first, corpus sintetico italiano e harness benchmark separato prima degli adapter reali `HUMADEX/OpenMed NER`. |
| [docs/adr/0032-document-intelligence-corpus-and-private-shadow-vault.md](./adr/0032-document-intelligence-corpus-and-private-shadow-vault.md) | Formalizza la strategia a due livelli per la document intelligence: corpus canonico `synthetic-only` in repo e vault locale privato fuori Git per shadow evaluation e failure analysis. |
| [docs/adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md](./adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md) | Definisce la governance lane-aware di rollout AI con shadow mode, fallback, rollback e kill-switch prima di qualunque promozione prudente. |
| [docs/adr/0034-local-only-default-and-network-home-base-opt-in.md](./adr/0034-local-only-default-and-network-home-base-opt-in.md) | Formalizza `WUL-117`: `local-only` resta il default, `network home-base` diventa una modalita esplicita su LAN fidata con nodo paired autorevole e thin slice iniziale read-only prima di replica, sync e identity model. |
| [docs/adr/0035-network-replica-thin-slice-snapshot-mirror.md](./adr/0035-network-replica-thin-slice-snapshot-mirror.md) | Formalizza `WUL-120`: la replica iniziale `network home-base` resta uno snapshot mirror governato con fallback locale, stato deferred e manual review prima di qualsiasi sync record-level. |
| [docs/adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md](./adr/0036-network-identity-thin-slice-node-credentials-and-ambulatory-scope.md) | Formalizza `WUL-122`: pairing device e credenziali operatore restano separati, il nodo dichiara il login minimo richiesto e lo scope clinico `network` viene risolto in modo esplicito come contesto sessione o default ambulatoriale del nodo. |
| [docs/adr/0037-network-ai-plane-optional-central-runtime-on-trusted-lan.md](./adr/0037-network-ai-plane-optional-central-runtime-on-trusted-lan.md) | Formalizza `WUL-121`: `AI locale` resta il default, il runtime centralizzato su nodo paired e opzionale e separato dal data plane, con fallback esplicito e attivazione bloccata finche benchmark lane-specific e rollout governance non promuovono la capability. |
| [docs/adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md](./adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md) | Formalizza `WUL-151`: comparator cloud `gpt-5.4` solo opt-in su case pack privati fuori Git, con gate privacy esplicito, report lane-specific e tassonomia di distillazione obbligatoria verso benchmark sintetici e miglioramenti locali. |
| [docs/adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md](./adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md) | Formalizza la prossima north star della document intelligence: documento come `evidence ledger`, con separazione tra recognition, source governance, decision layer e render/projection. |
| [docs/adr/0038-network-readonly-data-plane-auth-boundary.md](./adr/0038-network-readonly-data-plane-auth-boundary.md) | Formalizza `WUL-150`: bootstrap pairing PHI-safe senza token locale, conferma esplicita sul nodo, credenziale dedicata del device paired e primo data plane read-only che richiede paired client + sessione operatore. |
| [docs/adr/0041-openmed-redaction-shadow-adapter.md](./adr/0041-openmed-redaction-shadow-adapter.md) | Fissa il primo adapter interno OpenMed per la lane `PII/redaction`, con shape `redaction.v1`, auth locale, config localhost-only e shadow mode fuori da `/api/v1`. |
| [docs/adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md](./adr/0042-document-driven-new-patient-review-and-prudent-therapy-persistence.md) | Formalizza il create-flow `Nuova Anagrafica` da documento con review esplicita, matching locale ICD/AIFA e persistenza strutturata solo delle terapie sufficientemente confermate. |
| [docs/adr/0043-macos-oncology-backbone-prototype.md](./adr/0043-macos-oncology-backbone-prototype.md) | Formalizza il prototipo macOS della backbone oncologica come shell SwiftUI sintetica, locale e separata da backend, schema e contratti `/api/v1` del prodotto reale. |
| [docs/adr/0044-turboquant-feasibility-and-benchmark-only-runtime-prototype.md](./adr/0044-turboquant-feasibility-and-benchmark-only-runtime-prototype.md) | Formalizza `WUL-114`: TurboQuant resta un tema di runtime/KV cache e non un semplice challenger modello; l'unica strada sensata oggi e un prototipo benchmark-only su serving isolato `Ollama`/`MLX`. |
| [docs/adr/0051-patient-import-decision-contract-between-review-and-persistence.md](./adr/0051-patient-import-decision-contract-between-review-and-persistence.md) | Formalizza la thin slice `WUL-167`: contratto `patient import decision` tra review documentale e persistenza prudente, con target `create/merge/review` e distinzione esplicita tra write strutturate e note-only. |
| [docs/adr/0052-network-patient-profile-write-boundary.md](./adr/0052-network-patient-profile-write-boundary.md) | Formalizza la prima slice write paired: `PUT /api/v1/network/patients/{id}` con paired client, sessione operatore, scope ambulatoriale e `version`, lasciando fuori delete remoto, child CRUD, sync e campi AI/documentali. |
| [docs/adr/0053-network-diary-entry-write-boundary.md](./adr/0053-network-diary-entry-write-boundary.md) | Formalizza la slice write paired del diario: read/create/update/soft-delete su `/api/v1/network/patients/{id}/entries*` con `entries.version`, capability dedicate, audit PHI-safe e hard delete/attachment/AI fuori scope. |
| [docs/adr/0054-network-therapy-write-boundary.md](./adr/0054-network-therapy-write-boundary.md) | Formalizza la slice write paired delle terapie: read/create/update/soft-delete su `/api/v1/network/patients/{id}/therapies*` con `therapies.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0055-network-checkup-write-boundary.md](./adr/0055-network-checkup-write-boundary.md) | Formalizza la slice write paired dei checkup: read/create/update/soft-delete su `/api/v1/network/patients/{id}/checkups*` con `checkups.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0056-network-observation-write-boundary.md](./adr/0056-network-observation-write-boundary.md) | Formalizza la slice write paired delle osservazioni: read/create/update/soft-delete su `/api/v1/network/patients/{id}/observations*` con `observations.version`, capability dedicate, audit PHI-safe e hard delete/AI/documenti fuori scope. |
| [docs/adr/0057-local-evidence-absorption-layer.md](./adr/0057-local-evidence-absorption-layer.md) | Proposed ADR `WUL-213`: local evidence absorption layer per rendere allegati e diario fonti citabili/retrieval sopra un contract versionato, senza training, cloud runtime o auto-write clinici. |
| [docs/adr/0058-manual-evidence-reabsorb-affordance.md](./adr/0058-manual-evidence-reabsorb-affordance.md) | Proposed ADR `WUL-220`: futura affordance manuale e auditabile per riassorbire una fonte evidence invalidated/superseded, con stati espliciti, motivi PHI-safe e nessuna scrittura clinica strutturata. |
| [docs/adr/0059-macos-apple-vision-ocr-fallback.md](./adr/0059-macos-apple-vision-ocr-fallback.md) | Formalizza il fallback OCR Apple Vision solo macOS: DeepSeek/Ollama resta OCR primario locale, Windows/Linux non hanno fallback platform-specific equivalente dichiarato, Smart Import resta reviewable. |

## Checklist manutenzione indice

1. Verifica inventario file: `rg --files -g '*.md' | sort`.
2. Assicurati che ogni file appaia in questo indice con una descrizione.
3. Aggiorna data "Ultimo aggiornamento".
4. Se cambiano priorità o fonti autorevoli, aggiorna anche [docs/README.md](./README.md).
