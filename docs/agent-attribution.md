<!-- Codex: created 2026-02-01 -->
# Agent Attribution

This log tracks contributions by non-Antigravity agents.
Entries are additive and minimal.

## 2026-03-31 Codex
- Added the `WUL-123` AI Patient Insight benchmark lane with a dedicated synthetic corpus, local scorer/validator, runbook, npm wiring, and plan/doc index updates so insight quality is now measured on focus, citations, preferred sources, stale leakage and incomplete-claim burden instead of JSON validity alone: `scripts/benchmark-patient-insight.ts`, `scripts/fixtures/patient-insight-benchmark-corpus.json`, `docs/patient-insight-benchmark.md`, `package.json`, `PLANS.md`, `docs/README.md`, `docs/markdown-index.md`, `docs/agent-attribution.md`
- Hardened the shared `Patient Insight` prompt contract against stale chronic-background leakage and fake citation placeholders, with regression coverage for the new prompt rules: `lib/ai-task-contracts.ts`, `lib/ai-task-contracts.test.ts`

## 2026-03-29 Codex
- Finalized the `v0.5.0` release hygiene pass by restoring source-only ESLint ignores, fixing `node --experimental-strip-types` module resolution in the benchmark runners, and bumping the repository version metadata to `0.5.0`: `eslint.config.mjs`, `scripts/benchmark-ai-task-contracts.ts`, `scripts/benchmark-smart-import.ts`, `scripts/benchmark-model-stack.ts`, `scripts/benchmark-model-parliament.ts`, `package.json`, `package-lock.json`
- Published the canonical `v0.5.0` release narrative across the repository entrypoints so README, changelog, plans, roadmap and docs map all reflect `v0.5.0` as the released baseline and move the next cycle to `post-v0.5`: `README.md`, `CHANGELOG.md`, `PLANS.md`, `docs/ROADMAP.md`, `docs/README.md`

## 2026-04-01 Codex
- Added the `WUL-130` thin slice for dev preview profiles by introducing a local registry persisted in `settings`, a global preview chrome/banner, Settings controls for selecting and reloading experimental stacks, profile-aware shell styling for the `Liquid Glass UI` preview, and isolated registry coverage: `lib/preview-profiles.ts`, `components/preview-profile-chrome.tsx`, `app/layout.tsx`, `app/settings/page.tsx`, `app/globals.css`, `lib/preview-profiles.test.ts`

## 2026-03-22 Codex
- Added a cross-stack AI reliability dossier that consolidates current runtime architecture, contract decisions, incidents, benchmarks, bottlenecks, and the recommended hardening path, and refreshed the canonical doc maps to reference it: `docs/ai-stack-reliability-review.md`, `docs/README.md`, `docs/markdown-index.md`
- Added an execution-layer AI work package plan and promoted it into the active engineering plan so the reliability dossier now maps to concrete sequencing, dependencies, exit criteria and stop-rules: `docs/ai-stack-execution-plan.md`, `PLANS.md`, `docs/README.md`, `docs/markdown-index.md`
- Added the first AI model parliament thin slice by exporting the reusable Smart Import benchmark runner, introducing a report-driven parliament/retention script for baseline-challenger-prune decisions, normalizing benchmark base URLs, surfacing the latest parliament artifact read-only in Settings, and recording the governance policy in ADR 0029 plus canonical indexes: `scripts/benchmark-smart-import.ts`, `scripts/benchmark-model-parliament.ts`, `scripts/benchmark-ai-task-contracts.ts`, `scripts/benchmark-model-stack.ts`, `scripts/ollama-base-url.ts`, `lib/ai-model-parliament-storage.ts`, `app/api/system/ai-parliament/route.ts`, `components/settings/ai-model-parliament-panel.tsx`, `app/settings/page.tsx`, `docs/adr/0029-ai-model-parliament-and-local-retention-policy.md`, `package.json`, `docs/README.md`, `docs/markdown-index.md`

## 2026-03-23 Codex
- Added the `WUL-96` thin slice by fixing the benchmark scope in ADR 0030, introducing the local `mediflow.redaction.v1` contract and a corpus-driven redaction benchmark scaffold for OpenMed-style sidecars without touching the runtime generative path: `docs/adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md`, `lib/redaction-contracts.ts`, `scripts/fixtures/redaction-benchmark-corpus.json`, `scripts/benchmark-redaction.ts`, `package.json`, `docs/README.md`, `docs/markdown-index.md`
- Extended the `WUL-96` redaction slice with a real OpenMed sidecar adapter for `openmed==0.6.2`, label-to-contract mapping into `mediflow.redaction.v1`, and per-case benchmark error handling so localhost `POST /pii/deidentify` can be exercised without touching app runtime paths: `scripts/openmed-redaction-adapter.ts`, `scripts/benchmark-redaction.ts`, `package.json`
- Added an operator-facing runbook and launcher script so the OpenMed redaction benchmark can be executed against a real local sidecar with a preflight healthcheck instead of ad hoc terminal steps: `docs/openmed-redaction-benchmark.md`, `scripts/run-openmed-redaction-benchmark.sh`, `docs/README.md`, `docs/markdown-index.md`
- Expanded the Italian synthetic redaction corpus and added a repeatable threshold-sweep runner for OpenMed, so confidence tuning is now reproducible instead of being derived from ad hoc shell invocations: `scripts/fixtures/redaction-benchmark-corpus.json`, `scripts/benchmark-redaction.ts`, `scripts/benchmark-redaction-threshold-sweep.ts`, `package.json`, `docs/openmed-redaction-benchmark.md`
- Tightened the OpenMed redaction adapter after real-sidecar inspection by normalizing `DATEOFBIRTH`, recovering phone-like values mislabeled as `BANKACCOUNT`, expanding partial address spans, and promoting `0.3` as the benchmark default threshold with updated runbook evidence from the latest real run: `scripts/openmed-redaction-adapter.ts`, `docs/openmed-redaction-benchmark.md`
- Extended `WUL-96` with email/PEC-focused corpus v3 coverage and richer per-case diagnostics (`leakedForbiddenTokens`, `missingEntities`), then refined OpenMed normalization again to recover phone-like numbers mislabeled as `npi`, making the remaining failures clearly attributable to model-side mailbox misses rather than adapter contract drift: `scripts/fixtures/redaction-benchmark-corpus.json`, `scripts/benchmark-redaction.ts`, `scripts/openmed-redaction-adapter.ts`, `docs/openmed-redaction-benchmark.md`
- Added `recallByType` aggregation to the redaction benchmark and recorded the first quantified model-side bottleneck (`email recall = 0.333` on corpus v3), so `WUL-96` now distinguishes broad lane health from the specific mailbox/email weakness blocking shadow-mode promotion: `scripts/benchmark-redaction.ts`, `docs/openmed-redaction-benchmark.md`
- Added an email-focused redaction corpus plus repeat/resilience runners, then verified that benchmark metrics stay stable across repeated warm runs while the local failure-path harness catches `500`, invalid payload, malformed offsets, and timeout conditions; this consolidates the benchmark stack even though OpenMed still fails the mailbox-heavy email segment: `scripts/fixtures/redaction-benchmark-email-corpus.json`, `scripts/benchmark-redaction-repeat.ts`, `scripts/benchmark-redaction-resilience.ts`, `package.json`, `docs/openmed-redaction-benchmark.md`
- Added explicit shadow-readiness validation for `WUL-96`, wiring strict gold-case stop-rules into runnable commands that pass on the gold adapter and fail on real OpenMed for the documented mailbox/email misses; this persists the current decision as `benchmark-only / not shadow-ready` instead of leaving it implicit in raw benchmark numbers: `scripts/benchmark-redaction-validate.ts`, `package.json`, `docs/openmed-redaction-benchmark.md`
- Persisted the `WUL-96` outcome into the active engineering plan and the shared model-candidate registry, so OpenMed PII no longer appears as a generic future integration candidate but as a benchmarked lane that is currently blocked by shadow-validation failures on email/mailbox recall: `PLANS.md`, `scripts/fixtures/ai-model-stack-candidates.json`
- Opened the next `WUL-96` thin slice for `clinical_entities.v1` by recording an ADR for the evidence-first `medication + problem` scope, adding the local contract, synthetic corpus, and dedicated benchmark harness with a gold adapter, without yet introducing real `HUMADEX/OpenMed NER` adapters or runtime integration: `docs/adr/0031-clinical-entities-evidence-first-medication-problem-lane.md`, `lib/clinical-entities-contracts.ts`, `scripts/fixtures/clinical-entities-benchmark-corpus.json`, `scripts/benchmark-clinical-entities.ts`, `package.json`, `docs/README.md`, `docs/markdown-index.md`
- Added the first real `clinical_entities.v1` execution path by wiring a benchmark-only local `HUMADEX` adapter through a Python runner, documenting the local setup/runbook, and extending the benchmark with `missingEntities` / `unexpectedEntities` diagnostics so real NER runs can be interpreted without touching the app runtime: `scripts/humadex-clinical-entities-runner.py`, `scripts/humadex-clinical-entities-adapter.ts`, `scripts/benchmark-clinical-entities.ts`, `docs/clinical-entities-benchmark.md`, `package.json`, `.gitignore`, `docs/README.md`, `docs/markdown-index.md`
- Completed the first real `HUMADEX` benchmark cycle for `clinical_entities.v1`, then tightened the runner with span-to-word reconstruction, medication dosage recovery, lane-specific merge rules, and explicit adapter disposal so the measured result is now persisted as a promising but still benchmark-only NER lane in the plan and model registry: `scripts/humadex-clinical-entities-runner.py`, `scripts/humadex-clinical-entities-adapter.ts`, `scripts/benchmark-clinical-entities.ts`, `docs/clinical-entities-benchmark.md`, `PLANS.md`, `scripts/fixtures/ai-model-stack-candidates.json`
- Extended the `clinical_entities` corpus to a stricter v2 policy, added a benchmark-only local `OpenMed NER` runner/adapter using `openmed==0.6.3` with disease+pharma models, and persisted the first comparative result (`HUMADEX` ahead of the OpenMed baseline, both still benchmark-only) into the runbook, active plan and candidate registry: `scripts/fixtures/clinical-entities-benchmark-corpus.json`, `scripts/openmed-clinical-entities-runner.py`, `scripts/openmed-clinical-entities-adapter.ts`, `package.json`, `.gitignore`, `docs/clinical-entities-benchmark.md`, `PLANS.md`, `scripts/fixtures/ai-model-stack-candidates.json`
- Added repeatability and promotion-gate tooling for `clinical_entities.v1`, then hardened the Python adapter teardown so multi-run benchmarks terminate cleanly and persisted the resulting decision on disk: both `HUMADEX` and `OpenMed NER` are stable across 5 runs but fail the promotion gate because of negative-case leaks and under-span critical problems, so the lane remains `benchmark-only`: `scripts/benchmark-clinical-entities-repeat.ts`, `scripts/benchmark-clinical-entities-validate.ts`, `scripts/humadex-clinical-entities-adapter.ts`, `scripts/openmed-clinical-entities-adapter.ts`, `package.json`, `docs/clinical-entities-benchmark.md`, `PLANS.md`, `scripts/fixtures/ai-model-stack-candidates.json`

## 2026-03-21 Codex
- Added the WUL-95 thin slice with a shared `mediflow.ai.extract.v1` envelope for patient insight, smart import and document synthesis, a local compact render path for insight markdown, and contract-focused parser coverage: `lib/ai-task-contracts.ts`, `lib/ai-task-contracts.test.ts`, `lib/ai-summary-service.ts`, `lib/patient-smart-import-service.ts`, `lib/document-synthesis-parser.ts`, `lib/document-synthesis-service.ts`, `scripts/ai-task-contracts-test.sh`, `tsconfig.ai-task-contracts-test.json`, `package.json`
- Added the first headless benchmark/validator corpus for AI task contracts on `qwen2.5:32b` and `qwen3:32b`, with JSON/contract-valid metrics and latency reporting: `scripts/fixtures/ai-task-contract-corpus.json`, `scripts/benchmark-ai-task-contracts.ts`, `package.json`
- Fixed the `qwen3:32b` reasoning-token regression by moving clinical AI calls to Ollama's native `/api/chat` path with `think: false`, preserving multimodal support and stabilizing benchmarked JSON validity/latency: `lib/ai-service.ts`
- Recorded the new contract decision on disk and refreshed the canonical doc indexes: `docs/adr/0027-ai-task-extraction-envelope-and-local-render.md`, `docs/README.md`, `docs/markdown-index.md`
- Added a stack-aware AI evaluation matrix, candidate registry and reusable benchmark orchestration so runnable `ollama` generators can be tested immediately while report models in PII/NER/encoder lanes remain explicitly blocked by adapter, license or gating constraints: `docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md`, `scripts/fixtures/ai-model-stack-candidates.json`, `scripts/benchmark-model-stack.ts`, `package.json`, `docs/README.md`, `docs/markdown-index.md`
- Added an exploratory comparison between OpenMed and the current MediFlow AI stack, documenting why OpenMed fits best as a local PII/redaction sidecar and not as a replacement for the existing generative contract/runtime: `docs/openmed-toolkit-evaluation.md`, `docs/README.md`, `docs/markdown-index.md`

## 2026-03-20 Codex
- Ported the WUL-20 native actor attribution follow-up onto a fresh `main`-based branch so shared routes now derive audit context from the request+token pair, local API auth exposes a reusable validity helper, native actor sessions prefer the real unlocked user when present, and the audit harness covers the new branch while staying runnable in isolated Node tests: `app/api/settings/[key]/route.ts`, `app/api/settings/route.ts`, `app/api/v1/patients/[id]/route.ts`, `app/api/v1/patients/route.ts`, `lib/audit.ts`, `lib/audit.test.ts`, `lib/local-api-auth.ts`, `lib/local-api-token.ts`, `lib/server-auth.ts`, `scripts/audit-test.sh`, `tsconfig.audit-test.json`
- Reworked the settings experience into a more coherent Apple-inspired shell with a liquid hero header, sticky family rail, grouped section hierarchy for account/AI/data/operations/backup, and more harmonious “floating island” spacing: `app/settings/page.tsx`
- Aligned the embedded settings panels to the same grouped/liquid visual language so diagnostics, catalog maintenance, service topology, scheduler and restore no longer feel like legacy islands inside the new shell: `components/settings/exemption-db-manager.tsx`, `components/diagnostic-hub.tsx`, `components/service-architecture-panel.tsx`, `components/backup-scheduler-ui.tsx`, `components/backup-restore-ui.tsx`
- Fixed the preview/auth refresh gap that left patient queries stale after unlocking on a fresh origin by invalidating live queries whenever the active client-side master key changes, and hardened the dev server session store so route modules share the same session map across HMR/module reloads: `components/security-provider.tsx`, `lib/server-session.ts`

## 2026-03-19 Codex
- Reworked the patient-detail readability layer toward an Apple-inspired, content-first hierarchy with lighter chrome, a more expressive Liquid-Glass-like surface language, centralized quick actions, progressive disclosure for secondary metadata, and simplified AI/archive/observation panels: `app/globals.css`, `app/patients/[id]/page.tsx`, `components/ai-patient-insight.tsx`, `components/document-insights-panel.tsx`, `components/observation-manager.tsx`
- Extended the same patient-UI slice to browse/create flows by replacing dense card-heavy listings with scan-friendly grouped rows, adding more tactile pill-and-glass interactions, and reshaping the patient form into grouped sections with lower visual noise: `components/patient-list.tsx`, `components/patient-form.tsx`
- Realigned release-hygiene documentation to the actual `main` state before the `0.4.0` push by tightening the active gate wording, switching the canonical verify loop to `npm run typecheck`, and marking ADR 0024 as accepted: `PLANS.md`, `CONTRIBUTING.md`, `docs/adr/0024-web-core-stabilization-before-next-version-bump.md`
- Extended the release-facing documentation so `v0.4.0` explicitly records the macOS freeze/rebuild decision and keeps README/roadmap/native guides aligned with the actual post-release plan: `README.md`, `CHANGELOG.md`, `PLANS.md`, `docs/README.md`, `docs/markdown-index.md`, `docs/ROADMAP.md`, `docs/NATIVE.md`, `docs/walkthrough.md`

## 2026-03-18 Codex
- Added canonical ADR for pre-version-bump web/core stabilization, fixing the maintenance sequence on disk around shared patient payload helpers, structured patient field parsing, `typecheck`, and incremental decomposition of `SecurityProvider`/`SettingsPage`: `docs/adr/0024-web-core-stabilization-before-next-version-bump.md`, `PLANS.md`, `docs/README.md`, `docs/markdown-index.md`
- Added the first implementation slice of ADR 0024 by extracting a shared patient write-normalization helper, wiring it into web and `/api/v1` patient create/update routes, and adding an isolated test harness for payload semantics: `lib/patient-write-normalization.ts`, `lib/patient-write-normalization.test.ts`, `scripts/patient-write-normalization-test.sh`, `tsconfig.patient-write-normalization-test.json`, `app/api/patients/route.ts`, `app/api/patients/[id]/route.ts`, `app/api/v1/patients/route.ts`, `app/api/v1/patients/[id]/route.ts`, `package.json`

## 2026-03-16 Codex
- Added operator-reviewed smart import from patient notes/diary/document insights into ICD-11 diagnosis and therapy suggestions, with local ICD/AIFA matching, dedupe-aware apply flow, and persistent patient-profile CTA: `lib/patient-smart-import-service.ts`, `components/patient-smart-import-panel.tsx`, `app/patients/[id]/page.tsx`, `app/api/drugs/route.ts`
- Added ADR for the new smart-import guardrails and updated canonical security/plan/walkthrough/topology docs to record the web-only, suggestion-first flow with no automatic free-text import: `docs/adr/0012-operator-reviewed-smart-import-from-patient-context.md`, `SECURITY.md`, `PLANS.md`, `docs/walkthrough.md`, `docs/topologia-dati-flussi.md`, `docs/markdown-index.md`
- Added ADR for the OCR-first AI pipeline decision, consolidating Qwen as the default text-only clinical model and limiting ICD autofill to explicit document codes: `docs/adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md`
- Reworked document synthesis into a structured OCR-first analysis flow (`summary`, quality, ICD suggestions) with prudent diagnosis autofill on patient records and context propagation to AI Patient Insight: `lib/document-synthesis-service.ts`, `lib/ai-context.ts`, `lib/db.ts`, `components/document-insights-panel.tsx`
- Added an explicit review path on new-patient document import: Qwen-derived ICD suggestions are prefilled into the patient form and surfaced with quality guidance before save: `components/pdf-importer.tsx`, `app/patients/new/page.tsx`, `lib/pdf-service.ts`, `lib/document-synthesis-service.ts`
- Realigned web and macOS AI defaults/UI presets toward `qwen2.5:32b` for text-only tasks while keeping `deepseek-ocr` separate for OCR: `lib/ai-service.ts`, `lib/ai-summary-service.ts`, `lib/ai-engine.ts`, `app/settings/page.tsx`, `native/MediFlowMac/Sources/MediFlowMac/Services/AISettingsResolver.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/AIControlPanelView.swift`
- Updated canonical documentation and indexing for the new OCR-first + Qwen flow: `docs/walkthrough.md`, `docs/topologia-dati-flussi.md`, `docs/markdown-index.md`
- Added ADR for `/api/v1` OpenAPI governance choosing a single `spec-first` strategy, with ownership/review/versioning rules and thin-slice follow-up: `docs/adr/0010-openapi-spec-first-for-api-v1.md`
- Published the first OpenAPI thin-slice baseline for stable read-only patient endpoints under the new canonical `/api/v1` contract source: `docs/openapi/mediflow-v1.yaml`
- Added an OpenAPI maintenance runbook to keep the spec synchronized with ongoing `/api/v1` development: `docs/openapi/README.md`
- Updated contributor workflow and DoD so `/api/v1` changes require same-diff contract documentation or explicit `no contract impact`: `CONTRIBUTING.md`
- Marked the OpenAPI strategy as accepted and linked ADR/spec/runbook from the canonical docs map, active engineering plan, and markdown inventory: `docs/adr/0010-openapi-spec-first-for-api-v1.md`, `docs/README.md`, `PLANS.md`, `docs/markdown-index.md`
- Added patient optimistic concurrency with `patients.version`, compare-on-write update/delete guards, and shared PHI-safe `409 VERSION_CONFLICT` payloads across web and `/api/v1` routes: `lib/schema.ts`, `lib/db-server.ts`, `drizzle/0004_patients_version_concurrency.sql`, `lib/patient-concurrency.ts`, `app/api/patients/[id]/route.ts`, `app/api/v1/patients/[id]/route.ts`
- Propagated patient `version` handling and conflict-aware mutation flows through the web data facade, edit UI, automation-side patient writers, and seed cleanup path: `lib/db.ts`, `app/patients/[id]/edit/page.tsx`, `lib/ai-summary-service.ts`, `lib/document-synthesis-service.ts`, `components/therapy-manager.tsx`, `lib/seeder.ts`
- Extended native macOS patient contracts and mutation client handling to require `version` and surface structured local API conflicts: `native/MediFlowMac/Sources/MediFlowMac/Models/Patient.swift`, `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift`, `native/MediFlowMac/Sources/MediFlowMac/ContentView.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/EditPatientView.swift`
- Expanded the canonical `/api/v1` OpenAPI slice to document patient mutation requests, `version` fields, and PHI-safe conflict metadata for compare-on-write semantics: `docs/openapi/mediflow-v1.yaml`
- Added an isolated cross-client patient concurrency suite with deterministic auth/bootstrap, explicit `update/update` + `update/delete` stale-version scenarios, JSON reporting, and npm entrypoints: `scripts/patient-concurrency.test.mjs`, `scripts/patient-concurrency-smoke.sh`, `package.json`
- Documented the patient concurrency runbook and wired it into the canonical docs/testing workflow: `docs/patient-concurrency-tests.md`, `docs/README.md`, `docs/markdown-index.md`, `CONTRIBUTING.md`
- Added an OpenAPI anti-drift guard with tracked undocumented-route policy, breaking overrides, and CI wiring for `/api/v1`: `scripts/check-openapi-drift.mjs`, `docs/openapi/contract-policy.json`, `.github/workflows/openapi-contract-guard.yml`

## 2026-03-11 Codex
- Deferred server-side `pdfjs-dist` loading behind a runtime loader with minimal Node shims to avoid Turbopack build warnings about optional `canvas` polyfills: `lib/pdfjs-server.ts`, `app/api/pdf-extract/route.ts`

## 2026-03-17 Codex
- Finalized the audit actor-attribution slice by propagating explicit `auth:*` audit metadata through logout/settings/patient mutation hooks, correcting native actor resolution to require a real unlocked session, and marking macOS requests with an explicit native source-surface header: `app/api/auth/logout/route.ts`, `app/api/settings/route.ts`, `app/api/settings/[key]/route.ts`, `app/api/patients/route.ts`, `app/api/patients/[id]/route.ts`, `app/api/v1/patients/route.ts`, `app/api/v1/patients/[id]/route.ts`, `lib/local-api-auth.ts`, `lib/server-auth.ts`, `lib/server-session.ts`, `lib/audit.ts`, `lib/audit.test.ts`, `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift`
- Added the minimum audit thin slice with append-only SQLite storage, PHI-safe writer/list helpers, admin audit view, auth/settings/patient mutation hooks across web and `/api/v1`, and an isolated audit test runner: `lib/schema.ts`, `lib/db-server.ts`, `lib/audit-db.ts`, `lib/audit.ts`, `lib/audit.test.ts`, `app/api/system/audit/route.ts`, `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `app/api/settings/route.ts`, `app/api/settings/[key]/route.ts`, `app/api/patients/route.ts`, `app/api/patients/[id]/route.ts`, `app/api/v1/patients/route.ts`, `app/api/v1/patients/[id]/route.ts`, `drizzle/0005_audit_events_append_only.sql`, `scripts/audit-test.sh`, `tsconfig.audit-test.json`, `package.json`, `.gitignore`, `PLANS.md`
- Added the minimum never-regress guardrail with runtime scans for hardcoded default credentials, non-local default endpoints, telemetry drift, and zero-knowledge invariants, plus CI/DoD wiring and explicit allowlist handling for documented exceptions: `scripts/check-never-regress.mjs`, `scripts/never-regress-allowlist.mjs`, `.github/workflows/never-regress-guard.yml`, `package.json`, `CONTRIBUTING.md`, `SECURITY.md`, `PLANS.md`
- Added the native exemptions thin slice with reusable selector/search/save support in patient create/edit, a shared exemption-code codec, and parity-matrix alignment: `native/MediFlowMac/Sources/MediFlowMac/Models/ExemptionCodesCodec.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/ExemptionSearchField.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/NewPatientView.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/EditPatientView.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/ExemptionCodesCodecTests.swift`, `docs/parity-matrix.md`
- Added backup artifact v1 with canonical manifest/checksum validation, server-side restore preflight, and direct SQLite reinsertion for the supported local API collections: `lib/backup-artifact.ts`, `app/api/system/backup-restore/route.ts`, `lib/db.ts`, `components/backup-restore-ui.tsx`, `docs/adr/0016-backup-artifact-v1-manifest-preflight.md`, `docs/walkthrough.md`, `docs/README.md`, `docs/markdown-index.md`, `PLANS.md`
- Finalized `WUL-10` restore preflight with a dedicated preflight engine, actionable filesystem/artifact checks, a focused test runner, and UI surfacing of structured remediation before any overwrite: `lib/backup-restore-preflight.ts`, `lib/backup-restore-preflight.test.ts`, `scripts/backup-restore-preflight-test.sh`, `tsconfig.backup-restore-preflight-test.json`, `app/api/system/backup-restore/route.ts`, `lib/db.ts`, `components/backup-restore-ui.tsx`, `package.json`
- Finalized the native secure-first token bootstrap slice with deterministic precedence (`Keychain -> config -> legacy`), explicit bootstrap failures, auth preflight in the macOS client, and XCTest coverage: `docs/adr/0014-native-token-bootstrap-secure-first.md`, `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPITokenProvider.swift`, `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift`, `native/MediFlowMac/Sources/MediFlowMac/Services/SettingsStore.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/LocalAPITokenProviderTests.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/LocalAPIClientAuthTests.swift`, `docs/walkthrough.md`, `docs/README.md`, `docs/markdown-index.md`
- Added typed native local-API error mapping for auth, TLS/transport, validation and contract mismatches, and covered the new diagnostics with focused XCTest cases: `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift`, `native/MediFlowMac/Sources/MediFlowMac/Services/SecuritySession.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/LocalAPIClientAuthTests.swift`
- Hardened Smart Import therapy parsing for WUL-79 by adding atomic therapy hints from notes, explicit suggestion states (`active|transition|uncertain|inactive`), stronger brand/principle-active AIFA matching on noisy strings, and targeted Playwright coverage for multi-therapy notes with blocked review-only suggestions: `lib/patient-smart-import-service.ts`, `components/patient-smart-import-panel.tsx`, `e2e/smart-import.spec.ts`
- Added ADR 0013 to persist the new default text-only model choice (`qwen3.5:35b-a3b`) while keeping MedGemma as a specialist manual option, and updated ADR 0011 to keep the OCR-first pipeline accepted while delegating the default-model choice to ADR 0013: `docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md`, `docs/adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md`
- Updated canonical walkthrough and markdown index to reflect the new default model and ADR supersession chain: `docs/walkthrough.md`, `docs/markdown-index.md`
- Added a one-time legacy AI settings upgrade toward `qwen3.5:35b-a3b`, tightened Patient Insight prompts/output, and promoted proactive next-step suggestions in the patient screen: `lib/ai-models.ts`, `lib/ai-service.ts`, `lib/ai-summary-service.ts`, `lib/ai-context.ts`, `components/ai-patient-insight.tsx`, `app/settings/page.tsx`, `app/patients/[id]/page.tsx`

## 2026-03-18 Codex
- Added the `WUL-44` prescription-panel SISS thin slice with a local handoff service/route, integrated therapy-panel UX, controlled browser handoff helper, and isolated orchestration tests: `lib/siss-prescription.ts`, `lib/siss-prescription.test.ts`, `app/api/siss/prescription/route.ts`, `components/siss-prescription-panel.tsx`, `components/therapy-manager.tsx`, `app/patients/[id]/page.tsx`, `lib/siss.ts`, `scripts/siss-prescription-test.sh`, `tsconfig.siss-prescription-test.json`, `package.json`
- Added the `WUL-45` SISS adapter foundation as a pure local contract with typed actions, stable error taxonomy, transient retry policy, portal-handoff transport, focused unit tests, and ADR/index updates: `lib/siss-adapter.ts`, `lib/siss-adapter.test.ts`, `scripts/siss-adapter-test.sh`, `tsconfig.siss-adapter-test.json`, `docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md`, `docs/README.md`, `docs/markdown-index.md`, `package.json`
- Added the thin-slice `WUL-66` AI Patient Insight settings layer with persisted full-auto/manual budgets, isolated helper tests, settings UI wiring, runtime budget application in context/generation, and ADR/index updates without reintroducing the stacked upload/OCR branch: `lib/ai-insight-settings.ts`, `lib/ai-insight-settings.test.ts`, `scripts/ai-insight-settings-test.sh`, `tsconfig.ai-insight-settings-test.json`, `app/settings/page.tsx`, `lib/ai-context.ts`, `lib/ai-summary-service.ts`, `docs/adr/0018-ai-insight-full-auto-and-pro-settings.md`, `docs/README.md`, `docs/markdown-index.md`, `package.json`
- Added a read-only AX parity probe for macOS click-map verification, plus npm/docs wiring for `WUL-21` strict parity runs without performing writes on the native dataset: `scripts/native-click-map-probe.swift`, `package.json`, `docs/native-testing.md`, `docs/parity-smoke.md`
- Implemented the first thin slice of ADR 0024 by extracting a shared patient write-normalization helper, wiring it into `POST`/`PUT` web and `/api/v1` patient routes, and adding isolated tests plus an npm runner for the drift-sensitive normalization rules: `lib/patient-write-normalization.ts`, `lib/patient-write-normalization.test.ts`, `app/api/patients/route.ts`, `app/api/patients/[id]/route.ts`, `app/api/v1/patients/route.ts`, `app/api/v1/patients/[id]/route.ts`, `scripts/patient-write-normalization-test.sh`, `tsconfig.patient-write-normalization-test.json`, `package.json`
- Implemented the second thin slice of ADR 0024 by extracting shared patient structured-field parsing/revival for `exemptions`, `diagnoses` and `documentInsights`, reusing it in `lib/db.ts` and `lib/ai-context.ts`, and adding isolated helper coverage plus ai-context regression compatibility: `lib/patient-structured-fields.ts`, `lib/patient-structured-fields.test.ts`, `lib/db.ts`, `lib/ai-context.ts`, `scripts/patient-structured-fields-test.sh`, `tsconfig.patient-structured-fields-test.json`, `tsconfig.ai-context-test.json`, `package.json`
- Implemented the third thin slice of ADR 0024 by fixing the Playwright typing regression blocking repository-wide TypeScript checks and adding a dedicated generated-artifact-safe gate config plus npm wiring: `e2e/patient-header.spec.ts`, `tsconfig.typecheck.json`, `package.json`
- Added the `WUL-45` SISS adapter foundation as a pure local contract with typed actions, stable error taxonomy, transient retry policy, portal-handoff transport, focused unit tests, and ADR/index updates: `lib/siss-adapter.ts`, `lib/siss-adapter.test.ts`, `scripts/siss-adapter-test.sh`, `tsconfig.siss-adapter-test.json`, `docs/adr/0025-siss-local-adapter-contract-and-error-taxonomy.md`, `docs/README.md`, `docs/markdown-index.md`, `package.json`
- Implemented the fourth thin slice of ADR 0024 by extracting the inactivity auto-lock lifecycle from `SecurityProvider` into a dedicated client hook, preserving the existing auth/logout behavior while shrinking the provider shell, and by hardening the E2E unlock bootstrap to wait for the lock overlay to disappear before continuing: `lib/hooks/use-inactivity-lock.ts`, `components/security-provider.tsx`, `e2e/utils.ts`
- Implemented the fifth thin slice of ADR 0024 by extracting client-side security session persistence, restore and clear helpers out of `SecurityProvider`, while keeping auth fetches and provider state transitions in place: `lib/client-security-session.ts`, `components/security-provider.tsx`
- Implemented the sixth thin slice of ADR 0024 by extracting the client auth API wrappers and shared auth-health payload typing out of `SecurityProvider`, while keeping provider-side state branching and crypto unwrap local: `lib/client-auth-api.ts`, `components/auth-health-screen.tsx`, `components/security-provider.tsx`
- Implemented the seventh thin slice of ADR 0024 by extracting the AI settings controller state, load/save and health-test flows out of `SettingsPage`, while keeping the current markup and inline model selector intact: `lib/hooks/use-ai-settings-controller.ts`, `app/settings/page.tsx`
- Added `WUL-29` zero-knowledge PIN rotation on the stabilized auth shell: server route, client re-wrap helper/tests, auth client wiring, `SecurityProvider` integration, settings UI, and ADR/index updates: `app/api/auth/change-pin/route.ts`, `lib/pin-change.ts`, `lib/pin-change.test.ts`, `lib/client-auth-api.ts`, `components/security-provider.tsx`, `app/settings/page.tsx`, `scripts/pin-change-test.sh`, `tsconfig.pin-change-test.json`, `docs/adr/0026-pin-rotation-via-client-side-rewrap.md`, `docs/README.md`, `docs/markdown-index.md`, `package.json`
- Added the first thin slice for `WUL-83` with a synthetic observations corpus, local benchmark runner, persisted benchmark decision (`hybrid` default / `rules` fallback), and canonical docs updates: `scripts/fixtures/clinical-facts-observation-corpus.json`, `scripts/benchmark-observation-facts.mjs`, `package.json`, `docs/clinical-facts-benchmark-observations.md`, `docs/README.md`, `docs/markdown-index.md`
- Added the first thin slice for `WUL-59` by persisting explicit document medications from the clinical model into `documentInsights.extractedData.medications`, surfacing them in the Smart Archive UI, and isolating the JSON parser in a pure testable helper: `lib/document-synthesis-parser.ts`, `lib/document-synthesis-service.ts`, `lib/document-synthesis-service.test.ts`, `components/document-insights-panel.tsx`
- Added the first thin slice for `WUL-43` by codifying the canonical SISS baseline, current portal-shortcut state, explicit gaps, and the delivery sequence toward `WUL-45` then `WUL-44`: `docs/siss-baseline.md`, `docs/README.md`, `docs/markdown-index.md`
- Added isolated FSE validation coverage for the profile-driven pre-export rules by extracting injectable ATC lookup helpers and wiring a dedicated `node:test` runner for therapy/observation severity semantics and unsupported-profile handling: `lib/fse-validation.ts`, `lib/fse-validation.test.ts`, `scripts/fse-validation-test.sh`, `tsconfig.fse-validation-test.json`, `package.json`
- Added the first terminology registry thin slice by persisting canonical system/version metadata in `settings`, wiring `/api/v1/terminology/*` to the active registry version, and documenting the storage decision in ADR 0021: `lib/terminology-registry.ts`, `lib/terminology-registry.test.ts`, `app/api/v1/terminology/systems/route.ts`, `app/api/v1/terminology/search/route.ts`, `app/api/v1/terminology/resolve/route.ts`, `docs/adr/0021-terminology-registry-in-settings-json.md`, `docs/README.md`, `docs/markdown-index.md`
- Added the first PHI-safe audit dashboard slice by summarizing local `audit_events` into operational KPIs and surfacing them on the existing analytics page without changing the `/api/v1` contract or audit schema: `lib/audit.ts`, `lib/audit.test.ts`, `app/api/system/audit/route.ts`, `app/analytics/page.tsx`
- Added `WUL-31` backup retention with scheduler-owned `keep-last-N` cleanup helpers, dry-run/apply actions, tracked cleanup metadata, runner integration, smoke coverage, and ADR 0023: `lib/backup-scheduler.ts`, `lib/backup-scheduler.test.ts`, `app/api/system/backup-scheduler/route.ts`, `components/backup-scheduler-ui.tsx`, `scripts/run-scheduled-backup.mjs`, `scripts/backup-scheduler-test.sh`, `docs/adr/0023-backup-retention-policy-keep-last-n.md`, `docs/README.md`, `docs/markdown-index.md`, `docs/walkthrough.md`, `PLANS.md`

## 2026-03-03 Codex
- Hardened OSS export privacy filter to always exclude Linear orchestration/import artifacts from public export bundles: `scripts/prepare-oss.js`
- Added canonical Linear+Codex operational playbook for planning/coding/audit orchestration (MCP setup, GitHub linking, naming conventions, issue template, routine): `docs/linear-codex-playbook.md`
- Added `@linear/import` execution guide in the playbook (CLI flow, prompt choices, project-wise import runbook): `docs/linear-codex-playbook.md`
- Added seed-to-LinearCSV converter script and npm command for repeatable imports: `scripts/prepare-linear-import.mjs`, `package.json`
- Added automated import runner for `@linear/import` using `expect` to process all project CSV streams in sequence (`LINEAR_API_KEY` + optional team/project overrides): `scripts/linear-import-all.sh`, `package.json`
- Added direct GraphQL importer (`linear:import:api`) to bypass interactive CLI limitations and import CSV backlog into target Linear team/project with dedupe + auto-label creation: `scripts/linear-import-via-api.mjs`, `package.json`
- Generated import-ready CSV artifacts (all + per project stream): `docs/linear-import-open.linear.csv`, `docs/linear-import-open.mf-core-q2.linear.csv`, `docs/linear-import-open.mf-parity-q2.linear.csv`, `docs/linear-import-open.mf-fse-q2.linear.csv`
- Updated canonical documentation map with source-of-truth ownership for Linear+Codex workflow and refreshed metadata date: `docs/README.md`
- Updated full markdown inventory with the new playbook entry and refreshed metadata date: `docs/markdown-index.md`
- Added structural Codex MCP validation script for apple-docs (`codex mcp get` + version pin enforcement) and wired it to npm scripts: `scripts/codex-mcp-apple-docs-validate.sh`, `package.json`
- Added robust runtime smoke script for apple-docs-mcp with bounded startup timeout (prevents hanging checks) and wired it as the project test entrypoint: `scripts/mcp-apple-docs-smoke.mjs`, `package.json`
- Updated Apple Docs MCP guide to document dual validation levels (`validate` vs runtime smoke) for repeatable cross-project setup: `docs/apple-docs-mcp.md`

## 2026-03-11 Codex
- Added patient-side cleanup actions for Smart Archive (`remove single` + `clear all`) with immediate persistence and AI summary refresh after archive changes: `components/document-insights-panel.tsx`
- Aligned AI context building so an explicitly emptied Smart Archive no longer falls back to stale attachment summaries for the same patient: `lib/ai-context.ts`

## 2026-02-27 Codex
- Extended Apple Docs MCP integration guide with Codex-native setup commands (`codex mcp add/list/get/remove`) and troubleshooting note for network/proxy resolution failures: `docs/apple-docs-mcp.md`

## 2026-02-26 Codex
- Added Apple docs MCP developer integration guide with project guardrails (dev-only, no PHI/PII in queries), version pinning, MCP config snippet, and MediFlow-oriented workflow/templates: `docs/apple-docs-mcp.md`
- Added npm smoke-check command for the pinned Apple docs MCP server version: `package.json`
- Registered the new guide in canonical document maps/indexes and refreshed metadata dates: `docs/README.md`, `docs/markdown-index.md`

## 2026-02-20 Codex
- Added private-only OSS export playbook documenting private/public repo model, filtering rules, markdown reference sanitization, and release checklist: `docs/private/oss-export-playbook.md`
- Added OSS export hardening workflow with npm entrypoint and docs: `package.json`, `CONTRIBUTING.md`
- Enhanced OSS preparation script with path-based exclusions and markdown reference sanitization (broken private refs downgraded to ` (private)`), plus `.mjs` wrapper alignment to single source logic: `scripts/prepare-oss.js`, `scripts/prepare-oss.mjs`
- Strengthened documentation cross-reference system: made `docs/README.md` the explicit consult-policy map, upgraded `docs/markdown-index.md` to a full descriptive inventory (including ADR 0009), and added maintenance rules for `.md` changes: `AGENTS.md`, `README.md`, `docs/README.md`, `docs/markdown-index.md`, `CONTRIBUTING.md`
- Added/normalized internal doc links across canonical technical/operational guides to improve agent navigation between architecture, security, parity, native setup/testing, and planning docs: `ARCHITECTURE.md`, `SECURITY.md`, `PLANS.md`, `docs/walkthrough.md`, `docs/topologia-dati-flussi.md`, `docs/ARCHITETTURA.md`, `docs/system_architecture.md`, `docs/NATIVE.md`, `docs/native-testing.md`, `docs/native-setup.md`, `docs/native-launch.md`, `docs/e2e-smoke.md`, `docs/local-api-tls.md`, `docs/icd-local-setup.md`, `docs/COMPLIANCE.md`, `docs/FSE2-terminology-roadmap.md`, `docs/parity-matrix.md`, `docs/ROADMAP.md`, `docs/product_roadmap.md`, `docs/MANUALE.md`
- Added web smoke E2E scaffolding with Playwright config and first unlock/setup + navigation flow: `playwright.config.ts`, `e2e/web-smoke.spec.ts`
- Added isolated smoke orchestrator script (`MEDIFLOW_DATA_DIR` scoped) and npm commands for repeatable local/VM runs: `scripts/e2e-smoke.sh`, `package.json`, `.gitignore`
- Added macOS accessibility identifiers for parity click-path automation in patient list and patient detail surfaces: `native/MediFlowMac/Sources/MediFlowMac/ContentView.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift`
- Added macOS patient parity actions (`edit/archive/delete`) with toolbar + context-menu flows and dedicated edit form wired to `/api/v1/patients/:id`: `native/MediFlowMac/Sources/MediFlowMac/ContentView.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/EditPatientView.swift`
- Extracted patient list filter/sort logic into testable Swift module and wired ContentView to shared helper: `native/MediFlowMac/Sources/MediFlowMac/PatientsFiltering.swift`, `native/MediFlowMac/Sources/MediFlowMac/ContentView.swift`
- Added first native XCTest suite for patient filter/sort parity semantics in SwiftPM test target: `native/MediFlowMac/Package.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/PatientsFilteringTests.swift`
- Added native testing runner script and npm commands for `swift test` / `xcodebuild test`: `scripts/native-test.sh`, `package.json`
- Added ADR and canonical guide for macOS testing strategy (XCTest/Xcode-first): `docs/adr/0009-native-testing-strategy-xcode-xctest.md`, `docs/native-testing.md`
- Added unified parity smoke runner with lane gating and artifact summary output: `scripts/parity-smoke.sh`
- Added manual click-map checklist and parity smoke runbook for macOS/web combined sweeps: `docs/parity-click-map-macos.md`, `docs/parity-smoke.md`
- Improved parity smoke behavior when Playwright is missing: web lane is now `SKIPPED` (or `FAIL` only in strict mode) with explicit log artifact: `scripts/parity-smoke.sh`
- Split lint scripts into quiet default and full-warning mode: `package.json`
- Added operational guide for smoke harness and VM execution model: `docs/e2e-smoke.md`
- Updated canonical docs index and parity plan sequencing with smoke-harness stabilization item: `docs/README.md`, `PLANS.md`
- Stabilized web smoke auth determinism by adding E2E DB bootstrap (known admin/PIN), wiring it into smoke runner, hardening lock-screen locators, and removing duplicated lock overlay mount from root layout: `scripts/prepare-e2e-db.mjs`, `scripts/e2e-smoke.sh`, `e2e/web-smoke.spec.ts`, `app/layout.tsx`, `docs/e2e-smoke.md`

## 2026-02-19 Codex
- Added full repository Markdown index (all tracked `.md`) for GitHub navigation fallback and linked it from canonical doc entrypoints: `docs/markdown-index.md`, `README.md`, `docs/README.md`
- Fixed Mermaid compatibility in `ARCHITECTURE.md` by quoting graph labels/subgraph titles and preserving the same architecture mapping.
- Added canonical data topology and end-to-end flow mapping with Mermaid diagrams (system topology, data-at-rest path, ER model, auth/web/native/OCR sequences): `docs/topologia-dati-flussi.md`
- Linked the new canonical topology/flows document from primary doc indexes: `docs/README.md`, `README.md`, `docs/walkthrough.md`, `ARCHITECTURE.md`
- Added ADR for strict web/macOS parity as explicit release gate (same functions, fields, flexibility, operational autonomy): `docs/adr/0007-strict-web-native-parity-gate.md`
- Superseded ADR 0007 and marked status accordingly: `docs/adr/0007-strict-web-native-parity-gate.md`
- Added ADR for operational cadence `web-first + parity sweep periodici` on macOS: `docs/adr/0008-web-first-with-parity-sweeps.md`
- Added canonical baseline parity matrix for core modules (API/UI/campi/flessibilita/indipendenza) with gap inventory and exit criteria: `docs/parity-matrix.md`
- Updated parity matrix with explicit operating cadence and ADR 0008 reference: `docs/parity-matrix.md`
- Updated active engineering plan to reference ADR 0008 and marked `P0` parity matrix as completed: `PLANS.md`
- Registered parity matrix as canonical source in docs index and updated metadata date: `docs/README.md`

## 2026-02-18 Codex
- Added canonical documentation index: `docs/README.md`
- Updated developer doc entrypoint in `README.md` to reference canonical docs order
- Realigned canonical read-order in `docs/README.md` to match boot-sequence precedence (`README` then `AGENTS`)
- Added explicit `FSE2` roadmap reference in canonical docs map: `docs/README.md`, `README.md`
- Fixed `PLANS.md` metadata date to reflect today's update (`2026-02-18`)
- Updated visible release headers from `0.3.0` to `0.3.1` in `README.md` and `docs/ROADMAP.md`
- Added comprehensive `0.3.1` changelog entry with 2026-02-17/2026-02-18 timeline and OpenHospital tribute framing: `CHANGELOG.md`
- Marked `docs/product_roadmap.md` as deprecated alias to `docs/ROADMAP.md`
- Clarified canonical product roadmap note in `docs/ROADMAP.md`
- Added `SECONDARY` status label to `docs/ARCHITETTURA.md`
- Added `SECONDARY` status label to `docs/system_architecture.md`
- Added `CANONICAL` status label to `docs/walkthrough.md`
- Added `LEGACY` status label to `docs/index.html` embedded architecture page
- Extended `docs/README.md` with `CANONICAL/SECONDARY/LEGACY` convention and status matrix
- Realigned developer docs read-order in `README.md` to match canonical source precedence
- Hardened web patient update/delete route with explicit field whitelist and relation sync: `app/api/patients/[id]/route.ts`
- Added canonical status normalization helper and applied it to web/v1 therapies + checkups routes: `lib/status-normalization.ts`
- Aligned native status handling and picker values to canonical contract with legacy fallback rendering: `native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift`
- Hardened web item routes with 404 + stricter date/status validation: `app/api/entries/[id]/route.ts`
- Hardened web item routes with 404 + stricter date/status validation: `app/api/therapies/[id]/route.ts`
- Hardened web item routes with 404 + stricter date/status validation: `app/api/checkups/[id]/route.ts`
- Hardened ambulatories create/update/delete APIs with explicit validation and default conflict handling: `app/api/ambulatories/route.ts`
- Hardened ambulatories create/update/delete APIs with explicit validation and default conflict handling: `app/api/ambulatories/[id]/route.ts`
- Added shared ID normalization helper for bulk patient operations: `lib/patient-bulk-validation.ts`
- Hardened bulk patient assign/unassign/move/duplicate APIs with strict payload and existence validation: `app/api/patients/assign/route.ts`
- Hardened bulk patient assign/unassign/move/duplicate APIs with strict payload and existence validation: `app/api/patients/unassign/route.ts`
- Hardened bulk patient assign/unassign/move/duplicate APIs with strict payload and existence validation: `app/api/patients/move/route.ts`
- Hardened bulk patient assign/unassign/move/duplicate APIs with strict payload and existence validation: `app/api/patients/duplicate/route.ts`
- Enforced single-default invariant on ambulatory creation and validated parent linkage on create: `app/api/ambulatories/route.ts`
- Added guarded ambulatory delete semantics (linked-patient conflict + default fallback rules): `app/api/ambulatories/[id]/route.ts`
- Added ADR 0006 for terminology plugin strategy and FSE profile validation path: `docs/adr/0006-terminology-plugin-and-fse-profiles.md`
- Added terminology contract endpoints and static pilot resolver (systems/search/resolve): `app/api/v1/terminology/*`, `lib/terminology.ts`
- Added AIC+ATC first-class therapy support across schema, web/v1 APIs, and native contracts: `lib/schema.ts`, `app/api/therapies/*`, `app/api/v1/patients/[id]/therapies/*`, `native/MediFlowMac/Sources/MediFlowMac/*`
- Added observations thin slice (`LOINC + UCUM`) across schema, web APIs/UI, v1 APIs, FHIR export, and native client contracts: `lib/schema.ts`, `app/api/observations/*`, `components/observation-manager.tsx`, `app/api/v1/patients/[id]/observations/*`, `lib/fhir/*`, `native/MediFlowMac/Sources/MediFlowMac/*`
- Added shared FSE validation library and web export pre-check flow (`error` blocks, `warning` confirm): `lib/fse-validation.ts`, `app/api/fse/validate-patient/route.ts`, `app/patients/[id]/edit/page.tsx`
- Added discoverability guardrail in Definition of Done and aligned export UI labels to explicit `FHIR/FSE` wording: `CONTRIBUTING.md`, `app/patients/[id]/edit/page.tsx`, `components/patient-action-modal.tsx`
- Added `Export FHIR` CTA in patient detail page with same pre-check FSE flow used by edit page; fixed export modal to show only export-specific content: `app/patients/[id]/page.tsx`, `components/patient-action-modal.tsx`

## 2026-02-01 Codex
- Added ADR for native macOS client approach: docs/adr/0001-native-macos-client.md
- Added this attribution log: docs/agent-attribution.md
- Added local API auth helper for native endpoints: lib/local-api-auth.ts
- Added v1 API types for native client contracts: lib/api/v1/types.ts
- Added read-only v1 patients endpoints: app/api/v1/patients/route.ts
- Added read-only v1 patient detail endpoint: app/api/v1/patients/[id]/route.ts
- Added native SwiftUI macOS prototype scaffold: native/MediFlowMac/Package.swift
- Added native SwiftUI views and models: native/MediFlowMac/Sources/MediFlowMac/ContentView.swift
- Added native SwiftUI app entry point: native/MediFlowMac/Sources/MediFlowMac/MediFlowMacApp.swift
- Added native models and API client: native/MediFlowMac/Sources/MediFlowMac/Models/Patient.swift
- Added native API client: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Added native patient detail view: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Added local API TLS proxy script: scripts/local-api-tls-proxy.mjs
- Added local TLS setup doc: docs/local-api-tls.md
- Added v1 ambulatories endpoint: app/api/v1/ambulatories/route.ts
- Added native settings UI for TLS/token/base URL: native/MediFlowMac/Sources/MediFlowMac/Views/SettingsView.swift
- Added native Keychain token store: native/MediFlowMac/Sources/MediFlowMac/Services/KeychainService.swift
- Added native settings store: native/MediFlowMac/Sources/MediFlowMac/Services/SettingsStore.swift
- Added native local API settings constants: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPISettings.swift
- Updated native API client for HTTPS + pinning: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Updated native content view for settings and errors: native/MediFlowMac/Sources/MediFlowMac/ContentView.swift
- Updated native patient detail error handling: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Updated API v1 types with ambulatories: lib/api/v1/types.ts
- Added TLS proxy npm script: package.json
- Updated native models with ambulatories: native/MediFlowMac/Sources/MediFlowMac/Models/Patient.swift
- Added ambulatory selection and reload flow: native/MediFlowMac/Sources/MediFlowMac/ContentView.swift
- Added connection test in settings: native/MediFlowMac/Sources/MediFlowMac/Views/SettingsView.swift
- Updated settings store to validate/save for testing: native/MediFlowMac/Sources/MediFlowMac/Services/SettingsStore.swift
- Updated local API client for ambulatory filtering and test: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Added selected ambulatory persistence: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPISettings.swift
- Added ambulatory filtering to v1 patients endpoint: app/api/v1/patients/route.ts
- Added automated native setup script: scripts/native-setup.sh
- Added native setup guide: docs/native-setup.md
- Added bootstrap config loader: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIBootstrap.swift
- Updated settings store to auto-apply bootstrap: native/MediFlowMac/Sources/MediFlowMac/Services/SettingsStore.swift
- Added macOS menu bar commands and settings scene: native/MediFlowMac/Sources/MediFlowMac/MediFlowMacApp.swift
- Added native app bundle builder: scripts/build-native-app.sh
- Added double-click launcher script: scripts/Launch_MediFlowMac.command
- Added native launch guide: docs/native-launch.md
- Ignored Swift build/app bundle outputs: .gitignore
- Redesigned patient detail UI with structured sections: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Added v1 clinical endpoints for patients (entries/therapies/checkups): app/api/v1/patients/[id]/entries/route.ts
- Added v1 clinical endpoints for patients (entries/therapies/checkups): app/api/v1/patients/[id]/therapies/route.ts
- Added v1 clinical endpoints for patients (entries/therapies/checkups): app/api/v1/patients/[id]/checkups/route.ts
- Added clinical DTOs in v1 types: lib/api/v1/types.ts
- Extended patient summary with ADI/archived flags: app/api/v1/patients/route.ts
- Extended native models for clinical sections: native/MediFlowMac/Sources/MediFlowMac/Models/Patient.swift
- Extended native API client for clinical data: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Added tag view for list badges: native/MediFlowMac/Sources/MediFlowMac/Views/TagView.swift
- Improved patient list with badges and update recency: native/MediFlowMac/Sources/MediFlowMac/ContentView.swift
- Added clinical sections to patient detail view: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Fixed SwiftUI accent color usage: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Cleaned Keychain query warning: native/MediFlowMac/Sources/MediFlowMac/Services/KeychainService.swift
- Updated TLS pinning to avoid deprecated API: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Fixed SwiftUI accent color fallback for older toolchains: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Added native crypto service for PIN-based encryption: native/MediFlowMac/Sources/MediFlowMac/Services/CryptoService.swift
- Added native security session with PIN unlock: native/MediFlowMac/Sources/MediFlowMac/Services/SecuritySession.swift
- Added native lock screen view: native/MediFlowMac/Sources/MediFlowMac/Views/LockScreenView.swift
- Added native new patient form: native/MediFlowMac/Sources/MediFlowMac/Views/NewPatientView.swift
- Added native tools view (AI/Farmaci/ICD): native/MediFlowMac/Sources/MediFlowMac/Views/ToolsView.swift
- Updated native app entry for security session + lock command: native/MediFlowMac/Sources/MediFlowMac/MediFlowMacApp.swift
- Updated native content view for unlock + new patient + tools: native/MediFlowMac/Sources/MediFlowMac/ContentView.swift
- Updated patient detail to decrypt encrypted fields: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Expanded native API client (auth, settings, AI, drugs, ICD, create patient): native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Added v1 patients POST with ambulatory assignment: app/api/v1/patients/route.ts
- Added ADR for native security and modules: docs/adr/0002-native-security-and-modules.md
- Added v1 POST endpoints for patient entries: app/api/v1/patients/[id]/entries/route.ts
- Added v1 POST endpoints for patient therapies: app/api/v1/patients/[id]/therapies/route.ts
- Added v1 POST endpoints for patient checkups: app/api/v1/patients/[id]/checkups/route.ts
- Added AI settings resolver for native client: native/MediFlowMac/Sources/MediFlowMac/Services/AISettingsResolver.swift
- Updated tools view to reuse AI settings resolver: native/MediFlowMac/Sources/MediFlowMac/Views/ToolsView.swift
- Added drug search field view: native/MediFlowMac/Sources/MediFlowMac/Views/DrugSearchField.swift
- Added ICD search field view: native/MediFlowMac/Sources/MediFlowMac/Views/ICDSearchField.swift
- Added native new entry view: native/MediFlowMac/Sources/MediFlowMac/Views/NewEntryView.swift
- Added native new therapy view: native/MediFlowMac/Sources/MediFlowMac/Views/NewTherapyView.swift
- Added native new checkup view: native/MediFlowMac/Sources/MediFlowMac/Views/NewCheckupView.swift
- Expanded native patient detail with AI + create actions: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Expanded native API client for write operations and AI config: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Added ADR for native write and clinical tools: docs/adr/0003-native-write-clinical-ai.md
- Fixed SwiftPM tools-version header order: native/MediFlowMac/Package.swift

## 2026-02-02 Codex
- Fixed ForEach id typo in new entry view: native/MediFlowMac/Sources/MediFlowMac/Views/NewEntryView.swift
- Added native AI control panel UI and diagnostics: native/MediFlowMac/Sources/MediFlowMac/Views/AIControlPanelView.swift
- Added AI control tab and reasoning chat option: native/MediFlowMac/Sources/MediFlowMac/Views/ToolsView.swift
- Extended native AI settings resolver for reasoning/OCR: native/MediFlowMac/Sources/MediFlowMac/Services/AISettingsResolver.swift
- Added native API client support for AI settings, models, OCR, MLX control: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift

## 2026-02-06 Codex
- Added reusable floating glass panel window with traffic-light controls and collapse/expand motion: native/MediFlowMac/Sources/MediFlowMac/Views/GlassPanelWindow.swift
- Applied floating panel shell to settings/new-patient sheets: native/MediFlowMac/Sources/MediFlowMac/ContentView.swift
- Redesigned patient detail into conceptual islands and added dedicated AI Studio sheet: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Removed duplicate form titles now managed by panel header chrome: native/MediFlowMac/Sources/MediFlowMac/Views/NewPatientView.swift
- Removed duplicate form titles now managed by panel header chrome: native/MediFlowMac/Sources/MediFlowMac/Views/NewEntryView.swift
- Removed duplicate form titles now managed by panel header chrome: native/MediFlowMac/Sources/MediFlowMac/Views/NewTherapyView.swift
- Removed duplicate form titles now managed by panel header chrome: native/MediFlowMac/Sources/MediFlowMac/Views/NewCheckupView.swift
- Tuned motion/transparency for floating panels and patient concept islands, including reduce-motion fallbacks: native/MediFlowMac/Sources/MediFlowMac/Views/GlassPanelWindow.swift
- Tuned backdrop drift, island reveal timing, hover lift, and reduced decorative glass density: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Added exemptions lookup table and patient exemptions field in schema + DB runtime guardrails: lib/schema.ts
- Added exemptions lookup table and patient exemptions field in schema + DB runtime guardrails: lib/db-server.ts
- Added explicit migration for exemptions table and patient field: drizzle/0001_exemptions_lookup.sql
- Added canonical GTW/FSE baseline alignment matrix against official `it-fse-support` artifacts and updated the docs map/index: docs/fse-gtw-baseline-alignment.md, docs/README.md, docs/markdown-index.md
- Added local exemptions API (search, count, import, clear) with session/token auth: app/api/exemptions/route.ts
- Added exemptions importer/parser for TXT pipelines and stats helpers: lib/exemption-importer.ts
- Added settings UI manager for drag-and-drop exemptions catalog updates: components/settings/exemption-db-manager.tsx
- Added patient-form exemptions selector with searchable code lookup: components/exemption-selector.tsx
- Added web patient form/storage wiring for encrypted exemptions codes: components/patient-form.tsx
- Added exemptions visibility in patient detail web card: app/patients/[id]/page.tsx
- Added API contract propagation for patient exemptions in web/native v1 endpoints and types: app/api/v1/patients/[id]/route.ts
- Added native model/payload/detail rendering support for patient exemptions: native/MediFlowMac/Sources/MediFlowMac/Models/Patient.swift
- Added ADR for exemptions catalog architecture and patient mapping: docs/adr/0004-exemptions-catalog.md
- Improved exemptions selector UX to detect empty catalog and prompt import from settings: components/exemption-selector.tsx
- Added ADR for full web/native parity on shared local API contract: docs/adr/0005-web-native-functional-parity.md
- Added versioned v1 drugs API (search/count/import/clear): app/api/v1/drugs/route.ts
- Added versioned v1 exemptions API (search/filter/count/import/clear): app/api/v1/exemptions/route.ts
- Extended shared v1 DTOs for drugs and exemptions: lib/api/v1/types.ts
- Updated native API client to use v1 drugs endpoint and added v1 exemptions search method: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Fixed async session guard in native launcher API route (tsc blocker): app/api/system/native/route.ts
- Added v1 patient update/delete operations with ambulatory relation sync: app/api/v1/patients/[id]/route.ts
- Added v1 filters for entries/therapies/checkups list endpoints (type/status/dateFrom/dateTo): app/api/v1/patients/[id]/entries/route.ts
- Added v1 filters for entries/therapies/checkups list endpoints (type/status/dateFrom/dateTo): app/api/v1/patients/[id]/therapies/route.ts
- Added v1 filters for entries/therapies/checkups list endpoints (type/status/dateFrom/dateTo): app/api/v1/patients/[id]/checkups/route.ts
- Added v1 entry item endpoint with GET/PUT/DELETE: app/api/v1/patients/[id]/entries/[entryId]/route.ts
- Added v1 therapy item endpoint with GET/PUT/DELETE: app/api/v1/patients/[id]/therapies/[therapyId]/route.ts
- Added v1 checkup item endpoint with GET/PUT/DELETE: app/api/v1/patients/[id]/checkups/[checkupId]/route.ts
- Extended native API client with update/delete methods for patient, entry, therapy, and checkup: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Extended native API client list methods with v1 filters (entries/therapies/checkups): native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Added native patient-detail filters (type/status) for entries, therapies, and checkups: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Added native patient-detail row actions (edit/delete) for entries, therapies, and checkups: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Added native edit sheets for entry, therapy, and checkup wired to v1 update endpoints: native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift
- Unified audit actor attribution across web/native by introducing explicit auth channels, resolving local-token requests to the real local user when available, and tagging macOS requests with the native source-surface header: lib/server-session.ts, lib/server-auth.ts, lib/audit.ts, app/api/auth/login/route.ts, app/api/v1/patients/route.ts, app/api/v1/patients/[id]/route.ts, native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift, lib/audit.test.ts
- Re-authored the WUL-84 web provenance thin slice with citabile AI insight context, deterministic post-processing guardrails, contaminated narrative exclusion, and a diagnostics drawer plus focused unit coverage: lib/ai-context.ts, lib/ai-summary-service.ts, components/ai-patient-insight.tsx, lib/patient-insight.ts, lib/patient-data-guardrails.ts, lib/patient-insight.test.ts, scripts/patient-insight-test.sh, tsconfig.patient-insight-test.json, package.json
- Added native contract tests and tri-state patch encoding for patient/therapy updates, wiring the macOS edit/archive flows to explicit omit/null/value semantics: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift, native/MediFlowMac/Tests/MediFlowMacTests/LocalAPIContractsTests.swift, native/MediFlowMac/Sources/MediFlowMac/Views/EditPatientView.swift, native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift, native/MediFlowMac/Sources/MediFlowMac/ContentView.swift
- Added canonical ADR for shared auth lockout policy across web and macOS: docs/adr/0017-auth-lockout-policy.md
- Implemented persisted login lockout policy with structured `401/423` auth responses and PHI-safe logging: app/api/auth/login/route.ts
- Added reusable auth lockout helpers and tests for threshold/window/duration/response metadata: lib/auth-lockout.ts
- Added reusable auth lockout helpers and tests for threshold/window/duration/response metadata: lib/auth-lockout.test.ts
- Wired lockout messaging into the web security gate and lock screen: components/security-provider.tsx
- Wired lockout messaging into the web security gate and lock screen: components/lock-screen.tsx
- Wired lockout messaging into the native login path and error mapping: native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift
- Wired lockout messaging into the native login path and error mapping: native/MediFlowMac/Sources/MediFlowMac/Services/SecuritySession.swift
- Added macOS `launchd`-based nightly backup thin slice with headless runner, scheduler status/settings route, minimal settings UI, smoke coverage, and ADR 0022: docs/adr/0022-nightly-backup-via-macos-launchd.md, lib/backup-scheduler.ts, app/api/system/backup-scheduler/route.ts, scripts/run-scheduled-backup.mjs, scripts/backup-scheduler-test.sh, lib/backup-scheduler.test.ts, components/backup-scheduler-ui.tsx, app/settings/page.tsx, package.json
- Relaxed the AI Patient Insight fallback guard so partially supported outputs stay visible with `DATI-INCOMPLETI` markers instead of collapsing to a generic downgrade, and added focused coverage for partial-support vs no-support cases: lib/patient-insight.ts, lib/patient-insight.test.ts
- Hardened OCR document import fallback so low-confidence or partially structured local OCR still yields usable text instead of crashing the importer, and added isolated coverage for OCR fallback text promotion: lib/pdf-service.ts, lib/pdf-service.test.ts, scripts/pdf-service-test.sh, tsconfig.pdf-service-test.json, package.json
