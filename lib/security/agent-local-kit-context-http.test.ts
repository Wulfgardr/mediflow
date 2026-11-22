import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import test from 'node:test';
import { createAgentLocalKitHttp } from './agent-local-kit-http';
import { createAgentLocalKitContextHttp } from './agent-local-kit-context-http';
import { createAgentLocalKitStore } from '../agent-local-kit-store';
import { installLoopbackIngress } from './loopback-ingress.mjs';
import { AGENT_OPERATIONS } from '../agent-mandate-contract';
import { sha256HexClient } from '../agent-local-kit-context-contract';
import { LOCAL_KIT_CONTEXT_DIR_NAME } from './agent-local-kit-files';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-agent-local-kit-ctx-http-'));
const kitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-fake-ctx-kit-'));
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

const actor = 'synthetic-local-kit-ctx-doctor';
const username = ['synthetic', 'local', 'kit', 'ctx', 'account'].join('-');
const pin = ['2', '4', '6', '8'].join('');
database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
    .run(actor, username, 'admin', await bcrypt.hash(pin, 4), 'synthetic-wrapped-master', 'synthetic-salt');
const context = issueSyntheticWebSessionContext({ id: actor, username, role: 'admin' }, 'agent-local-kit-ctx-http');
let current = context.session as typeof context.session | null;
let failAuditOnce = false;

function wrappedStore() {
    const base = createAgentLocalKitStore(database);
    return {
        ...base,
        recordContextAudit(eventType: 'agent.context.exported' | 'agent.context.cleared', actorRef: string, subjectRef: string, generation: string) {
            if (failAuditOnce) {
                failAuditOnce = false;
                throw new Error('synthetic audit failure');
            }
            return base.recordContextAudit(eventType, actorRef, subjectRef, generation);
        },
    };
}

const kitHandlers = createAgentLocalKitHttp({
    session: async () => current,
    async verifyPin(candidateUser, candidatePin) {
        const result = await verifyHostCredentials({ username: candidateUser, pin: candidatePin });
        return result.kind === 'verified' ? result.account.id : null;
    },
    store: () => createAgentLocalKitStore(database),
});

const contextHandlers = createAgentLocalKitContextHttp({
    session: async () => current,
    store: wrappedStore,
});

installLoopbackIngress();
const server = createServer(async (incoming, outgoing) => {
    try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
        const request = new Request(url, {
            method: incoming.method,
            headers: incoming.headers as Record<string, string>,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        const table = url.pathname.startsWith('/context') ? contextHandlers : kitHandlers;
        const handler = table[incoming.method as keyof typeof table];
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

function mutationHeaders(extra: Record<string, string> = {}) {
    return {
        'Content-Type': 'application/json',
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
        'x-mediflow-archive-generation': readSqliteArchiveGeneration(database),
        ...extra,
    };
}

async function sampleContextPayload(taxCode = 'RSSMRA80A01H501U') {
    const cfHash = await sha256HexClient(taxCode);
    return {
        patient: { cfHash, taxCodeLast4: taxCode.slice(-4), birthYear: 1980 },
        diagnoses: [{ description: 'Ipertensione arteriosa', code: 'BA00', system: 'ICD-11' }],
        therapies: [{ drugName: 'Ramipril 5 mg', dosage: '1 cp al mattino', status: 'active' }],
        exemptions: [{ code: '031' }],
        allergies: [],
        observations: [{ display: 'Peso corporeo', value: '75', unit: 'kg', code: '29463-7' }],
        recentNotes: [{ date: '2026-10-01', text: 'Quadro stabile.' }],
        openCheckups: [],
    };
}

async function connectKit() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const response = await fetch(`${origin}/kit`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
            pin,
            kitPath: kitDir,
            mandate: {
                id: randomUUID(),
                durationMs: 86400000,
                operations: [...AGENT_OPERATIONS],
                provider: 'openai',
                allowsClinicalEgress: true,
                publicKey: Buffer.from(raw).toString('base64'),
                wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64),
            },
        }),
    });
    assert.equal(response.status, 201);
}

test.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    retireSyntheticWebSession(context.session);
    dbServer.$client.close();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(kitRoot, { recursive: true, force: true });
});

test('blocks unauthenticated, cross-origin, bearer, and disconnected exports without writing files', async () => {
    const payload = await sampleContextPayload();

    current = null;
    try {
        assert.equal((await fetch(`${origin}/context`)).status, 401);
        assert.equal((await fetch(`${origin}/context`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(payload) })).status, 403);
    } finally {
        current = context.session;
    }

    assert.equal((await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders({ Authorization: 'Bearer mfa_should_never_be_accepted' }),
        body: JSON.stringify(payload),
    })).status, 403);

    assert.equal((await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders({ 'x-mediflow-archive-generation': 'stale-generation' }),
        body: JSON.stringify(payload),
    })).status, 403);

    const disconnectedRes = await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify(payload),
    });
    assert.equal(disconnectedRes.status, 403);
    assert.equal((await disconnectedRes.json()).code, 'LOCAL_KIT_INACTIVE');
    assert.equal(fs.existsSync(path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME)), false);
});

test('exports audited patient context when kit is active, rolls back file on audit failure, hides cfHash on GET, and clears on DELETE', async () => {
    await connectKit();
    const payload = await sampleContextPayload();

    failAuditOnce = true;
    const failedAuditRes = await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify(payload),
    });
    assert.equal(failedAuditRes.status, 503);
    assert.equal(fs.existsSync(path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME, `${payload.patient.cfHash}.json`)), false);

    const exportRes = await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify(payload),
    });
    assert.equal(exportRes.status, 201);
    const exportedText = await exportRes.text();
    assert.equal(exportedText.includes(payload.patient.cfHash), false);
    const exported = JSON.parse(exportedText);
    assert.equal(exported.status, 'exported');
    assert.equal(exported.taxCodeLast4, '501U');

    const contextFile = path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME, `${payload.patient.cfHash}.json`);
    assert.equal(fs.existsSync(contextFile), true);
    const onDisk = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    assert.equal(onDisk.schema, 'mediflow.agent_patient_context.v1');
    assert.equal(onDisk.patient.cfHash, payload.patient.cfHash);
    assert.equal(onDisk.diagnoses[0].code, 'BA00');

    const listRes = await fetch(`${origin}/context`);
    assert.equal(listRes.status, 200);
    const listText = await listRes.text();
    assert.equal(listText.includes(payload.patient.cfHash), false);
    assert.equal(listText.includes('Ipertensione'), false);
    const listed = JSON.parse(listText);
    assert.equal(listed.count, 1);
    assert.equal(listed.items[0].taxCodeLast4, '501U');

    const deleteRes = await fetch(`${origin}/context`, { method: 'DELETE', headers: mutationHeaders() });
    assert.equal(deleteRes.status, 200);
    assert.equal((await deleteRes.json()).removed, 1);
    assert.equal(fs.existsSync(contextFile), false);

    const audits = database.prepare('SELECT event_type, subject_ref FROM audit_events WHERE actor_ref=? ORDER BY rowid').all(actor) as Array<{ event_type: string; subject_ref: string }>;
    assert.ok(audits.some(row => row.event_type === 'agent.context.exported' && row.subject_ref === payload.patient.cfHash));
    assert.ok(audits.some(row => row.event_type === 'agent.context.cleared' && row.subject_ref === 'all'));
});
