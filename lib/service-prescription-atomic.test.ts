/* @Codex: synthetic real-SQLite oracle for the ten ordinary service writes. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import type { ServerSession } from './security/server-session.ts';

const dir = mkdtempSync(join(process.env.MEDIFLOW_DATA_DIR!, 'service-atomic-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer } = await import('./db-server.ts');
const { patients, ambulatories, patientsToAmbulatories, servicePrescriptions, servicePrescriptionItems } = await import('./schema.ts');
const writer = await import('./service-prescription-write.ts');
const sql = new Database(join(dir, 'medical.db'));
const baseline = process.env.MEDIFLOW_SERVICE_BASELINE === '1';
const observations: unknown[] = [];
let n = 0;
const next = (name: string) => `synthetic-service-${++n}-${name}`;
const session: ServerSession = {
    id: 'synthetic-session', userId: 'synthetic-user', username: next('username'),
    role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
};
const pairedSession: ServerSession = { ...session, authChannel: 'native' };
const pairedClient = { clientId: 'synthetic-paired' } as Parameters<typeof writer.createNetworkScopedServicePrescription>[0]['pairedClient'];
const request = new Request('http://localhost/test', { headers: { 'x-request-id': 'synthetic-request', 'x-mediflow-source-surface': 'job' } });
const ambulatoryId = next('ambulatory');
dbServer.insert(ambulatories).values({ id: ambulatoryId, name: 'Synthetic ambulatory', type: 'live' }).run();
test.after(() => {
    if (process.env.MEDIFLOW_SERVICE_REPORT) {
        writeFileSync(process.env.MEDIFLOW_SERVICE_REPORT, JSON.stringify(observations, null, 2));
    }
    sql.close();
    dbServer.$client.close();
});
function seed(kind: 'active' | 'archived' | 'deleted' = 'active', scope = true) {
    const ids = { patientId: next('patient'), prescriptionId: next('prescription'), itemId: next('item') };
    dbServer.insert(patients).values({
        id: ids.patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax'),
        deletedAt: kind === 'deleted' ? new Date('2026-01-01') : null, isArchived: kind === 'archived',
    }).run();
    if (scope) dbServer.insert(patientsToAmbulatories).values({ patientId: ids.patientId, ambulatoryId }).run();
    return ids;
}
function insertParent(ids: ReturnType<typeof seed>) {
    dbServer.insert(servicePrescriptions).values({
        id: ids.prescriptionId, patientId: ids.patientId, prescribedAt: new Date('2026-05-01'),
        serviceName: 'ENC:synthetic:parent', version: 3,
    }).run();
}
function insertItem(ids: ReturnType<typeof seed>) {
    dbServer.insert(servicePrescriptionItems).values({
        id: ids.itemId, patientId: ids.patientId, prescriptionId: ids.prescriptionId,
        serviceName: 'ENC:synthetic:item', version: 3,
    }).run();
}
const operations = [
    'host-parent-create', 'host-parent-update', 'host-parent-delete',
    'host-item-create', 'host-item-update', 'host-item-delete',
    'paired-parent-create', 'paired-parent-update', 'paired-item-create', 'paired-item-update',
] as const;
type Operation = typeof operations[number];
function snapshot(ids: ReturnType<typeof seed>) {
    return {
        parent: sql.prepare('SELECT * FROM service_prescriptions WHERE id=?').get(ids.prescriptionId) ?? null,
        item: sql.prepare('SELECT * FROM service_prescription_items WHERE id=?').get(ids.itemId) ?? null,
        audit: sql.prepare('SELECT * FROM audit_events WHERE subject_ref IN (?,?) ORDER BY rowid')
            .all(ids.prescriptionId, ids.itemId),
    };
}
async function invoke(op: Operation, ids: ReturnType<typeof seed>, version = 3) {
    const host = { request, session }; const paired = { request, session: pairedSession, pairedClient, scopeAmbulatoryId: ambulatoryId };
    const parentBody = { id: ids.prescriptionId, patientId: ids.patientId, prescribedAt: '2026-05-01', serviceName: 'ENC:synthetic:create', notes: 'ENC:synthetic:private' };
    const itemBody = { id: ids.itemId, prescriptionId: ids.prescriptionId, serviceName: 'ENC:synthetic:create', notes: 'ENC:synthetic:private' };
    switch (op) {
        case 'host-parent-create': return writer.createHostServicePrescription(host, parentBody);
        case 'host-parent-update': return writer.updateHostServicePrescription({ ...host, id: ids.prescriptionId }, { version, serviceName: 'ENC:synthetic:update', notes: null });
        case 'host-parent-delete': return writer.deleteHostServicePrescription({ ...host, id: ids.prescriptionId }, version);
        case 'host-item-create': return writer.createHostServicePrescriptionItem(host, itemBody);
        case 'host-item-update': return writer.updateHostServicePrescriptionItem({ ...host, id: ids.itemId }, { version, serviceName: 'ENC:synthetic:update', notes: null });
        case 'host-item-delete': return writer.deleteHostServicePrescriptionItem({ ...host, id: ids.itemId }, version);
        case 'paired-parent-create': return writer.createNetworkScopedServicePrescription({ ...paired, patientId: ids.patientId }, parentBody);
        case 'paired-parent-update': return writer.updateNetworkScopedServicePrescription({ ...paired, prescriptionId: ids.prescriptionId }, { version, serviceName: 'ENC:synthetic:update', notes: null });
        case 'paired-item-create': return writer.createNetworkScopedServicePrescriptionItem(paired, itemBody);
        case 'paired-item-update': return writer.updateNetworkScopedServicePrescriptionItem({ ...paired, itemId: ids.itemId }, { version, serviceName: 'ENC:synthetic:update', notes: null });
    }
}
async function capture(op: Operation, fault?: 'FAIL' | 'IGNORE', domainIgnore = false) {
    const ids = seed();
    if (op.includes('item') || !op.includes('create')) insertParent(ids);
    if ((op.includes('item') && !op.includes('create')) || op === 'host-parent-delete') insertItem(ids);
    const before = snapshot(ids);
    const table = op.includes('item') ? 'service_prescription_items' : 'service_prescriptions';
    if (fault) {
        const detail = fault === 'FAIL' ? ", 'synthetic audit failure'" : '';
        sql.exec(`CREATE TRIGGER synthetic_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${detail}); END`);
    }
    if (domainIgnore) {
        const verb = op.includes('create') ? 'INSERT' : op.includes('delete') ? 'DELETE' : 'UPDATE';
        sql.exec(`CREATE TRIGGER synthetic_dml_ignore BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
    }
    let result: Awaited<ReturnType<typeof invoke>> | null = null;
    let error: string | null = null;
    try { result = await invoke(op, ids); } catch (cause) { error = String(cause); }
    finally {
        if (fault) sql.exec('DROP TRIGGER synthetic_audit_fault');
        if (domainIgnore) sql.exec('DROP TRIGGER synthetic_dml_ignore');
    }
    const after = snapshot(ids);
    observations.push({ op, fault, domainIgnore, result, error, before, after });
    return { ids, result, error, before, after };
}
test('twenty audit faults roll back domain and audit', async () => {
    for (const op of operations) for (const fault of ['FAIL', 'IGNORE'] as const) {
        const result = await capture(op, fault);
        if (baseline) continue;
        assert.ok(result.error, `${op}/${fault}`);
        assert.deepEqual(result.after, result.before, `${op}/${fault}`);
    }
});

test('ten ignored DML writes cannot succeed', async () => {
    for (const op of operations) {
        const result = await capture(op, undefined, true);
        if (baseline) continue;
        assert.ok(result.error, op);
        assert.deepEqual(result.after, result.before, op);
    }
});

test('ten successful writes persist one minimal event', async () => {
    for (const op of operations) {
        const result = await capture(op);
        if (baseline) continue;
        assert.equal(result.error, null, op);
        assert.equal(result.result?.status, op.includes('create') ? 201 : 200, op);
        assert.equal(result.after.audit.length - result.before.audit.length, 1, op);
        const event = result.after.audit.at(-1) as Record<string, unknown>;
        assert.equal(event.subject_ref, op.includes('item') ? result.ids.itemId : result.ids.prescriptionId);
        assert.equal(event.actor_ref, session.userId);
        assert.equal(event.source_surface, op.startsWith('host') ? 'web' : 'native');
        assert.ok(!JSON.stringify(event).includes('ENC:synthetic:'));
        const metadata = JSON.parse(String(event.redacted_metadata));
        assert.equal(metadata.resourceVersion, op.includes('create') ? 1 : op.includes('delete') ? 3 : 4);
        const row = (op.includes('item') ? result.after.item : result.after.parent) as Record<string, unknown> | null;
        if (op.includes('delete')) {
            assert.equal(row, null);
        } else {
            assert.equal(row?.service_name, op.includes('create') ? 'ENC:synthetic:create' : 'ENC:synthetic:update');
            assert.equal(row?.notes, op.includes('create') ? 'ENC:synthetic:private' : null);
            assert.equal(row?.version, op.includes('create') ? 1 : 4);
        }
        if (op === 'host-parent-delete') assert.equal(result.after.item, null);
    }
});

/* @Codex: a suppressed child removal must roll back the aggregate delete. */
test('parent hard delete rolls back if one child DELETE is ignored', async () => {
    const ids = seed(); insertParent(ids); insertItem(ids); const before = snapshot(ids);
    sql.exec('CREATE TRIGGER synthetic_child_ignore BEFORE DELETE ON service_prescription_items BEGIN SELECT RAISE(IGNORE); END');
    let error: unknown;
    try { await invoke('host-parent-delete', ids); } catch (cause) { error = cause; }
    finally { sql.exec('DROP TRIGGER synthetic_child_ignore'); }
    if (!baseline) { assert.ok(error); assert.deepEqual(snapshot(ids), before); }
});

/* @Codex: admission, scope, and version precedence use the current transaction state. */
test('patient, parent, paired scope, stale version and retry', async () => {
    if (baseline) return;
    for (const op of operations) for (const kind of ['deleted', 'archived'] as const) {
        const ids = seed(kind); if (op.includes('item') || !op.includes('create')) insertParent(ids); if (op.includes('item') && !op.includes('create')) insertItem(ids);
        const before = snapshot(ids); const result = await invoke(op, ids);
        assert.equal(result.status, kind === 'deleted' ? 404 : op.includes('create') ? 201 : 200, `${op}/${kind}`);
        if (kind === 'deleted') assert.deepEqual(snapshot(ids), before);
    }
    for (const op of operations) {
        const ids = seed(); if (op.includes('item') || !op.includes('create')) insertParent(ids); if (op.includes('item') && !op.includes('create')) insertItem(ids);
        sql.pragma('foreign_keys = OFF'); sql.prepare('DELETE FROM patients WHERE id=?').run(ids.patientId); sql.pragma('foreign_keys = ON');
        const before = snapshot(ids); assert.equal((await invoke(op, ids)).status, 404, op); assert.deepEqual(snapshot(ids), before);
    }
    for (const op of operations.filter(value => value.startsWith('paired'))) {
        const ids = seed('active', false); if (op.includes('item') || !op.includes('create')) insertParent(ids); if (op.includes('item') && !op.includes('create')) insertItem(ids);
        const before = snapshot(ids); assert.equal((await invoke(op, ids)).status, 404, op); assert.deepEqual(snapshot(ids), before);
    }
    for (const op of operations.filter(value => value.includes('update') || value.includes('delete'))) {
        const ids = seed(); insertParent(ids); if (op.includes('item')) insertItem(ids);
        const before = snapshot(ids); const stale = await invoke(op, ids, 2); assert.equal(stale.status, 409, op);
        assert.equal(stale.value.code, 'VERSION_CONFLICT'); assert.deepEqual(snapshot(ids), before);
        assert.equal((await invoke(op, ids, 3)).status, 200);
        assert.equal((await invoke(op, ids, 3)).status, op.includes('delete') ? 404 : 409);
    }
    for (const op of operations.filter(value => value.includes('item') && !value.includes('create'))) {
        const ids = seed(); const other = seed(); insertParent(other);
        dbServer.insert(servicePrescriptionItems).values({ id: ids.itemId, patientId: ids.patientId, prescriptionId: other.prescriptionId, serviceName: 'ENC:synthetic:wrong-parent', version: 3 }).run();
        const before = snapshot(ids); assert.equal((await invoke(op, ids)).status, 404, op); assert.deepEqual(snapshot(ids), before);
    }
});

/* @Codex: two independent SQLite connections contend after an explicit startup barrier. */
function launchChild(mode: 'update' | 'tombstone', ids: ReturnType<typeof seed>) {
    const child = spawn(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/fixtures/service-atomic-process.ts', mode, ids.patientId, ids.prescriptionId],
        { cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: dir } });
    let output = ''; let errors = '';
    let resolveReady: () => void = () => {}; let rejectReady: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    if (mode === 'tombstone') resolveReady();
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
        child.stdout.setEncoding('utf8').on('data', (part: string) => { output += part; if (mode === 'update' && output.startsWith('READY\n')) resolveReady(); });
        child.stderr.setEncoding('utf8').on('data', (part: string) => { errors += part; });
        child.on('error', (error: Error) => { rejectReady(error); reject(error); });
        child.on('close', (code) => {
            if (code !== 0) { const error = new Error(errors || output); rejectReady(error); reject(error); return; }
            try { resolve(JSON.parse(mode === 'update' ? output.slice('READY\n'.length) : output)); } catch (error) { reject(error); }
        });
    });
    return { ready, release: () => child.stdin.end('GO\n'), result };
}
test('independent SQLite writers serialize a version and observe parent tombstone after restart', async () => {
    if (baseline) return;
    const ids = seed(); insertParent(ids);
    const contenders = [launchChild('update', ids), launchChild('update', ids)];
    await Promise.all(contenders.map(child => child.ready)); contenders.forEach(child => child.release());
    const results = await Promise.all(contenders.map(child => child.result));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const after = snapshot(ids); assert.equal((after.parent as Record<string, unknown>).version, 4); assert.equal(after.audit.length, 1);
    const deleted = seed(); insertParent(deleted);
    assert.equal((await launchChild('tombstone', deleted).result).status, 'tombstoned');
    const later = launchChild('update', deleted); await later.ready; later.release();
    assert.equal((await later.result).status, 404); assert.equal((snapshot(deleted).parent as Record<string, unknown>).version, 3);
});

/* @Codex: identity and actor are admitted by the host, not selected by body or headers. */
test('host system actor and paired patient identity survive body spoofing', async () => {
    if (baseline) return;
    const ids = seed(); const other = seed();
    const system: ServerSession = { ...session, id: 'synthetic-local-api', authChannel: 'system' };
    const host = await writer.createHostServicePrescription({ request, session: system },
        { id: ids.prescriptionId, patientId: ids.patientId, prescribedAt: '2026-05-01', serviceName: 'ENC:synthetic:system' });
    assert.equal(host.status, 201);
    const event = snapshot(ids).audit[0] as Record<string, unknown>;
    assert.equal(event.actor_type, 'system'); assert.equal(event.actor_ref, 'local-api'); assert.equal(event.source_surface, 'api');
    const paired = await writer.createNetworkScopedServicePrescription({ request, session: pairedSession, pairedClient, scopeAmbulatoryId: ambulatoryId, patientId: other.patientId },
        { id: other.prescriptionId, patientId: ids.patientId, prescribedAt: '2026-05-01', serviceName: 'ENC:synthetic:paired' });
    assert.equal(paired.status, 201);
    assert.equal((snapshot(other).parent as Record<string, unknown>).patient_id, other.patientId);
    const pairedEvent = snapshot(other).audit[0] as Record<string, unknown>;
    assert.equal(pairedEvent.actor_ref, pairedSession.userId); assert.equal(pairedEvent.source_surface, 'native');
});


test('duplicate service parent and item create IDs return conflict without effects', async () => {
    for (const op of ['host-parent-create', 'paired-parent-create', 'host-item-create', 'paired-item-create'] as const) {
        const ids = seed();
        if (op.includes('item')) insertParent(ids);
        assert.equal((await invoke(op, ids)).status, 201);
        const before = snapshot(ids);
        assert.deepEqual(await invoke(op, ids), { status: 409, value: { error: 'Prescription ID already exists' } });
        assert.deepEqual(snapshot(ids), before);
    }
});
test('service item ordinal defaults, omitted update and exact conversion survive SQLite', async () => {
    const ids = seed(); insertParent(ids);
    assert.equal((await invoke('host-item-create', ids)).status, 201);
    assert.equal((snapshot(ids).item as Record<string, unknown>).ordinal, 0);
    const host = { request, session, id: ids.itemId };
    assert.equal((await writer.updateHostServicePrescriptionItem(host, { version: 1, ordinal: '02' })).status, 200);
    assert.equal((snapshot(ids).item as Record<string, unknown>).ordinal, 2);
    assert.equal((await writer.updateHostServicePrescriptionItem(host, { version: 2, notes: null })).status, 200);
    assert.equal((snapshot(ids).item as Record<string, unknown>).ordinal, 2);
    const before = snapshot(ids);
    assert.equal((await writer.updateHostServicePrescriptionItem(host, { version: 3, ordinal: '2x' })).status, 400);
    assert.deepEqual(snapshot(ids), before);
});
