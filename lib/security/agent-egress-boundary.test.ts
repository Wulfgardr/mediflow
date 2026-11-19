import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAgentMandateStore } from '../agent-mandate-store';
import { createAgentPairingStore } from '../agent-pairing-store';
import { createAgentRegistrationStore } from '../agent-registration-store';
import { createAgentCassetteStore } from '../agent-cassette-store';
import { readSqliteArchiveGeneration } from '../archive-generation';
import { AGENT_OPERATIONS, type AgentMandateInput } from '../agent-mandate-contract';
import { agentBase64, type AgentItemKind } from '../agent-cassette-crypto';
import { AGENT_ITEM_OPERATION } from '../agent-cassette-contract';
import { sealAgentItemNode } from '../../packages/agent-client/src/cassette-crypto';
import { installLoopbackIngress } from './loopback-ingress.mjs';
import { agentChannelFailure, withAuthenticatedAgentTransaction } from './agent-channel';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-egress-'));
process.env.MEDIFLOW_DATA_DIR = directory; process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { openDbServer } = await import('../db-server.ts'); const database = openDbServer();
const { POST: visits } = await import('../../app/api/agent/v1/visits/route.ts');
const { POST: confirm, GET: confirmation } = await import('../../app/api/agent/v1/confirmation/route.ts');
const { GET: context } = await import('../../app/api/agent/v1/context/route.ts');
const actor = 'synthetic-egress-doctor', sentinel = 'SYNTHETIC_EGRESS_6742_CLINICAL_TEXT';
database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
    .run(actor, actor, 'admin', 'synthetic-hash', 'synthetic-wrapping', 'synthetic-salt');
const generation = readSqliteArchiveGeneration(database);
const mandates = createAgentMandateStore(database), pairings = createAgentPairingStore(database), store = createAgentCassetteStore(database);
const wrappedPrivateKey = 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64);
const tables = ['agent_cassettes', 'agent_mandates', 'agent_clients', 'audit_events', 'settings'];
const snapshot = () => tables.map(table => database.prepare(`SELECT * FROM ${table}`).all());
installLoopbackIngress();

async function agent(provider: AgentMandateInput['provider'], allowsClinicalEgress: boolean) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations: [...AGENT_OPERATIONS], provider, allowsClinicalEgress,
        publicKey, wrappedPrivateKey }, actor, generation);
    const pairing = pairings.request('Synthetic egress agent', [...AGENT_OPERATIONS]);
    pairings.approve(pairing.request.id, pairing.request.code, mandate.id, actor, generation);
    const token = pairings.poll(pairing.request.id, pairing.claim).credential!.token;
    const principal = database.transaction(() => pairings.principal(token)!).immediate();
    const seal = (visitId: string, itemId: string, kind: AgentItemKind, value: unknown) =>
        sealAgentItemNode(publicKey, { mandateRef: mandate.id, visitId, itemId, kind }, new TextEncoder().encode(JSON.stringify(value)));
    const anchor = (visitId: string) => seal(visitId, visitId, 'anchor', { fiscalCode: 'RSSMRA80A01H501U' });
    const item = <K extends Exclude<AgentItemKind, 'anchor'>>(visitId: string, kind: K) => {
        const id = randomUUID(), bytes = new TextEncoder().encode(JSON.stringify({ text: sentinel }));
        return { id, kind, envelope: seal(visitId, id, kind, { text: sentinel }), byteLength: bytes.length, documentHash: kind === 'pdf' ? 'a'.repeat(64) : null };
    };
    const note = (visitId: string) => item(visitId, 'note');
    const deposited = (close: boolean) => {
        const visitId = randomUUID();
        let receipt = database.transaction(() => store.open(principal, visitId, anchor(visitId))).immediate();
        receipt = database.transaction(() => store.add(principal, visitId, receipt.revision, note(visitId))).immediate();
        if (close) receipt = database.transaction(() => store.close(principal, visitId, receipt.revision)).immediate();
        return { visitId, revision: receipt.revision };
    };
    return { mandate, token, principal, anchor, item, note, deposited, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
}

const server = createServer(async (incoming, outgoing) => {
    try {
        const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), { method: incoming.method,
            headers: incoming.headers as Record<string, string>, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const { pathname } = new URL(request.url);
        let response: Response;
        if (pathname === '/api/agent/v1/visits') response = await visits(request);
        else if (pathname === '/api/agent/v1/confirmation') response = await (incoming.method === 'POST' ? confirm(request) : confirmation(request));
        else if (pathname === '/api/agent/v1/context') response = await context(request);
        else {
            try { response = withAuthenticatedAgentTransaction(database, request, 'visita.proponi.osservazione', () => {
                database.prepare("INSERT INTO settings(key,value) VALUES ('synthetic-egress-route-write','ciphertext')").run(); return Response.json({ status: 'accepted' });
            }); } catch (error) { response = agentChannelFailure(error); }
        }
        outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object'); const origin = `http://127.0.0.1:${address.port}`;
test.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); database.close(); rmSync(directory, { recursive: true, force: true }); });

const post = (path: string, headers: Record<string, string>, body: unknown) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) });

for (const provider of ['openai', 'anthropic'] as const) {
    test(`J1: the ${provider} mandate without clinical egress is refused on every clinical route and leaves the archive unchanged`, async () => {
        const denied = await agent(provider, false);
        const prior = denied.deposited(false), closed = denied.deposited(true);
        const before = snapshot();
        const visitId = randomUUID();
        const attempts: [string, () => Promise<Response>][] = [
            ['visita.apri', () => post('/api/agent/v1/visits', denied.headers, { operation: 'visita.apri', visitId, anchor: denied.anchor(visitId) })],
            ['visita.nota', () => post('/api/agent/v1/visits', denied.headers, { operation: 'visita.nota', visitId: prior.visitId,
                expectedRevision: prior.revision, item: denied.note(prior.visitId) })],
            ...(['transcription', 'pdf', 'therapy', 'service', 'diagnosis', 'exemption', 'observation'] as const).map(kind => [kind, () =>
                post('/api/agent/v1/visits', denied.headers, { operation: AGENT_ITEM_OPERATION[kind], visitId: prior.visitId, expectedRevision: prior.revision,
                    item: denied.item(prior.visitId, kind) })] as [string, () => Promise<Response>]),
            ['visita.chiudi', () => post('/api/agent/v1/visits', denied.headers, { operation: 'visita.chiudi', visitId: prior.visitId, expectedRevision: prior.revision })],
            ['POST confirmation', () => post('/api/agent/v1/confirmation', denied.headers, { visitId: closed.visitId })],
            ['GET confirmation', () => fetch(origin + '/api/agent/v1/confirmation?reference=' + randomUUID(), { headers: denied.headers })],
        ];
        for (const [label, attempt] of attempts) {
            const response = await attempt();
            assert.equal(response.status, 403, label);
            assert.deepEqual(await response.json(), { code: 'AGENT_CHANNEL_DENIED' }, label);
            assert.deepEqual(snapshot(), before, label);
        }
    });
}

test('J2: a route that is not yet written inherits the refusal from the channel', async () => {
    const denied = await agent('openai', false), allowed = await agent('openai', true);
    const before = snapshot();
    assert.equal((await fetch(origin + '/synthetic-future-route', { method: 'POST', headers: denied.headers })).status, 403);
    assert.deepEqual(snapshot(), before);
    assert.equal((await fetch(origin + '/synthetic-future-route', { method: 'POST', headers: allowed.headers })).status, 200);
    database.prepare("DELETE FROM settings WHERE key='synthetic-egress-route-write'").run();
});

test('J3: the mandate context stays readable without clinical content while clinical operations are refused', async () => {
    const denied = await agent('anthropic', false), prior = denied.deposited(true);
    const response = await fetch(origin + '/api/agent/v1/context', { headers: denied.headers });
    assert.equal(response.status, 200);
    const text = await response.text(), body = JSON.parse(text);
    assert.deepEqual(Object.keys(body).sort(), ['agentRef', 'allowsClinicalEgress', 'expiresAt', 'mandateRef', 'modelProvider', 'operations', 'publicKey']);
    assert.equal(body.modelProvider, 'anthropic');
    assert.equal(body.allowsClinicalEgress, false);
    for (const forbidden of [sentinel, prior.visitId, 'RSSMRA80A01H501U', wrappedPrivateKey, denied.token, actor]) assert.equal(text.includes(forbidden), false);
    const visitId = randomUUID();
    assert.equal((await post('/api/agent/v1/visits', denied.headers, { operation: 'visita.apri', visitId, anchor: denied.anchor(visitId) })).status, 403);
});

test('J3: a renewable registration with a cloud mandate without egress still retrieves its non-clinical credential receipt', async () => {
    const template = mandates.create({ id: randomUUID(), durationMs: 3600000, operations: ['visita.apri', 'visita.nota'], provider: 'openai', allowsClinicalEgress: false,
        publicKey: 'B' + 'A'.repeat(86) + '=', wrappedPrivateKey }, actor, generation);
    const registrations = createAgentRegistrationStore(database);
    const pairing = pairings.request('Synthetic renewable egress agent', ['visita.apri', 'visita.nota']);
    pairings.approve(pairing.request.id, pairing.request.code, template.id, actor, generation, true);
    const polled = pairings.poll(pairing.request.id, pairing.claim);
    assert.ok('registrationCredential' in polled && polled.registrationCredential);
    registrations.renew(actor, generation, 'synthetic-unlock');
    const unlocked = (ref: string, owner: string) => ref === 'synthetic-unlock' && owner === actor;
    const retrieved = registrations.retrieve(polled.registrationCredential.token, unlocked);
    assert.deepEqual(Object.keys(retrieved).sort(), ['agentRef', 'expiresAt', 'issuedAt', 'mandateRef', 'token']);
    const principal = database.transaction(() => registrations.principal(retrieved.token, unlocked)).immediate();
    assert.equal(principal?.modelProvider, 'openai');
    assert.equal(principal?.allowsClinicalEgress, false);
});

for (const [provider, allowsClinicalEgress] of [['local', false], ['openai', true], ['anthropic', true]] as const) {
    test(`J4: the ${provider} mandate with egress ${allowsClinicalEgress} still opens, deposits and closes a visit through the real route`, async () => {
        const allowed = await agent(provider, allowsClinicalEgress), visitId = randomUUID();
        const opened = await post('/api/agent/v1/visits', allowed.headers, { operation: 'visita.apri', visitId, anchor: allowed.anchor(visitId) });
        assert.equal(opened.status, 201);
        const note = await post('/api/agent/v1/visits', allowed.headers, { operation: 'visita.nota', visitId,
            expectedRevision: (await opened.json()).receipt.revision, item: allowed.note(visitId) });
        assert.equal(note.status, 201);
        const closed = await post('/api/agent/v1/visits', allowed.headers, { operation: 'visita.chiudi', visitId, expectedRevision: (await note.json()).receipt.revision });
        assert.equal(closed.status, 201);
        const receipt = (await closed.json()).receipt;
        assert.equal(receipt.modelProvider, provider);
        assert.equal(receipt.allowsClinicalEgress, allowsClinicalEgress);
        const started = await post('/api/agent/v1/confirmation', allowed.headers, { visitId });
        assert.equal(started.status, 200);
    });
}
