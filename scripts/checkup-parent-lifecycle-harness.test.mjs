/* @Codex: regression for the private loader and current transactional fixture seams. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './test-support/checkup-parent-lifecycle-harness.mjs';

for (const method of ['PUT', 'DELETE']) {
    test(`loader: ${method} uses the real mutation and the in-memory transaction audit seam`, async t => {
        const h = createHarness();
        t.after(() => h.close());
        const response = await h.request(method, { version: 5, title: 'Loader regression' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true });
        assert.equal(h.row().version, 6);
        if (method === 'PUT') assert.equal(h.row().title, 'Loader regression');
        else assert.ok(h.row().deleted_at);
        assert.ok(h.statements.some(sql => /^begin immediate$/i.test(sql)));
        assert.ok(h.statements.some(sql => /^update "checkups" /i.test(sql)));
        assert.equal(h.audit.length, 1);
        assert.equal(h.audit[0].eventType, method === 'PUT' ? 'checkup.updated' : 'checkup.deleted');
        assert.equal(h.audit[0].subjectRef, 'synthetic-checkup');
        assert.equal(h.audit[0].redactedMetadata.resourceVersion, 6);
        assert.equal(h.sqlite.inTransaction, false);
    });
}

test('loader: the real body reader rejects a non-object without row or audit effects', async t => {
    const h = createHarness();
    t.after(() => h.close());
    const before = h.row();
    const response = await h.request('PUT', []);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid JSON body' });
    assert.deepEqual(h.row(), before);
    assert.equal(h.audit.length, 0);
    assert.ok(!h.statements.some(sql => /^begin /i.test(sql)));
});
