/* @Codex */
import { cookies } from 'next/headers';
/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    authenticateNetworkPairedClient,
    getNetworkIdentitySummary,
} from './network-home-base-server';
/* @Codex */
import type { StoredNetworkPairedClient } from './network-pairing-model';
/* @Codex */
import { forbiddenResponse, requireSession, unauthorizedResponse } from './server-auth';
/* @Codex */
import type { ServerSession } from './server-session';

/* @Codex */
export type NetworkWriteContext = {
    request: Request;
    scopeAmbulatoryId: string;
    pairedClient: StoredNetworkPairedClient;
    session: ServerSession;
};

/* @Codex */
export async function resolveNetworkScope(session: ServerSession): Promise<string | null> {
    const cookieStore = await cookies();
    const activeAmbulatoryId = cookieStore.get('ambulatory_id')?.value ?? null;
    const identity = await getNetworkIdentitySummary(session, activeAmbulatoryId);
    return identity.scope.effectiveAmbulatoryId;
}

/* @Codex */
export async function requireNetworkCapabilityContext(
    request: Request,
    requiredCapability: string
): Promise<{ ok: true; context: NetworkWriteContext } | { ok: false; response: NextResponse }> {
    const pairedClient = await authenticateNetworkPairedClient(request);
    if (!pairedClient) return { ok: false, response: unauthorizedResponse() };
    if (!pairedClient.grantedCapabilities.includes(requiredCapability)) {
        return { ok: false, response: forbiddenResponse() };
    }

    const session = await requireSession();
    if (!session) return { ok: false, response: unauthorizedResponse() };

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

/* @Codex */
export const requireNetworkWriteContext = requireNetworkCapabilityContext;
