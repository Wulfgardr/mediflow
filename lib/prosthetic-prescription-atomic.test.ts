/* @Codex: real SQLite regression oracle for the five ordinary prosthetic writes. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { ServerSession } from './security/server-session.ts';

const root = process.env.MEDIFLOW_DATA_DIR!;
const dir = mkdtempSync(join(root, 'prosthetic-atomic-'));
process.env.MEDIFLOW_DATA_DIR = dir;
const { dbServer } = await import('./db-server.ts');
const { patients, ambulatories, patientsToAmbulatories, prostheticPrescriptions } = await import('./schema.ts');
const writer = await import('./prosthetic-prescription-write.ts');
const sql = new Database(join(dir, 'medical.db'));
const baseline = process.env.MEDIFLOW_PROSTHETIC_BASELINE === '1';
const observations: unknown[] = [];
let n = 0;
const next = (name: string) => `synthetic-prosthetic-${++n}-${name}`;
const session: ServerSession = { id: 'synthetic-session', userId: 'synthetic-user', username: next('username'), role: 'admin', authChannel: 'web', createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
const pairedSession: ServerSession = { ...session, id: 'synthetic-native', authChannel: 'native' };
const pairedClient = { clientId: 'synthetic-paired' } as Parameters<typeof writer.createNetworkScopedProstheticPrescription>[0]['pairedClient'];
const request = new Request('http://localhost/test', { headers: { 'x-request-id': 'synthetic-request', 'x-audit-source-surface': 'job' } });
const ambulatoryId = next('ambulatory');
dbServer.insert(ambulatories).values({ id: ambulatoryId, name: 'Synthetic ambulatory', type: 'live' }).run();
test.after(() => { if (process.env.MEDIFLOW_PROSTHETIC_REPORT) writeFileSync(process.env.MEDIFLOW_PROSTHETIC_REPORT, JSON.stringify(observations, null, 2)); sql.close(); dbServer.$client.close(); });
function seed(kind: 'active' | 'deleted' | 'archived' = 'active', inScope = true) {
    const patientId = next('patient'); const id = next('prescription');
    dbServer.insert(patients).values({ id: patientId, firstName: 'Synthetic', lastName: 'Patient', taxCode: next('tax'), deletedAt: kind === 'deleted' ? new Date('2026-01-01') : null, isArchived: kind === 'archived' }).run();
    if (inScope) dbServer.insert(patientsToAmbulatories).values({ patientId, ambulatoryId }).run();
    return { patientId, id };
}
function insert(ids: { patientId: string; id: string }) {
    dbServer.insert(prostheticPrescriptions).values({ id: ids.id, patientId: ids.patientId, prescribedAt: new Date('2026-05-01'), description: 'ENC:synthetic:original', version: 3 }).run();
}
const operations = ['host-create', 'host-update', 'host-delete', 'paired-create', 'paired-update'] as const;
type Operation = typeof operations[number];
function read(id: string) { return { row: sql.prepare('SELECT * FROM prosthetic_prescriptions WHERE id=?').get(id) ?? null, audit: sql.prepare('SELECT * FROM audit_events WHERE subject_ref=? ORDER BY rowid').all(id) }; }
async function invoke(op: Operation, ids: { patientId: string; id: string }, version = 3) {
    const host = { request, session, id: ids.id }; const paired = { request, session: pairedSession, pairedClient, scopeAmbulatoryId: ambulatoryId };
    const body = { id: ids.id, patientId: ids.patientId, prescribedAt: '2026-05-01', description: 'ENC:synthetic:create', notes: 'ENC:synthetic:private' };
    if (op === 'host-create') return writer.createHostProstheticPrescription(host, body);
    if (op === 'host-update') return writer.updateHostProstheticPrescription(host, { version, description: 'ENC:synthetic:update', notes: null });
    if (op === 'host-delete') return writer.deleteHostProstheticPrescription(host, version);
    if (op === 'paired-create') return writer.createNetworkScopedProstheticPrescription({ ...paired, patientId: ids.patientId }, body);
    return writer.updateNetworkScopedProstheticPrescription({ ...paired, prescriptionId: ids.id }, { version, description: 'ENC:synthetic:update', notes: null });
}
async function capture(op: Operation, fault?: 'FAIL' | 'IGNORE', domainIgnore = false) {
    const ids = seed(); if (op.includes('update') || op.includes('delete')) insert(ids);
    const before = read(ids.id);
    if (fault) sql.exec(`CREATE TRIGGER synthetic_audit_fault BEFORE INSERT ON audit_events BEGIN SELECT RAISE(${fault}${fault === 'FAIL' ? ", 'synthetic audit failure'" : ''}); END`);
    if (domainIgnore) sql.exec(`CREATE TRIGGER synthetic_domain_ignore BEFORE ${op.includes('create') ? 'INSERT' : op.includes('delete') ? 'DELETE' : 'UPDATE'} ON prosthetic_prescriptions BEGIN SELECT RAISE(IGNORE); END`);
    let result: Awaited<ReturnType<typeof invoke>> | null = null; let error: string | null = null;
    try { result = await invoke(op, ids); } catch (cause) { error = String(cause); }
    finally { if (fault) sql.exec('DROP TRIGGER synthetic_audit_fault'); if (domainIgnore) sql.exec('DROP TRIGGER synthetic_domain_ignore'); }
    const after = read(ids.id); observations.push({ op, fault, domainIgnore, result, error, before, after });
    return { ids, before, after, result, error };
}

test('audit FAIL and IGNORE roll back every ordinary mutation', async () => {
    for (const op of operations) for (const fault of ['FAIL', 'IGNORE'] as const) {
        const x = await capture(op, fault);
        if (!baseline) { assert.ok(x.error, `${op}/${fault} must throw`); assert.deepEqual(x.after, x.before, `${op}/${fault} must roll back`); }
    }
});

test('DML IGNORE after admission never succeeds', async () => {
    for (const op of operations) { const x = await capture(op, undefined, true); if (!baseline) { assert.ok(x.error, `${op} must throw`); assert.deepEqual(x.after, x.before); } }
});

test('five ordinary mutations write one row and one minimal audit event', async () => {
    for (const op of operations) { const x = await capture(op); if (baseline) continue;
        assert.equal(x.error, null); assert.equal(x.result?.status, op.includes('create') ? 201 : 200);
        assert.equal(x.after.audit.length - x.before.audit.length, 1);
        const event = x.after.audit.at(-1) as Record<string, unknown>;
        assert.equal(event.subject_ref, x.ids.id); assert.equal(event.actor_ref, 'synthetic-user');
        assert.equal(event.source_surface, op.startsWith('host') ? 'web' : 'native');
        assert.ok(!JSON.stringify(event).includes('ENC:synthetic:'));
        const metadata = JSON.parse(String(event.redacted_metadata));
        assert.equal(metadata.resourceVersion, op.includes('create') ? 1 : 3 + (op.includes('delete') ? 0 : 1));
        assert.ok(op.startsWith('paired') ? metadata.flags.includes('auth:paired-client') && metadata.flags.includes('paired-client:synthetic-paired') : metadata.flags.includes('auth:session'));
        assert.equal(Boolean(metadata.changedFields?.includes('notes')), op.includes('create') || op.includes('update'));
        assert.equal(x.after.row === null, op === 'host-delete');
        if (op.includes('create')) {
            assert.equal((x.after.row as Record<string, unknown>).description, 'ENC:synthetic:create');
            assert.equal((x.after.row as Record<string, unknown>).notes, 'ENC:synthetic:private');
            assert.equal((x.after.row as Record<string, unknown>).version, 1);
        } else if (op.includes('update')) {
            assert.equal((x.after.row as Record<string, unknown>).description, 'ENC:synthetic:update');
            assert.equal((x.after.row as Record<string, unknown>).notes, null);
            assert.equal((x.after.row as Record<string, unknown>).version, 4);
        }
    }
});

test('parent and paired scope admission, stale retry and archived parent', async () => {
    if (baseline) return;
    for (const op of operations) for (const kind of ['deleted', 'archived'] as const) {
        const ids = seed(kind); if (!op.includes('create')) insert(ids); const before = read(ids.id);
        const response = await invoke(op, ids); const after = read(ids.id);
        if (kind === 'deleted') { assert.equal(response.status, 404); assert.deepEqual(after, before); }
        else { assert.equal(response.status, op.includes('create') ? 201 : 200); assert.equal(after.audit.length, 1); }
    }
    for (const op of operations) {
        const ids = seed(); if (!op.includes('create')) insert(ids);
        dbServer.update(patients).set({ deletedAt: new Date('2026-05-03') }).where(eq(patients.id, ids.patientId)).run();
        const before = read(ids.id); assert.equal((await invoke(op, ids)).status, 404); assert.deepEqual(read(ids.id), before);
    }
    for (const op of operations) {
        const ids = seed(); if (!op.includes('create')) insert(ids);
        sql.pragma('foreign_keys = OFF'); sql.prepare('DELETE FROM patients WHERE id=?').run(ids.patientId); sql.pragma('foreign_keys = ON');
        const before = read(ids.id); assert.equal((await invoke(op, ids)).status, 404); assert.deepEqual(read(ids.id), before);
    }
    for (const op of ['paired-create', 'paired-update'] as const) {
        const ids = seed('active', false); if (op === 'paired-update') insert(ids);
        const before = read(ids.id); assert.equal((await invoke(op, ids)).status, 404); assert.deepEqual(read(ids.id), before);
    }
    for (const op of ['host-update', 'host-delete', 'paired-update'] as const) {
        const ids = seed(); insert(ids); const before = read(ids.id);
        const stale = await invoke(op, ids, 2); assert.equal(stale.status, 409); assert.equal(stale.value.code, 'VERSION_CONFLICT'); assert.deepEqual(read(ids.id), before);
        assert.equal((await invoke(op, ids, 3)).status, 200);
    }
});

/* @Codex: separate SQLite connections prove version serialization and parent currentness. */
type ChildResult = { status?: number | string; value?: Record<string, unknown>; error?: string };
/* @Codex: explicit startup barrier prevents a sequential launch from masquerading as contention. */
function launchChild(mode: 'update' | 'tombstone', ids: { patientId: string; id: string }) {
    const child = spawn(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/fixtures/prosthetic-atomic-process.ts', mode, ids.patientId, ids.id],
        { cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: dir } });
    let out = ''; let err = '';
    let signalReady: () => void = () => {};
    let failReady: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => { signalReady = resolve; failReady = reject; });
    if (mode === 'tombstone') signalReady();
    const result = new Promise<ChildResult>((resolve, reject) => {
        child.stdout.setEncoding('utf8').on('data', (part: string) => {
            out += part;
            if (mode === 'update' && out.startsWith('READY\n')) signalReady();
        });
        child.stderr.setEncoding('utf8').on('data', (part: string) => { err += part; });
        child.on('error', (cause: Error) => { failReady(cause); reject(cause); });
        child.on('close', code => {
            if (code !== 0) { const cause = new Error(err || out); failReady(cause); reject(cause); return; }
            try { resolve(JSON.parse(mode === 'update' ? out.slice('READY\n'.length) : out)); }
            catch (cause) { reject(cause); }
        });
    });
    return { ready, release: () => child.stdin.end('GO\n'), result };
}
async function runChild(mode: 'update' | 'tombstone', ids: { patientId: string; id: string }): Promise<ChildResult> {
    const child = launchChild(mode, ids);
    await child.ready;
    if (mode === 'update') child.release();
    return child.result;
}
test('two SQLite processes contend for one version; a later process sees tombstoned parent', async () => {
    if (baseline) return;
    const ids = seed(); insert(ids);
    const contenders = [launchChild('update', ids), launchChild('update', ids)];
    await Promise.all(contenders.map(child => child.ready));
    contenders.forEach(child => child.release());
    const [first, second] = await Promise.all(contenders.map(child => child.result));
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const afterRace = read(ids.id); assert.equal((afterRace.row as Record<string, unknown>).version, 4); assert.equal(afterRace.audit.length, 1);
    const parentIds = seed(); insert(parentIds);
    assert.equal((await runChild('tombstone', parentIds)).status, 'tombstoned');
    assert.equal((await runChild('update', parentIds)).status, 404);
    assert.equal((read(parentIds.id).row as Record<string, unknown>).version, 3);
    assert.equal(read(parentIds.id).audit.length, 0);
});

/* @Codex: host actor attribution follows the admitted session, not a spoofed header. */
test('host system session retains its audit actor classification', async () => {
    if (baseline) return;
    const ids = seed();
    const systemSession: ServerSession = { ...session, id: 'local-api', authChannel: 'system' };
    const result = await writer.createHostProstheticPrescription({ request, session: systemSession },
        { id: ids.id, patientId: ids.patientId, prescribedAt: '2026-05-01', description: 'ENC:synthetic:system' });
    assert.equal(result.status, 201);
    const event = read(ids.id).audit[0] as Record<string, unknown>;
    assert.equal(event.actor_type, 'system'); assert.equal(event.actor_ref, 'local-api');
    assert.equal(event.source_surface, 'api');
    assert.ok(!JSON.stringify(event).includes('ENC:synthetic:'));
});

/* @Codex: a paired body cannot select another patient or actor. */
test('paired create uses admitted patient and session identity', async () => {
    if (baseline) return;
    const ids = seed(); const other = seed();
    const context = { request, session: pairedSession, pairedClient, scopeAmbulatoryId: ambulatoryId, patientId: ids.patientId };
    const response = await writer.createNetworkScopedProstheticPrescription(context, {
        id: ids.id, patientId: other.patientId, prescribedAt: '2026-05-01', description: 'ENC:synthetic:paired' });
    assert.equal(response.status, 201);
    assert.equal((read(ids.id).row as Record<string, unknown>).patient_id, ids.patientId);
    const event = read(ids.id).audit[0] as Record<string, unknown>;
    assert.equal(event.actor_ref, pairedSession.userId); assert.equal(event.source_surface, 'native');
});


test('duplicate prosthetic create IDs return generic conflict without domain or audit effects', async () => {
    for (const op of ['host-create', 'paired-create'] as const) {
        const ids = seed();
        assert.equal((await invoke(op, ids)).status, 201);
        const before = read(ids.id);
        const result = await invoke(op, ids);
        assert.deepEqual(result, { status: 409, value: { error: 'Prescription ID already exists' } });
        assert.deepEqual(read(ids.id), before);
    }
});
