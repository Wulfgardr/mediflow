import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const { agentCassetteFixture } = await import('../test-fixtures/agent-cassette.ts');
const { readAgentCassette, readAgentCassetteIndex } = await import('../agent-cassette-store.ts');
const { createAgentIncomingReader } = await import('./agent-incoming-reader.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const { installLoopbackIngress } = await import('./loopback-ingress.mjs');

const f = await agentCassetteFixture();
f.run(() => f.store.open(f.principal, f.visitId, f.anchor));
f.database.prepare('UPDATE agent_cassettes SET archive_generation=? WHERE id=?').run(randomUUID(), f.visitId);
const own = f.rows()[0], other = { ...own, id: randomUUID(), actorRef: 'another-synthetic-doctor' };
const copyCassette = f.database.prepare(`INSERT INTO agent_cassettes SELECT ?, mandate_ref, agent_ref, ?, archive_generation,
    public_key, wrapped_private_key, model_provider, allows_clinical_egress, anchor_ciphertext, items_ciphertext, status,
    revision, deposited_at, modified_at FROM agent_cassettes WHERE id=?`);
copyCassette.run(other.id, other.actorRef, own.id);
const context = issueSyntheticWebSessionContext({ id: f.actorRef, username: f.actorRef, role: 'admin' }, 'agent-incoming-reader');
let session: typeof context.session | null = context.session;
let reads = 0;
const handler = createAgentIncomingReader({
    session: async () => session,
    index: (actorRef, after) => { reads++; return readAgentCassetteIndex(f.database, actorRef, after); },
    cassette: (actorRef, id) => {
        reads++;
        const row = readAgentCassette(f.database, id, actorRef);
        return row && { ...row, appliedItemIds: [] };
    },
});
installLoopbackIngress();
const server = createServer(async (incoming, outgoing) => {
    try {
        const request = new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), { headers: incoming.headers as Record<string, string> });
        const response = await handler(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object');
const origin = 'http://127.0.0.1:' + address.port;
test.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    retireSyntheticWebSession(context.session); f.database.close();
});

test('the attested HTTP reader returns only the current physician cassettes and retains previous-generation recovery', async () => {
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    const { visits: rows, next } = await response.json();
    assert.deepEqual(rows.map((row: { id: string }) => row.id), [own.id]);
    assert.equal(next, null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(rows[0].archiveGeneration, own.archiveGeneration);
    assert.notEqual(own.archiveGeneration, f.generation);
});

test('the inbox lists only metadata and loads only the requested cassette payload', async () => {
    const listing = await fetch(origin);
    assert.equal(listing.status, 200);
    const index = await listing.text();
    assert.ok(index.includes(own.id));
    assert.ok(!index.includes('itemsCiphertext'));
    assert.ok(!index.includes('wrappedPrivateKey'));
    const detail = await fetch(origin + '?visit=' + own.id);
    assert.equal(detail.status, 200);
    const row = await detail.json();
    assert.equal(row.id, own.id);
    assert.equal(row.itemsCiphertext, own.itemsCiphertext);
    assert.equal((await fetch(origin + '?visit=' + other.id)).status, 404);
});

test('a large inbox crosses the cursor without returning another physician’s cassette', async () => {
    const ids = Array.from({ length: 65 }, () => randomUUID());
    f.run(() => { for (const id of ids) copyCassette.run(id, f.actorRef, own.id); });
    try {
        const first = await (await fetch(origin)).json();
        assert.equal(first.visits.length, 64);
        assert.equal(first.next, first.visits.at(-1).id);
        const second = await (await fetch(origin + '?after=' + first.next)).json();
        assert.equal(second.next, null);
        assert.deepEqual([...first.visits, ...second.visits].map((row: { id: string }) => row.id), [own.id, ...ids].sort());
        assert.deepEqual(await (await fetch(origin + '?after=' + other.id)).json(), { visits: [], next: null });
        assert.equal((await fetch(origin + '?after=invalid')).status, 400);
        assert.equal((await fetch(origin + '?after=' + first.next + '&visit=' + own.id)).status, 400);
    } finally { f.run(() => { for (const id of ids) f.database.prepare('DELETE FROM agent_cassettes WHERE id=?').run(id); }); }
});

test('bearer, missing session and forged loopback requests cannot read any cassette', async () => {
    const before = reads;
    assert.equal((await fetch(origin, { headers: { Authorization: 'Bearer synthetic-agent' } })).status, 404);
    session = null;
    assert.equal((await fetch(origin)).status, 403);
    session = { ...context.session, role: 'reader' };
    assert.equal((await fetch(origin)).status, 403);
    session = Object.assign({ ...context.session }, { authChannel: 'token' });
    assert.equal((await fetch(origin)).status, 403);
    session = context.session;
    assert.equal((await handler(new Request(origin, { headers: { 'x-mediflow-server-loopback': 'forged' } }))).status, 404);
    assert.equal(reads, before);
});
