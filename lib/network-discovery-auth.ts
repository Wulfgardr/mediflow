/* @Codex */
import type { NextResponse } from 'next/server';
/* @Codex */
import type { StoredNetworkPairedClient } from './network-pairing-model';
/* @Codex */
import type { NetworkCapabilitiesResponse } from './api/v1/types';

/* @Codex */
export type NetworkDiscoveryAuthContext =
    | { authMode: 'local-token' }
    | { authMode: 'paired-client'; pairedClient: StoredNetworkPairedClient };

/* @Codex */
export type NetworkDiscoveryAuthDeps = {
    requireLocalApiToken: (request: Request) => NextResponse | null;
    authenticateNetworkPairedClient: (request: Request) => Promise<StoredNetworkPairedClient | null>;
    getNetworkModeGateResponse: () => Promise<NextResponse | null>;
};

/* @Codex */
export function projectNetworkCapabilitiesForDiscoveryAuth(
    response: NetworkCapabilitiesResponse,
    context: NetworkDiscoveryAuthContext
): NetworkCapabilitiesResponse {
    if (context.authMode === 'local-token') return response;

    const grantedCapabilities = new Set(context.pairedClient.grantedCapabilities);
    return {
        ...response,
        capabilities: response.capabilities.map((capability) => {
            if (!capability.requiresPairing
                || capability.status !== 'available'
                || grantedCapabilities.has(capability.key)) {
                return capability;
            }
            return { ...capability, status: 'unavailable' };
        }),
    };
}

/* @Codex */
export async function resolveNetworkDiscoveryAuth(
    request: Request,
    deps: NetworkDiscoveryAuthDeps
): Promise<{ ok: true; context: NetworkDiscoveryAuthContext } | { ok: false; response: NextResponse }> {
    const localTokenError = deps.requireLocalApiToken(request);
    if (!localTokenError) return { ok: true, context: { authMode: 'local-token' } };

    const pairedClient = await deps.authenticateNetworkPairedClient(request);
    if (!pairedClient) return { ok: false, response: localTokenError };

    const modeGateResponse = await deps.getNetworkModeGateResponse();
    if (modeGateResponse) return { ok: false, response: modeGateResponse };

    return { ok: true, context: { authMode: 'paired-client', pairedClient } };
}
