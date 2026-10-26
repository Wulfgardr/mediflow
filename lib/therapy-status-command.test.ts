import type { ServerSession } from './security/server-session';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
process.env.MEDIFLOW_DATA_DIR = mkdtempSync(join(tmpdir(), 'mediflow-status-command-'));
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server.ts');
const { patients, therapies, users } = load('./schema.ts') as typeof import('./schema.ts');
const { bindSyntheticArchiveSessions, issueSyntheticWebSession, retireSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture.ts');
const { executeTherapyStatusCommand, closeTherapyStatusCommand, readTherapyStatusReceipt } = load('./therapy-status-command-service.ts') as typeof import('./therapy-status-command-service.ts');
const generation = bindSyntheticArchiveSessions('synthetic-command-session');
const syntheticUsername = 'synthetic-command';
let session: ServerSession = { id: 'synthetic-command-session', userId: 'synthetic-command-actor', username: syntheticUsername, role: 'admin', authChannel: 'web' as const, createdAt: Date.now(), expiresAt: Date.now() + 600000 };
dbServer.insert(users).values({ id: session.userId, username: session.username, role: 'admin', passwordHash: 'synthetic', salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
session = issueSyntheticWebSession({ id: session.userId, username: session.username, role: 'admin' }, 'therapy-command');
const sql = openDbServer();
function fixture() {
    const patientId = randomUUID(), therapyId = randomUUID();
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: randomUUID() }).run();
    dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', version: 3, startDate: new Date(), endDate: new Date('2026-01-01T00:00:00Z') }).run();
    return { commandId: randomUUID(), protocol: 'therapy.status.change.v1' as const, archiveGeneration: generation, patientId, therapyId, expectedVersion: 3 };
}
function counts(command: ReturnType<typeof fixture>) {
    return { therapy: sql.prepare('SELECT status, version, end_date FROM therapies WHERE id=?').get(command.therapyId), audits: sql.prepare('SELECT count(*) AS n FROM audit_events WHERE subject_ref=?').get(command.therapyId), receipt: sql.prepare('SELECT * FROM therapy_status_commands WHERE command_id=?').get(command.commandId) };
}
test('one atomic commit, replay exact, host clock and no duplicate effect', () => {
    const command = fixture(), input = { ...command, target: 'completed' as const };
    const result = executeTherapyStatusCommand(session, input);
    assert.equal(result.outcome, 'applied');
    assert.equal(result.resultVersion, 4); assert.equal(result.resultEndDate, result.committedAt);
    assert.deepEqual(executeTherapyStatusCommand(session, input), result);
    assert.deepEqual(closeTherapyStatusCommand(session, command), result);
    assert.deepEqual(counts(command).audits, { n: 1 });
    assert.throws(() => executeTherapyStatusCommand(session, { ...input, target: 'suspended' }), /collision/);
});
test('close has no target, ignores current CAS and denies every late target', () => {
    const command = fixture(); sql.prepare('UPDATE therapies SET version=9 WHERE id=?').run(command.therapyId);
    const result = closeTherapyStatusCommand(session, command);
    assert.equal(result.outcome, 'closed'); assert.equal(result.target, null);
    for (const target of ['active', 'suspended', 'completed'] as const) {
        const outcome = executeTherapyStatusCommand(session, { ...command, target });
        assert.equal(outcome.outcome, 'closed');
    }
    assert.deepEqual(counts(command).audits, { n: 0 });
    assert.equal((counts(command).therapy as {version:number}).version, 9);
});
for (const [table, operation] of [['audit_events', 'INSERT'], ['therapies', 'UPDATE'], ['therapy_status_commands', 'INSERT']] as const) {
    for (const fault of ['ABORT', 'IGNORE']) test(`${table} ${fault} rolls back clinical effect, audit and receipt`, () => {
        const command = fixture(), before = counts(command);
        sql.exec(`CREATE TRIGGER synthetic_fault BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(${fault}${fault === 'ABORT' ? ", 'synthetic fault'" : ''}); END`);
        let failure: unknown;
        try { executeTherapyStatusCommand(session, { ...command, target: 'suspended' }); }
        catch (error) { failure = error; }
        finally { sql.exec('DROP TRIGGER synthetic_fault'); }
        assert.deepEqual(counts(command), before);
        assert(failure instanceof Error);
        assert.equal(readTherapyStatusReceipt(session, command).outcome, 'unknown');
    });
}
test('CAS rejection durable, absent unknown, wrong owner and system reader denied', () => {
    const command = fixture();
    assert.equal(readTherapyStatusReceipt(session, command).outcome, 'unknown');
    const result = executeTherapyStatusCommand(session, { ...command, expectedVersion: 1, target: 'active' });
    assert.equal(result.outcome, 'rejected');
    assert.throws(() => closeTherapyStatusCommand(session, command), /collision/);
    for (const other of [{ ...session, userId: 'other' }, { ...session, role: 'user' }, { ...session, authChannel: 'system' as const }])
        assert.throws(() => readTherapyStatusReceipt(other, command), /denied|collision/);
    assert.deepEqual(counts(command).audits, { n: 0 });
});
test('suspend preserves endDate and resume clears it with a host timestamp', () => {
    for (const target of ['suspended', 'active'] as const) {
        const command = fixture(), before = counts(command).therapy as {end_date:number};
        const result = executeTherapyStatusCommand(session, { ...command, target });
        assert.equal(result.resultEndDate, target === 'active' ? null : before.end_date);
        const audit = sql.prepare('SELECT occurred_at FROM audit_events WHERE event_id=?').get(result.auditEventId) as {occurred_at:number};
        const changed = sql.prepare('SELECT updated_at FROM therapies WHERE id=?').get(command.therapyId) as {updated_at:number};
        assert.equal(audit.occurred_at, result.committedAt); assert.equal(changed.updated_at, result.committedAt);
    }
});
test('all immutable binding collisions and malformed target denied without further effect', () => {
    const command = fixture(), input = { ...command, target: 'completed' as const };
    executeTherapyStatusCommand(session, input); const before = counts(command);
    for (const patch of [{ patientId: 'other' }, { therapyId: 'other' }, { expectedVersion: 2 }, { target: 'active' }, { archiveGeneration: randomUUID() }, { protocol: 'other' }, { target: true }, { actorRef: 'other' }]) {
        assert.throws(() => executeTherapyStatusCommand(session, { ...input, ...patch } as never));
        assert.deepEqual(counts(command), before);
    }
});
test('another authorized physician knowing an unreceived ID can retire it but cannot expose or execute the original owner command', () => {
    const command = fixture(), otherActor = 'synthetic-authorized-other';
    dbServer.insert(users).values({ id: otherActor, username: otherActor, role: 'admin', passwordHash: 'synthetic', salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
    const otherSession = issueSyntheticWebSession({ id: otherActor, username: otherActor, role: 'admin' }, 'other-physician');
    assert.equal(closeTherapyStatusCommand(otherSession, command).outcome, 'closed');
    assert.throws(() => executeTherapyStatusCommand(session, { ...command, target: 'completed' }), /denied/);
    assert.throws(() => readTherapyStatusReceipt(session, command), /denied/);
    assert.deepEqual(counts(command).audits, { n: 0 });
});
test('retired real owner projection cannot use a delayed request after lock', () => {
    const command = fixture(), before = counts(command);
    retireSyntheticWebSession(session);
    assert.throws(() => executeTherapyStatusCommand(session, { ...command, target: 'completed' }), /denied/);
    assert.throws(() => closeTherapyStatusCommand(session, command), /denied/);
    assert.throws(() => readTherapyStatusReceipt(session, command), /denied/);
    assert.deepEqual(counts(command), before);
});
test.after(() => dbServer.$client.close());
