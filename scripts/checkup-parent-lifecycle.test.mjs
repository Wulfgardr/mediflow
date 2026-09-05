/* @Codex MF085 combined review: normal editor behavior, synthetic SQLite only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './test-support/checkup-parent-lifecycle-harness.mjs';

for (const method of ['PUT', 'DELETE']) {
    const payload = method === 'PUT' ? { version: 5, title: 'After' } : { version: 5 };
    test(`${method}: a tombstoned parent denies the write without changing child or audit`, async t => {
        const h = createHarness(); t.after(() => h.close()); h.deleteParent(); const before = h.row();
        const response = await h.request(method, payload);
        assert.equal(response.status, 404); assert.deepEqual(h.row(), before); assert.equal(h.audit.length, 0);
    });
    test(`${method}: parent deleted after read is checked atomically with the child CAS`, async t => {
        const h = createHarness(); t.after(() => h.close()); const before = h.row();
        h.beforeUpdate(() => h.deleteParent());
        const response = await h.request(method, payload);
        assert.equal(response.status, 409); assert.deepEqual(h.row(), before); assert.equal(h.audit.length, 0);
        const conflict = await response.json(); assert.equal(conflict.code, 'VERSION_CONFLICT'); assert.equal(conflict.currentState, 'missing');
    });
    test(`${method}: archived but not deleted parents remain writable`, async t => {
        const h = createHarness(); t.after(() => h.close()); h.sqlite.exec('UPDATE patients SET is_archived = 1');
        const response = await h.request(method, payload);
        assert.equal(response.status, 200); assert.equal(h.row().version, 6); assert.equal(h.audit.length, 1);
        if (method === 'PUT') assert.equal(h.row().title, 'After'); else assert.ok(h.row().deleted_at);
    });
    test(`${method}: stale child version retains its structured conflict and writes nothing`, async t => {
        const h = createHarness(); t.after(() => h.close()); const before = h.row();
        const response = await h.request(method, { ...payload, version: 4 });
        assert.equal(response.status, 409); assert.deepEqual(h.row(), before); assert.equal(h.audit.length, 0);
        const conflict = await response.json(); assert.equal(conflict.expectedVersion, 4); assert.equal(conflict.currentVersion, 5);
    });
}
for (const deletion of [false, true]) {
    test(`real snapshot planner + route: ${deletion ? 'remove' : 'edit'} child after parent tombstone preserves draft`, async t => {
        const h = createHarness(); t.after(() => h.close());
        const session = new h.Session({ id: 'synthetic-patient', version: 3, firstName: 'Synthetic', lastName: 'Review',
            checkups: [{ id: 'synthetic-checkup', patientId: 'synthetic-patient', version: 5, title: 'Before',
                date: new Date('2030-01-02T00:00:00Z'), status: 'pending', source: 'manual' }] });
        const draft = session.getDefaultValues();
        if (deletion) draft.checkups = []; else draft.checkups[0].title = 'After';
        h.deleteParent(); const before = h.row(); let parentWrites = 0;
        const send = async (method, body) => { const response = await h.request(method, body); if (!response.ok) throw new Error(`HTTP ${response.status}`); };
        const result = await session.submit(draft, {
            updatePatient: async () => { parentWrites++; throw new Error('unexpected parent write'); },
            updateCheckup: async (_id, body) => send('PUT', body),
            deleteCheckup: async (_id, version) => send('DELETE', { version }),
            createCheckup: async () => { throw new Error('unexpected create'); },
        }, () => 'synthetic-new');
        assert.equal(parentWrites, 0); assert.equal(result.status, 'interrupted'); assert.equal(result.confirmed, 0);
        assert.equal(result.total, 1); assert.equal(session.locked, true); assert.deepEqual(h.row(), before); assert.equal(h.audit.length, 0);
    });
}
