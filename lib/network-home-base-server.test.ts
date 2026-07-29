/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { settings } from './schema';
import type { NetworkPairingState } from './network-pairing-model';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-network-home-base-'));
process.env.MEDIFLOW_DATA_DIR = DATA_DIR;

function bootstrapDatabase(): void {
    const sqlite = new Database(path.join(DATA_DIR, 'medical.db'));
    try {
        const migrationsDir = path.join(ROOT_DIR, 'drizzle');
        const migrationFiles = fs
            .readdirSync(migrationsDir)
            .filter((file) => file.endsWith('.sql'))
            .sort((left, right) => left.localeCompare(right));
        for (const fileName of migrationFiles) {
            const sql = fs
                .readFileSync(path.join(migrationsDir, fileName), 'utf8')
                .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
            if (sql.trim().length > 0) sqlite.exec(sql);
        }
    } finally {
        sqlite.close();
    }
}

bootstrapDatabase();

const { dbServer } = await import('./db-server.ts');
const {
    confirmNetworkPairingIntent,
    loadNetworkPairingState,
    mutateNetworkPairingState,
    postNetworkPairingIntent,
} = await import('./network-home-base-server.ts');
const {
    hashNetworkPairedClientToken,
    NETWORK_PAIRING_STATE_KEY,
    removePairedClient,
    serializeNetworkPairingState,
} = await import('./network-pairing-model.ts');
const { authenticatePairedClientRequest } = await import('./network-paired-client-auth.ts');
const { NETWORK_MODE_KEY } = await import('./network-contract.ts');

function syntheticClient(clientId: string, token: string) {
    return {
        clientId,
        deviceName: `Dispositivo sintetico ${clientId}`,
        clientPlatform: 'ios' as const,
        appVersion: null,
        grantedCapabilities: ['network.replica.readonly-patients'],
        pairedAt: '2026-07-29T10:00:00.000Z',
        lastSeenAt: null,
        sourceIntentId: `intent-${clientId}`,
        tokenHash: hashNetworkPairedClientToken(token),
    };
}

function writeStateDirectly(state: NetworkPairingState): void {
    const serialized = serializeNetworkPairingState(state);
    dbServer
        .insert(settings)
        .values({ key: NETWORK_PAIRING_STATE_KEY, value: serialized })
        .onConflictDoUpdate({ target: settings.key, set: { value: serialized } })
        .run();
}

function pairedRequest(clientId: string, token: string): Request {
    return new Request('http://localhost/api/v1/network/patients', {
        headers: {
            'x-mediflow-paired-client-id': clientId,
            'x-mediflow-paired-client-token': token,
        },
    });
}

test('la primitiva CAS rilegge dopo una scrittura interferente e preserva entrambi gli effetti', async () => {
    const tokenA = 'synthetic-token-a';
    const tokenB = 'synthetic-token-b';
    writeStateDirectly({
        intents: [],
        clients: [syntheticClient('client-a', tokenA), syntheticClient('client-b', tokenB)],
    });

    let mutatorCalls = 0;
    const outcome = await mutateNetworkPairingState((state) => {
        mutatorCalls += 1;
        if (mutatorCalls === 1) {
            // Writer concorrente: rimuove client-b tra la lettura e la CAS.
            writeStateDirectly({
                intents: state.intents,
                clients: state.clients.filter((client) => client.clientId !== 'client-b'),
            });
        }
        const result = removePairedClient(state, 'client-a');
        return result.ok
            ? { write: true, nextState: result.nextState, result }
            : { write: false, result };
    });

    assert.equal(outcome.conflict, false);
    assert.equal(mutatorCalls, 2);
    const finalState = await loadNetworkPairingState();
    assert.deepEqual(finalState.clients.map((client) => client.clientId), []);
});

test('una scrittura interferente non resuscita un client revocato', async () => {
    const tokenA = 'synthetic-token-revoked';
    const tokenC = 'synthetic-token-confirmed';
    writeStateDirectly({
        intents: [],
        clients: [syntheticClient('client-a', tokenA)],
    });

    let mutatorCalls = 0;
    const outcome = await mutateNetworkPairingState((state) => {
        mutatorCalls += 1;
        if (mutatorCalls === 1) {
            // Writer concorrente in stile conferma: aggiunge client-c sopra
            // lo stesso snapshot che contiene ancora client-a.
            writeStateDirectly({
                intents: [],
                clients: [...state.clients, syntheticClient('client-c', tokenC)],
            });
        }
        const result = removePairedClient(state, 'client-a');
        return result.ok
            ? { write: true, nextState: result.nextState, result }
            : { write: false, result };
    });

    assert.equal(outcome.conflict, false);
    assert.equal(mutatorCalls, 2);
    const finalState = await loadNetworkPairingState();
    assert.deepEqual(finalState.clients.map((client) => client.clientId), ['client-c']);

    const revoked = authenticatePairedClientRequest(pairedRequest('client-a', tokenA), finalState.clients);
    assert.equal(revoked, null);
    const survivor = authenticatePairedClientRequest(pairedRequest('client-c', tokenC), finalState.clients);
    assert.notEqual(survivor, null);
});

test('intent e conferma reali passano dalla primitiva e restano funzionanti', async () => {
    writeStateDirectly({ intents: [], clients: [] });
    dbServer
        .insert(settings)
        .values({ key: NETWORK_MODE_KEY, value: 'network-home-base' })
        .onConflictDoUpdate({ target: settings.key, set: { value: 'network-home-base' } })
        .run();

    const draft = await postNetworkPairingIntent({
        deviceName: 'iPad sintetico',
        clientPlatform: 'ipados',
        appVersion: '0.8.0',
        requestedCapabilities: ['network.replica.readonly-patients'],
    });
    assert.equal(draft.ok, true);
    if (!draft.ok) return;

    const confirmed = await confirmNetworkPairingIntent(draft.value.intentId);
    assert.equal(confirmed.status, 201);
    const finalState = await loadNetworkPairingState();
    assert.equal(finalState.intents.length, 0);
    assert.equal(finalState.clients.length, 1);

    await dbServer.delete(settings).where(eq(settings.key, NETWORK_MODE_KEY));
});
