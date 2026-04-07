# Indice Completo Markdown (Repo)

> [!NOTE]
> GitHub mostra in alto solo alcuni file speciali (`README`, `CONTRIBUTING`, `SECURITY`, ecc.).
> Questo file elenca invece **tutti** i `.md` tracciati nella repository con una sintesi rapida d'uso.

Ultimo aggiornamento: 2026-04-04

## Come usare questo indice

- Se devi capire **quali file sono canonici**, parti da [docs/README.md](./README.md).
- Se devi trovare **dove sta un tema specifico**, usa le tabelle qui sotto.
- Se aggiungi/rimuovi/rinomini un `.md`, aggiorna subito questo file e [docs/README.md](./README.md).

## Orchestrazione e governance (consultazione sempre)

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | Regole globali per agent, vincoli e processo decisionale. | Sempre, prima di qualsiasi task. |
| [README.md](../README.md) | Onboarding generale progetto e punti di accesso documentazione. | Sempre, in fase di avvio. |
| [docs/README.md](./README.md) | Mappa canonica della documentazione (fonte autorevole per tema). | Sempre, per decidere precedenze. |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Visione architetturale stabile, confini e non-obiettivi. | Sempre, per cambi tecnici non banali. |
| [SECURITY.md](../SECURITY.md) | Policy sicurezza, threat model e regole redazione/logging. | Sempre, per qualunque cambio dati/API. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Workflow contributivo e Definition of Done. | Sempre, prima di chiudere un task. |
| [docs/linear-codex-playbook.md](./linear-codex-playbook.md) | Playbook operativo per orchestrare Linear, Codex e GitHub con tracciabilita end-to-end. | Quando imposti processi, naming issue/branch/PR e audit trail. |
| [PLANS.md](../PLANS.md) | Piano engineering operativo (2-6 settimane). | Sempre, per allineare priorità correnti. |
| [CHANGELOG.md](../CHANGELOG.md) | Storico release e cambiamenti rilevanti. | Al bisogno, per contesto versioni. |

## Architettura, flussi e parity

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/walkthrough.md](./walkthrough.md) | Walkthrough canonico end-to-end (web + native + servizi locali). | Per capire flussi completi e integrazione moduli. |
| [docs/topologia-dati-flussi.md](./topologia-dati-flussi.md) | Topologia dati, trust boundaries, cifratura e percorsi digitali. | Per analisi data flow e impatti sicurezza. |
| [docs/parity-matrix.md](./parity-matrix.md) | Stato parity web/macOS su moduli core e gap operativi. | Per steering parity e release readiness. |
| [docs/ARCHITETTURA.md](./ARCHITETTURA.md) | Deep dive tecnico esteso dell'architettura MediFlow. | Per approfondimenti implementativi. |
| [docs/system_architecture.md](./system_architecture.md) | Sintesi rapida dell'architettura operativa. | Per overview veloce in onboarding/review. |

## Native, setup e testing

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/NATIVE.md](./NATIVE.md) | Guida tecnica principale del client macOS SwiftUI, ora riferita allo snapshot pre-rebuild controllato. | Per capire il client esistente, il contratto da preservare e i vincoli del prossimo rebuild native. |
| [docs/native-setup.md](./native-setup.md) | Setup automatico ambiente client nativo. | Prima di avviare sviluppo/test native. |
| [docs/native-launch.md](./native-launch.md) | Avvio rapido app macOS via script/launcher. | Per esecuzione operativa locale. |
| [docs/local-api-tls.md](./local-api-tls.md) | TLS proxy locale e trasporto sicuro per native API. | Per debug networking/certificate pinning. |
| [docs/native-testing.md](./native-testing.md) | Strategia canonica test macOS (SwiftPM/XCTest/Xcode). | Per piani test e parity sweep. |
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
| [docs/COMPLIANCE.md](./COMPLIANCE.md) | Quadro compliance GDPR/FHIR e interoperabilità. | Per requisiti normativi e policy operative. |
| [docs/FSE2-terminology-roadmap.md](./FSE2-terminology-roadmap.md) | Roadmap codifiche cliniche FSE/EDS. | Per sviluppo terminologie e export documentale. |
| [docs/clinical-facts-benchmark-observations.md](./clinical-facts-benchmark-observations.md) | Benchmark v1 per facts osservazionali `LOINC/UCUM`, corpus sintetico e decisione `hybrid` default / `rules` fallback. | Quando si toccano osservazioni, import documentale codificato o decisioni di interoperabilità sui clinical facts. |
| [docs/fse-gtw-baseline-alignment.md](./fse-gtw-baseline-alignment.md) | Matrice di allineamento tra baseline ufficiale GTW/FSE e stato MediFlow. | Per gap analysis ministeriale, priorità FSE e anti-drift tecnico. |
| [docs/siss-baseline.md](./siss-baseline.md) | Baseline canonica SISS: stato attuale, target certificato, gap e sequenza di consegna. | Quando si lavora su `WUL-43`, `WUL-44` e `WUL-45`. |
| [docs/openmed-toolkit-evaluation.md](./openmed-toolkit-evaluation.md) | Valutazione comparativa tra OpenMed e lo stack AI locale MediFlow, con raccomandazione di fit per lane (`PII`, `NER`, runtime generativo). | Quando si esplorano toolkit AI esterni o si decide se introdurre sidecar locali specialistici. |
| [docs/openmed-redaction-benchmark.md](./openmed-redaction-benchmark.md) | Runbook operativo per eseguire il benchmark `WUL-96` della lane `redaction.v1` contro un sidecar locale OpenMed. | Quando serve avviare davvero il benchmark PII/redaction con healthcheck, env vars e comando benchmark dedicato. |
| [docs/clinical-entities-benchmark.md](./clinical-entities-benchmark.md) | Runbook operativo per eseguire la thin slice `clinical_entities.v1` con adapter benchmark-only locali, a partire da `HUMADEX`, e leggere le diagnostiche `missingEntities/unexpectedEntities`. | Quando serve misurare davvero `problem + medication` su corpus sintetico italiano senza toccare il runtime applicativo. |
| [docs/resolver-benchmark.md](./resolver-benchmark.md) | Runbook operativo per benchmarkare i resolver reali WHO ICD-11 e AIFA su corpus sintetici, con metriche su recall, ambiguità, latenza e mismatch di dosage/packaging. | Quando serve misurare i resolver locali veri prima di ritoccare Smart Import, coding o rollout AI. |
| [docs/patient-insight-benchmark.md](./patient-insight-benchmark.md) | Runbook operativo per misurare `AI Patient Insight` con corpus sintetico dedicato, scoring su focus/citations e validator locale anti-regressione. | Quando si toccano prompt, guardrail o context builder dell'insight e serve un benchmark piu utile del solo controllo JSON. |
| [docs/patient-insight-document-troubleshooting.md](./patient-insight-document-troubleshooting.md) | Runbook operativo locale per diagnosticare e recuperare i casi in cui allegati PDF o diario clinico non entrano correttamente nel contesto o nel render finale di `AI Patient Insight`. | Quando un caso reale mostra fallback, follow-up documentale assente o mismatch tra qualita del PDF e resa finale dell'insight. |
| [docs/document-intelligence-lab.md](./document-intelligence-lab.md) | Nota operativa per organizzare il document intelligence lab: corpus canonico `synthetic-only` in repo, vault locale privato fuori Git e shape minima dei casi multi-archetipo. | Quando si progettano nuovi archetipi documentali, shadow evaluation locale o benchmark cross-lane su document intelligence. |
| [docs/cloud-comparator-shadow-eval.md](./cloud-comparator-shadow-eval.md) | Runbook operativo per confrontare baseline locale e `gpt-5.4` su case pack privati redatti/minimizzati, con prompt emessi localmente, run opt-in, report di distillazione tassonomica, `localEvolutionAgenda` e review strutturato dell approccio documentale. | Quando serve un confronto cloud disciplinato che non contamini il runtime operativo o il corpus canonico. |
| [docs/ai-stack-reliability-review.md](./ai-stack-reliability-review.md) | Dossier tecnico trasversale sullo stato reale dello stack AI, sugli incidenti incontrati, sui benchmark gia eseguiti e sulle priorita di hardening. | Quando serve una vista unica su current state AI, colli di bottiglia, benchmark e prossime mosse affidabili. |
| [docs/ai-stack-execution-plan.md](./ai-stack-execution-plan.md) | Piano operativo work-package per portare a terra benchmark resolver, hardening Smart Import/Insight, lane PII e rollout prudente dello stack AI. | Quando serve passare dal dossier AI alla sequenza concreta di implementazione con dipendenze ed exit criteria. |
| [docs/ai-rollout-governance.md](./ai-rollout-governance.md) | Runbook canonico per shadow mode, fallback, rollback e kill-switch delle lane AI locali. | Quando serve giudicare se una lane AI puo restare `hold`, entrare in `shadow mode` o richiedere rollback. |
| [docs/MANUALE.md](./MANUALE.md) | Manuale utente medico. | Per supporto operativo lato clinico. |
| [oss-assets/README.md](../oss-assets/README.md) | Presentazione OSS e posizionamento progetto. | Per contesto pubblico/comunicazione. |

## Tracciabilità agent e metadoc

| File | Scopo | Quando consultarlo |
| --- | --- | --- |
| [docs/agent-attribution.md](./agent-attribution.md) | Registro contributi agent (Codex, altri). | Quando si aggiungono cambi non banali da agent. |
| [docs/markdown-index.md](./markdown-index.md) | Indice completo markdown con sintesi. | Per navigazione completa e controllo copertura doc. |
| [docs/openapi/README.md](./openapi/README.md) | Runbook operativo per manutenzione della spec OpenAPI `/api/v1`. | Quando si cambia il contratto client-facing o si fa review di drift. |

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

## Checklist manutenzione indice

1. Verifica inventario file: `rg --files -g '*.md' | sort`.
2. Assicurati che ogni file appaia in questo indice con una descrizione.
3. Aggiorna data "Ultimo aggiornamento".
4. Se cambiano priorità o fonti autorevoli, aggiorna anche [docs/README.md](./README.md).
