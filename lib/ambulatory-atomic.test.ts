/* @Codex: synthetic real-SQLite characterization of eight ambulatory writes. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import type { ServerSession } from './security/server-session.ts';

const dataDir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'ambulatory-atomic-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer } = await import('./db-server.ts');
const schema = await import('./schema.ts');
const host = await import('./ambulatory-write.ts');
const paired = await import('./network-ambulatory-write.ts');
const sql = new Database(join(dataDir, 'medical.db'));
const baseline = process.env.MEDIFLOW_AMBULATORY_BASELINE === '1';
const observations: unknown[] = [];
let counter = 0;
const next = (label: string) => `synthetic-ambulatory-${++counter}-${label}`;
const session: ServerSession = {
    id: 'synthetic-session', userId: 'synthetic-user', username: next('username'),
    role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
};
const request = new Request('http://localhost/api/ambulatories', {
    headers: { 'x-request-id': 'synthetic-request', 'x-mediflow-source-surface': 'job' },
});
const pairedContext = {
    request, session: { ...session, authChannel: 'native' as const },
    pairedClient: { clientId: 'synthetic-paired' }, scopeAmbulatoryId: 'synthetic-scope',
} as Parameters<typeof paired.createNetworkAmbulatory>[0];
test.after(() => {
    if (process.env.MEDIFLOW_AMBULATORY_REPORT) {
        writeFileSync(process.env.MEDIFLOW_AMBULATORY_REPORT, JSON.stringify(observations, null, 2));
    }
    sql.close();
    dbServer.$client.close();
});

type Ids = ReturnType<typeof ids>;
function ids() {
    return {
        target: next('target'), fallback: next('fallback'), testOnlyA: next('test-only-a'),
        testOnlyB: next('test-only-b'), sharedLive: next('shared-live'),
        sharedNull: next('shared-null'), alreadyDeleted: next('already-deleted'),
        staleLegacy: next('stale-legacy'), live: next('live'), nullableLive: next('nullable-live'),
        otherTest: next('other-test'), child: next('child'),
    };
}
function ambulatory(id: string, type: 'live' | 'test' | null, isDefault: boolean, version = 3) {
    dbServer.insert(schema.ambulatories).values({ id, name: id, type, isDefault, version }).run();
}
function patient(id: string, legacyAmbulatoryId: string | null, deleted = false) {
    dbServer.insert(schema.patients).values({
        id, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax'),
        ambulatoryId: legacyAmbulatoryId, version: 3,
        deletedAt: deleted ? new Date('2026-05-01') : null,
    }).run();
}
function membership(patientId: string, ambulatoryId: string) {
    dbServer.insert(schema.patientsToAmbulatories).values({ patientId, ambulatoryId }).run();
}
const operations = [
    'host-create', 'host-update', 'host-delete', 'host-clear',
    'paired-create', 'paired-update', 'paired-delete', 'paired-clear',
] as const;
type Operation = typeof operations[number];
function prepare(op: Operation): Ids {
    const x = ids();
    if (op.endsWith('create')) {
        ambulatory(x.fallback, 'live', true);
    } else if (op.endsWith('update')) {
        ambulatory(x.fallback, 'live', true);
        ambulatory(x.target, 'live', false);
    } else if (op.endsWith('delete')) {
        ambulatory(x.fallback, 'live', false);
        ambulatory(x.target, 'live', true);
    } else {
        ambulatory(x.target, 'test', false);
        ambulatory(x.live, 'live', true);
        ambulatory(x.nullableLive, null, false);
        ambulatory(x.otherTest, 'test', false);
        patient(x.testOnlyA, null);
        patient(x.testOnlyB, null);
        patient(x.sharedLive, null);
        patient(x.sharedNull, null);
        patient(x.alreadyDeleted, null, true);
        patient(x.staleLegacy, x.target);
        for (const member of [x.testOnlyA, x.testOnlyB, x.sharedLive, x.sharedNull, x.alreadyDeleted]) {
            membership(member, x.target);
        }
        membership(x.sharedLive, x.live);
        membership(x.sharedNull, x.nullableLive);
        membership(x.staleLegacy, x.otherTest);
        dbServer.insert(schema.entries).values({
            id: x.child, patientId: x.testOnlyA, type: 'note',
            title: 'Synthetic child', date: new Date('2026-05-01'), content: 'ENC:synthetic:child',
        }).run();
    }
    return x;
}
function snapshot() {
    return {
        ambulatories: sql.prepare('SELECT * FROM ambulatories ORDER BY id').all(),
        patients: sql.prepare('SELECT * FROM patients ORDER BY id').all(),
        memberships: sql.prepare('SELECT * FROM patients_to_ambulatories ORDER BY patient_id, ambulatory_id').all(),
        children: sql.prepare('SELECT * FROM entries ORDER BY id').all(),
        audit: sql.prepare('SELECT * FROM audit_events ORDER BY rowid').all(),
    };
}
/* @Codex: reset only this test's synthetic domain rows; audit remains append-only. */
function resetSyntheticDomain() {
    dbServer.delete(schema.entries).run();
    dbServer.delete(schema.patientsToAmbulatories).run();
    dbServer.delete(schema.patients).run();
    dbServer.delete(schema.ambulatories).run();
}
async function invoke(op: Operation, x: Ids, version = 3) {
    const body = { id: x.target, name: 'Synthetic changed', type: 'live', isDefault: true };
    const update = { name: 'Synthetic changed', isDefault: true, version };
    switch (op) {
        case 'host-create': return host.createAmbulatory({ request, session }, body);
        case 'host-update': return host.updateAmbulatory({ request, session }, x.target, update);
        case 'host-delete': return host.deleteAmbulatory({ request, session }, x.target, version);
        case 'host-clear': return host.clearAmbulatory({ request, session }, x.target, version);
        case 'paired-create': return paired.createNetworkAmbulatory(pairedContext, body);
        case 'paired-update': return paired.updateNetworkAmbulatory(pairedContext, x.target, update);
        case 'paired-delete': return paired.deleteNetworkAmbulatory(pairedContext, x.target, { version });
        case 'paired-clear': return paired.clearNetworkAmbulatory(pairedContext, x.target, { version });
    }
}
type Fault = 'AUDIT_FAIL' | 'AUDIT_IGNORE' | 'SECOND_PATIENT_AUDIT_FAIL'
    | 'PRIMARY_DML_IGNORE' | 'SECONDARY_DML_IGNORE' | 'SECOND_PATIENT_DML_IGNORE'
    | 'MEMBERSHIP_DELETE_IGNORE';
function installFault(fault: Fault, op: Operation, x: Ids) {
    const signal = fault === 'AUDIT_FAIL' || fault === 'SECOND_PATIENT_AUDIT_FAIL'
        ? "RAISE(FAIL, 'synthetic failure')" : 'RAISE(IGNORE)';
    if (fault.startsWith('AUDIT_') || fault === 'SECOND_PATIENT_AUDIT_FAIL') {
        const predicate = fault === 'SECOND_PATIENT_AUDIT_FAIL'
            ? `WHEN NEW.event_type='patient.deleted' AND NEW.subject_ref='${x.testOnlyB}'` : '';
        sql.exec(`CREATE TRIGGER synthetic_fault BEFORE INSERT ON audit_events ${predicate} BEGIN SELECT ${signal}; END`);
    } else if (fault === 'PRIMARY_DML_IGNORE') {
        const verb = op.endsWith('create') ? 'INSERT' : op.endsWith('delete') ? 'DELETE' : 'UPDATE';
        const predicate = op.endsWith('create') ? `WHEN NEW.id='${x.target}'` : `WHEN OLD.id='${x.target}'`;
        sql.exec(`CREATE TRIGGER synthetic_fault BEFORE ${verb} ON ambulatories ${predicate} BEGIN SELECT RAISE(IGNORE); END`);
    } else if (fault === 'SECONDARY_DML_IGNORE') {
        const predicate = op.endsWith('delete') ? `WHEN OLD.id='${x.fallback}'` : `WHEN OLD.id='${x.fallback}'`;
        sql.exec(`CREATE TRIGGER synthetic_fault BEFORE UPDATE ON ambulatories ${predicate} BEGIN SELECT RAISE(IGNORE); END`);
    } else if (fault === 'SECOND_PATIENT_DML_IGNORE') {
        sql.exec(`CREATE TRIGGER synthetic_fault BEFORE UPDATE ON patients WHEN OLD.id='${x.testOnlyB}' BEGIN SELECT RAISE(IGNORE); END`);
    } else {
        sql.exec(`CREATE TRIGGER synthetic_fault BEFORE DELETE ON patients_to_ambulatories WHEN OLD.ambulatory_id='${x.target}' BEGIN SELECT RAISE(IGNORE); END`);
    }
}
async function capture(op: Operation, fault?: Fault) {
    resetSyntheticDomain();
    const x = prepare(op);
    const before = snapshot();
    const defaults = (before.ambulatories as Array<{ is_default: number }>).filter(row => row.is_default === 1);
    assert.equal(defaults.length, 1, `${op}/${fault ?? 'success'} must start with exactly one default`);
    assert.equal(before.ambulatories.length, op.endsWith('clear') ? 4 : op.endsWith('create') ? 1 : 2);
    if (fault) installFault(fault, op, x);
    let result: Awaited<ReturnType<typeof invoke>> | null = null;
    let error: string | null = null;
    try { result = await invoke(op, x); } catch (cause) { error = String(cause); }
    finally { if (fault) sql.exec('DROP TRIGGER synthetic_fault'); }
    const after = snapshot();
    observations.push({ op, fault: fault ?? null, ids: x, result, error, before, after });
    return { ids: x, result, error, before, after };
}

test('eight baseline successes and audit FAIL/IGNORE outcomes', async () => {
    for (const op of operations) {
        const success = await capture(op);
        assert.equal(success.error, null, op);
        assert.equal(success.result?.status, op.endsWith('create') ? 201 : 200, op);
        const auditDelta = success.after.audit.length - success.before.audit.length;
        const expectedEvents = baseline
            ? (op.endsWith('clear') ? (op.startsWith('paired') ? 3 : 2) : (op.startsWith('paired') ? 1 : 0))
            : (op.endsWith('clear') ? 3 : 2);
        assert.equal(auditDelta, expectedEvents, op);
        if (!baseline) {
            const events = (success.after.audit as Array<Record<string, unknown>>)
                .slice(success.before.audit.length);
            const mainType = `ambulatory.${op.endsWith('clear') ? 'cleared' : op.endsWith('create') ? 'created' : op.endsWith('update') ? 'updated' : 'deleted'}`;
            const main = events.find(event => event.event_type === mainType && event.subject_ref === success.ids.target);
            assert.ok(main, op);
            for (const event of events) {
                assert.equal(event.actor_ref, session.userId);
                assert.equal(event.source_surface, op.startsWith('paired') ? 'native' : 'web');
                assert.ok(!JSON.stringify(event).includes('Synthetic changed'));
                assert.ok(!JSON.stringify(event).includes('ENC:synthetic:child'));
                const metadata = JSON.parse(String(event.redacted_metadata));
                if (op.startsWith('paired')) {
                    assert.ok(metadata.flags.includes('auth:paired-client'));
                    assert.ok(metadata.flags.includes('paired-client:synthetic-paired'));
                }
            }
            const mainVersion = op.endsWith('create') ? 1 : op.endsWith('delete') ? 3 : 4;
            assert.equal(JSON.parse(String(main.redacted_metadata)).resourceVersion, mainVersion);
            if (op.endsWith('clear')) {
                const patientEvents = events.filter(event => event.event_type === 'patient.deleted');
                assert.equal(patientEvents.length, 2);
                assert.ok(patientEvents.every(event => JSON.parse(String(event.redacted_metadata)).resourceVersion === 3));
            } else {
                const indirect = events.find(event => event.subject_ref === success.ids.fallback);
                assert.equal(indirect?.event_type, 'ambulatory.updated');
                const metadata = JSON.parse(String(indirect?.redacted_metadata));
                assert.deepEqual(metadata.changedFields, ['isDefault']);
                assert.equal(metadata.resourceVersion, 4);
            }
        }
        if (op.endsWith('clear')) {
            const patients = new Map((success.after.patients as Array<Record<string, unknown>>)
                .map(row => [row.id, row]));
            const memberships = success.after.memberships as Array<Record<string, unknown>>;
            const deleted = (id: string) => patients.get(id)?.deleted_at !== null;
            assert.ok(deleted(success.ids.testOnlyA));
            assert.ok(deleted(success.ids.testOnlyB));
            assert.equal(deleted(success.ids.sharedLive), false);
            assert.equal(deleted(success.ids.sharedNull), false);
            assert.equal(deleted(success.ids.staleLegacy), false);
            assert.equal(patients.get(success.ids.alreadyDeleted)?.deleted_at,
                (success.before.patients as Array<Record<string, unknown>>)
                    .find(row => row.id === success.ids.alreadyDeleted)?.deleted_at);
            assert.ok(memberships.every(row => row.ambulatory_id !== success.ids.target));
            assert.ok(memberships.some(row => row.patient_id === success.ids.staleLegacy && row.ambulatory_id === success.ids.otherTest));
            assert.deepEqual(success.after.children, success.before.children);
        }
        for (const fault of ['AUDIT_FAIL', 'AUDIT_IGNORE'] as const) {
            const observed = await capture(op, fault);
            if (!baseline) {
                assert.ok(observed.error, `${op}/${fault}`);
                assert.deepEqual(observed.after, observed.before, `${op}/${fault}`);
            }
        }
    }
});

test('ignored primary and secondary DML outcomes', async () => {
    for (const op of operations) {
        const primary = await capture(op, 'PRIMARY_DML_IGNORE');
        if (!baseline) { assert.ok(primary.error, op); assert.deepEqual(primary.after, primary.before, op); }
        if (op.endsWith('clear')) continue;
        const secondary = await capture(op, 'SECONDARY_DML_IGNORE');
        if (!baseline) { assert.ok(secondary.error, op); assert.deepEqual(secondary.after, secondary.before, op); }
    }
});

test('clear faults at second patient audit, second tombstone and membership removal', async () => {
    for (const op of ['host-clear', 'paired-clear'] as const) {
        for (const fault of ['SECOND_PATIENT_AUDIT_FAIL', 'SECOND_PATIENT_DML_IGNORE', 'MEMBERSHIP_DELETE_IGNORE'] as const) {
            const observed = await capture(op, fault);
            if (!baseline) { assert.ok(observed.error, `${op}/${fault}`); assert.deepEqual(observed.after, observed.before, `${op}/${fault}`); }
        }
    }
});

/* @Codex: admission failures do not write domain rows or audit events. */
test('stale versions, denial, linked patients, duplicate ID, and retry have no side effects', async () => {
    if (baseline) return;
    for (const op of operations.filter(value => !value.endsWith('create'))) {
        resetSyntheticDomain();
        const x = prepare(op);
        const before = snapshot();
        const stale = await invoke(op, x, 2);
        assert.equal(stale.status, 409, op);
        assert.deepEqual(snapshot(), before, op);
        const success = await invoke(op, x);
        assert.equal(success.status, 200, op);
        const committed = snapshot();
        const retry = await invoke(op, x);
        assert.equal(retry.status, op.endsWith('delete') ? 404 : 409, op);
        assert.deepEqual(snapshot(), committed, op);
    }
    for (const op of operations.filter(value => value.endsWith('create'))) {
        resetSyntheticDomain();
        const x = prepare(op);
        assert.equal((await invoke(op, x)).status, 201);
        const before = snapshot();
        assert.equal((await invoke(op, x)).status, 409);
        assert.deepEqual(snapshot(), before);
    }
    resetSyntheticDomain();
    const x = prepare('host-clear');
    const before = snapshot();
    const operator: ServerSession = { ...session, role: 'operator' };
    assert.equal((await host.clearAmbulatory({ request, session: operator }, x.target, 3)).status, 403);
    assert.equal((await host.clearAmbulatory({ request, session }, x.live, 3)).status, 403);
    assert.equal((await host.clearAmbulatory({ request, session }, 'synthetic-missing', 3)).status, 404);
    assert.deepEqual(snapshot(), before);

    resetSyntheticDomain();
    const last = ids(); ambulatory(last.target, 'live', true);
    const lastBefore = snapshot();
    assert.equal(host.deleteAmbulatory({ request, session }, last.target, 3).status, 409);
    assert.deepEqual(snapshot(), lastBefore);
    patient(last.testOnlyA, last.target);
    const linkedBefore = snapshot();
    assert.equal(host.deleteAmbulatory({ request, session }, last.target, 3).status, 409);
    assert.deepEqual(snapshot(), linkedBefore);
});

/* @Codex: preserve current input representation and ignore caller-selected audit surface. */
test('omission, null, ignored fields, and actor surface retain their meaning', async () => {
    if (baseline) return;
    resetSyntheticDomain();
    const x = ids(); ambulatory(x.fallback, 'live', true);
    const result = host.createAmbulatory({ request, session }, {
        id: x.target, name: '  Synthetic  ', type: null, address: '', description: null,
        createdAt: '2026-05-01', unsupportedSynthetic: 'ignored',
    });
    assert.equal(result.status, 201);
    const created = sql.prepare('SELECT * FROM ambulatories WHERE id=?').get(x.target) as Record<string, unknown>;
    assert.equal(created.name, 'Synthetic');
    assert.equal(created.type, 'live');
    assert.equal(created.address, null);
    assert.equal(created.description, null);
    const createdAudit = (snapshot().audit as Array<Record<string, unknown>>).at(-1)!;
    assert.equal(createdAudit.actor_ref, session.userId);
    assert.equal(createdAudit.source_surface, 'web');
    assert.ok(!JSON.stringify(createdAudit).includes('Synthetic  '));
    assert.ok(!JSON.stringify(createdAudit).includes('ignored'));
    const update = host.updateAmbulatory({ request, session }, x.target, { version: 1, description: 'ENC:synthetic:note' });
    assert.equal(update.status, 200);
    assert.equal((sql.prepare('SELECT * FROM ambulatories WHERE id=?').get(x.target) as Record<string, unknown>).description, 'ENC:synthetic:note');
    const cleared = host.updateAmbulatory({ request, session }, x.target, { version: 2, description: null });
    assert.equal(cleared.status, 200);
    assert.equal((sql.prepare('SELECT * FROM ambulatories WHERE id=?').get(x.target) as Record<string, unknown>).description, null);
    assert.ok(!(snapshot().audit as Array<Record<string, unknown>>).some(event => JSON.stringify(event).includes('ENC:synthetic:note')));
});

/* @Codex: a process barrier proves default promotion on separate SQLite connections. */
function launchContender(targetId: string) {
    const child = spawn(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/fixtures/ambulatory-atomic-process.ts', targetId],
        { cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir } });
    let output = ''; let errors = '';
    let resolveReady: () => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
        child.stdout.setEncoding('utf8').on('data', (part: string) => {
            output += part;
            if (output.startsWith('READY\n')) resolveReady();
        });
        child.stderr.setEncoding('utf8').on('data', (part: string) => { errors += part; });
        child.on('error', (error: Error) => { rejectReady(error); reject(error); });
        child.on('close', (code) => {
            if (code !== 0) { const error = new Error(errors || output); rejectReady(error); reject(error); return; }
            try { resolve(JSON.parse(output.slice('READY\n'.length))); } catch (error) { reject(error); }
        });
    });
    return { ready, release: () => child.stdin.end('GO\n'), result };
}
test('two SQLite processes serialize one default promotion', async () => {
    if (baseline) return;
    resetSyntheticDomain();
    const x = prepare('host-update');
    const contenders = [launchContender(x.target), launchContender(x.target)];
    await Promise.all(contenders.map(child => child.ready));
    contenders.forEach(child => child.release());
    const results = await Promise.all(contenders.map(child => child.result));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const rows = snapshot().ambulatories as Array<Record<string, unknown>>;
    assert.equal(rows.filter(row => row.is_default === 1).length, 1);
    assert.equal(rows.find(row => row.id === x.target)?.version, 4);
    assert.equal(rows.find(row => row.id === x.fallback)?.version, 4);
    const audit = snapshot().audit as Array<Record<string, unknown>>;
    assert.equal(audit.filter(event => event.subject_ref === x.target || event.subject_ref === x.fallback).length, 2);
});
