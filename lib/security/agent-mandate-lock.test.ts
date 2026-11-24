import assert from 'node:assert/strict';
import { syntheticWebClientRequest } from './loopback-ingress-test-fixture';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-mandate-lock-'));
process.env.MEDIFLOW_DATA_DIR = directory; process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { openDbServer } = await import('../db-server.ts');
const database = openDbServer();
const { createAgentMandateStore } = await import('../agent-mandate-store.ts');
const { readSqliteArchiveGeneration } = await import('../archive-generation.ts');
const { completeExactWebP3ApplicationLock } = await import('./web-auth-application-lock-server.ts');
const { issueSyntheticWebSessionContext } = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const { bootstrapControl, resolve } = await import('./web-auth-lifecycle-owner-adapter.ts');
const generation = readSqliteArchiveGeneration(database);
const store = createAgentMandateStore(database);
test.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
function lockFixture(label: string, reason = 'manual') {
    const actor = `synthetic-mandate-lock-${label}`;
    database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)').run(actor, actor, 'admin', 'synthetic-hash', 'synthetic-wrapped', 'synthetic-salt');
    const context = issueSyntheticWebSessionContext({ id: actor, username: actor, role: 'admin' }, randomUUID());
    const mandate = store.create({ id: randomUUID(), durationMs: 43200000, operations: ['visita.nota'], provider: 'local', allowsClinicalEgress: false,
        publicKey: 'B' + 'A'.repeat(86) + '=', wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) }, actor, generation);
    const request = syntheticWebClientRequest('http://127.0.0.1/api/auth/lock', { method: 'POST', headers: { 'x-mediflow-lock-reason': reason } });
    const mutation = Object.freeze({ controlId: context.controlId, ifMatch: context.etag, idempotencyKey: randomUUID() });
    return { context, mandate, mutation, lock: (next = mutation) =>
        completeExactWebP3ApplicationLock({ name: 'mediflow_session', value: context.session.id }, next, request) };
}

for (const reason of ['manual', 'inactivity', 'unrecognized'] as const) test(`${reason} lock removes the Web session and applies the corresponding mandate policy`, async () => {
    const { context, mandate, lock } = lockFixture(reason, reason);
    const result = await lock();
    assert.equal((await result.json()).state, 'server_invalidation_confirmed');
    assert.notEqual(resolve(context.session.id, context.controlId).status, 'active');
    const deposit = () => database.transaction(() => store.admit(mandate.id, 'visita.nota')).immediate();
    if (reason === 'inactivity') { assert.equal(store.read(mandate.id)?.revokedAt, null); assert.equal(deposit().id, mandate.id); }
    else { assert.notEqual(store.read(mandate.id)?.revokedAt, null); assert.throws(deposit, /AGENT_MANDATE_DENIED/); }
});

test('a stale lock fence keeps the Web session and the mandate active', async () => {
    const { context, mandate, mutation, lock } = lockFixture('stale');
    const stale = bootstrapControl();
    assert.ok(stale && stale.etag !== mutation.ifMatch);
    const result = await lock(Object.freeze({ ...mutation, ifMatch: stale.etag }));
    assert.equal((await result.json()).state, 'server_invalidation_unconfirmed');
    assert.equal(resolve(context.session.id, context.controlId).status, 'active');
    assert.equal(store.read(mandate.id)?.revokedAt, null);
    assert.equal((await (await lock(Object.freeze({ ...mutation, idempotencyKey: randomUUID() }))).json()).state, 'server_invalidation_confirmed');
    assert.notEqual(store.read(mandate.id)?.revokedAt, null);
});

test('failed mandate audit retires the Web session and cannot confirm the lock on retry', async () => {
    const { context, mandate, mutation, lock } = lockFixture('failed-audit');
    database.exec(`CREATE TRIGGER synthetic_revoke_audit_failure BEFORE INSERT ON audit_events
        WHEN NEW.event_type='agent.mandate.revoked' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_REVOKE_AUDIT_FAILURE'); END`);
    try {
        const result = await lock();
        assert.equal((await result.json()).state, 'server_invalidation_unconfirmed');
        assert.notEqual(resolve(context.session.id, context.controlId).status, 'active');
        assert.equal(store.read(mandate.id)?.revokedAt, null);
        const etag = result.headers.get('etag')?.slice(1, -1);
        assert.ok(etag && etag !== mutation.ifMatch);
        const replay = await lock();
        assert.equal((await replay.json()).state, 'server_invalidation_unconfirmed');
        const retry = await lock(Object.freeze({ ...mutation, ifMatch: etag, idempotencyKey: randomUUID() }));
        assert.equal((await retry.json()).state, 'server_invalidation_unconfirmed');
    } finally { database.exec('DROP TRIGGER synthetic_revoke_audit_failure'); }
});
