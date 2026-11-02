import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
/* WUL-800, coorte 3: passaggi di stato e data di fine delle terapie su SQLite reale. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { THERAPY_TRANSITIONS, isTherapyTransitionAllowed } from './clinical-status-transitions.ts';

const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'therapy-transitions-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
bindSyntheticArchiveSessions('synthetic-session', 'synthetic-native', 'synthetic-local-api');
const { patients, therapies } = await import('./schema.ts');
const { updateTherapyOperation } = await import('./therapy-write-operation.ts');
const { auditContextFromSession } = await import('./security/audit.ts');
const sql = new Database(join(dir, 'medical.db'));
test.after(() => { sql.close(); dbServer.$client.close(); });

const decision = JSON.parse(readFileSync(new URL('../docs/domain/clinical-status-transitions.json', import.meta.url), 'utf8')) as
    { therapy: Record<string, string[]> };
const STATUSES = ['active', 'suspended', 'completed'] as const;
const syntheticOperator = ['synthetic', 'therapy', 'operator', String(process.pid)].join('-');
const session = { id: 'synthetic-session', userId: 'synthetic-user', username: syntheticOperator, role: 'admin' as const,
    authChannel: 'web' as const, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const actor = auditContextFromSession(session);
const audit = { actorType: actor.actorType, actorRef: actor.actorRef, sourceSurface: actor.sourceSurface, requestId: 'synthetic-request',
    flags: [], archiveGeneration: actor.archiveGeneration };
const savedEnd = new Date('2026-05-20T00:00:00.000Z');
const moment = new Date('2026-06-15T10:00:00.000Z');
let n = 0;

function seed(status: string, endDate: Date | null = null): string {
    const patientId = `synthetic-therapy-patient-${++n}`;
    const therapyId = `synthetic-therapy-${n}`;
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: `synthetic-tax-${n}` }).run();
    dbServer.insert(therapies).values({ id: therapyId, patientId, drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose',
        status, version: 2, startDate: new Date('2026-01-01'), endDate }).run();
    return therapyId;
}
function row(therapyId: string) {
    return sql.prepare('SELECT status, version, end_date AS endDate FROM therapies WHERE id=?').get(therapyId) as
        { status: string; version: number; endDate: number | null };
}
function auditCount(therapyId: string) {
    return (sql.prepare('SELECT count(*) AS total FROM audit_events WHERE subject_ref=?').get(therapyId) as { total: number }).total;
}
function update(therapyId: string, values: Record<string, unknown>, expectedVersion = 2) {
    return updateTherapyOperation({ therapyId, expectedVersion, values: { ...values, updatedAt: moment },
        changedFields: Object.keys(values), mode: 'web', audit, occurredAt: moment });
}
const seconds = (date: Date) => date.getTime() / 1000;

test('the product table is exactly the decided one', () => {
    assert.deepEqual(
        Object.fromEntries(Object.entries(THERAPY_TRANSITIONS).map(([from, targets]) => [from, [...targets].sort()])),
        Object.fromEntries(Object.entries(decision.therapy).map(([from, targets]) => [from, [...targets].sort()])),
    );
});

test('every pair of therapy states is accepted or refused on the server as decided', () => {
    for (const from of STATUSES) {
        for (const to of STATUSES) {
            const expected = from === to || decision.therapy[from].includes(to);
            assert.equal(isTherapyTransitionAllowed(from, to), expected, `${from} -> ${to}`);
            const therapyId = seed(from, from === 'completed' ? savedEnd : null);
            const result = update(therapyId, { status: to });
            assert.equal(result.status, expected ? 200 : 409, `${from} -> ${to}`);
            assert.equal(row(therapyId).status, expected ? to : from);
            assert.equal(auditCount(therapyId), expected ? 1 : 0);
        }
    }
});

test('completed never goes straight to suspended, and says why', () => {
    const therapyId = seed('completed', savedEnd);
    const result = update(therapyId, { status: 'suspended' });
    assert.deepEqual(result.value, { error: 'Status transition not allowed', code: 'status_transition_not_allowed', entity: 'therapy', from: 'completed', to: 'suspended' });
    assert.deepEqual(row(therapyId), { status: 'completed', version: 2, endDate: seconds(savedEnd) });
});

test('completing keeps a given or saved end date, otherwise uses the moment of the change', () => {
    const fresh = seed('active');
    assert.equal(update(fresh, { status: 'completed' }).status, 200);
    assert.equal(row(fresh).endDate, seconds(moment));

    const planned = seed('active', savedEnd);
    assert.equal(update(planned, { status: 'completed' }).status, 200);
    assert.equal(row(planned).endDate, seconds(savedEnd));

    const given = seed('suspended');
    const chosen = new Date('2026-06-01T00:00:00.000Z');
    assert.equal(update(given, { status: 'completed', endDate: chosen }).status, 200);
    assert.equal(row(given).endDate, seconds(chosen));
});

test('reactivating clears the end date unless the request sets a planned one', () => {
    const cleared = seed('completed', savedEnd);
    assert.equal(update(cleared, { status: 'active' }).status, 200);
    assert.equal(row(cleared).endDate, null);

    const planned = seed('suspended');
    const plannedEnd = new Date('2026-07-01T00:00:00.000Z');
    assert.equal(update(planned, { status: 'active', endDate: plannedEnd }).status, 200);
    assert.equal(row(planned).endDate, seconds(plannedEnd));
});

test('suspending leaves the end date alone', () => {
    const therapyId = seed('active', savedEnd);
    assert.equal(update(therapyId, { status: 'suspended' }).status, 200);
    assert.equal(row(therapyId).endDate, seconds(savedEnd));
});

test('completing with an empty end date, as Apple sends with the switch off, uses the saved date or the moment', () => {
    const therapyId = seed('active');
    assert.equal(update(therapyId, { status: 'completed', endDate: null }).status, 200);
    assert.equal(row(therapyId).endDate, seconds(moment));
});

test('a completed therapy cannot lose its end date', () => {
    const therapyId = seed('completed', savedEnd);
    const result = update(therapyId, { endDate: null });
    assert.equal(result.status, 409);
    assert.equal(result.value.code, 'therapy_end_date_required');
    assert.deepEqual(row(therapyId), { status: 'completed', version: 2, endDate: seconds(savedEnd) });
    assert.equal(auditCount(therapyId), 0);
});

test('saved aliases follow their canonical status and existing rows are not rewritten', () => {
    const stopped = seed('completed', savedEnd);
    sql.prepare("UPDATE therapies SET status='stopped' WHERE id=?").run(stopped);
    assert.equal(update(stopped, { status: 'suspended' }).status, 409);
    assert.equal(row(stopped).status, 'stopped');

    const legacy = seed('completed', null);
    assert.equal(update(legacy, { dosage: 'ENC:synthetic:changed', endDate: null }).status, 200);
    assert.deepEqual(row(legacy), { status: 'completed', version: 3, endDate: null });
});
