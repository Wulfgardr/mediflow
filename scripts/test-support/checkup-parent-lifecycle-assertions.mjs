/* @Codex: shared behavioral oracle for real routes and negative fixture controls. */
import assert from 'node:assert/strict';

function independentWalConnections(h) {
    assert.ok(h.contender);
    assert.notEqual(h.sqlite, h.contender);
    assert.equal(h.sqlite.name, h.contender.name);
    assert.equal(h.sqlite.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(h.contender.pragma('journal_mode', { simple: true }), 'wal');
}

export async function assertDeletionFirst(h, method, payload) {
    independentWalConnections(h);
    const before = h.row(), auditBefore = h.audit.slice();
    let reached = false;
    h.beforeTransaction(() => {
        reached = true;
        // This hook is after the route's successful preflight but before the
        // real operation opens IMMEDIATE. B commits through its own connection.
        assert.equal(h.sqlite.inTransaction, false);
        assert.ok(h.statements.some(sql => /^select .*"checkups".*exists\s*\(/i.test(sql)));
        assert.equal(h.deleteParent(h.contender).changes, 1);
        assert.equal(h.contender.inTransaction, false);
        assert.equal(h.parent().deleted_at, 1893456001);
    });
    const response = await h.request(method, payload);
    assert.equal(reached, true, 'the deletion must occur after successful preflight');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Not found' });
    assert.deepEqual(h.row(), before);
    assert.deepEqual({ ...h.contender.prepare("SELECT * FROM checkups WHERE id = 'synthetic-checkup'").get() }, before);
    assert.deepEqual(h.audit, auditBefore);
    assert.equal(h.sqlite.inTransaction, false);
}

export async function assertChildFirst(h, method, payload) {
    independentWalConnections(h);
    const before = h.row();
    let reached = false, deletionCode;
    h.beforeUpdate(() => {
        reached = true;
        assert.equal(h.sqlite.inTransaction, true);
        assert.equal(h.parent(h.contender).deleted_at, null);
        try { h.deleteParent(h.contender); deletionCode = 'committed'; }
        catch (error) { deletionCode = error.code; }
    });
    const response = await h.request(method, payload);
    assert.equal(reached, true, 'the independent deletion must attempt before child UPDATE');
    assert.equal(deletionCode, 'SQLITE_BUSY', 'the admitted child transaction must exclude the other writer');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(h.parent().deleted_at, null);
    assert.equal(h.parent(h.contender).deleted_at, null);
    assert.equal(h.row().version, before.version + 1);
    if (method === 'PUT') assert.equal(h.row().title, payload.title);
    else assert.ok(h.row().deleted_at);
    for (const field of ['id', 'patient_id', 'date', 'notes', 'status', 'source', 'created_at']) {
        assert.equal(h.row()[field], before[field], `${field} must retain its value`);
    }
    assert.equal(h.audit.length, 1);
    assert.equal(h.audit[0].eventType, method === 'PUT' ? 'checkup.updated' : 'checkup.deleted');
    assert.equal(h.audit[0].subjectRef, before.id);
    assert.equal(h.audit[0].redactedMetadata.resourceVersion, before.version + 1);
    assert.equal(h.sqlite.inTransaction, false);
    assert.ok(h.statements.some(sql => /^begin immediate$/i.test(sql)));
    assert.deepEqual({ ...h.contender.prepare("SELECT * FROM checkups WHERE id = 'synthetic-checkup'").get() }, h.row());

    // The formerly blocked writer may commit only after the child transaction.
    assert.equal(h.deleteParent(h.contender).changes, 1);
    assert.equal(h.parent().deleted_at, 1893456001);
    const committed = h.row(), auditCommitted = h.audit.slice();
    const later = await h.request(method, { ...payload, version: committed.version });
    assert.equal(later.status, 404);
    assert.deepEqual(await later.json(), { error: 'Not found' });
    assert.deepEqual(h.row(), committed);
    assert.deepEqual(h.audit, auditCommitted);
}
