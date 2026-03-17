<!-- Codex: created 2026-02-01 -->
# Agent Attribution

This log tracks contributions by non-Antigravity agents.
Entries are additive and minimal.

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
- Added the native exemptions thin slice with reusable selector/search/save support in patient create/edit, a shared exemption-code codec, and parity-matrix alignment: `native/MediFlowMac/Sources/MediFlowMac/Models/ExemptionCodesCodec.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/ExemptionSearchField.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/NewPatientView.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/EditPatientView.swift`, `native/MediFlowMac/Sources/MediFlowMac/Views/PatientDetailView.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/ExemptionCodesCodecTests.swift`, `docs/parity-matrix.md`
- Added backup artifact v1 with canonical manifest/checksum validation, server-side restore preflight, and direct SQLite reinsertion for the supported local API collections: `lib/backup-artifact.ts`, `app/api/system/backup-restore/route.ts`, `lib/db.ts`, `components/backup-restore-ui.tsx`, `docs/adr/0016-backup-artifact-v1-manifest-preflight.md`, `docs/walkthrough.md`, `docs/README.md`, `docs/markdown-index.md`, `PLANS.md`
- Finalized the native secure-first token bootstrap slice with deterministic precedence (`Keychain -> config -> legacy`), explicit bootstrap failures, auth preflight in the macOS client, and XCTest coverage: `docs/adr/0014-native-token-bootstrap-secure-first.md`, `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPITokenProvider.swift`, `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift`, `native/MediFlowMac/Sources/MediFlowMac/Services/SettingsStore.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/LocalAPITokenProviderTests.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/LocalAPIClientAuthTests.swift`, `docs/walkthrough.md`, `docs/README.md`, `docs/markdown-index.md`
- Added typed native local-API error mapping for auth, TLS/transport, validation and contract mismatches, and covered the new diagnostics with focused XCTest cases: `native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift`, `native/MediFlowMac/Sources/MediFlowMac/Services/SecuritySession.swift`, `native/MediFlowMac/Tests/MediFlowMacTests/LocalAPIClientAuthTests.swift`
- Hardened Smart Import therapy parsing for WUL-79 by adding atomic therapy hints from notes, explicit suggestion states (`active|transition|uncertain|inactive`), stronger brand/principle-active AIFA matching on noisy strings, and targeted Playwright coverage for multi-therapy notes with blocked review-only suggestions: `lib/patient-smart-import-service.ts`, `components/patient-smart-import-panel.tsx`, `e2e/smart-import.spec.ts`
- Added ADR 0013 to persist the new default text-only model choice (`qwen3.5:35b-a3b`) while keeping MedGemma as a specialist manual option, and updated ADR 0011 to keep the OCR-first pipeline accepted while delegating the default-model choice to ADR 0013: `docs/adr/0013-qwen35-default-text-only-medgemma-specialist.md`, `docs/adr/0011-ocr-first-qwen-clinical-and-prudent-icd-autofill.md`
- Updated canonical walkthrough and markdown index to reflect the new default model and ADR supersession chain: `docs/walkthrough.md`, `docs/markdown-index.md`
- Added a one-time legacy AI settings upgrade toward `qwen3.5:35b-a3b`, tightened Patient Insight prompts/output, and promoted proactive next-step suggestions in the patient screen: `lib/ai-models.ts`, `lib/ai-service.ts`, `lib/ai-summary-service.ts`, `lib/ai-context.ts`, `components/ai-patient-insight.tsx`, `app/settings/page.tsx`, `app/patients/[id]/page.tsx`

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
