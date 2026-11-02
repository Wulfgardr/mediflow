import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
/* WUL-800, coorte 2: passaggi di stato delle visite su SQLite reale. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { CHECKUP_TRANSITIONS, isCheckupTransitionAllowed } from './clinical-status-transitions.ts';

const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'checkup-transitions-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
bindSyntheticArchiveSessions('synthetic-session', 'synthetic-native', 'synthetic-local-api');
const { patients, checkups } = await import('./schema.ts');
const { updateCheckupOperation } = await import('./checkup-write-operation.ts');
const { auditContextFromSession } = await import('./security/audit.ts');
const sql = new Database(join(dir, 'medical.db'));


test.after(() => { sql.close(); dbServer.$client.close(); });

const decision = JSON.parse(readFileSync(new URL('../docs/domain/clinical-status-transitions.json', import.meta.url), 'utf8')) as
    { checkup: Record<string, string[]> };
const STATUSES = ['pending', 'completed', 'cancelled'] as const;
const syntheticOperator = ['synthetic', 'checkup', 'operator', String(process.pid)].join('-');
const session = { id: 'synthetic-session', userId: 'synthetic-user', username: syntheticOperator, role: 'admin' as const,
    authChannel: 'web' as const, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const actor = auditContextFromSession(session);
const audit = { actorType: actor.actorType, actorRef: actor.actorRef, sourceSurface: actor.sourceSurface, requestId: 'synthetic-request',
    flags: [], archiveGeneration: actor.archiveGeneration };
let n = 0;

function seed(status: string): { patientId: string; checkupId: string } {
    const patientId = `synthetic-checkup-patient-${++n}`;
    const checkupId = `synthetic-checkup-${n}`;
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: `synthetic-tax-${n}` }).run();
    dbServer.insert(checkups).values({ id: checkupId, patientId, date: new Date('2026-06-01'), title: 'ENC:synthetic:title', status, version: 2 }).run();
    return { patientId, checkupId };
}
function row(checkupId: string) {
    return sql.prepare('SELECT status, version FROM checkups WHERE id=?').get(checkupId) as { status: string; version: number };
}
function auditCount(checkupId: string) {
    return (sql.prepare('SELECT count(*) AS total FROM audit_events WHERE subject_ref=?').get(checkupId) as { total: number }).total;
}
function update(checkupId: string, status: string, expectedVersion = 2) {
    return updateCheckupOperation({ checkupId, expectedVersion, values: { status, updatedAt: new Date() }, changedFields: ['status'], mode: 'web', audit });
}

test('the product table is exactly the decided one', () => {
    assert.deepEqual(
        Object.fromEntries(Object.entries(CHECKUP_TRANSITIONS).map(([from, targets]) => [from, [...targets].sort()])),
        Object.fromEntries(Object.entries(decision.checkup).map(([from, targets]) => [from, [...targets].sort()])),
    );
});

test('every pair of checkup states is accepted or refused on the server as decided', () => {
    for (const from of STATUSES) {
        for (const to of STATUSES) {
            const expected = from === to || decision.checkup[from].includes(to);
            assert.equal(isCheckupTransitionAllowed(from, to), expected, `${from} -> ${to}`);
            const { checkupId } = seed(from);
            const result = update(checkupId, to);
            assert.equal(result.status, expected ? 200 : 409, `${from} -> ${to}`);
            assert.deepEqual(row(checkupId), expected ? { status: to, version: 3 } : { status: from, version: 2 });
            assert.equal(auditCount(checkupId), expected ? 1 : 0);
        }
    }
});

test('completed and cancelled never swap directly, but both reopen to pending', () => {
    const { checkupId } = seed('completed');
    const refused = update(checkupId, 'cancelled');
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.value, {
        error: 'Status transition not allowed', code: 'status_transition_not_allowed', entity: 'checkup', from: 'completed', to: 'cancelled',
    });
    assert.equal(update(checkupId, 'pending').status, 200);
    assert.equal(update(checkupId, 'cancelled', 3).status, 200);
    assert.deepEqual(row(checkupId), { status: 'cancelled', version: 4 });
});

test('a stale version is a version conflict even when the transition is refused', () => {
    const { checkupId } = seed('completed');
    const result = update(checkupId, 'cancelled', 1);
    assert.equal(result.status, 409);
    assert.equal(result.value.code, 'VERSION_CONFLICT');
});

test('a legacy status outside the table can be brought to a valid one', () => {
    const { checkupId } = seed('pending');
    sql.prepare("UPDATE checkups SET status='done' WHERE id=?").run(checkupId);
    assert.equal(update(checkupId, 'completed').status, 200);
    assert.equal(row(checkupId).status, 'completed');
});

test('an update without a status is not a transition', () => {
    const { checkupId } = seed('completed');
    const result = updateCheckupOperation({ checkupId, expectedVersion: 2, values: { title: 'ENC:synthetic:changed', updatedAt: new Date() }, changedFields: ['title'], mode: 'web', audit });
    assert.equal(result.status, 200);
    assert.deepEqual(row(checkupId), { status: 'completed', version: 3 });
});
