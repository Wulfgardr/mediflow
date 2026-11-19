import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_OPERATIONS } from './agent-mandate-contract';
import { agentBase64, type AgentItemKind } from './agent-cassette-crypto';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { encryptData, generateMasterKey } from './security/security';
import { db, type Patient } from './db';
import { observeArchiveGeneration } from './security/client-auth-api';

const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-incoming-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const fixture = await import('./test-fixtures/clinical-writer-composition.ts');
fixture.seedComposition();
const { createAgentMandateStore } = await import('./agent-mandate-store.ts');
const { createAgentPairingStore } = await import('./agent-pairing-store.ts');
const { createAgentCassetteStore, readAgentCassette, readAgentCassetteIndex } = await import('./agent-cassette-store.ts');
const { applyAgentVisit, agentAppliedItemIds, AgentApplicationDenied } = await import('./agent-visit-application.ts');
const { archiveGenerationForSession } = await import('./security/archive-session-generation.ts');
const { refreshAgentIncoming, applyReviewedAgentVisits, agentIncomingSnapshot, subscribeAgentIncoming } = await import('./agent-incoming.ts');
const { agentVisitAwaitsReview } = await import('./agent-visit-review.ts');

const database = dbServer.$client, actor = fixture.session.userId, cf = 'RSSMRA80A01H501U';
const generation = archiveGenerationForSession(fixture.session)!;
const quote = 'LOINC 2345-7. Glucosio 100 mg/dL intervallo 70 110';
const masterKey = await generateMasterKey();
const tables = ['entries', 'attachments', 'observations', 'patients', 'audit_events'];
const clinicalTables = 3;
const snapshot = () => tables.map(table => database.prepare(`SELECT * FROM ${table}`).all());
const version = () => (database.prepare('SELECT version FROM patients WHERE id=?').get(fixture.patientId) as { version: number }).version;
const patient = (): Patient => ({ id: fixture.patientId, taxCode: cf, firstName: 'Paziente', lastName: 'Sintetico', address: '', phone: '',
    updatedAt: new Date(), createdAt: new Date(), version: version() });
const posts: Record<string, unknown>[] = [];
const published: string[] = [];
const inbox = '/api/agent-mandates/incoming';

db.setKey(masterKey);
observeArchiveGeneration(generation);
mock.method(db.patients, 'toArray', async () => [patient()]);
mock.method(db.patients, 'get', async () => patient());
mock.method(db.exemptions, 'toArray', async () => []);
mock.method(db.observations, 'query', () => ({ toArray: async () => [] }));
mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    if (url.pathname === '/api/auth/profile') return Response.json({ doctorTaxCode: null });
    if (url.pathname !== inbox) return Response.json({}, { status: 404 });
    if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        try { return Response.json(applyAgentVisit(new Request('http://127.0.0.1' + inbox, { method: 'POST' }), fixture.session, body)); }
        catch (error) { return Response.json({ status: 'not_applied' }, { status: error instanceof AgentApplicationDenied ? error.status : 409 }); }
    }
    const visit = url.searchParams.get('visit');
    if (visit) return Response.json({ ...readAgentCassette(database, visit, actor)!, appliedItemIds: agentAppliedItemIds(visit) });
    return Response.json(readAgentCassetteIndex(database, actor, url.searchParams.get('after')));
});
const unsubscribe = subscribeAgentIncoming(() => { published.push(JSON.stringify(agentIncomingSnapshot())); });
test.after(() => { unsubscribe(); db.setKey(null); mock.restoreAll(); database.close(); rmSync(directory, { recursive: true, force: true }); });

async function cloudCassette() {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    const wrapped = await encryptData(agentBase64(raw), masterKey); raw.fill(0);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const mandates = createAgentMandateStore(database), pairings = createAgentPairingStore(database), store = createAgentCassetteStore(database);
    const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations: [...AGENT_OPERATIONS], provider: 'openai', allowsClinicalEgress: false,
        publicKey, wrappedPrivateKey: `ENC:${wrapped.iv}:${wrapped.data}` }, actor, generation);
    const pairing = pairings.request('Synthetic incoming agent', [...AGENT_OPERATIONS]);
    pairings.approve(pairing.request.id, pairing.request.code, mandate.id, actor, generation);
    const principal = database.transaction(() => pairings.principal(pairings.poll(pairing.request.id, pairing.claim).credential!.token)!).immediate();
    const visitId = randomUUID();
    const run = <T>(action: () => T) => database.transaction(action).immediate();
    const seal = (id: string, kind: AgentItemKind, value: unknown) => {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        return { bytes, envelope: sealAgentItemNode(publicKey, { mandateRef: mandate.id, visitId, itemId: id, kind }, bytes) };
    };
    let receipt = run(() => store.open(principal, visitId, seal(visitId, 'anchor', { fiscalCode: cf }).envelope));
    const pdfs = ['originale', 'nota'].map(name => Buffer.from(`%PDF-1.4\nSYNTHETIC_INCOMING_${name}_${visitId}\n%%EOF`));
    const hashes = pdfs.map(bytes => createHash('sha256').update(bytes).digest('hex'));
    const values: [Exclude<AgentItemKind, 'anchor'>, unknown, string | null][] = [
        ['note', { text: 'Nota sintetica della visita' }, null],
        ['transcription', { text: 'Trascrizione sintetica della visita' }, null],
        ['pdf', { name: 'originale.pdf', base64: pdfs[0]!.toString('base64') }, hashes[0]!],
        ['pdf', { name: 'nota.pdf', base64: pdfs[1]!.toString('base64') }, hashes[1]!],
        ['observation', { values: { code: '2345-7', display: 'Glucosio', value: '100', unitCode: 'mg/dL', unit: 'mg/dL', observedAt: '2026-11-17',
            refLow: '70', refHigh: '110', refText: '70 110' }, quote, source: { sha256: hashes[0], fileName: 'originale.pdf' } }, null],
    ];
    const ids: string[] = [];
    for (const [kind, value, documentHash] of values) {
        const id = randomUUID(), sealed = seal(id, kind, value);
        ids.push(id);
        receipt = run(() => store.add(principal, visitId, receipt.revision, { id, kind, envelope: sealed.envelope, byteLength: sealed.bytes.length, documentHash }));
    }
    run(() => store.close(principal, visitId, receipt.revision));
    return { visitId, ids, pdfs, setEgress: (value: 0 | 1) => database.prepare('UPDATE agent_cassettes SET allows_clinical_egress=? WHERE id=?').run(value, visitId) };
}
const readPdf = async () => 'Paziente CF ' + cf + '\n' + quote;
const visitApplied = (visitId: string) => database.prepare("SELECT * FROM audit_events WHERE event_type='agent.visit.applied' AND subject_ref=? ORDER BY rowid")
    .all(visitId) as { event_id: string; redacted_metadata: string }[];
const added = (after: unknown[][], before: unknown[][]) => after.slice(0, clinicalTables).map((rows, index) => rows.length - before[index]!.length);
const itemEvents = (visitId: string) => (database.prepare("SELECT count(*) FROM audit_events WHERE event_type='agent.item.applied' AND request_id=?").pluck().get(visitId));

test('J5a: «Applica la visita» applies a cloud cassette without egress whole, PDFs included, without publishing their bytes', async () => {
    posts.length = 0;
    const f = await cloudCassette(), before = snapshot();
    await refreshAgentIncoming(db.getSessionReadSignal(), readPdf);
    assert.equal(posts.length, 0);
    const shown = agentIncomingSnapshot().visits.find(review => review.visit.cassette.id === f.visitId);
    assert.ok(shown);
    assert.deepEqual([...shown.blockers, ...shown.proposalBlockers], []);
    assert.equal(agentVisitAwaitsReview(shown), true);
    await applyReviewedAgentVisits([f.visitId]);
    assert.equal(agentIncomingSnapshot().error, null);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.phase, 'review');
    assert.deepEqual((posts[0]!.items as { kind: string }[]).map(item => item.kind).sort(), ['note', 'observation', 'pdf', 'pdf', 'transcription']);
    assert.deepEqual(agentAppliedItemIds(f.visitId).sort(), [...f.ids].sort());
    const after = snapshot();
    assert.deepEqual(added(after, before), [2, 2, 1]);
    assert.equal(itemEvents(f.visitId), 5);
    const pdfIds = (posts[0]!.items as { id: string; kind: string }[]).filter(item => item.kind === 'pdf').map(item => item.id);
    assert.deepEqual(pdfIds.map(id => database.prepare('SELECT size FROM attachments WHERE id=?').pluck().get(id)).sort(), f.pdfs.map(pdf => pdf.length).sort());
    const [event] = visitApplied(f.visitId);
    assert.deepEqual(JSON.parse(event!.redacted_metadata).flags, ['review', 'cassette_complete']);
    assert.ok(!agentIncomingSnapshot().visits.some(review => review.visit.cassette.id === f.visitId));
    for (const pdf of f.pdfs) assert.ok(published.every(value => !value.includes(pdf.toString('base64'))));
    assert.equal(applyAgentVisit(new Request('http://127.0.0.1' + inbox, { method: 'POST' }), fixture.session, posts[0]).eventId, event!.event_id);
    assert.deepEqual(snapshot(), after);
});

test('J5b: a cloud cassette whose automatic pass ran under the previous rule completes with only the pending proposal', async () => {
    posts.length = 0;
    const f = await cloudCassette(), before = snapshot();
    f.setEgress(1);
    await refreshAgentIncoming(db.getSessionReadSignal(), readPdf);
    assert.deepEqual(posts.map(body => body.phase), ['automatic']);
    f.setEgress(0);
    const legacy = snapshot();
    assert.deepEqual(added(legacy, before), [2, 2, 0]);
    assert.equal(itemEvents(f.visitId), 4);
    await refreshAgentIncoming(db.getSessionReadSignal(), readPdf);
    assert.equal(posts.length, 1);
    const shown = agentIncomingSnapshot().visits.find(review => review.visit.cassette.id === f.visitId);
    assert.ok(shown && agentVisitAwaitsReview(shown));
    await applyReviewedAgentVisits([f.visitId]);
    assert.equal(agentIncomingSnapshot().error, null);
    assert.deepEqual(posts.map(body => body.phase), ['automatic', 'review']);
    assert.deepEqual((posts[1]!.items as { kind: string }[]).map(item => item.kind), ['observation']);
    assert.deepEqual(agentAppliedItemIds(f.visitId).sort(), [...f.ids].sort());
    const after = snapshot();
    assert.deepEqual(added(after, legacy), [0, 0, 1]);
    assert.equal(itemEvents(f.visitId), 5);
    const events = visitApplied(f.visitId);
    assert.deepEqual(events.map(event => JSON.parse(event.redacted_metadata).flags), [['automatic'], ['review', 'cassette_complete']]);
    assert.equal(applyAgentVisit(new Request('http://127.0.0.1' + inbox, { method: 'POST' }), fixture.session, posts[1]).eventId, events[1]!.event_id);
    assert.deepEqual(snapshot(), after);
    assert.throws(() => applyAgentVisit(new Request('http://127.0.0.1' + inbox, { method: 'POST' }), fixture.session,
        { ...posts[1], items: [...(posts[0]!.items as unknown[]), ...(posts[1]!.items as unknown[])], expectedVersion: version() }), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(snapshot(), after);
});
