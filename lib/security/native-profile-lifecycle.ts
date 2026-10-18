import 'server-only';

import { eq } from 'drizzle-orm';
import { dbServer } from '../db-server';
import { settings, users } from '../schema';
import { NETWORK_MODE_KEY, normalizeNetworkOperatingMode } from '../network-contract';
import { NETWORK_PAIRING_STATE_KEY, parseNetworkPairingState } from '../network-pairing-model';
import { serverSessions, type NativeSessionResourcePort, type NativeSessionResourceUse,
    type NativeSessionResourceBinding, type WebResourceDisposer } from './web-auth-lifecycle-owner-adapter';

export type NativeProfilePort = NativeSessionResourcePort;

function current(binding: NativeSessionResourceBinding): boolean {
    const setting = (key: string) => dbServer.select({ value: settings.value }).from(settings)
        .where(eq(settings.key, key)).get()?.value ?? null;
    if (normalizeNetworkOperatingMode(setting(NETWORK_MODE_KEY)) !== 'network-home-base') return false;
    const client = parseNetworkPairingState(setting(NETWORK_PAIRING_STATE_KEY)).clients
        .find(value => value.clientId === binding.clientId);
    const user = dbServer.select({ username: users.username, role: users.role }).from(users)
        .where(eq(users.id, binding.principalRef)).get();
    return Boolean(client && client.clientPlatform === binding.clientPlatform && client.tokenHash === binding.tokenHash
        && client.grantedCapabilities.includes('network.replica.readonly-patients')
        && user && user.username === binding.username && (user.role ?? 'user') === binding.role);
}

export function withCurrentResourceBinding(use: unknown, operation: (binding: NativeSessionResourceBinding) => void): boolean {
    let accepted = false;
    try {
        const valid = serverSessions.withCurrentNativeSessionResourceBinding(use, binding => {
            if (!current(binding)) return;
            operation(binding);
            accepted = current(binding);
        });
        return valid && accepted;
    } catch { return false; }
}

export function beginResourceUse(port: unknown): NativeSessionResourceUse | null {
    const use = serverSessions.beginNativeSessionResourceUse(port);
    if (use && withCurrentResourceBinding(use, () => undefined)) return use;
    if (use) serverSessions.abortNativeSessionResourceUse(use);
    return null;
}

export function commitResourceUse(use: unknown): boolean {
    if (withCurrentResourceBinding(use, () => undefined)) return serverSessions.commitNativeSessionResourceUse(use);
    serverSessions.abortNativeSessionResourceUse(use);
    return false;
}

export function mintResourcePort(session: unknown): NativeProfilePort | null {
    const port = serverSessions.mintNativeSessionResourcePort(session);
    if (!port) return null;
    const use = beginResourceUse(port);
    if (use && commitResourceUse(use)) return port;
    if (use) serverSessions.abortNativeSessionResourceUse(use);
    serverSessions.releaseNativeSessionResourcePort(port);
    return null;
}

export const abortResourceUse = serverSessions.abortNativeSessionResourceUse;
export const releaseResourcePort = serverSessions.releaseNativeSessionResourcePort;
export function registerPrivateResource(port: unknown, dispose: WebResourceDisposer) {
    const use = beginResourceUse(port);
    if (!use) return null;
    try {
        const registration = serverSessions.registerNativeSessionPrivateResource(port, dispose);
        if (registration && commitResourceUse(use)) return registration;
        if (registration) serverSessions.unregisterNativeSessionPrivateResource(port, registration);
        return null;
    } finally { abortResourceUse(use); }
}
export const unregisterPrivateResource = serverSessions.unregisterNativeSessionPrivateResource;
