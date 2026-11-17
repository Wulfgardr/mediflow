import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAgentMandateStore } from '../agent-mandate-store';
import { createAgentPairingStore } from '../agent-pairing-store';
import { readSqliteArchiveGeneration } from '../archive-generation';
import { installLoopbackIngress } from './loopback-ingress.mjs';
import { agentChannelFailure, withAgentTransaction } from './agent-channel';
import { allowsNetworkIngress } from './network-ingress-policy.mjs';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-channel-'));
process.env.MEDIFLOW_DATA_DIR = directory; process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { openDbServer } = await import('../db-server.ts'); const database = openDbServer();
const { getOrCreateLocalApiToken } = await import('./local-api-token.ts');
const { POST: pair, GET: poll } = await import('../../app/api/agent/v1/pairings/route.ts');
const { GET: context } = await import('../../app/api/agent/v1/context/route.ts');
const actor = 'synthetic-channel-doctor';
database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
    .run(actor, actor, 'admin', 'synthetic-hash', 'synthetic-wrapping', 'synthetic-salt');
const generation = readSqliteArchiveGeneration(database);
const mandates = createAgentMandateStore(database), pairings = createAgentPairingStore(database);
const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations: ['visita.apri', 'visita.nota'], provider: 'local', allowsClinicalEgress: false,
    publicKey: 'B' + 'A'.repeat(86) + '=', wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) }, actor, generation);
installLoopbackIngress();
const server = createServer(async (incoming, outgoing) => {
    try {
        const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), { method: incoming.method,
            headers: incoming.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const url = new URL(request.url);
        let response: Response;
        if (url.pathname === '/api/agent/v1/pairings') response = await (incoming.method === 'POST' ? pair(request) : poll(request));
        else if (url.pathname === '/api/agent/v1/context') response = await context(request);
        else {
            try { response = withAgentTransaction(database, request, 'visita.proponi.terapia', () => {
                database.prepare("INSERT INTO settings(key,value) VALUES ('synthetic-agent-scope-write','ciphertext')").run(); return Response.json({ status: 'accepted' });
            }); } catch (error) { response = agentChannelFailure(error); }
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object'); const origin = `http://127.0.0.1:${address.port}`;
test.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); database.close(); rmSync(directory, { recursive: true, force: true }); });

test('real loopback pairing route never emits a token before UI approval and its bearer has a bounded non-clinical context', async () => {
    const response = await fetch(origin + '/api/agent/v1/pairings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Synthetic channel agent', operations: ['visita.apri', 'visita.nota'] }) });
    assert.equal(response.status, 201); const requested = await response.json();
    const url = origin + '/api/agent/v1/pairings?requestId=' + requested.receipt.id;
    const headers = { Authorization: 'Pairing ' + requested.pairingCredential.claim };
    const pending = await fetch(url, { headers }); assert.equal(pending.status, 202); assert.equal((await pending.json()).credential, null);
    pairings.approve(requested.receipt.id, requested.receipt.code, mandate.id, actor, generation);
    const issued = await fetch(url, { headers }); assert.equal(issued.status, 200); const credential = await issued.json();
    const token = credential.credential.token;
    assert.ok(!JSON.stringify(credential.receipt).includes(token));
    const authorized = { Authorization: 'Bearer ' + token };
    const info = await fetch(origin + '/api/agent/v1/context', { headers: authorized }); assert.equal(info.status, 200);
    const body = await info.json(); assert.equal(body.publicKey, mandate.publicKey); assert.equal(body.expiresAt, mandate.expiresAt);
    for (const forbidden of ['wrappedPrivateKey', 'actorRef', 'pin', 'patients', 'token']) assert.equal(Object.hasOwn(body, forbidden), false);
    const scope = await fetch(origin + '/synthetic-scope-probe', { method: 'POST', headers: authorized }); assert.equal(scope.status, 403);
    assert.equal(database.prepare("SELECT count(*) FROM settings WHERE key='synthetic-agent-scope-write'").pluck().get(), 0);
    const local = await fetch(origin + '/api/agent/v1/context', { headers: { Authorization: 'Bearer ' + getOrCreateLocalApiToken() } }); assert.equal(local.status, 401);
    const forged = await context(new Request(origin + '/api/agent/v1/context', { headers: { ...authorized, 'x-mediflow-server-loopback': 'forged', 'x-forwarded-for': '127.0.0.1' } }));
    assert.equal(forged.status, 404);
    mandates.revoke(mandate.id, actor, generation);
    const revoked = await fetch(origin + '/api/agent/v1/context', { headers: authorized }); assert.equal(revoked.status, 401);
    assert.ok(!database.serialize().includes(Buffer.from(token)));
});

test('remote proxy policy denies all agent and mandate routes including encoded and decorated variants', () => {
    for (const path of ['/api/agent/v1/pairings', '/api/agent/v1/context', '/api/agent/v1/visits', '/api/agent-mandates',
        '/api/agent-mandates/pairings', '/api/%61gent/v1/context', '/api/agent/v1/context?loopback=1']) {
        for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(allowsNetworkIngress(method, path), false);
    }
});
