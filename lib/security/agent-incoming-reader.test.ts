import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const { agentCassetteFixture } = await import('../test-fixtures/agent-cassette.ts');
const { createAgentIncomingReader } = await import('./agent-incoming-reader.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const { installLoopbackIngress } = await import('./loopback-ingress.mjs');

const f = await agentCassetteFixture();
f.run(() => f.store.open(f.principal, f.visitId, f.anchor));
const own = f.rows()[0], other = { ...own, id: randomUUID(), actorRef: 'another-synthetic-doctor' };
const context = issueSyntheticWebSessionContext({ id: f.actorRef, username: f.actorRef, role: 'admin' }, 'agent-incoming-reader');
let session: typeof context.session | null = context.session;
let reads = 0;
const handler = createAgentIncomingReader({ session: async () => session, cassettes: () => { reads++; return [own, other]; } });
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
    const rows = await response.json();
    assert.deepEqual(rows.map((row: { id: string }) => row.id), [own.id]);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(rows[0].archiveGeneration, own.archiveGeneration);
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
