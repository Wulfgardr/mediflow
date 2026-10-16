import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
    authenticateNetworkPairedClient,
    getNetworkIdentitySummary,
    getNetworkOperatingMode,
} from './network-home-base-server';
import { evaluateNetworkDataPlaneModeGate } from './network-contract';
import type { StoredNetworkPairedClient } from './network-pairing-model';
import { requireLocalApiToken } from './security/local-api-auth';
export {
    resolveNetworkDiscoveryAuth,
} from './network-discovery-auth';
import type { NetworkDiscoveryAuthContext } from './network-discovery-auth';
import { resolveNetworkDiscoveryAuth } from './network-discovery-auth';
import { forbiddenResponse, requireSession, unauthorizedResponse } from './security/server-auth';
import { requirePairedNativeSession } from './security/paired-native-session';
import { archiveWriteRequestDenial } from './security/archive-write-request';
import type { ServerSession } from './security/server-session';

export type NetworkWriteContext = {
    request: Request;
    scopeAmbulatoryId: string;
    pairedClient: StoredNetworkPairedClient;
    session: ServerSession;
};

export async function resolveNetworkScope(session: ServerSession): Promise<string | null> {
    const cookieStore = await cookies();
    const activeAmbulatoryId = cookieStore.get('ambulatory_id')?.value ?? null;
    const identity = await getNetworkIdentitySummary(session, activeAmbulatoryId);
    return identity.scope.effectiveAmbulatoryId;
}

// WUL-307: disabling network-home-base keeps pairings stored but makes their
// tokens inert: paired-client data-plane requests are rejected with the
// stable NETWORK_MODE_DISABLED code until the mode is re-enabled.
export async function getNetworkModeGateResponse(): Promise<NextResponse | null> {
    const gate = evaluateNetworkDataPlaneModeGate(await getNetworkOperatingMode());
    if (gate.allowed) return null;
    return NextResponse.json(gate.value, { status: gate.status });
}

export async function requireNetworkCapabilityContext(
    request: Request,
    requiredCapability: string
): Promise<{ ok: true; context: NetworkWriteContext } | { ok: false; response: NextResponse }> {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return { ok: false, response: unauthorizedResponse() };

    const modeGateResponse = await getNetworkModeGateResponse();
    if (modeGateResponse) return { ok: false, response: modeGateResponse };

    if (!pairedClient.grantedCapabilities.includes(requiredCapability)) {
        return { ok: false, response: forbiddenResponse() };
    }

    const session = await requireSession() ?? await requirePairedNativeSession(request);
    if (!session) return { ok: false, response: unauthorizedResponse() };
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return { ok: false, response: archiveDenial };

    const scopeAmbulatoryId = await resolveNetworkScope(session);
    if (!scopeAmbulatoryId) {
        return {
            ok: false,
            response: NextResponse.json({ error: 'Network scope unavailable' }, { status: 403 }),
        };
    }

    return {
        ok: true,
        context: {
            request,
            scopeAmbulatoryId,
            pairedClient,
            session,
        },
    };
}

export const requireNetworkWriteContext = requireNetworkCapabilityContext;

export async function requireNetworkDiscoveryAuth(
    request: Request
): Promise<{ ok: true; context: NetworkDiscoveryAuthContext } | { ok: false; response: NextResponse }> {
    return resolveNetworkDiscoveryAuth(request, {
        requireLocalApiToken,
        authenticateNetworkPairedClient,
        getNetworkModeGateResponse,
    });
}
