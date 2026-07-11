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
    ],
    externalUrls: [
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
            pattern: 'http://mediflow-home\\.local:3000/api/auth/login',
            reason: 'Request-transport tests use a synthetic LAN .local Host fixture to verify the TLS-proxy marker still asserts secure cookies on a non-loopback paired host; no runtime egress occurs.',
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
