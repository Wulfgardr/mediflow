import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import test from 'node:test';
import { createAgentLocalKitHttp } from './agent-local-kit-http';
import { createAgentLocalKitStore } from '../agent-local-kit-store';
import { createAgentPairingStore } from '../agent-pairing-store';
import { createAgentRegistrationStore } from '../agent-registration-store';
import { installLoopbackIngress } from './loopback-ingress.mjs';
import { AGENT_OPERATIONS } from '../agent-mandate-contract';
import { readAgentCredential, readAgentRegistration } from '../../packages/agent-client/src/credentials';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-agent-local-kit-http-'));
const kitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-fake-kit-'));
const kitDir = path.join(kitRoot, 'mf-ambulatorio-kit');
const credsDir = path.join(kitDir, '.agente');
fs.mkdirSync(kitDir, { mode: 0o700 });
fs.writeFileSync(
    path.join(kitDir, 'deposito.json'),
    JSON.stringify({
        origine: 'http://127.0.0.1:3000',
        mediflow: '/synthetic/mediflow/corrente',
        node: '/synthetic/node',
        credenziali: credsDir,
        agente: null,
    }, null, 2) + '\n',
    { mode: 0o600 },
);

process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { openDbServer, dbServer } = await import('../db-server.ts');
const database = openDbServer();
const { verifyHostCredentials } = await import('./host-credential-verification.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const { readSqliteArchiveGeneration } = await import('../archive-generation.ts');

const actor = 'synthetic-local-kit-doctor';
const username = ['synthetic', 'local', 'kit', 'account'].join('-');
const pin = ['2', '4', '6', '8'].join('');
database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
    .run(actor, username, 'admin', await bcrypt.hash(pin, 4), 'synthetic-wrapped-master', 'synthetic-salt');
const context = issueSyntheticWebSessionContext({ id: actor, username, role: 'admin' }, 'agent-local-kit-http');
let current = context.session as typeof context.session | null;
let pinCalls = 0;

const handlers = createAgentLocalKitHttp({
    session: async () => current,
    async verifyPin(candidateUser, candidatePin) {
        pinCalls++;
        const result = await verifyHostCredentials({ username: candidateUser, pin: candidatePin });
        return result.kind === 'verified' ? result.account.id : null;
    },
    store: () => createAgentLocalKitStore(database),
});

installLoopbackIngress();
const server = createServer(async (incoming, outgoing) => {
    try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), {
            method: incoming.method,
            headers: incoming.headers as Record<string, string>,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        const handler = handlers[incoming.method as keyof typeof handlers];
        const response = handler ? await handler(request) : new Response(null, { status: 405 });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
        outgoing.writeHead(500);
        outgoing.end();
    }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;

async function candidateMandate() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    return {
        id: randomUUID(),
        durationMs: 43200000,
        operations: [...AGENT_OPERATIONS],
        provider: 'openai' as const,
        allowsClinicalEgress: true,
        publicKey: Buffer.from(raw).toString('base64'),
        wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64),
    };
}

function mutationHeaders(extra: Record<string, string> = {}) {
    return {
        'Content-Type': 'application/json',
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
        'x-mediflow-archive-generation': readSqliteArchiveGeneration(database),
        ...extra,
    };
}

test.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    retireSyntheticWebSession(context.session);
    dbServer.$client.close();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(kitRoot, { recursive: true, force: true });
});

test('locked session cannot read, configure, connect or disconnect local kit', async () => {
    current = null;
    try {
        assert.equal((await fetch(origin)).status, 401);
        assert.equal((await fetch(origin, { method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ kitPath: kitDir }) })).status, 403);
        assert.equal((await fetch(origin, {
            method: 'POST',
            headers: mutationHeaders(),
            body: JSON.stringify({ pin, mandate: await candidateMandate(), kitPath: kitDir }),
        })).status, 403);
        assert.equal((await fetch(origin, { method: 'DELETE', headers: mutationHeaders() })).status, 403);
    } finally {
        current = context.session;
    }
});

test('rejects nonexistent kit path and symlink kit path without creating mandates or consuming PIN attempts', async () => {
    const beforeCalls = pinCalls;
    const missing = path.join(kitRoot, 'missing-kit');
    const symlinkKit = path.join(kitRoot, 'symlink-kit');
    fs.symlinkSync(kitDir, symlinkKit);

    for (const badPath of [missing, symlinkKit]) {
        const putRes = await fetch(origin, { method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ kitPath: badPath }) });
        assert.equal(putRes.status, 400);
        const postRes = await fetch(origin, {
            method: 'POST',
            headers: mutationHeaders(),
            body: JSON.stringify({ pin, mandate: await candidateMandate(), kitPath: badPath }),
        });
        assert.equal(postRes.status, 400);
    }
    assert.equal(pinCalls, beforeCalls);
    assert.equal(database.prepare('SELECT count(*) FROM agent_mandates').pluck().get(), 0);
});

test('connects Codex in one click, writes kit files without leaking tokens, supports renewal, and disconnect invalidates credentials', async () => {
    const putRes = await fetch(origin, { method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ kitPath: kitDir }) });
    assert.equal(putRes.status, 200);
    const savedState = await putRes.json();
    assert.equal(savedState.kitPath, fs.realpathSync(kitDir));
    assert.equal(savedState.connected, false);

    const mandateInput = await candidateMandate();
    const connectRes = await fetch(origin, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({ pin, mandate: mandateInput }),
    });
    assert.equal(connectRes.status, 201);
    const receiptText = await connectRes.text();
    assert.equal(receiptText.includes('mfa_'), false);
    assert.equal(receiptText.includes('mfr_'), false);
    const receipt = JSON.parse(receiptText);
    assert.equal(receipt.status, 'connected');
    const otherKit = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-other-kit-'));
    fs.chmodSync(otherKit, 0o700);
    fs.writeFileSync(path.join(otherKit, 'deposito.json'), JSON.stringify({ credenziali: path.join(otherKit, '.agente'), agente: null }), { mode: 0o600 });
    const moveRes = await fetch(origin, { method: 'PUT', headers: mutationHeaders(), body: JSON.stringify({ kitPath: otherKit }) });
    assert.equal(moveRes.status, 409);
    assert.equal((await moveRes.json()).code, 'LOCAL_KIT_CONNECTED');
    assert.equal(fs.existsSync(path.join(otherKit, '.agente')), false);
    assert.equal(typeof receipt.agentRef, 'string');
    assert.equal(receipt.mandateRef, mandateInput.id);

    const deposito = JSON.parse(fs.readFileSync(path.join(kitDir, 'deposito.json'), 'utf8'));
    assert.equal(deposito.agente, receipt.agentRef);
    assert.equal(deposito.mediflow, '/synthetic/mediflow/corrente');
    assert.equal(deposito.node, '/synthetic/node');

    const access = readAgentCredential(credsDir, receipt.agentRef);
    const registration = readAgentRegistration(credsDir, receipt.agentRef);
    assert.ok(access);
    assert.ok(registration);
    assert.equal(access.mandateRef, mandateInput.id);
    assert.equal(access.origin, 'http://127.0.0.1:3000');
    assert.equal(registration.origin, 'http://127.0.0.1:3000');

    const activePrincipal = database.transaction(() => createAgentPairingStore(database).principal(access.token)).immediate();
    assert.ok(activePrincipal);
    assert.equal(activePrincipal.agentRef, receipt.agentRef);
    assert.equal(activePrincipal.mandateRef, mandateInput.id);

    const registrationStore = createAgentRegistrationStore(database);
    const generation = readSqliteArchiveGeneration(database);
    registrationStore.renew(actor, generation, 'synthetic-unlock-ref');
    const renewed = registrationStore.retrieve(registration.token, ref => ref === 'synthetic-unlock-ref');
    assert.equal(renewed.agentRef, receipt.agentRef);
    assert.match(renewed.token, /^mfa_[A-Za-z0-9_-]{43}$/u);

    const creationAudits = database.prepare("SELECT event_type FROM audit_events WHERE actor_ref=? ORDER BY rowid").all(actor) as { event_type: string }[];
    assert.ok(creationAudits.some(row => row.event_type === 'agent.mandate.created'));
    assert.ok(creationAudits.some(row => row.event_type === 'agent.client.registered'));

    const disconnectRes = await fetch(origin, { method: 'DELETE', headers: mutationHeaders() });
    assert.equal(disconnectRes.status, 200);

    assert.equal(fs.existsSync(path.join(credsDir, `${receipt.agentRef}.json`)), false);
    assert.equal(fs.existsSync(path.join(credsDir, `${receipt.agentRef}.registration.json`)), false);
    const depositoAfter = JSON.parse(fs.readFileSync(path.join(kitDir, 'deposito.json'), 'utf8'));
    assert.equal(depositoAfter.agente, null);
    assert.equal(depositoAfter.mediflow, '/synthetic/mediflow/corrente');

    const principalAfter = database.transaction(() => createAgentPairingStore(database).principal(access.token)).immediate();
    assert.equal(principalAfter, null);
    const renewedPrincipalAfter = database.transaction(() => registrationStore.principal(renewed.token, () => true)).immediate();
    assert.equal(renewedPrincipalAfter, null);
    assert.throws(() => registrationStore.retrieve(registration.token, () => true), /AGENT_MANDATE_DENIED/);

    const revocationAudits = database.prepare("SELECT event_type FROM audit_events WHERE actor_ref=?").all(actor) as { event_type: string }[];
    assert.ok(revocationAudits.some(row => row.event_type === 'agent.client.revoked'));
    assert.ok(revocationAudits.some(row => row.event_type === 'agent.mandate.revoked'));

    const statusAfter = await (await fetch(origin)).json();
    assert.equal(statusAfter.connected, false);
    assert.equal(statusAfter.agentRef, null);
});
