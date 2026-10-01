/* @Codex: regression for the private loader and current transactional fixture seams. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHarness } from './test-support/checkup-parent-lifecycle-harness.mjs';
import { assertChildFirst, assertDeletionFirst } from './test-support/checkup-parent-lifecycle-assertions.mjs';

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

const operationPath = 'lib/checkup-write-operation.ts';
const operationSource = fs.readFileSync(new URL('../lib/checkup-write-operation.ts', import.meta.url), 'utf8');
test('guard: parent-first safety oracle rejects removal of transactional parent admission', async t => {
    const admission = "        if (!activeParentExists(tx, existing.patientId)) return { status: 404, value: { error: 'Not found' } };";
    assert.equal(operationSource.split(admission).length, 2, 'mutation must remove exactly the update parent check');
    const h = createHarness({ sharedWal: true, sourceOverrides: { [operationPath]: operationSource.replace(admission, '') } });
    t.after(() => h.close());
    await assert.rejects(assertDeletionFirst(h, 'PUT', { version: 5, title: 'Must be denied' }),
        { code: 'ERR_ASSERTION', actual: 200, expected: 404 });
});

test('guard: child-first safety oracle rejects loss of IMMEDIATE writer exclusion', async t => {
    assert.equal(operationSource.split("{ behavior: 'immediate' }").length, 3);
    const h = createHarness({ sharedWal: true, sourceOverrides: {
        [operationPath]: operationSource.replaceAll("{ behavior: 'immediate' }", "{ behavior: 'deferred' }"),
    } });
    t.after(() => h.close());
    await assert.rejects(assertChildFirst(h, 'DELETE', { version: 5 }),
        { code: 'ERR_ASSERTION', actual: 'committed', expected: 'SQLITE_BUSY' });
});

test('registration: behavior and private-loader suites each occur once in required units', () => {
    const runner = fs.readFileSync(new URL('./run-unit-suite.mjs', import.meta.url), 'utf8');
    const selection = runner.match(/const unitArgs = (\[[^\n]+\]);/)?.[1];
    assert.ok(selection);
    for (const filename of ['scripts/checkup-parent-lifecycle.test.mjs', 'scripts/checkup-parent-lifecycle-harness.test.mjs']) {
        assert.equal(selection.split(`'${filename}'`).length, 2, `${filename} must be selected exactly once`);
    }
});
