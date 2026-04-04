/* @Codex */
import type { NetworkIdentitySummary } from './api/v1/types.ts';
/* @Codex */
import type { ServerSession } from './server-session.ts';

export type NetworkIdentityUser = {
    id: string;
    username: string;
    displayName: string | null;
    role: string | null;
};

export type NetworkIdentityHintUser = {
    username: string;
    displayName: string | null;
};

export type NetworkIdentityAmbulatory = {
    id: string;
    name: string;
};

export type NetworkIdentityInput = {
    session: ServerSession | null;
    operator: NetworkIdentityUser | null;
    activeAmbulatory: NetworkIdentityAmbulatory | null;
    defaultAmbulatory: NetworkIdentityAmbulatory | null;
    userCount: number;
    loginHint: NetworkIdentityHintUser | null;
};

const NETWORK_IDENTITY_LIMITATIONS = [
    'Pairing device e login operatore restano separati.',
    'La slice attuale non e un RBAC completo o multi-tenant.',
    'Lo scope clinico resta ambulatoriale, non per-paziente.',
] as const;

export function deriveNetworkIdentitySummary(input: NetworkIdentityInput): NetworkIdentitySummary {
    const hasOperatorSession = !!(input.session && input.operator);
    const loginMode = input.userCount === 1
        ? 'single-local-user-default'
        : 'explicit-username-required';
    const scopeSource = input.activeAmbulatory
        ? 'session-context'
        : input.defaultAmbulatory
            ? 'node-default'
            : 'none';
    const effectiveAmbulatory = input.activeAmbulatory ?? input.defaultAmbulatory;

    return {
        identityModel: 'paired-device-plus-node-credentials',
        pairingBoundary: 'device-pairing-separate-from-operator-login',
        credentialState: hasOperatorSession ? 'session-bound' : 'node-credentials-required',
        loginMode,
        usernameHint: hasOperatorSession
            ? input.operator?.username ?? null
            : loginMode === 'single-local-user-default'
                ? input.loginHint?.username ?? null
                : null,
        displayNameHint: hasOperatorSession
            ? input.operator?.displayName ?? null
            : loginMode === 'single-local-user-default'
                ? input.loginHint?.displayName ?? null
                : null,
        operator: {
            userId: hasOperatorSession ? input.operator?.id ?? null : null,
            username: hasOperatorSession ? input.operator?.username ?? null : null,
            displayName: hasOperatorSession ? input.operator?.displayName ?? null : null,
            role: hasOperatorSession ? input.operator?.role ?? null : null,
            authChannel: hasOperatorSession ? input.session?.authChannel ?? 'none' : 'none',
        },
        scope: {
            policy: 'session-context-else-node-default',
            effectiveAmbulatoryId: effectiveAmbulatory?.id ?? null,
            effectiveAmbulatoryName: effectiveAmbulatory?.name ?? null,
            defaultAmbulatoryId: input.defaultAmbulatory?.id ?? null,
            defaultAmbulatoryName: input.defaultAmbulatory?.name ?? null,
            source: scopeSource,
        },
        audit: {
            actorType: hasOperatorSession ? 'user' : 'system',
            actorBinding: hasOperatorSession ? 'session-user' : 'token-only',
        },
        limitations: [...NETWORK_IDENTITY_LIMITATIONS],
    };
}
