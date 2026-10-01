/* @Codex: invented authority only, without login/PIN or production data. */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { dbServer } from './db-server';
import { settings, users } from './schema';
import { NETWORK_MODE_KEY } from './network-contract';
import { hashNetworkPairedClientToken, NETWORK_PAIRING_STATE_KEY, serializeNetworkPairingState,
    type StoredNetworkPairedClient } from './network-pairing-model';
import { createNativeServerSession, captureNativeLoginSessionFence } from './security/server-session';

export function installNetworkPatientCookieFixture(dataDir: string, state: {
    cookies: Map<string, string>; onCookies?: () => Promise<void> | void;
}) {
    const key = `network-patient-cookies-${dataDir}`;
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for(key)] = state;
    const file = join(dataDir, 'synthetic-cookies.cjs');
    writeFileSync(file, `const s=globalThis[Symbol.for(${JSON.stringify(key)})];
exports.cookies=async()=>{await s.onCookies?.();return {get:(name)=>s.cookies.has(name)?{name,value:s.cookies.get(name)}:undefined}};`);
    const load = createRequire(import.meta.url);
    const { registerHooks } = load('node:module') as { registerHooks: (hooks: {
        resolve: (specifier: string, context: unknown, next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean };
    }) => { deregister: () => void } };
    const hook = registerHooks({ resolve(specifier, context, next) {
        return specifier === 'next/headers' ? { url: pathToFileURL(file).href, shortCircuit: true } : next(specifier, context);
    } });
    return () => { hook.deregister(); delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for(key)]; };
}

export function syntheticNetworkPatientAuthority(db: typeof dbServer, scopeAmbulatoryId: string, options: {
    clientId?: string; userId?: string; requestId?: string;
} = {}) {
    const user = { id: options.userId ?? 'synthetic-patient-operator',
        username: ['synthetic', 'patient', 'operator'].join('-'), role: 'admin' };
    const token = 'synthetic-patient-device-token';
    const pairedClient: StoredNetworkPairedClient = {
        clientId: options.clientId ?? 'synthetic-patient-device', deviceName: 'Synthetic device', clientPlatform: 'ipados',
        appVersion: 'synthetic', grantedCapabilities: ['network.replica.write-patient-profile', 'network.replica.write-patient-lifecycle'],
        pairedAt: new Date().toISOString(), lastSeenAt: null, sourceIntentId: 'synthetic-intent',
        tokenHash: hashNetworkPairedClientToken(token),
    };
    db.insert(users).values({ ...user, passwordHash: 'synthetic-unusable', encryptedMasterKey: 'synthetic-unusable', salt: 'synthetic-unusable' })
        .onConflictDoNothing().run();
    for (const [key, value] of [[NETWORK_MODE_KEY, 'network-home-base'], [NETWORK_PAIRING_STATE_KEY,
        serializeNetworkPairingState({ clients: [pairedClient], intents: [] })]]) {
        db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    }
    const { clientId, clientPlatform, tokenHash } = pairedClient;
    const session = createNativeServerSession(user, { clientId, clientPlatform, tokenHash }, captureNativeLoginSessionFence());
    const request = new Request('http://127.0.0.1/api/v1/network/patients/synthetic-patient', { headers: {
        'x-mediflow-paired-client-id': pairedClient.clientId, 'x-mediflow-paired-client-token': token,
        'x-request-id': options.requestId ?? 'synthetic-patient-request',
    } });
    return { request, scopeAmbulatoryId, pairedClient, session };
}
