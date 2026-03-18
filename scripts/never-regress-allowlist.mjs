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
    ],
    externalUrls: [
        {
            path: 'lib/siss.ts',
            pattern: 'https://operatorisiss.servizirl.it/',
            reason: 'Explicit, user-driven SISS portal integration is allowed and documented.',
        },
    ],
};
