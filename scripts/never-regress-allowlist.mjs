/* @Codex */
export const NEVER_REGRESS_ALLOWLIST = {
    credentialLiterals: [
        {
            path: 'lib/security/audit.test.ts',
            pattern: "username:\\s*'admin'",
            reason: 'Audit tests use a synthetic native admin actor to verify attribution without relying on live credentials.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift',
            pattern: 'username:\\s*"admin"',
            reason: 'Native bootstrap still targets the first local admin account until auth identity becomes configurable.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowMacTests/LocalAPIClientAuthTests.swift',
            pattern: 'pin:\\s*"0000"',
            reason: 'Native auth tests use a synthetic PIN literal to validate typed error mapping without hitting a live backend.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/CryptoServiceTests.swift',
            pattern: 'pin:\\s*"1234"',
            reason: 'Crypto compatibility tests use a synthetic PIN fixture to verify PBKDF2 parity with the web implementation.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/CryptoServiceTests.swift',
            pattern: 'pin:\\s*"9999"',
            reason: 'Crypto compatibility tests use a synthetic PIN fixture to verify local master-key wrap and unwrap behavior.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/HomeBasePairedStore.swift',
            pattern: 'username\\s*=\\s*"mediflow\\.homeBase\\.username"',
            reason: 'The paired home-base store persists the operator name under a scoped UserDefaults key; this is an internal setting identifier, not a runtime credential.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBasePairedStoreTests.swift',
            pattern: 'username:\\s*" doctor "',
            reason: 'Home-base paired-store tests trim a synthetic operator name to verify persistence normalization without using live credentials.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBasePairedStoreTests.swift',
            pattern: 'username:\\s*"doctor"',
            reason: 'Home-base paired-store tests reuse a synthetic operator fixture to verify round-trip persistence without using live credentials.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBasePatientsClientTests.swift',
            pattern: 'username:\\s*"doctor"',
            reason: 'Home-base client tests submit a synthetic operator fixture to validate native login payload encoding against a mocked local endpoint.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/PairedPatientsWorkspaceModelLifecycleTests.swift',
            pattern: 'username\\s*=\\s*"doctor"',
            reason: 'PIN-rotation lifecycle tests assign a synthetic operator fixture on the workspace model to drive a mocked login; no live credentials are involved.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBasePatientsClientTests.swift',
            pattern: 'password:\\s*"1992"',
            reason: 'Home-base client tests use a synthetic password literal only inside a mocked local login exchange and never against a live backend.',
        },
        {
            path: 'lib/api-schemas/api-schemas.test.ts',
            pattern: "username:\\s*'admin'",
            reason: 'API-schema tests use a synthetic admin username fixture to exercise the authSetupSchema validation boundary without real credentials.',
        },
        {
            path: 'lib/api-schemas/api-schemas.test.ts',
            pattern: "password:\\s*'1234'",
            reason: 'API-schema tests use a synthetic password fixture to exercise the authSetupSchema validation boundary without real credentials.',
        },
        {
            path: 'lib/network-identity.test.ts',
            pattern: "username:\\s*'solo-user'",
            reason: 'Network identity tests use a synthetic single-user fixture to validate login-hint derivation without real credentials.',
        },
        {
            path: 'lib/network-identity.test.ts',
            pattern: "username:\\s*'paired-user'",
            reason: 'Network identity tests use a synthetic paired operator fixture to validate session-bound identity state without real credentials.',
        },
        {
            path: 'lib/network-operating-mode.test.ts',
            pattern: "username:\\s*'paired-user'",
            reason: 'Network operating mode tests use a synthetic paired operator fixture to render the session-bound UI state without real credentials.',
        },
        {
            path: 'lib/prescription-delete-concurrency.test.ts',
            pattern: "username:\\s*'prescription-delete-user'",
            reason: 'Prescription delete concurrency tests build a synthetic ServerSession fixture to exercise version-guarded hard deletes without real credentials.',
        },
        {
            path: 'lib/security/settings-write-policy.test.ts',
            pattern: "username:\\s*'policy-user'",
            reason: 'Settings write-policy tests build a synthetic ServerSession fixture to exercise the per-channel write allowlist matrix without real credentials.',
        },
        {
            path: 'lib/ai-providers/fabric/document-synthesis-production-operation.test.ts',
            pattern: "username:\\s*'clinician\\.synthetic'",
            reason: 'Document Synthesis production-operation tests use an explicit synthetic clinician identity with mocked local authority.',
        },
        {
            path: 'lib/ai-providers/fabric/patient-insight-authenticated-preview.test.ts',
            pattern: "username:\\s*'synthetic'",
            reason: 'Patient Insight preview tests use a synthetic authenticated session fixture and no live credential.',
        },
        {
            path: 'lib/ai-providers/fabric/treatment-reasoning-authenticated-projection.test.ts',
            pattern: "username:\\s*'synthetic'",
            reason: 'Treatment Reasoning projection tests use a synthetic authenticated session fixture and no live credential.',
        },
        {
            path: 'lib/legacy-smart-import-apply-retired-route.test.ts',
            pattern: "username:\\s*'synthetic\\.smart-import\\.retirement'",
            reason: 'The retired Smart Import apply-route test uses a named synthetic session to verify the authenticated denial.',
        },
        {
            path: 'lib/security/client-application-lock.test.ts',
            pattern: "(?:username|password):\\s*'(?:admin|654321|123456)'",
            reason: 'Client lock tests use fixed local-only credentials to exercise synthetic lock, unlock and password-rejection paths.',
        },
        {
            path: 'lib/security/headless-soap-active-role-enrollment.test.ts',
            pattern: "username:\\s*'other'",
            reason: 'Active-role enrollment tests use a synthetic alternate username to verify identity mismatch rejection.',
        },
        {
            path: 'lib/security/headless-soap-active-role-session-grant-attach-failure-fixture.ts',
            pattern: "username:\\s*'synthetic-soap-admin'",
            reason: 'The attach-failure fixture carries a synthetic SOAP administrator identity for an isolated failure process.',
        },
        {
            path: 'lib/security/headless-soap-active-role-session-grant-binding.test.ts',
            pattern: "username:\\s*'synthetic-h6-admin'",
            reason: 'The H6 session-grant binding test uses a synthetic administrator identity for exact subject binding.',
        },
        {
            path: 'lib/security/headless-soap-active-role-session-grant-rejection-fixture.ts',
            pattern: "username:\\s*'synthetic-soap-admin'",
            reason: 'The rejection fixture carries a synthetic SOAP administrator identity for an isolated failure process.',
        },
        {
            path: 'lib/security/headless-soap-active-role-session-grant.test.ts',
            pattern: "username:\\s*'synthetic-soap-admin'",
            reason: 'Session-grant tests reuse one synthetic SOAP administrator identity across local lifecycle cases.',
        },
        {
            path: 'lib/security/headless-checkup-active-role-session-grant-production.test.ts',
            pattern: "username:\\s*'synthetic-checkup-production-(?:enrolled|not-enrolled)-user'",
            reason: 'Checkup production grant tests bind two explicit synthetic administrators to isolated local enrollment states.',
        },
        {
            path: 'lib/security/headless-checkup-active-role-session-grant.test.ts',
            pattern: "username:\\s*'synthetic-checkup-admin'",
            reason: 'Checkup grant lifecycle tests reuse one synthetic administrator identity in an isolated in-process owner.',
        },
        {
            path: 'lib/security/headless-soap-authorization-lineage.test.ts',
            pattern: "username:\\s*'synthetic\\.clinician'",
            reason: 'Authorization-lineage tests bind receipts to an explicit synthetic clinician identity.',
        },
        {
            path: 'lib/security/headless-soap-authorization-proof-binding.test.ts',
            pattern: "username\\s*[:=]\\s*'(?:synthetic\\.clinician|synthetic-h6-exact-session(?:-positive)?)'",
            reason: 'Authorization-proof binding tests use named synthetic identities to distinguish positive and adversarial sessions.',
        },
        {
            path: 'lib/security/headless-soap-authorization-proof-lifecycle-adversarial.test.ts',
            pattern: "username:\\s*'synthetic-admin'",
            reason: 'Adversarial authorization-proof tests use a synthetic administrator identity and isolated stores.',
        },
        {
            path: 'lib/security/headless-soap-authorization-proof-lifecycle.test.ts',
            pattern: "username:\\s*'synthetic-admin'",
            reason: 'Authorization-proof lifecycle tests use a synthetic administrator identity and isolated stores.',
        },
        {
            path: 'lib/security/headless-soap-command-binding-test-fixture.ts',
            pattern: "username:\\s*'synthetic\\.clinician'",
            reason: 'The command-binding fixture exposes a synthetic clinician identity only to local contract tests.',
        },
        {
            path: 'lib/security/headless-soap-fresh-pin-verification.test.ts',
            pattern: "username:\\s*(?:`\\$\\{USERNAME\\} `|'other'|'synthetic-other-admin')",
            reason: 'Fresh-PIN verification tests use explicit synthetic current, alternate and whitespace-variant identities.',
        },
        {
            path: 'lib/security/pin-change-service.test.ts',
            pattern: 'username:\\s*`synthetic-\\$\\{suffix\\}`',
            reason: 'PIN-change tests derive a unique synthetic username per isolated database fixture.',
        },
        {
            path: 'lib/security/portable-supervisor-context-owner.test.ts',
            pattern: "username:\\s*'synthetic-clinician'",
            reason: 'Portable Supervisor owner tests use an explicit synthetic clinician session against an isolated database fixture.',
        },
        {
            path: 'lib/security/server-auth.test.ts',
            pattern: "username:\\s*'(?:synthetic-auth-operator|username|different-synthetic-user)'",
            reason: 'Server-auth tests use explicit synthetic identities to cover accepted and mismatched sessions.',
        },
        {
            path: 'lib/security/server-session-native-system-owner.test.ts',
            pattern: "username:\\s*'synthetic-(?:user|other)'",
            reason: 'Native system-owner tests distinguish two synthetic local identities without real credentials.',
        },
        {
            path: 'lib/security/server-session-projection-owner-selection-lifecycle.test.ts',
            pattern: "username:\\s*'synthetic-clinician'",
            reason: 'Projection-owner lifecycle tests use an explicit synthetic clinician session.',
        },
        {
            path: 'lib/security/web-auth-lifecycle-owner-adapter.test.ts',
            pattern: 'username:\\s*`synthetic-\\$\\{suffix\\}`',
            reason: 'Web-auth adapter tests derive unique synthetic identities for isolated owner stores.',
        },
        {
            path: 'lib/security/web-auth-lifecycle-owner-process.test.ts',
            pattern: "username\\s*:\\s*'(?:synthetic-|forged|synthetic-late|synthetic-fresh|synthetic-poisoned|synthetic-capability-(?:pending|stale|post-abort)|synthetic-invalid|synthetic-process)'",
            reason: 'Web-auth owner process tests use named synthetic identities to separate race, forgery and lifecycle cases.',
        },
        {
            path: 'lib/security/web-auth-logout-server.test.ts',
            pattern: "username:\\s*'synthetic-logout-operator'",
            reason: 'Logout server tests use a synthetic operator identity against an isolated local session store.',
        },
    ],
    externalUrls: [
        {
            path: 'lib/ai-providers/v2/openai-responses-official-transport.ts',
            pattern: 'https://api\\.openai\\.com/v1/responses',
            reason: 'The provider-v2 transport pins the sole OpenAI Responses egress target; it is server-only, opt-in, policy-gated and cannot be replaced by caller input.',
        },
        {
            path: 'lib/ai-providers/v2/anthropic-messages-official-transport.ts',
            pattern: 'https://api\\.anthropic\\.com/v1/messages',
            reason: 'The provider-v2 transport pins the sole Anthropic Messages egress target; it is server-only, opt-in, workspace-bound and cannot be replaced by caller input.',
        },
        {
            path: 'lib/ai-providers/v2/provider-lifecycle.test.ts',
            pattern: 'https://api\\.openai\\.com(?=["\\x27`])',
            reason: 'The lifecycle test supplies an endpoint-shaped forbidden field to prove that the strict provider binding rejects caller-selected destinations without network access.',
        },
        {
            path: 'lib/reference-data/icd11-who-host-composition.test.ts',
            pattern: 'https://icdaccessmanagement\\.who\\.int/connect/token(?=["\\x27`])',
            reason: 'WHO host-composition tests assert the exact token binding through injected fake clients without network access.',
        },
        {
            path: 'lib/reference-data/icd11-who-host-composition.test.ts',
            pattern: 'https://id\\.who\\.int/icd/release/11/2026-01/mms/search(?=\\?)',
            reason: 'WHO host-composition tests assert the immutable Search binding through injected fake clients without network access.',
        },
        {
            path: 'lib/reference-data/icd11-who-host-composition.test.ts',
            pattern: 'https://caller\\.invalid(?=["\\x27`])',
            reason: 'WHO host-composition tests use a reserved invalid caller endpoint to prove caller-supplied URLs are rejected.',
        },
        {
            path: 'lib/reference-data/icd11-who-http-route.test.ts',
            pattern: 'https://mediflow\\.local/api/icd/proxy(?=\\?|["\\x27`])',
            reason: 'The WHO HTTP route test uses one synthetic origin only to construct Request objects for the exact route under test.',
        },
        {
            path: 'lib/reference-data/icd11-who-node-https-client.test.ts',
            pattern: 'https://icdaccessmanagement\\.who\\.int/connect/token(?=["\\x27`])',
            reason: 'The Node HTTPS client test observes the exact token request through a fake HTTPS seam and performs no network access.',
        },
        {
            path: 'lib/reference-data/icd11-who-node-https-client.test.ts',
            pattern: 'https://id\\.who\\.int/icd/release/11/2026-01/mms/search(?=\\?)',
            reason: 'The Node HTTPS client test observes the exact Search request through a fake HTTPS seam and performs no network access.',
        },
        {
            path: 'lib/reference-data/icd11-who-node-https-client.ts',
            pattern: 'https://icdaccessmanagement\\.who\\.int/connect/token(?=["\\x27`])',
            reason: 'The server-only WHO HTTPS client permits only the immutable official OAuth endpoint selected by the host composition.',
        },
        {
            path: 'lib/reference-data/icd11-who-node-https-client.ts',
            pattern: 'https://id\\.who\\.int\\$\\{path\\}(?=["\\x27`])',
            reason: 'The server-only WHO HTTPS client combines the fixed official ICD host with a path already validated by its transport contract.',
        },
        {
            path: 'lib/reference-data/icd11-who-official-token-issuer.test.ts',
            pattern: 'https://id\\.who\\.int/connect/token(?=["\\x27`])',
            reason: 'The token issuer test uses the wrong WHO host as an inert hostile fixture to prove exact-host rejection.',
        },
        {
            path: 'lib/reference-data/icd11-who-official-token-issuer.test.ts',
            pattern: 'http://icdaccessmanagement\\.who\\.int/connect/token(?=["\\x27`])',
            reason: 'The token issuer test uses plaintext HTTP as an inert hostile fixture to prove HTTPS-only rejection.',
        },
        {
            path: 'lib/reference-data/icd11-who-official-token-issuer.ts',
            pattern: 'https://icdaccessmanagement\\.who\\.int/connect/token(?=["\\x27`])',
            reason: 'The server-only token issuer binds to the immutable official WHO OAuth endpoint and accepts no caller URL.',
        },
        {
            path: 'lib/reference-data/icd11-who-server-owner.test.ts',
            pattern: 'https://caller\\.invalid(?=["\\x27`])',
            reason: 'The WHO owner test uses a reserved invalid endpoint to prove caller-supplied URL fields are denied.',
        },
        {
            path: 'lib/aifa-catalog.ts',
            pattern: 'https://www\\.aifa\\.gov\\.it/open-data',
            reason: 'The official AIFA Open Data page is stored as user-reviewed provenance and opened only through an explicit settings link; the catalog importer reads a user-selected local file and performs no network fetch.',
        },
        {
            path: 'lib/compliance-evidence-inventory.ts',
            pattern: 'https://eur-lex\\.europa\\.eu/eli/(?:reg/2016/679/art_(?:25|32)|reg/2024/1689)/',
            reason: 'Official EUR-Lex URLs are read-only legal provenance rendered for explicit user review; the inventory performs no fetch or background egress.',
        },
        {
            path: 'lib/compliance-evidence-inventory.test.ts',
            pattern: 'https://eur-lex\\.europa\\.eu/eli/(?:reg/2016/679/art_(?:25|32)|reg/2024/1689)/',
            reason: 'Compliance inventory tests assert official EUR-Lex provenance strings without issuing network requests.',
        },
        {
            path: 'lib/aifa-catalog.ts',
            pattern: 'https://www\\.aifa\\.gov\\.it/copyright',
            reason: 'The official AIFA reuse-terms URL is persisted as catalog provenance metadata and is never fetched by the import or search runtime.',
        },
        {
            path: 'lib/athena-model-identity.ts',
            pattern: 'https://huggingface\\.co/mims-harvard/ATHENA-R1-Qwen3-8B',
            reason: 'The ATHENA model card URL is provenance documentation inside a comment; the MLX runtime resolves only pre-downloaded local artifacts and never performs network egress.',
        },
        {
            path: 'lib/siss-urls.ts',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'The canonical SISS URL registry is an explicit, user-driven integration boundary and is documented as such.',
        },
        {
            path: 'lib/siss.ts',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'Explicit, user-driven SISS portal integration is allowed and documented.',
        },
        {
            path: 'lib/siss-adapter.ts',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'The SISS adapter foundation preserves the documented user-driven portal handoff as an explicit transport mode.',
        },
        {
            path: 'lib/siss-session-observer.test.ts',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'SISS session observer tests use canonical operator URLs as synthetic Atlas history fixtures without performing runtime egress.',
        },
        {
            path: 'lib/siss-session-observer.test.ts',
            pattern: 'https://idpcrlmain.crs.lombardia.it/',
            reason: 'SISS session observer tests use documented IdPC checkpoints only as synthetic fixtures for remote-sign detection.',
        },
        {
            path: 'lib/scales/tinetti-poma28-v1.ts',
            pattern: '^\\s*"sourceUrl": "https://www\\.shropscommunityhealth\\.nhs\\.uk/content/doclib/10756\\.pdf",\\s*$',
            reason: 'ADR 0118: exact NHS FPS 006 V1 provenance property, like a FHIR identifier; copied into scale metadata, never fetched. Not a runtime egress permission.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/TinettiPOMA28.swift',
            pattern: '^\\s*sourceUrl: "https://www\\.shropscommunityhealth\\.nhs\\.uk/content/doclib/10756\\.pdf",\\s*$',
            reason: 'ADR 0118: the identical NHS provenance String in the native value object, encoded as metadata without URLSession or automatic fetch; exact file/property/literal only.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://id\\.who\\.int/icd/release/11/mms',
            reason: 'FHIR coding-system URI identifier inside generated resources, mirroring lib/fhir/clinical-adapter.ts (directory exempted by the scanner); never fetched at runtime.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://hl7\\.org/fhir/sid/icd-10',
            reason: 'FHIR coding-system URI identifier inside generated resources, mirroring lib/fhir/clinical-adapter.ts; never fetched at runtime.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://hl7\\.org/fhir/sid/icd-9',
            reason: 'FHIR coding-system URI identifier inside generated resources, mirroring lib/fhir/clinical-adapter.ts; never fetched at runtime.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://hl7\\.it/sid/codice-fiscale',
            reason: 'FHIR identifier-system URI inside generated resources, mirroring lib/fhir/patient-adapter.ts; never fetched at runtime.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://loinc\\.org',
            reason: 'FHIR coding-system URI inside generated resources, mirroring lib/fhir/clinical-adapter.ts; never fetched at runtime.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://terminology\\.hl7\\.org/CodeSystem/condition-clinical',
            reason: 'FHIR coding-system URI inside generated resources, mirroring lib/fhir/clinical-adapter.ts; never fetched at runtime.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://terminology\\.hl7\\.org/CodeSystem/v3-ActCode',
            reason: 'FHIR coding-system URI inside generated resources, mirroring lib/fhir/clinical-adapter.ts; never fetched at runtime.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowCore/FHIRBundleGenerator.swift',
            pattern: 'http://unitsofmeasure\\.org',
            reason: 'UCUM system URI inside generated observation resources, mirroring lib/fhir/clinical-adapter.ts; never fetched at runtime.',
        },
        {
            path: 'lib/siss.test.ts',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'SISS handoff tests validate explicit user-driven portal URLs with synthetic fixtures and no background runtime egress.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/SystemActions.swift',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'The native PRREG handoff opens the regional portal dashboard in the system browser on explicit user action, mirroring lib/siss-urls.ts; no background egress.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/PairedPatientsWorkspaceModelPrregTests.swift',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'PRREG handoff tests assert the portal dashboard URL against a spy; no runtime egress.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/HomeBaseBonjourDiscovery.swift',
            pattern: 'https://\\\\\\(hostName\\):\\\\\\(port\\)',
            reason: 'Bonjour discovery assembles a paired local server URL from the discovered host and port at runtime; it is not a hardcoded external endpoint.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBaseBonjourDiscoveryTests.swift',
            pattern: 'https://mediflow-smoke\\.local:3443',
            reason: 'Bonjour discovery tests use a synthetic .local host to validate candidate normalization without performing network egress.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/HomeBasePairedStoreTests.swift',
            pattern: 'https://home-base\\.test',
            reason: 'Home-base paired-store tests use a synthetic .test server URL to verify trimmed persistence without contacting a live endpoint.',
        },
        {
            path: 'lib/security/request-transport.test.ts',
            pattern: "(?:new Request\\('http://mediflow-home\\.local:3000/api/(?:auth/login|system/probe)'|origin: 'https://mediflow-home\\.local:3000')",
            reason: 'Request-transport tests use one explicit synthetic LAN .local origin to verify secure cookies and exact same-origin reconstruction through the TLS proxy; they construct Request values without network egress.',
        },
        {
            path: 'native/MediFlowMac/Package.swift',
            pattern: 'https://github\\.com/apple/swift-crypto\\.git',
            reason: 'SwiftPM resolves the pinned swift-crypto package during explicit build setup; this is dependency resolution, not runtime patient-data egress.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift',
            pattern: 'http://loinc\\.org',
            reason: 'LOINC appears as a terminology system identifier in UI test seed data and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientsWorkspaceModel.swift',
            pattern: 'http://unitsofmeasure\\.org',
            reason: 'UCUM appears as a terminology system identifier in UI test seed data and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientClinicalSections.swift',
            pattern: 'https?://loinc\\.org(?=[",\\s])',
            reason: 'LOINC is rendered as a coding-system identifier in the clinical UI and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientClinicalSections.swift',
            pattern: 'http://snomed\\.info/sct(?=[",\\s])',
            reason: 'SNOMED CT is rendered as a coding-system identifier in the clinical UI and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientClinicalSections.swift',
            pattern: 'http://unitsofmeasure\\.org(?=[",\\s])',
            reason: 'UCUM is rendered as a coding-system identifier in the clinical UI and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/PairedPatientClinicalSections.swift',
            pattern: 'http://hl7\\.org/fhir/sid/icd-(?:10|9-cm)(?=[",\\s])',
            reason: 'ICD coding-system URIs are rendered as identifiers in the clinical UI and do not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/ObservationTrendTests.swift',
            pattern: 'http://unitsofmeasure\\.org',
            reason: 'UCUM appears as a terminology system identifier in synthetic observation trend tests and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/PatientReportDocumentTests.swift',
            pattern: 'http://loinc\\.org',
            reason: 'LOINC appears as a terminology system identifier in synthetic patient report fixtures and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Tests/MediFlowAppleSharedTests/PatientReportDocumentTests.swift',
            pattern: 'http://unitsofmeasure\\.org',
            reason: 'UCUM appears as a terminology system identifier in synthetic patient report fixtures and does not initiate network access.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowMac/Models/OncologyPrototype.swift',
            pattern: 'https://www.aiom.it/linee-guida-aiom/',
            reason: 'The oncology prototype exposes clinician-invoked guidance links and does not perform background egress or runtime API calls.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowMac/Models/OncologyPrototype.swift',
            pattern: 'https://easl.eu/news/easl-cpgs-hcc/',
            reason: 'The oncology prototype exposes clinician-invoked guidance links and does not perform background egress or runtime API calls.',
        },
        {
            path: 'native/MediFlowMac/Sources/MediFlowMac/Models/OncologyPrototype.swift',
            pattern: 'https://interactiveguidelines.esmo.org/esmo-web-app/home/',
            reason: 'The oncology prototype exposes clinician-invoked guidance links and does not perform background egress or runtime API calls.',
        },
    ],
};
