import assert from 'node:assert/strict';
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
const { resolve } = await import('./web-auth-lifecycle-owner-adapter.ts');
const generation = readSqliteArchiveGeneration(database);
const store = createAgentMandateStore(database);
test.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
for (const reason of ['manual', 'inactivity', 'unrecognized'] as const) test(`${reason} lock removes the Web session and applies the corresponding mandate policy`, async () => {
    const actor = `synthetic-mandate-lock-${reason}`;
    database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)').run(actor, actor, 'admin', 'synthetic-hash', 'synthetic-wrapped', 'synthetic-salt');
    const context = issueSyntheticWebSessionContext({ id: actor, username: actor, role: 'admin' }, randomUUID());
    const mandate = store.create({ id: randomUUID(), durationMs: 43200000, operations: ['visita.nota'], provider: 'local', allowsClinicalEgress: false,
        publicKey: 'B' + 'A'.repeat(86) + '=', wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) }, actor, generation);
    const request = new Request('http://127.0.0.1/api/auth/lock', { method: 'POST', headers: { 'x-mediflow-lock-reason': reason } });
    const mutation = Object.freeze({ controlId: context.controlId, ifMatch: context.etag, idempotencyKey: randomUUID() });
    const result = await completeExactWebP3ApplicationLock({ name: 'mediflow_session', value: context.session.id }, mutation, request);
    assert.equal((await result.json()).state, 'server_invalidation_confirmed');
    assert.notEqual(resolve(context.session.id, context.controlId).status, 'active');
    const deposit = () => database.transaction(() => store.admit(mandate.id, 'visita.nota')).immediate();
    if (reason === 'inactivity') { assert.equal(store.read(mandate.id)?.revokedAt, null); assert.equal(deposit().id, mandate.id); }
    else { assert.notEqual(store.read(mandate.id)?.revokedAt, null); assert.throws(deposit, /AGENT_MANDATE_DENIED/); }
});
