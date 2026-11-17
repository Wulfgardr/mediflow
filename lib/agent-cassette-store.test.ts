import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { agentCassetteFixture } from './test-fixtures/agent-cassette';
import { rotateSqliteArchiveGeneration } from './archive-generation';
import { createAgentCassetteStore } from './agent-cassette-store';

test('a cassette durably separates anchor, encrypted items and metadata, retries without duplicate writes and closes once', async () => {
    const f = await agentCassetteFixture();
    try {
        const open = f.run(() => f.store.open(f.principal, f.visitId, f.anchor)); assert.equal(open.revision, 1);
        assert.deepEqual(f.run(() => f.store.open(f.principal, f.visitId, f.anchor)), open);
        const added = f.run(() => f.store.add(f.principal, f.visitId, 1, f.item)); assert.equal(added.revision, 2);
        assert.deepEqual(f.run(() => createAgentCassetteStore(f.database, () => f.mandate.createdAt + 1).add(f.principal, f.visitId, 1, f.item)), added);
        const closed = f.run(() => f.store.close(f.principal, f.visitId, 2)); assert.equal(closed.status, 'closed'); assert.equal(closed.revision, 3);
        assert.deepEqual(f.run(() => f.store.close(f.principal, f.visitId, 2)), closed);
        assert.equal(f.rows().length, 1); assert.equal(f.rows()[0]!.wrappedPrivateKey, f.mandate.wrappedPrivateKey);
        assert.ok(!f.database.serialize().includes(Buffer.from(f.sentinel)));
        assert.ok(!f.database.serialize().includes(Buffer.from('SYNTHETIC_CF_6742')));
        assert.ok(!JSON.stringify(closed).includes(f.token)); assert.ok(!JSON.stringify(closed).includes(f.sentinel));
        const audit = f.database.prepare("SELECT actor_type,actor_ref,source_surface,proposer_ref,mandate_ref,model_provider FROM audit_events WHERE event_type LIKE 'agent.cassette.%' OR event_type='agent.item.deposited'").all();
        assert.equal(audit.length, 3);
        for (const row of audit) assert.deepEqual(row, { actor_type: 'user', actor_ref: f.actorRef, source_surface: 'agent', proposer_ref: f.principal.agentRef, mandate_ref: f.mandate.id, model_provider: 'local' });
    } finally { f.database.close(); }
});
for (const mutation of ['revoked', 'expired', 'archive', 'scope', 'actor', 'no-transaction'] as const) test(`${mutation} cannot deposit or audit a cassette`, async () => {
    const f = await agentCassetteFixture();
    try {
        if (mutation === 'revoked') f.mandates.revoke(f.mandate.id, f.actorRef, f.generation);
        if (mutation === 'expired') f.advance(43200000);
        if (mutation === 'archive') f.run(() => rotateSqliteArchiveGeneration(f.database));
        const principal = mutation === 'scope' ? { ...f.principal, operations: ['visita.nota' as const] } : mutation === 'actor' ? { ...f.principal, actorRef: 'other' } : f.principal;
        const action = () => f.store.open(principal, f.visitId, f.anchor);
        assert.throws(() => mutation === 'no-transaction' ? action() : f.run(action));
        assert.equal(f.rows().length, 0);
        assert.equal(f.database.prepare("SELECT count(*) FROM audit_events WHERE event_type='agent.cassette.opened'").pluck().get(), 0);
    } finally { f.database.close(); }
});
for (const stage of ['open', 'add', 'close'] as const) for (const failure of ['audit', 'ignored-write'] as const) test(`${stage} ${failure} leaves the cassette unchanged`, async () => {
    const f = await agentCassetteFixture();
    try {
        if (stage !== 'open') f.run(() => f.store.open(f.principal, f.visitId, f.anchor));
        if (stage === 'close') f.run(() => f.store.add(f.principal, f.visitId, 1, f.item));
        const before = f.rows(), count = f.database.prepare('SELECT count(*) FROM audit_events').pluck().get();
        if (failure === 'audit') f.database.exec("CREATE TRIGGER synthetic_cassette_audit_fault BEFORE INSERT ON audit_events WHEN NEW.source_surface='agent' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CASSETTE_AUDIT_FAULT'); END");
        else f.database.exec(`CREATE TRIGGER synthetic_cassette_ignored BEFORE ${stage === 'open' ? 'INSERT' : 'UPDATE'} ON agent_cassettes BEGIN SELECT RAISE(IGNORE); END`);
        assert.throws(() => f.run(() => stage === 'open' ? f.store.open(f.principal, f.visitId, f.anchor) : stage === 'add' ? f.store.add(f.principal, f.visitId, 1, f.item) : f.store.close(f.principal, f.visitId, 2)));
        assert.deepEqual(f.rows(), before); assert.equal(f.database.prepare('SELECT count(*) FROM audit_events').pluck().get(), count);
    } finally { f.database.close(); }
});
test('stale revision, changed retry, wrong proposer and plaintext metadata never change an existing cassette', async () => {
    const f = await agentCassetteFixture();
    try {
        f.run(() => f.store.open(f.principal, f.visitId, f.anchor)); const before = f.rows();
        for (const action of [() => f.store.add(f.principal, f.visitId, 9, f.item),
            () => f.store.add({ ...f.principal, agentRef: randomUUID() }, f.visitId, 1, f.item),
            () => f.store.add(f.principal, f.visitId, 1, { ...f.item, clinicalText: f.sentinel }),
            () => f.store.open(f.principal, f.visitId, { ...f.anchor, clinicalText: f.sentinel })]) assert.throws(() => f.run(action));
        assert.deepEqual(f.rows(), before);
        f.run(() => f.store.add(f.principal, f.visitId, 1, f.item));
        assert.throws(() => f.run(() => f.store.add(f.principal, f.visitId, 1, { ...f.item, byteLength: f.item.byteLength + 1 })));
        assert.equal(f.rows()[0]!.revision, 2);
    } finally { f.database.close(); }
});
