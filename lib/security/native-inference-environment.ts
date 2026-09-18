/* @Codex */
import 'server-only';
import { eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from '../db-server';
import { settings, users } from '../schema';
import { NETWORK_MODE_KEY, normalizeNetworkOperatingMode } from '../network-contract';
import { NETWORK_PAIRING_STATE_KEY, parseNetworkPairingState } from '../network-pairing-model';
import type { NativeSessionResourceBinding } from './web-auth-lifecycle-owner-adapter';

// Deliberately fixed production reads. There is no configurable authority source.
// native.ai.configure is not considered here: configuration cannot grant inference.
export function withCurrentNativeInferenceEnvironment(
    binding: NativeSessionResourceBinding, operation: () => void,
): boolean {
    const setting = (key: string) => dbServer.select({ value: settings.value })
        .from(settings).where(eq(settings.key, key)).get()?.value ?? null;
    const current = () => {
        if (normalizeNetworkOperatingMode(setting(NETWORK_MODE_KEY)) !== 'network-home-base') return false;
        const client = parseNetworkPairingState(setting(NETWORK_PAIRING_STATE_KEY)).clients
            .find(value => value.clientId === binding.clientId);
        const user = dbServer.select({ username: users.username, role: users.role })
            .from(users).where(eq(users.id, binding.principalRef)).get();
        return Boolean(client && client.clientPlatform === 'macos' && client.tokenHash === binding.tokenHash
            && client.grantedCapabilities.includes('network.ai.central-runtime')
            && client.grantedCapabilities.includes('network.replica.readonly-patients')
            && user && user.username === binding.username && user.role === binding.role
            && (user.role === 'admin' || user.role === 'user'));
    };
    try {
        return runDbServerImmediateTransaction(() => {
            if (!current()) return false;
            operation();
            return current();
        });
    } catch { return false; }
}
