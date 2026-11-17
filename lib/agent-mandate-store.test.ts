import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { initializeSqliteSchema } from './sqlite-schema';
import { readSqliteArchiveGeneration, rotateSqliteArchiveGeneration } from './archive-generation';
import { createAgentMandateStore } from './agent-mandate-store';
import { MANDATE_MAX_DURATION_MS, type AgentMandateInput } from './agent-mandate-contract';

function fixture() {
    const database = new Database(':memory:');
    database.pragma('foreign_keys=ON'); initializeSqliteSchema(database);
    database.prepare("INSERT INTO users(id,username,password_hash,encrypted_master_key,salt) VALUES ('synthetic-doctor','synthetic-mandate-doctor','synthetic-hash','synthetic-wrapping','synthetic-salt')").run();
    let time = 1900000000000;
    const store = createAgentMandateStore(database, () => time);
    const generation = readSqliteArchiveGeneration(database);
    const input: AgentMandateInput = { id: randomUUID(), durationMs: MANDATE_MAX_DURATION_MS, operations: ['visita.apri', 'visita.nota'],
        provider: 'openai', allowsClinicalEgress: true, publicKey: 'B' + 'A'.repeat(86) + '=', wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) };
    return { database, store, generation, input, advance: (milliseconds: number) => { time += milliseconds; },
        create: () => store.create(input, 'synthetic-doctor', generation),
        deposit: () => database.transaction(() => { store.admit(input.id, 'visita.nota'); database.prepare("INSERT INTO settings(key,value) VALUES ('synthetic-deposit','ciphertext')").run(); }).immediate(),
        count: () => database.prepare("SELECT count(*) FROM settings WHERE key='synthetic-deposit'").pluck().get() };
}

test('mandate persists declared scope, provider, expiry and wrapped key with its audit', () => {
    const f = fixture();
    try {
        const mandate = f.create();
        assert.equal(mandate.expiresAt - mandate.createdAt, MANDATE_MAX_DURATION_MS);
        assert.equal(mandate.actorRef, 'synthetic-doctor');
        assert.equal(mandate.wrappedPrivateKey, f.input.wrappedPrivateKey);
        assert.deepEqual(f.store.list('synthetic-doctor'), [mandate]);
        assert.deepEqual(f.store.list('other'), []);
        const audit = f.database.prepare("SELECT event_type,actor_ref,outcome FROM audit_events WHERE subject_ref=?").get(mandate.id);
        assert.deepEqual(audit, { event_type: 'agent.mandate.created', actor_ref: 'synthetic-doctor', outcome: 'success' });
        assert.throws(() => f.store.admit(mandate.id, 'visita.nota'), /AGENT_MANDATE_DENIED/);
        f.deposit(); assert.equal(f.count(), 1);
    } finally { f.database.close(); }
});

for (const durationMs of [0, -1, MANDATE_MAX_DURATION_MS + 60000, NaN, Infinity, 1.5]) test(`invalid duration ${durationMs} produces no mandate or audit`, () => {
    const f = fixture();
    try {
        assert.throws(() => f.store.create({ ...f.input, durationMs }, 'synthetic-doctor', f.generation), /AGENT_MANDATE_DENIED/);
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_mandates').pluck().get(), 0);
        assert.equal(f.database.prepare('SELECT count(*) FROM audit_events').pluck().get(), 0);
    } finally { f.database.close(); }
});

for (const reason of ['expiry', 'revocation', 'archive', 'scope'] as const) test(`${reason} denies the next transaction without deposit`, () => {
    const f = fixture();
    try {
        f.create();
        if (reason === 'expiry') f.advance(MANDATE_MAX_DURATION_MS);
        if (reason === 'revocation') f.store.revoke(f.input.id, 'synthetic-doctor', f.generation);
        if (reason === 'archive') f.database.transaction(() => rotateSqliteArchiveGeneration(f.database)).immediate();
        if (reason === 'scope') f.database.prepare('UPDATE agent_mandates SET operations=?').run(JSON.stringify(['visita.apri']));
        const before = performance.now();
        assert.throws(f.deposit, /AGENT_MANDATE_DENIED/);
        assert.ok(performance.now() - before < 1000);
        assert.equal(f.count(), 0);
    } finally { f.database.close(); }
});

for (const operation of ['create', 'revoke'] as const) test(`failed ${operation} audit rolls back the complete mandate transition`, () => {
    const f = fixture();
    try {
        if (operation === 'revoke') f.create();
        f.database.exec("CREATE TRIGGER synthetic_mandate_audit_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'SYNTHETIC_MANDATE_AUDIT_FAILURE'); END");
        assert.throws(() => operation === 'create' ? f.create() : f.store.revoke(f.input.id, 'synthetic-doctor', f.generation), /SYNTHETIC_MANDATE_AUDIT_FAILURE/);
        if (operation === 'create') assert.equal(f.store.read(f.input.id), null);
        else assert.equal(f.store.read(f.input.id)?.revokedAt, null);
    } finally { f.database.close(); }
});

test('revocation is repeatable, cannot be performed by another actor and cannot revive the mandate', () => {
    const f = fixture();
    try {
        f.create();
        assert.throws(() => f.store.revoke(f.input.id, 'other', f.generation), /AGENT_MANDATE_DENIED/);
        f.store.revoke(f.input.id, 'synthetic-doctor', f.generation);
        f.store.revoke(f.input.id, 'synthetic-doctor', f.generation);
        assert.equal(f.database.prepare("SELECT count(*) FROM audit_events WHERE event_type='agent.mandate.revoked'").pluck().get(), 1);
        assert.throws(f.create);
        assert.throws(f.deposit, /AGENT_MANDATE_DENIED/);
    } finally { f.database.close(); }
});

test('manual revocation of multiple mandates rolls back all revocations when the last audit fails', () => {
    const f = fixture();
    try {
        f.create();
        const second = f.store.create({ ...f.input, id: randomUUID() }, 'synthetic-doctor', f.generation);
        f.database.exec("CREATE TRIGGER synthetic_last_mandate_audit_failure BEFORE INSERT ON audit_events WHEN (SELECT count(*) FROM audit_events WHERE event_type='agent.mandate.revoked')=1 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_LAST_MANDATE_AUDIT_FAILURE'); END");
        assert.throws(() => f.store.revokeAll('synthetic-doctor', f.generation), /SYNTHETIC_LAST_MANDATE_AUDIT_FAILURE/);
        assert.equal(f.store.read(f.input.id)?.revokedAt, null); assert.equal(f.store.read(second.id)?.revokedAt, null);
        assert.equal(f.database.prepare("SELECT count(*) FROM audit_events WHERE event_type='agent.mandate.revoked'").pluck().get(), 0);
    } finally { f.database.close(); }
});

test('account erasure removes its authority rather than being blocked by mandate foreign keys', () => {
    const f = fixture();
    try {
        f.create();
        f.database.prepare("DELETE FROM users WHERE id='synthetic-doctor'").run();
        assert.equal(f.store.read(f.input.id), null);
        assert.throws(f.deposit, /AGENT_MANDATE_DENIED/);
    } finally { f.database.close(); }
});
