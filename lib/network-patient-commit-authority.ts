/* @Codex: patient admission is not authority to commit after a body-read await. */
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import type { dbServer } from './db-server';
import { ambulatories, settings, users } from './schema';
import { NETWORK_MODE_KEY, normalizeNetworkOperatingMode, evaluateNetworkDataPlaneModeGate } from './network-contract';
import { NETWORK_PAIRING_STATE_KEY, parseNetworkPairingState } from './network-pairing-model';
import { authenticatePairedClientRequest } from './network-paired-client-auth';
import type { NetworkWriteContext } from './network-write-context';
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
    context: NetworkWriteContext, capability: string,
): Promise<NetworkPatientCommitGuard> {
    const activeAmbulatoryId = (await cookies()).get('ambulatory_id')?.value ?? null;
    return (tx) => {
        // Fixed reads under the patient's IMMEDIATE write lock. No await occurs
        // from these checks through clinical/membership/required-audit commit.
        const setting = (key: string) => tx.select({ value: settings.value }).from(settings)
            .where(eq(settings.key, key)).get()?.value ?? null;
        const paired = authenticatePairedClientRequest(context.request,
            parseNetworkPairingState(setting(NETWORK_PAIRING_STATE_KEY)).clients);
        if (!paired || paired.clientId !== context.pairedClient.clientId
            || paired.tokenHash !== context.pairedClient.tokenHash
            || paired.clientPlatform !== context.pairedClient.clientPlatform) {
            return { status: 401, value: { error: 'Unauthorized' } };
        }
        const mode = evaluateNetworkDataPlaneModeGate(normalizeNetworkOperatingMode(setting(NETWORK_MODE_KEY)));
        if (!mode.allowed) return { status: mode.status, value: mode.value };
        if (!paired.grantedCapabilities.includes(capability)) return { status: 403, value: { error: 'Forbidden' } };
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
        if (!scope || scope.id !== context.scopeAmbulatoryId) {
            return { status: 403, value: { error: 'Network scope unavailable' } };
        }
        return null;
    };
}
