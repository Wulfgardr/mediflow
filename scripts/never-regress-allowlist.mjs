/* @Codex */
export const NEVER_REGRESS_ALLOWLIST = {
    credentialLiterals: [
        {
            path: 'lib/audit.test.ts',
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
    ],
    externalUrls: [
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
            path: 'lib/siss.test.ts',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'SISS handoff tests validate explicit user-driven portal URLs with synthetic fixtures and no background runtime egress.',
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
