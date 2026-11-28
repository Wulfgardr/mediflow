import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_OPERATIONS } from '../agent-mandate-contract';
import { agentBase64 } from '../agent-cassette-crypto';
import { sealAgentItemNode } from '../../packages/agent-client/src/cassette-crypto';
import { encryptData, generateMasterKey } from './security';
import type { AgentApplicationInput } from '../agent-visit-application-contract';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-local-kit-pending-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('../db-server.ts');
openDbServer();
const fixture = await import('../test-fixtures/clinical-writer-composition.ts');
fixture.seedComposition();
const { createAgentLocalKitStore } = await import('../agent-local-kit-store.ts');
const { createAgentPairingStore } = await import('../agent-pairing-store.ts');
const { createAgentCassetteStore } = await import('../agent-cassette-store.ts');
const { applyAgentVisit } = await import('../agent-visit-application.ts');
const { archiveGenerationForSession } = await import('./archive-session-generation.ts');
const database = dbServer.$client;
database.prepare("UPDATE users SET role='admin' WHERE id=?").run(fixture.session.userId);
const generation = archiveGenerationForSession(fixture.session)!;
const key = await generateMasterKey();
const field = async (value: unknown) => { const sealed = await encryptData(value, key); return `ENC:${sealed.iv}:${sealed.data}`; };
const request = new Request('http://127.0.0.1/api/agent-mandates/incoming', { method: 'POST' });
const version = () => (database.prepare('SELECT version FROM patients WHERE id=?').get(fixture.patientId) as { version: number }).version;
test.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

async function connectLocalKit() {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const connection = createAgentLocalKitStore(database).connect({ id: randomUUID(), durationMs: 86400000, operations: [...AGENT_OPERATIONS],
        provider: 'openai', allowsClinicalEgress: true, publicKey, wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) },
    fixture.session.userId, generation);
    return { connection, publicKey };
}

async function depositClosedNote(bearerToken: string, publicKey: string): Promise<AgentApplicationInput> {
    const pairings = createAgentPairingStore(database), store = createAgentCassetteStore(database);
    const principal = database.transaction(() => pairings.principal(bearerToken)!).immediate();
    const id = randomUUID(), noteId = randomUUID();
    const bytes = new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_PENDING' }));
    const seal = (itemId: string, kind: 'anchor' | 'note') => sealAgentItemNode(publicKey, { mandateRef: principal.mandateRef, visitId: id, itemId, kind }, bytes);
    let receipt = database.transaction(() => store.open(principal, id, seal(id, 'anchor'))).immediate();
    receipt = database.transaction(() => store.add(principal, id, receipt.revision,
        { id: noteId, kind: 'note', envelope: seal(noteId, 'note'), byteLength: bytes.length, documentHash: null })).immediate();
    receipt = database.transaction(() => store.close(principal, id, receipt.revision)).immediate();
    const values = { title: await field('Nota sintetica'), content: await field('SYNTHETIC_PENDING'), metadata: await field({ synthetic: true }), date: '2026-11-27' };
    return { visitId: id, phase: 'review', patientId: fixture.patientId, expectedVersion: version(), cassetteRevision: receipt.revision,
        items: [{ id: noteId, kind: 'note', values }] };
}

test('a visit deposited by the connected kit stays applicable after the first context export creates the reference secret', async () => {
    const { connection, publicKey } = await connectLocalKit();
    const pending = await depositClosedNote(connection.bearerToken, publicKey);
    const kit = createAgentLocalKitStore(database);
    database.prepare('DELETE FROM settings WHERE key=?').run('agent.localKitPatientReferenceKey');
    const installed: string[] = [];
    kit.patientReference('RSSMRA80A01H501U', fixture.session.userId, generation, secret => { installed.push(secret); });
    assert.equal(installed.length, 1);
    assert.equal(kit.status(fixture.session.userId).agentRef, connection.agentRef);
    const receipt = applyAgentVisit(request, fixture.session, { ...pending, expectedVersion: version() });
    assert.equal(receipt.status, 'applied');
});

test('reconnecting the kit revokes the agent, so visits it deposited before can no longer be applied', async () => {
    const { connection, publicKey } = await connectLocalKit();
    const pending = await depositClosedNote(connection.bearerToken, publicKey);
    const kit = createAgentLocalKitStore(database);
    kit.disconnect(fixture.session.userId, generation);
    await connectLocalKit();
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...pending, expectedVersion: version() }), /AGENT_APPLICATION_DENIED/);
});
