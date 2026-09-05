/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PatientEditSession, patientFormDefaults,
    type PatientEditPort, type PatientEditRecord, type PatientFormSeed,
} from './patient-edit-session.ts';

function fixture(): PatientEditRecord {
    return {
        id: 'synthetic-patient-a', version: 3,
        firstName: 'Test', lastName: 'Fixture', taxCode: 'SYNTHETIC0000001',
        birthDate: new Date('1980-02-03T12:34:56.789Z'),
        diagnoses: [{ system: 'ICD-11', code: 'TEST-A', description: 'Synthetic diagnosis', date: new Date('2020-01-02T12:34:56.789Z') }],
        checkups: [{ id: 'synthetic-checkup-a', patientId: 'synthetic-patient-a', version: 5,
            title: 'Synthetic follow-up', date: new Date('2030-02-03T12:34:56.789Z'), notes: null,
            status: 'pending', source: 'manual' }],
    };
}
class Conflict extends Error {}
type Call = { kind: string; id: string; version?: number; changes?: Record<string, unknown> };

/** A synthetic transport model only. The planner/journal under test is production code. */
function store(seed = fixture()) {
    const patient = structuredClone(seed);
    const rows = new Map(seed.checkups.map(row => [row.id, structuredClone(row)]));
    const calls: Call[] = [];
    let applied = 0;
    let fault: { id: string; kind: string; phase: 'before' | 'after' } | null = null;
    function maybeFail(kind: string, id: string, phase: 'before' | 'after') {
        if (fault?.id === id && fault.kind === kind && fault.phase === phase) {
            fault = null;
            throw new Error('Synthetic transport interruption');
        }
    }
    function current(id: string, version: number) {
        const row = rows.get(id);
        if (!row) throw new Error('Synthetic not found');
        if (row.version !== version) throw new Conflict('Synthetic version conflict');
        return row;
    }
    const port: PatientEditPort = {
        async updatePatient(id, changes) {
            calls.push({ kind: 'patient', id, version: changes.version, changes: structuredClone(changes) });
            maybeFail('patient', id, 'before');
            if (id !== patient.id || patient.deletedAt) throw new Error('Synthetic patient missing');
            if (patient.version !== changes.version) throw new Conflict('Synthetic version conflict');
            Object.assign(patient, structuredClone(changes), { version: changes.version + 1 });
            applied += 1;
            maybeFail('patient', id, 'after');
        },
        async updateCheckup(id, changes) {
            calls.push({ kind: 'update', id, version: changes.version, changes: structuredClone(changes) });
            maybeFail('update', id, 'before');
            Object.assign(current(id, changes.version), structuredClone(changes), { version: changes.version + 1 });
            applied += 1;
            maybeFail('update', id, 'after');
        },
        async deleteCheckup(id, version) {
            calls.push({ kind: 'delete', id, version });
            maybeFail('delete', id, 'before');
            Object.assign(current(id, version), { deletedAt: new Date('2030-01-01'), version: version + 1 });
            applied += 1;
            maybeFail('delete', id, 'after');
        },
        async createCheckup(item) {
            calls.push({ kind: 'create', id: item.id });
            maybeFail('create', item.id, 'before');
            if (rows.has(item.id)) throw new Error('Synthetic duplicate primary key');
            rows.set(item.id, { ...structuredClone(item), version: 1 });
            applied += 1;
            maybeFail('create', item.id, 'after');
            return item.id;
        },
    };
    return { patient, rows, calls, port, get applied() { return applied; },
        fail(kind: string, id: string, phase: 'before' | 'after' = 'before') { fault = { kind, id, phase }; },
        snapshot(): PatientEditRecord {
            return { ...structuredClone(patient), checkups: [...rows.values()].filter(row => !row.deletedAt).map(row => structuredClone(row)) };
        },
    };
}
const newId = () => 'synthetic-created-a';
function changed(session: PatientEditSession) {
    const draft = session.getDefaultValues();
    draft.firstName = 'Updated';
    draft.checkups[0].title = 'Reviewed follow-up';
    return draft;
}

test('unchanged save is a no-op, including dates, diagnosis timestamps and absent optional fields', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    assert.deepEqual(await session.submit(session.getDefaultValues(), memory.port, newId), { status: 'complete', confirmed: 0, total: 0 });
    assert.equal(memory.calls.length, 0);
    assert.equal(memory.patient.version, 3);
    assert.equal(memory.rows.get('synthetic-checkup-a')?.version, 5);
    assert.equal(session.getDefaultValues().diagnoses[0].date, '2020-01-02T12:34:56.789Z');
});

test('the initial patient/checkup tokens and values are detached from later live-query objects', async () => {
    const record = fixture(); const memory = store(record); const session = new PatientEditSession(record);
    record.version = 99; record.firstName = 'Live update'; record.checkups[0].version = 99;
    record.checkups[0].title = 'Live title'; record.diagnoses![0].description = 'Live diagnosis';
    const draft = changed(session);
    assert.equal(draft.diagnoses[0].description, 'Synthetic diagnosis');
    assert.equal((await session.submit(draft, memory.port, newId)).status, 'complete');
    assert.deepEqual(memory.calls.map(call => call.version), [3, 5]);
});

test('form defaults handed to a consumer cannot mutate the CAS baseline', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    const values = session.getDefaultValues(); values.checkups[0].title = 'Edited';
    values.diagnoses[0].description = 'Edited diagnosis';
    assert.equal((await session.submit(values, memory.port, newId)).status, 'complete');
    assert.equal(memory.calls.length, 2);
});

test('stale patient update fails before any child writes and keeps the original patient token', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    memory.patient.version = 4; memory.patient.firstName = 'Concurrent';
    const result = await session.submit(changed(session), memory.port, newId);
    assert.equal(result.status, 'interrupted'); assert.equal(result.confirmed, 0);
    assert.deepEqual(memory.calls.map(call => [call.kind, call.version]), [['patient', 3]]);
    assert.equal(memory.patient.firstName, 'Concurrent'); assert.equal(memory.applied, 0);
});

test('ordinary unchanged save does not overwrite a concurrently changed patient', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    memory.patient.version = 4; memory.patient.firstName = 'Concurrent';
    assert.equal((await session.submit(session.getDefaultValues(), memory.port, newId)).status, 'complete');
    assert.equal(memory.calls.length, 0); assert.equal(memory.patient.firstName, 'Concurrent');
});

test('stale checkup update never rolls back a concurrently completed status', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    Object.assign(memory.rows.get('synthetic-checkup-a')!, { version: 6, status: 'completed' });
    const draft = session.getDefaultValues(); draft.checkups[0].title = 'Edited';
    const result = await session.submit(draft, memory.port, newId);
    assert.equal(result.status, 'interrupted'); assert.equal(result.confirmed, 0);
    assert.equal(memory.calls[0].version, 5); assert.equal(memory.rows.get('synthetic-checkup-a')?.status, 'completed');
    assert.equal(memory.applied, 0);
});

test('stale checkup deletion retains the concurrent row and uses the initial token', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    memory.rows.get('synthetic-checkup-a')!.version = 6;
    const draft = session.getDefaultValues(); draft.checkups = [];
    assert.equal((await session.submit(draft, memory.port, newId)).status, 'interrupted');
    assert.deepEqual(memory.calls, [{ kind: 'delete', id: 'synthetic-checkup-a', version: 5 }]);
    assert.equal(memory.rows.get('synthetic-checkup-a')?.deletedAt, undefined);
});

test('an unseen concurrent addition survives both an update and an explicit initial-row removal', async () => {
    for (const remove of [false, true]) {
        const memory = store(); const session = new PatientEditSession(fixture());
        memory.rows.set('synthetic-concurrent', { ...fixture().checkups[0], id: 'synthetic-concurrent', version: 1 });
        const draft = session.getDefaultValues();
        if (remove) draft.checkups = []; else draft.checkups[0].title = 'Edited';
        assert.equal((await session.submit(draft, memory.port, newId)).status, 'complete');
        assert.equal(memory.rows.get('synthetic-concurrent')?.version, 1);
        assert.equal(memory.rows.get('synthetic-concurrent')?.deletedAt, undefined);
        assert.ok(memory.calls.every(call => call.id !== 'synthetic-concurrent'));
    }
});

test('unchanged rows are not updated even when their current version/status changed', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    Object.assign(memory.rows.get('synthetic-checkup-a')!, { version: 6, status: 'completed' });
    const draft = session.getDefaultValues(); draft.phone = 'synthetic-extension';
    assert.equal((await session.submit(draft, memory.port, newId)).status, 'complete');
    assert.deepEqual(memory.calls.map(call => call.kind), ['patient']);
});

test('explicit removal soft-deletes only the initial row with its original version', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    const draft = session.getDefaultValues(); draft.checkups = [];
    assert.equal((await session.submit(draft, memory.port, newId)).status, 'complete');
    assert.equal(memory.rows.get('synthetic-checkup-a')?.version, 6);
    assert.ok(memory.rows.get('synthetic-checkup-a')?.deletedAt);
});

for (const missing of ['soft-deleted', 'missing'] as const) {
    for (const remove of [false, true]) {
        test(`${missing} initial row is never recreated during ${remove ? 'delete' : 'update'}`, async () => {
            const memory = store(); const session = new PatientEditSession(fixture());
            if (missing === 'missing') memory.rows.delete('synthetic-checkup-a');
            else Object.assign(memory.rows.get('synthetic-checkup-a')!, { deletedAt: new Date(), version: 6 });
            const draft = session.getDefaultValues();
            if (remove) draft.checkups = []; else draft.checkups[0].title = 'Edited';
            assert.equal((await session.submit(draft, memory.port, newId)).status, 'interrupted');
            assert.ok(memory.calls.every(call => call.kind !== 'create'));
            assert.equal(memory.applied, 0);
        });
    }
}

test('an already deleted but unchanged row is left alone, not reinserted', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    memory.rows.delete('synthetic-checkup-a');
    assert.equal((await session.submit(session.getDefaultValues(), memory.port, newId)).status, 'complete');
    assert.equal(memory.calls.length, 0);
});

for (const variant of ['unknown-id', 'duplicate-id', 'foreign-owner', 'foreign-patient', 'missing-list'] as const) {
    test(`all validation precedes the patient write: ${variant}`, async () => {
        const memory = store(); const session = new PatientEditSession(fixture());
        const draft: PatientFormSeed = changed(session);
        if (variant === 'unknown-id') draft.checkups![0].id = 'synthetic-foreign-row';
        if (variant === 'duplicate-id') draft.checkups!.push({ ...draft.checkups![0] });
        if (variant === 'foreign-owner') draft.checkups![0].patientId = 'synthetic-patient-b';
        if (variant === 'foreign-patient') draft.id = 'synthetic-patient-b';
        if (variant === 'missing-list') delete draft.checkups;
        await assert.rejects(session.submit(draft, memory.port, newId));
        assert.equal(memory.calls.length, 0); assert.equal(session.locked, false);
    });
}

test('snapshot validation rejects duplicate/foreign/deleted rows and missing or invalid versions', () => {
    const invalid: PatientEditRecord[] = [];
    let seed = fixture(); seed.checkups.push({ ...seed.checkups[0] }); invalid.push(seed);
    seed = fixture(); seed.checkups[0].patientId = 'synthetic-patient-b'; invalid.push(seed);
    seed = fixture(); seed.checkups[0].deletedAt = new Date(); invalid.push(seed);
    seed = fixture(); seed.deletedAt = new Date(); invalid.push(seed);
    for (const version of [undefined, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) {
        seed = fixture(); seed.version = version; invalid.push(seed);
        seed = fixture(); seed.checkups[0].version = version; invalid.push(seed);
    }
    for (const record of invalid) assert.throws(() => new PatientEditSession(record));
});

test('partial failure resumes only unconfirmed operations even after acknowledged rows change again', async () => {
    const seed = fixture(); seed.checkups.push({ ...seed.checkups[0], id: 'synthetic-checkup-b', version: 8 });
    const memory = store(seed); const session = new PatientEditSession(seed); const draft = changed(session);
    draft.checkups[1].title = 'Second edit'; memory.fail('update', 'synthetic-checkup-b');
    const partial = await session.submit(draft, memory.port, newId);
    assert.equal(partial.status, 'interrupted'); assert.equal(partial.confirmed, 2); assert.equal(partial.total, 3);
    Object.assign(memory.patient, { version: 5, firstName: 'Concurrent after ack' });
    Object.assign(memory.rows.get('synthetic-checkup-a')!, { version: 7, title: 'Concurrent after ack' });
    draft.checkups[1].title = 'Changed caller draft'; // must not affect the frozen plan
    const resumed = await session.resume(memory.port);
    assert.deepEqual(resumed, { status: 'complete', confirmed: 3, total: 3 });
    assert.deepEqual(memory.calls.map(call => [call.kind, call.version]), [['patient', 3], ['update', 5], ['update', 8], ['update', 8]]);
    assert.equal(memory.patient.firstName, 'Concurrent after ack');
    assert.equal(memory.rows.get('synthetic-checkup-a')?.title, 'Concurrent after ack');
    assert.equal(memory.rows.get('synthetic-checkup-b')?.title, 'Second edit');
    await assert.rejects(session.submit(draft, memory.port, newId));
});

test('acknowledged creates are not repeated when a later delete fails', async () => {
    const memory = store(); const session = new PatientEditSession(fixture()); const draft = session.getDefaultValues();
    draft.checkups = [{ ...draft.checkups[0], id: '', title: 'New synthetic row' }];
    memory.fail('delete', 'synthetic-checkup-a');
    const partial = await session.submit(draft, memory.port, newId);
    assert.equal(partial.confirmed, 1);
    assert.equal((await session.resume(memory.port)).status, 'complete');
    assert.equal(memory.calls.filter(call => call.kind === 'create').length, 1);
    assert.equal(memory.rows.get(newId())?.patientId, fixture().id);
});

test('interrupted create retries the same generated ID rather than allocating another', async () => {
    const memory = store(); const session = new PatientEditSession(fixture()); const draft = session.getDefaultValues();
    draft.checkups.push({ ...draft.checkups[0], id: '', title: 'New synthetic row' });
    let ids = 0; memory.fail('create', newId());
    assert.equal((await session.submit(draft, memory.port, () => { ids += 1; return newId(); })).status, 'interrupted');
    assert.equal((await session.resume(memory.port)).status, 'complete');
    assert.equal(ids, 1); assert.deepEqual(memory.calls.map(call => call.id), [newId(), newId()]);
    assert.equal(memory.rows.size, 2);
});

for (const kind of ['patient', 'update', 'delete', 'create'] as const) {
    test(`lost ${kind} acknowledgement never repeats an effect; explicit reread is recoverable`, async () => {
        const memory = store(); const session = new PatientEditSession(fixture()); const draft = session.getDefaultValues();
        if (kind === 'patient') draft.firstName = 'Updated';
        if (kind === 'update') draft.checkups[0].title = 'Updated';
        if (kind === 'delete') draft.checkups = [];
        if (kind === 'create') draft.checkups.push({ ...draft.checkups[0], id: '', title: 'Added' });
        const id = kind === 'patient' ? fixture().id : kind === 'create' ? newId() : 'synthetic-checkup-a';
        memory.fail(kind, id, 'after');
        const first = await session.submit(draft, memory.port, newId);
        assert.equal(first.status, 'interrupted'); assert.equal(first.confirmed, 0); assert.equal(memory.applied, 1);
        const retried = await session.resume(memory.port);
        assert.equal(retried.status, 'interrupted'); assert.equal(retried.confirmed, 0); assert.equal(memory.applied, 1);
        // Models the separate, user-confirmed reread. The old plan is not rebased.
        const recovered = new PatientEditSession(memory.snapshot());
        assert.deepEqual(await recovered.submit(recovered.getDefaultValues(), memory.port, newId), { status: 'complete', confirmed: 0, total: 0 });
        assert.equal(memory.applied, 1);
    });
}

test('duplicate generated IDs are rejected before any write', async () => {
    const memory = store(); const session = new PatientEditSession(fixture()); const draft = changed(session);
    draft.checkups.push({ ...draft.checkups[0], id: '' }, { ...draft.checkups[0], id: '' });
    await assert.rejects(session.submit(draft, memory.port, newId));
    assert.equal(memory.calls.length, 0);
});

test('an adapter cannot change the frozen retry payload', async () => {
    const memory = store(); const session = new PatientEditSession(fixture()); const draft = session.getDefaultValues();
    draft.firstName = 'Reviewed';
    const port: PatientEditPort = { ...memory.port, async updatePatient(_id, changes) { changes.version = 99; changes.firstName = 'Mutated'; throw new Error('Synthetic interruption'); } };
    assert.equal((await session.submit(draft, port, newId)).status, 'interrupted');
    assert.equal((await session.resume(memory.port)).status, 'complete');
    assert.equal(memory.patient.firstName, 'Reviewed'); assert.equal(memory.calls[0].version, 3);
});

test('overlapping submits/resumes cannot dispatch a second write', async () => {
    const memory = store(); const session = new PatientEditSession(fixture()); const draft = session.getDefaultValues(); draft.firstName = 'Updated';
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
    const port: PatientEditPort = { ...memory.port, async updatePatient(id, changes) { calls += 1; await gate; await memory.port.updatePatient(id, changes); } };
    const saving = session.submit(draft, port, newId);
    await assert.rejects(session.resume(port), /già in corso/);
    await assert.rejects(session.submit(draft, port, newId));
    release(); assert.equal((await saving).status, 'complete'); assert.equal(calls, 1);
    assert.equal((await session.resume(port)).status, 'complete'); assert.equal(calls, 1);
});

test('a title-only update preserves date precision, provenance and all untouched fields', async () => {
    const memory = store(); const session = new PatientEditSession(fixture()); const draft = session.getDefaultValues(); draft.checkups[0].title = 'Reviewed';
    await session.submit(draft, memory.port, newId);
    assert.deepEqual(memory.calls[0].changes, { version: 5, title: 'Reviewed' });
    assert.equal((memory.rows.get('synthetic-checkup-a')!.date as Date).toISOString(), '2030-02-03T12:34:56.789Z');
});

test('clearing birthDate uses the existing nullable wire contract, not an invalid Date', async () => {
    const memory = store(); const session = new PatientEditSession(fixture()); const draft = session.getDefaultValues(); draft.birthDate = '';
    await session.submit(draft, memory.port, newId);
    assert.deepEqual(memory.calls[0].changes, { version: 3, birthDate: null });
});

test('new-form defaults and date transforms retain the normal create flow', () => {
    const empty = patientFormDefaults();
    assert.deepEqual(empty.checkups, []); assert.deepEqual(empty.diagnoses, []);
    assert.equal(empty.monitoringProfile, 'taken_in_charge'); assert.equal(empty.isAdi, false);
    const defaults = patientFormDefaults(fixture());
    assert.equal(defaults.birthDate, '1980-02-03'); assert.equal(defaults.checkups[0].date, '2030-02-03');
    assert.equal(defaults.checkups[0].id, 'synthetic-checkup-a');
    assert.throws(() => patientFormDefaults({ birthDate: 'invalid-date' }));
});

/* @Codex: followup2 — compare editable values, not property insertion order. */
test('diagnosis property order alone causes zero writes', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    const draft = session.getDefaultValues();
    const row = draft.diagnoses[0];
    draft.diagnoses[0] = { date: row.date, description: row.description, code: row.code, system: row.system };
    assert.deepEqual(await session.submit(draft, memory.port, newId), { status: 'complete', confirmed: 0, total: 0 });
    assert.deepEqual(memory.calls, []);
});

for (const date of [new Date('2020-01-02T12:34:56.789Z'), '2020-01-02T14:34:56.789+02:00']) {
    test(`equivalent diagnosis instant is unchanged: ${String(date)}`, async () => {
        const memory = store(); const session = new PatientEditSession(fixture());
        const draft: PatientFormSeed = session.getDefaultValues();
        draft.diagnoses![0] = { date, description: 'Synthetic diagnosis', code: 'TEST-A', system: 'ICD-11' };
        assert.deepEqual(await session.submit(draft, memory.port, newId), { status: 'complete', confirmed: 0, total: 0 });
        assert.deepEqual(memory.calls, []);
    });
}

for (const [field, value] of Object.entries({ code: 'TEST-B', description: 'Changed diagnosis', system: 'ICD-10', date: '2020-01-02T12:34:56.790Z' })) {
    test(`a real diagnosis ${field} edit is written with the initial token`, async () => {
        const memory = store(); const session = new PatientEditSession(fixture());
        const draft = session.getDefaultValues();
        draft.diagnoses[0] = { ...draft.diagnoses[0], [field]: value };
        assert.deepEqual(await session.submit(draft, memory.port, newId), { status: 'complete', confirmed: 1, total: 1 });
        assert.deepEqual(memory.calls[0].changes, { version: 3, diagnoses: draft.diagnoses.map(row => ({ ...row, date: new Date(row.date) })) });
        assert.equal(memory.calls.length, 1);
    });
}

for (const action of ['reorder', 'add duplicate', 'remove'] as const) {
    test(`diagnosis arrays retain order and multiplicity on ${action}`, async () => {
        const record = fixture();
        record.diagnoses!.push({ ...record.diagnoses![0], code: 'TEST-B', description: 'Other diagnosis' });
        const memory = store(record); const session = new PatientEditSession(record);
        const draft = session.getDefaultValues();
        if (action === 'reorder') draft.diagnoses.reverse();
        else if (action === 'add duplicate') draft.diagnoses.push({ ...draft.diagnoses[0] });
        else draft.diagnoses.splice(0, 1);
        assert.equal((await session.submit(draft, memory.port, newId)).confirmed, 1);
        assert.deepEqual(memory.calls[0].changes, { version: 3, diagnoses: draft.diagnoses.map(row => ({ ...row, date: new Date(row.date) })) });
        assert.equal(memory.calls.length, 1);
    });
}

function recordWithOpaqueDiagnosis() {
    const record = fixture();
    const opaque = { ...record.diagnoses![0], provenance: { source: 'synthetic-source', tags: ['b', 'a'] } };
    return { ...record, diagnoses: [opaque, { ...record.diagnoses![0], code: 'TEST-B', description: 'Other diagnosis' }] };
}

test('schema-shaped draft omitting opaque diagnosis metadata does not overwrite it on a name edit', async () => {
    const record = recordWithOpaqueDiagnosis(); const memory = store(record); const session = new PatientEditSession(record);
    const draft = session.getDefaultValues();
    draft.diagnoses = draft.diagnoses.map(row => ({ code: row.code, description: row.description, system: row.system, date: row.date }));
    draft.firstName = 'Updated';
    await session.submit(draft, memory.port, newId);
    assert.deepEqual(memory.calls[0].changes, { version: 3, firstName: 'Updated' });
    assert.deepEqual(memory.patient.diagnoses, record.diagnoses);
});

test('retained opaque metadata comes from the snapshot, not a draft or the row index', async () => {
    const record = recordWithOpaqueDiagnosis(); const memory = store(record); const session = new PatientEditSession(record);
    const values = session.getDefaultValues();
    const untrusted = { ...values.diagnoses[0], provenance: { source: 'changed-in-draft' } };
    const edited = { ...values.diagnoses[1], description: 'Changed other diagnosis' };
    const draft = { ...values, diagnoses: [edited, untrusted] };
    await session.submit(draft, memory.port, newId);
    assert.deepEqual(memory.calls[0].changes, { version: 3, diagnoses: [
        { ...edited, date: new Date(edited.date) }, record.diagnoses[0],
    ] });
    assert.equal(memory.calls.length, 1);
    assert.deepEqual(session.getDefaultValues(), values);
});

for (const action of ['edit', 'remove', 'duplicate'] as const) {
    test(`opaque diagnosis ${action} fails before any write rather than guessing metadata identity`, async () => {
        const record = recordWithOpaqueDiagnosis(); const memory = store(record); const session = new PatientEditSession(record);
        const draft = session.getDefaultValues(); draft.firstName = 'Updated'; draft.checkups[0].title = 'Reviewed';
        if (action === 'edit') draft.diagnoses[0].description = 'Changed opaque diagnosis';
        else if (action === 'remove') draft.diagnoses.splice(0, 1);
        else draft.diagnoses.push({ ...draft.diagnoses[0] });
        const before = structuredClone(draft);
        await assert.rejects(session.submit(draft, memory.port, newId), /metadati non gestiti/);
        assert.deepEqual(memory.calls, []); assert.equal(session.locked, false);
        assert.deepEqual(draft, before); assert.deepEqual(memory.patient.diagnoses, record.diagnoses);
    });
}

test('schema-shaped reordered diagnosis keys do not prepend a patient write to a checkup conflict', async () => {
    const memory = store(); const session = new PatientEditSession(fixture());
    const values = session.getDefaultValues(); const row = values.diagnoses[0];
    const draft = { ...values, diagnoses: [{ code: row.code, description: row.description, system: row.system, date: new Date(row.date) }] };
    draft.checkups[0].title = 'Reviewed'; memory.rows.get('synthetic-checkup-a')!.version = 6;
    const result = await session.submit(draft, memory.port, newId);
    assert.equal(result.status, 'interrupted'); assert.equal(result.confirmed, 0); assert.equal(result.total, 1);
    assert.deepEqual(memory.calls, [{ kind: 'update', id: 'synthetic-checkup-a', version: 5, changes: { version: 5, title: 'Reviewed' } }]);
    assert.equal(memory.patient.version, 3); assert.equal(memory.applied, 0);
});
