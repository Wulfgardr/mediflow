import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import test from 'node:test';
import { createAgentMandateHttp } from './agent-mandate-http';
import { createAgentMandateStore } from '../agent-mandate-store';
import { installLoopbackIngress } from './loopback-ingress.mjs';
import { AGENT_OPERATIONS } from '../agent-mandate-contract';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-mandate-http-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { openDbServer, dbServer } = await import('../db-server.ts');
const database = openDbServer();
const { verifyHostCredentials } = await import('./host-credential-verification.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const { readSqliteArchiveGeneration } = await import('../archive-generation.ts');
const actor = 'synthetic-mandate-http-doctor', username = ['synthetic', 'mandate', 'http', 'account'].join('-'), pin = ['2', '4', '6', '8'].join('');
database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
    .run(actor, username, 'admin', await bcrypt.hash(pin, 4), 'synthetic-wrapped-master', 'synthetic-salt');
const context = issueSyntheticWebSessionContext({ id: actor, username, role: 'admin' }, 'agent-mandate-http');
let current = context.session as typeof context.session | null;
let revokeDuringPin = false, pinCalls = 0;
const handlers = createAgentMandateHttp({ session: async () => current,
    async verifyPin(username, pin) {
        pinCalls++;
        const result = await verifyHostCredentials({ username, pin });
        if (revokeDuringPin) current = null;
        return result.kind === 'verified' ? result.account.id : null;
    }, store: () => createAgentMandateStore(database) });
installLoopbackIngress();
const server = createServer(async (incoming, outgoing) => {
    try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), { method: incoming.method,
            headers: incoming.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const handler = handlers[incoming.method as keyof typeof handlers];
        const response = handler ? await handler(request) : new Response(null, { status: 405 });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
async function candidate() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return { id: randomUUID(), durationMs: 43200000, operations: [...AGENT_OPERATIONS], provider: 'openai', allowsClinicalEgress: true,
        publicKey: Buffer.from(raw).toString('base64'), wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) };
}
async function post(mandate: Awaited<ReturnType<typeof candidate>>, options: { pin?: string; headers?: Record<string, string> } = {}) {
    return fetch(origin, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin',
        'x-mediflow-archive-generation': readSqliteArchiveGeneration(database), ...options.headers }, body: JSON.stringify({ mandate, pin: options.pin ?? pin }) });
}
test.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    retireSyntheticWebSession(context.session); dbServer.$client.close(); rmSync(directory, { recursive: true, force: true });
});

test('socket-attested trusted Web creation requires the actual PIN and persists no PIN in mandate or receipt', async () => {
    const input = await candidate();
    const deniedCredential = Array(4).fill(0).join('');
    const denied = await post(input, { pin: deniedCredential }); assert.equal(denied.status, 403);
    assert.equal(createAgentMandateStore(database).read(input.id), null);
    const response = await post(input); assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.actorRef, actor); assert.equal(body.expiresAt - body.createdAt, 43200000);
    assert.equal(body.publicKey, input.publicKey); assert.equal(body.wrappedPrivateKey, input.wrappedPrivateKey);
    const row = database.prepare('SELECT * FROM agent_mandates WHERE id=?').get(input.id) as Record<string, unknown>;
    assert.ok(!Object.keys(row).some(key => /pin|password|private_key_clear/u.test(key)));
    assert.equal(Object.hasOwn(body, 'pin'), false);
});

test('automation PIN outside trusted browser transport, local token and forged loopback attestation fail before PIN verification', async () => {
    const input = await candidate(), before = pinCalls;
    const foreignOrigin = new URL(origin); foreignOrigin.hostname = 'foreign.invalid';
    const cases: Record<string, string>[] = [{ 'Sec-Fetch-Site': 'none' }, { Origin: foreignOrigin.origin },
        { Authorization: 'Bearer synthetic-local-api-token' }, { 'x-mediflow-archive-generation': 'synthetic-old-generation' }];
    for (const headers of cases) {
        assert.equal((await post(input, { headers })).status, 403);
    }
    const direct = new Request(origin, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin,
        'Sec-Fetch-Site': 'same-origin', 'x-mediflow-server-loopback': 'forged', 'x-mediflow-archive-generation': readSqliteArchiveGeneration(database) },
        body: JSON.stringify({ mandate: input, pin }) });
    assert.equal((await handlers.POST(direct)).status, 403);
    assert.equal(pinCalls, before);
    assert.equal(createAgentMandateStore(database).read(input.id), null);
});

test('12h1min and invalid curve point fail without a mandate', async () => {
    const input = await candidate();
    assert.equal((await post({ ...input, durationMs: 43260000 })).status, 400);
    const response = await post({ ...input, publicKey: 'B' + '/'.repeat(86) + '=' });
    assert.notEqual(response.status, 201);
    assert.equal(createAgentMandateStore(database).read(input.id), null);
});

test('a passphrase or non-digit PIN fails before verification without consuming a lockout attempt', async () => {
    const input = await candidate();
    const beforeCalls = pinCalls;
    const attempts = () => (database.prepare('SELECT failed_login_attempts n FROM users WHERE id = ?').get(actor) as { n: number }).n;
    const beforeAttempts = attempts();
    for (const candidatePin of ['cavallo batteria graffetta corretta', 'AbC!09', '123456789', 'segreto', '1234a']) {
        const response = await post(input, { pin: candidatePin });
        assert.equal(response.status, 400, candidatePin);
    }
    assert.equal(pinCalls, beforeCalls);
    assert.equal(attempts(), beforeAttempts);
    assert.equal(createAgentMandateStore(database).read(input.id), null);
});

test('session retirement during PIN verification cannot publish a new mandate', async () => {
    const input = await candidate(); revokeDuringPin = true;
    try { assert.equal((await post(input)).status, 403); assert.equal(createAgentMandateStore(database).read(input.id), null); }
    finally { current = context.session; revokeDuringPin = false; }
});
