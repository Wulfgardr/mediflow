/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PatientEditSession, type PatientEditPort, type PatientEditRecord } from './patient-edit-session.ts';
import { patientSchema } from './schemas.ts';

// Real application schema, not a surrogate parser. All fixture values are synthetic.
function fixture(): PatientEditRecord {
    return {
        id: 'synthetic-schema-patient', version: 3,
        firstName: 'Test', lastName: 'Fixture', taxCode: 'SYNTHETIC0000001',
        birthDate: new Date('1980-02-03T12:34:56.789Z'),
        diagnoses: [{ system: 'ICD-11', code: 'TEST-A', description: 'Synthetic diagnosis', date: new Date('2020-01-02T12:34:56.789Z') }],
        checkups: [{ id: 'synthetic-schema-checkup', patientId: 'synthetic-schema-patient', version: 5,
            date: new Date('2030-02-03T12:34:56.789Z'), title: 'Synthetic follow-up', notes: null,
            status: 'pending', source: 'manual' }],
    };
}
function recorder() {
    const calls: Array<{ kind: string; id: string; changes?: unknown; version?: number }> = [];
    const port: PatientEditPort = {
        async updatePatient(id, changes) { calls.push({ kind: 'patient', id, changes: structuredClone(changes) }); },
        async updateCheckup(id, changes) { calls.push({ kind: 'checkup', id, changes: structuredClone(changes) }); },
        async deleteCheckup(id, version) { calls.push({ kind: 'delete', id, version }); },
        async createCheckup(item) { calls.push({ kind: 'create', id: item.id, changes: structuredClone(item) }); return item.id; },
    };
    return { calls, port };
}
const newId = () => 'synthetic-schema-created';

test('ordinary unchanged save through real patientSchema emits zero writes despite key reordering', async () => {
    const record = fixture(); const session = new PatientEditSession(record); const memory = recorder();
    assert.deepEqual(Object.keys(record.diagnoses![0]), ['system', 'code', 'description', 'date']);
    const parsed = patientSchema.parse(session.getDefaultValues());
    assert.deepEqual(Object.keys(parsed.diagnoses[0]), ['code', 'description', 'system', 'date']);
    assert.ok(parsed.diagnoses[0].date instanceof Date);
    assert.equal(parsed.diagnoses[0].date.toISOString(), '2020-01-02T12:34:56.789Z');
    assert.deepEqual(await session.submit(parsed, memory.port, newId), { status: 'complete', confirmed: 0, total: 0 });
    assert.deepEqual(memory.calls, []);
});

test('real patientSchema checkup conflict attempts exactly one child write, with no patient PUT first', async () => {
    const session = new PatientEditSession(fixture()); const memory = recorder();
    const parsed = patientSchema.parse(session.getDefaultValues()); parsed.checkups[0].title = 'Reviewed';
    const conflict = new Error('Synthetic stale checkup');
    const port: PatientEditPort = { ...memory.port, async updateCheckup(id, changes) {
        await memory.port.updateCheckup(id, changes); throw conflict;
    } };
    const result = await session.submit(parsed, port, newId);
    assert.deepEqual(result, { status: 'interrupted', confirmed: 0, total: 1, error: conflict });
    assert.deepEqual(memory.calls, [{ kind: 'checkup', id: 'synthetic-schema-checkup', changes: { version: 5, title: 'Reviewed' } }]);
});

for (const date of [new Date('2020-01-02T12:34:56.789Z'), '2020-01-02T14:34:56.789+02:00']) {
    test(`real patientSchema preserves equivalent diagnosis instants: ${String(date)}`, async () => {
        const session = new PatientEditSession(fixture()); const memory = recorder();
        const values = session.getDefaultValues(); const row = values.diagnoses[0];
        const parsed = patientSchema.parse({ ...values, diagnoses: [{ date, description: row.description, code: row.code, system: row.system }] });
        assert.equal(parsed.diagnoses[0].date.toISOString(), '2020-01-02T12:34:56.789Z');
        assert.deepEqual(await session.submit(parsed, memory.port, newId), { status: 'complete', confirmed: 0, total: 0 });
        assert.deepEqual(memory.calls, []);
    });
}

for (const [field, value] of Object.entries({ code: 'TEST-B', description: 'Changed diagnosis', system: 'ICD-10', date: '2020-01-02T12:34:56.790Z' })) {
    test(`real patientSchema does not hide a genuine diagnosis ${field} edit`, async () => {
        const session = new PatientEditSession(fixture()); const memory = recorder();
        const draft = session.getDefaultValues(); draft.diagnoses[0] = { ...draft.diagnoses[0], [field]: value };
        const parsed = patientSchema.parse(draft);
        assert.deepEqual(await session.submit(parsed, memory.port, newId), { status: 'complete', confirmed: 1, total: 1 });
        assert.deepEqual(memory.calls, [{ kind: 'patient', id: 'synthetic-schema-patient', changes: { version: 3, diagnoses: parsed.diagnoses } }]);
    });
}

test('real patientSchema retains submitted diagnosis order and duplicates', async () => {
    const record = fixture(); record.diagnoses!.push({ ...record.diagnoses![0], code: 'TEST-B' });
    const session = new PatientEditSession(record); const memory = recorder(); const draft = session.getDefaultValues();
    draft.diagnoses.reverse(); draft.diagnoses.push({ ...draft.diagnoses[0] });
    const parsed = patientSchema.parse(draft);
    await session.submit(parsed, memory.port, newId);
    assert.deepEqual(memory.calls, [{ kind: 'patient', id: record.id, changes: { version: 3, diagnoses: parsed.diagnoses } }]);
    assert.deepEqual(parsed.diagnoses.map(row => row.code), ['TEST-B', 'TEST-A', 'TEST-B']);
});

for (const editName of [false, true]) {
    test(`real patientSchema stripping opaque fields does not rewrite diagnoses (name edit: ${editName})`, async () => {
        const record = fixture(); const opaque = { ...record.diagnoses![0], provenance: { source: 'synthetic-document' } };
        record.diagnoses = [opaque]; const session = new PatientEditSession(record); const memory = recorder();
        const parsed = patientSchema.parse({ ...session.getDefaultValues(), diagnoses: [opaque] });
        assert.equal(Object.prototype.hasOwnProperty.call(parsed.diagnoses[0], 'provenance'), false);
        if (editName) parsed.firstName = 'Updated';
        await session.submit(parsed, memory.port, newId);
        assert.deepEqual(memory.calls, editName ? [{ kind: 'patient', id: record.id, changes: { version: 3, firstName: 'Updated' } }] : []);
    });
}

test('real patientSchema addition preserves the opaque fields of retained snapshot diagnoses', async () => {
    const record = fixture(); const opaque = { ...record.diagnoses![0], provenance: { source: 'synthetic-document' } };
    record.diagnoses = [opaque]; const session = new PatientEditSession(record); const memory = recorder();
    const draft = session.getDefaultValues(); draft.diagnoses.unshift({ ...draft.diagnoses[0], code: 'TEST-B' });
    const parsed = patientSchema.parse(draft); await session.submit(parsed, memory.port, newId);
    assert.deepEqual(memory.calls, [{ kind: 'patient', id: record.id, changes: { version: 3, diagnoses: [parsed.diagnoses[0], opaque] } }]);
});

test('real patientSchema opaque-row edit is reported before writes, without losing the draft', async () => {
    const record = fixture(); const opaque = { ...record.diagnoses![0], provenance: { source: 'synthetic-document' } };
    record.diagnoses = [opaque]; const session = new PatientEditSession(record); const memory = recorder();
    const parsed = patientSchema.parse(session.getDefaultValues()); parsed.diagnoses[0].description = 'Edited opaque row';
    const before = structuredClone(parsed);
    await assert.rejects(session.submit(parsed, memory.port, newId), /metadati non gestiti/);
    assert.deepEqual(memory.calls, []); assert.equal(session.locked, false); assert.deepEqual(parsed, before);
});
