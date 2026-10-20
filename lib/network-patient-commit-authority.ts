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
import { isCurrentServerSession, type PairedNativeBinding } from './security/current-session-authority';
import type { ServerSession } from './security/server-session';

export type NetworkPatientCommitDenial = { status: 401 | 403; value: Record<string, unknown> };
type Transaction = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
export type NetworkPatientCommitGuard = (tx: Transaction) => NetworkPatientCommitDenial | null;

function setting(tx: Transaction, key: string): string | null {
    return tx.select({ value: settings.value }).from(settings)
        .where(eq(settings.key, key)).get()?.value ?? null;
}

/**
 * Revalidates the paired grant, mode and session in the caller's transaction.
 * The caller fences the archive before checking its generation-bound grant.
 */
export function revalidatePairedCommitAuthority(
    tx: Transaction,
    input: {
        request: Request;
        session: ServerSession;
        binding: PairedNativeBinding;
        archiveGeneration: string | undefined;
        requiredCapabilities?: readonly string[];
    },
): NetworkPatientCommitDenial | null {
    const rawPairing = setting(tx, NETWORK_PAIRING_STATE_KEY);
    let bound = false;
    try {
        bound = rawPairing !== null && JSON.parse(rawPairing).archiveGeneration === input.archiveGeneration;
    } catch { /* Invalid grants fail closed. */ }
    const paired = authenticatePairedClientRequest(input.request,
        parseNetworkPairingState(bound ? rawPairing : null).clients);
    const { clientId, clientPlatform, tokenHash } = input.binding;
    const binding = { clientId, clientPlatform, tokenHash };
    if (!paired || paired.clientId !== binding.clientId
        || paired.tokenHash !== binding.tokenHash
        || paired.clientPlatform !== binding.clientPlatform) {
        return { status: 401, value: { error: 'Unauthorized' } };
    }
    const mode = evaluateNetworkDataPlaneModeGate(normalizeNetworkOperatingMode(setting(tx, NETWORK_MODE_KEY)));
    if (!mode.allowed) return { status: mode.status, value: mode.value };
    const capabilities = input.requiredCapabilities ?? [];
    if (!capabilities.every(value => paired.grantedCapabilities.includes(value))) return { status: 403, value: { error: 'Forbidden' } };
    if (!isCurrentServerSession(input.session, binding)) return { status: 401, value: { error: 'Unauthorized' } };
    return null;
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
        assertArchiveGeneration(tx, generation);
        const denial = revalidatePairedCommitAuthority(tx, {
            request: context.request,
            session: context.session,
            binding: context.pairedClient,
            archiveGeneration: generation,
            requiredCapabilities: capabilities,
        });
        if (denial) return denial;
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
