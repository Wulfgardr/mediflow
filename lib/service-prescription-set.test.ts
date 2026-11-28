import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-service-prescription-set-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const fixture = await import('./test-fixtures/clinical-writer-composition.ts');
const writers = await import('./service-prescription-write.ts');
fixture.seedComposition();
test.after(() => { dbServer.$client.close(); rmSync(directory, { recursive: true, force: true }); });

const context = { request: new Request('http://127.0.0.1/synthetic-service-prescription-set'), session: fixture.session };
const tables = ['service_prescriptions', 'service_prescription_items', 'audit_events'] as const;
const snapshot = () => tables.map(table => dbServer.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
const counts = () => snapshot().map(rows => rows.length);
const auditFor = (ids: string[]) => dbServer.$client.prepare(
    `SELECT event_type AS type, subject_ref AS id FROM audit_events WHERE subject_ref IN (${ids.map(() => '?').join(',')}) ORDER BY rowid`).all(...ids);

function entry(prefix: string, serviceCode: string, item: Record<string, unknown> = {}) {
    return {
        prescription: { id: prefix, patientId: fixture.patientId, prescribedAt: '2026-11-28', status: 'prescribed', category: 'lab',
            codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode, serviceName: `ENC:synthetic:${serviceCode}`, source: 'manual' },
        item: { id: `${prefix}-item`, patientId: fixture.patientId, prescriptionId: prefix, ordinal: 0, status: 'prescribed', category: 'lab',
            codeSystem: 'REGIONAL_PRESTAZIONI', serviceCode, serviceName: `ENC:synthetic:${serviceCode}`, matchStatus: 'manual', ...item },
    };
}

test('one gesture writes every prescription with its item and their audits in one commit', async () => {
    const before = counts();
    const body = { entries: [entry('set-commit-a', '95.11'), entry('set-commit-b', '90.28.1')] };
    const result = await writers.createHostServicePrescriptionSet(context, body);
    assert.equal(result.status, 201);
    assert.deepEqual(result.value, { replayed: false, entries: [
        { prescriptionId: 'set-commit-a', itemId: 'set-commit-a-item' }, { prescriptionId: 'set-commit-b', itemId: 'set-commit-b-item' }] });
    assert.deepEqual(counts().map((count, index) => count - before[index]), [2, 2, 4]);
    assert.deepEqual(auditFor(['set-commit-a', 'set-commit-a-item', 'set-commit-b', 'set-commit-b-item']), [
        { type: 'service.prescription.created', id: 'set-commit-a' }, { type: 'service.prescription_item.created', id: 'set-commit-a-item' },
        { type: 'service.prescription.created', id: 'set-commit-b' }, { type: 'service.prescription_item.created', id: 'set-commit-b-item' }]);
});

test('resending a gesture whose answer was lost returns the same receipt and writes nothing', async () => {
    const body = { entries: [entry('set-replay-a', '95.11'), entry('set-replay-b', '90.28.1')] };
    const first = await writers.createHostServicePrescriptionSet(context, body);
    assert.equal(first.status, 201);
    const committed = snapshot();
    const replay = await writers.createHostServicePrescriptionSet(context, body);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.value, { ...first.value, replayed: true });
    assert.deepEqual(snapshot(), committed);
});

test('a refused item of the last entry leaves no prescription, no item and no audit of the gesture', async () => {
    const before = snapshot();
    const body = { entries: [entry('set-refused-a', '95.11'), entry('set-refused-b', '90.28.1', { status: 'not-a-status' })] };
    const result = await writers.createHostServicePrescriptionSet(context, body);
    assert.equal(result.status, 400);
    assert.deepEqual(snapshot(), before);
    const retried = await writers.createHostServicePrescriptionSet(context, { entries: [entry('set-refused-a', '95.11'), entry('set-refused-b', '90.28.1')] });
    assert.equal(retried.status, 201, 'nothing of the refused gesture blocks the corrected one');
});

test('a refused item of a single entry leaves its prescription unwritten', async () => {
    const before = snapshot();
    const result = await writers.createHostServicePrescriptionSet(context, { entries: [entry('set-single', '95.11', { matchStatus: 'not-a-match' })] });
    assert.equal(result.status, 400);
    assert.deepEqual(snapshot(), before);
});

test('a failing item audit rolls back the prescriptions already written in the same gesture', async () => {
    const before = snapshot();
    dbServer.$client.exec("CREATE TRIGGER synthetic_set_item_audit_failure BEFORE INSERT ON audit_events WHEN NEW.subject_ref='set-audit-b-item' BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_SET_AUDIT_FAILURE'); END");
    try {
        await assert.rejects(writers.createHostServicePrescriptionSet(context, { entries: [entry('set-audit-a', '95.11'), entry('set-audit-b', '90.28.1')] }),
            /SYNTHETIC_SET_AUDIT_FAILURE/);
    } finally {
        dbServer.$client.exec('DROP TRIGGER synthetic_set_item_audit_failure');
    }
    assert.deepEqual(snapshot(), before);
});

test('ids already used by another write are a conflict, not a replay', async () => {
    assert.equal((await writers.createHostServicePrescription(context, entry('set-taken', '95.11').prescription)).status, 201);
    const before = snapshot();
    const result = await writers.createHostServicePrescriptionSet(context, { entries: [entry('set-taken', '95.11'), entry('set-fresh', '90.28.1')] });
    assert.equal(result.status, 409);
    assert.deepEqual(snapshot(), before);
});

test('a resent gesture that names another service under the same ids is a conflict', async () => {
    assert.equal((await writers.createHostServicePrescriptionSet(context, { entries: [entry('set-changed', '95.11')] })).status, 201);
    const before = snapshot();
    const result = await writers.createHostServicePrescriptionSet(context, { entries: [entry('set-changed', '90.28.1')] });
    assert.equal(result.status, 409);
    assert.deepEqual(snapshot(), before);
});

test('incoherent gestures are refused before any write', async () => {
    const before = snapshot();
    const otherPatient = entry('set-other-patient', '90.28.1');
    otherPatient.prescription.patientId = 'synthetic-other-patient';
    const wrongParent = entry('set-wrong-parent', '95.11', { prescriptionId: 'set-commit-a' });
    const duplicated = entry('set-duplicate', '95.11');
    for (const body of [{ entries: [] }, { entries: [entry('set-mixed', '95.11'), otherPatient] }, { entries: [wrongParent] },
        { entries: [duplicated, duplicated] }, { entries: [entry('set-extra', '95.11')], extra: true }]) {
        assert.equal((await writers.createHostServicePrescriptionSet(context, body)).status, 400, JSON.stringify(body).slice(0, 80));
    }
    const missing = entry('set-missing-patient', '95.11');
    missing.prescription.patientId = 'synthetic-missing-patient';
    assert.equal((await writers.createHostServicePrescriptionSet(context, { entries: [missing] })).status, 404);
    assert.deepEqual(snapshot(), before);
});
