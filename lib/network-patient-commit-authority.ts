import { archiveGenerationForSession } from './security/archive-session-generation';
import { assertArchiveGeneration } from './archive-generation';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import type { dbServer } from './db-server';
import { ambulatories, settings, users } from './schema';
import { NETWORK_MODE_KEY, normalizeNetworkOperatingMode, evaluateNetworkDataPlaneModeGate } from './network-contract';
import { NETWORK_PAIRING_STATE_KEY, parseNetworkPairingState } from './network-pairing-model';
import { authenticatePairedClientRequest } from './network-paired-client-auth';
import type { NetworkWriteContext } from './network-write-context';
import { bindNetworkRequestScope } from './network-request-scope';
import { isPairedNativeServerSession, peekSession } from './security/server-session';
import {
    mintResourcePort, beginResourceUse, commitResourceUse, abortResourceUse, releaseResourcePort,
} from './security/web-auth-lifecycle-owner-adapter';

export type NetworkPatientCommitDenial = { status: 401 | 403; value: Record<string, unknown> };
type Transaction = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
export type NetworkPatientCommitGuard = (tx: Transaction) => NetworkPatientCommitDenial | null;

function currentSession(context: NetworkWriteContext): boolean {
    const session = context.session;
    if (session.authChannel === 'native') {
        const { clientId, clientPlatform, tokenHash } = context.pairedClient;
        return peekSession(session.id) === session && isPairedNativeServerSession(session, { clientId, clientPlatform, tokenHash });
    }
    if (session.authChannel !== 'web') return false;
    // Authenticate the original owner projection, not a copied/fresh projection.
    const port = mintResourcePort(session);
    if (!port) return false;
    let use: ReturnType<typeof beginResourceUse> = null;
    try {
        use = beginResourceUse(port);
        const current = use !== null && commitResourceUse(use);
        if (!current && use) abortResourceUse(use);
        return current;
    } finally { releaseResourcePort(port); }
}

export async function prepareNetworkPatientCommitGuard(
    context: NetworkWriteContext, capability: string | readonly string[],
): Promise<NetworkPatientCommitGuard> {
    // The host names every required capability; an empty set cannot authorize a read or write.
    const capabilities = typeof capability === 'string' ? [capability] : Array.isArray(capability) ? [...capability] : [];
    if (!capabilities.length || capabilities.some(value => typeof value !== 'string' || !value || value.trim() !== value)
        || new Set(capabilities).size !== capabilities.length) throw new TypeError('Invalid required network capabilities');
    Object.freeze(capabilities);
    const generation = archiveGenerationForSession(context.session);
    const activeAmbulatoryId = (await cookies()).get('ambulatory_id')?.value ?? null;
    return (tx) => {
        // Fixed reads in the caller's transaction. Writers hold IMMEDIATE; read-only
        // services use the same current authority without acquiring write permission.
        const setting = (key: string) => tx.select({ value: settings.value }).from(settings)
            .where(eq(settings.key, key)).get()?.value ?? null;
        assertArchiveGeneration(tx, generation);
        const rawPairing = setting(NETWORK_PAIRING_STATE_KEY);
        let bound = false;
        try { bound = rawPairing !== null && JSON.parse(rawPairing).archiveGeneration === generation; } catch { /* Invalid grants fail closed. */ }
        const paired = authenticatePairedClientRequest(context.request,
            parseNetworkPairingState(bound ? rawPairing : null).clients);
        if (!paired || paired.clientId !== context.pairedClient.clientId
            || paired.tokenHash !== context.pairedClient.tokenHash
            || paired.clientPlatform !== context.pairedClient.clientPlatform) {
            return { status: 401, value: { error: 'Unauthorized' } };
        }
        const mode = evaluateNetworkDataPlaneModeGate(normalizeNetworkOperatingMode(setting(NETWORK_MODE_KEY)));
        if (!mode.allowed) return { status: mode.status, value: mode.value };
        if (!capabilities.every(value => paired.grantedCapabilities.includes(value))) return { status: 403, value: { error: 'Forbidden' } };
        if (!currentSession(context)) return { status: 401, value: { error: 'Unauthorized' } };
        const user = tx.select({ username: users.username, role: users.role }).from(users)
            .where(eq(users.id, context.session.userId)).get();
        if (!user || user.username !== context.session.username
            || (user.role ?? (context.session.authChannel === 'native' ? 'user' : context.session.role)) !== context.session.role) {
            return { status: 401, value: { error: 'Unauthorized' } };
        }
        const selected = activeAmbulatoryId ? tx.select({ id: ambulatories.id }).from(ambulatories)
            .where(eq(ambulatories.id, activeAmbulatoryId)).get() : undefined;
        const scope = selected ?? tx.select({ id: ambulatories.id }).from(ambulatories)
            .where(eq(ambulatories.isDefault, true)).get();
        if (!scope || scope.id !== context.scopeAmbulatoryId
            || bindNetworkRequestScope(context.request, scope.id) !== scope.id) {
            return { status: 403, value: { error: 'Network scope unavailable' } };
        }
        return null;
    };
}
