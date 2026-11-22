import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPairingStateWriters, FIX_GUIDANCE, inspectPairingStateSource, resolvePairingKeyLiteral } from './check-pairing-state-writers.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('live repository allows only lib/network-home-base-server.ts to write NETWORK_PAIRING_STATE_KEY', () => {
    const result = checkPairingStateWriters(REPO_ROOT);
    assert.deepEqual(result.findings, []);
    assert.ok(result.checkedFiles > 100);
});

test('rejects a second production writer updating NETWORK_PAIRING_STATE_KEY via Drizzle or raw SQL', () => {
    const drizzleBypass = inspectPairingStateSource(
        'lib/rogue-pairing-writer.ts',
        `
        import { eq } from 'drizzle-orm';
        import { dbServer } from './db-server';
        import { settings } from './schema';
        import { NETWORK_PAIRING_STATE_KEY } from './network-pairing-model';
        export function revokeUnsafe(value: string) {
            dbServer.update(settings).set({ value }).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).run();
        }
        `,
    );
    assert.equal(drizzleBypass.length, 1);
    assert.ok(drizzleBypass[0].includes(FIX_GUIDANCE));

    const rawSqlBypass = inspectPairingStateSource(
        'app/api/v1/network/rogue/route.ts',
        `
        export function writeUnsafe(sqlite: { prepare(sql: string): { run(...args: unknown[]): void } }) {
            sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'network.pairing.state'").run('{}');
        }
        `,
        resolvePairingKeyLiteral(REPO_ROOT),
    );
    assert.equal(resolvePairingKeyLiteral(REPO_ROOT), 'network.pairing.state');
    assert.equal(rawSqlBypass.length, 1);
    assert.ok(rawSqlBypass[0].includes('mutateNetworkPairingState()'));
});

test('allows read-only production consumers of NETWORK_PAIRING_STATE_KEY', () => {
    const reader = inspectPairingStateSource(
        'lib/network-reader.ts',
        `
        import { eq } from 'drizzle-orm';
        import { dbServer } from './db-server';
        import { settings } from './schema';
        import { NETWORK_PAIRING_STATE_KEY, parseNetworkPairingState } from './network-pairing-model';
        export function readClients() {
            const row = dbServer.select().from(settings).where(eq(settings.key, NETWORK_PAIRING_STATE_KEY)).get();
            return parseNetworkPairingState(row?.value ?? null).clients;
        }
        `,
    );
    assert.deepEqual(reader, []);
});

test('flags canonical writer if immediate transaction or archive-generation fence is removed', () => {
    const weakened = inspectPairingStateSource(
        'lib/network-home-base-server.ts',
        `
        export function mutateNetworkPairingState() {
            dbServer.update(settings).set({ value: '{}' }).run();
        }
        `,
    );
    assert.equal(weakened.length, 1);
    assert.match(weakened[0], /runDbServerImmediateTransaction/);
});
