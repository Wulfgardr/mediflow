/* @Codex */
export const NEVER_REGRESS_ALLOWLIST = {
    credentialLiterals: [
        {
            path: 'native/MediFlowMac/Sources/MediFlowMac/Services/LocalAPIClient.swift',
            pattern: 'username:\\s*"admin"',
            reason: 'Native bootstrap still targets the first local admin account until auth identity becomes configurable.',
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
