import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_OPERATIONS } from './agent-mandate-contract';
import { agentBase64 } from './agent-cassette-crypto';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { encryptData, generateMasterKey } from './security/security';
import { sealPatientDocumentFile } from './security/attachment-file-envelope';
import type { AgentApplicationInput, AgentItemDecisionInput } from './agent-visit-application-contract';

type KeepInput = Extract<AgentItemDecisionInput, { decision: 'keep' | 'correct' }>;
type DiscardInput = Extract<AgentItemDecisionInput, { decision: 'discard' }>;

const directory = mkdtempSync(join(tmpdir(), 'mediflow-agent-item-decision-'));
process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('./db-server.ts');
openDbServer();
const fixture = await import('./test-fixtures/clinical-writer-composition.ts');
fixture.seedComposition();
const { patients } = await import('./schema.ts');
const otherPatientId = 'synthetic-other-patient';
dbServer.insert(patients).values({ id: otherPatientId, firstName: 'Altra', lastName: 'Sintetica', taxCode: 'SYNTHETICOTHER' }).run();
const { createAgentMandateStore } = await import('./agent-mandate-store.ts');
const { createAgentPairingStore } = await import('./agent-pairing-store.ts');
const { createAgentCassetteStore, readAgentCassetteIndex } = await import('./agent-cassette-store.ts');
const { applyAgentVisit, decideAgentVisitItem, agentAppliedItemIds, agentDiscardedItemIds, agentCorrectedItemIds } = await import('./agent-visit-application.ts');
const { archiveGenerationForSession } = await import('./security/archive-session-generation.ts');
const database = dbServer.$client;
const key = await generateMasterKey();
const field = async (value: unknown) => { const sealed = await encryptData(value, key); return `ENC:${sealed.iv}:${sealed.data}`; };
const request = new Request('http://127.0.0.1/api/agent-mandates/incoming/items', { method: 'POST' });
const clinical = ['entries', 'attachments', 'therapies', 'service_prescriptions', 'service_prescription_items', 'observations', 'patients', 'patients_to_ambulatories'];
const clinicalSnapshot = () => clinical.map(table => database.prepare(`SELECT * FROM ${table}`).all());
const fullSnapshot = () => [...clinicalSnapshot(), database.prepare('SELECT * FROM audit_events').all()];
const version = (id = fixture.patientId) => (database.prepare('SELECT version FROM patients WHERE id=?').get(id) as { version: number }).version;
const queued = (id: string) => readAgentCassetteIndex(database, fixture.session.userId, null).visits.some(row => row.id === id);
const flagsOf = (eventType: string, subjectRef: string) => (database.prepare('SELECT redacted_metadata FROM audit_events WHERE event_type=? AND subject_ref=?')
    .all(eventType, subjectRef) as Array<{ redacted_metadata: string }>).map(row => JSON.parse(row.redacted_metadata).flags as string[]);
test.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });

async function visit() {
    const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const mandates = createAgentMandateStore(database), pairings = createAgentPairingStore(database), store = createAgentCassetteStore(database);
    const generation = archiveGenerationForSession(fixture.session)!;
    const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations: [...AGENT_OPERATIONS], provider: 'local', allowsClinicalEgress: false,
        publicKey, wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) }, fixture.session.userId, generation);
    const pairing = pairings.request('Synthetic decision agent', [...AGENT_OPERATIONS]);
    pairings.approve(pairing.request.id, pairing.request.code, mandate.id, fixture.session.userId, generation);
    const token = pairings.poll(pairing.request.id, pairing.claim).credential!.token;
    const principal = database.transaction(() => pairings.principal(token)!).immediate();
    const id = randomUUID();
    const seal = (itemId: string, kind: Parameters<typeof sealAgentItemNode>[1]['kind']) => sealAgentItemNode(publicKey,
        { mandateRef: mandate.id, visitId: id, itemId, kind }, new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_DECISION' })));
    let receipt = database.transaction(() => store.open(principal, id, seal(id, 'anchor'))).immediate();
    const file = await sealPatientDocumentFile(new TextEncoder().encode('%PDF-1.4\nSYNTHETIC_DECISION\n%%EOF'), key);
    file.fileKey.fill(0);
    const note = { title: await field('Nota sintetica'), content: await field('SYNTHETIC_DECISION'), metadata: await field({ synthetic: true }), date: '2026-11-17' };
    const source = await field({ visitId: id, source: { fileName: 'referto-sintetico.pdf' }, quote: 'colecalciferolo 25.000 UI una fiala ogni 15 giorni' });
    const items: AgentApplicationInput['items'] = [
        { id: randomUUID(), kind: 'note', values: note },
        { id: randomUUID(), kind: 'pdf', values: { name: await field('referto-sintetico.pdf'), data: file.data, size: 45 } },
        { id: randomUUID(), kind: 'therapy', values: { drugName: 'Colecalciferolo', dosage: '25.000 UI ogni 15 giorni', startDate: '2026-11-17', status: 'active', motivation: source } },
        { id: randomUUID(), kind: 'observation', values: { codeSystem: 'LOINC', code: '2160-0', display: 'Creatinina', unitSystem: 'UCUM', unitCode: 'mg/dL', value: '1.1', observedAt: '2026-11-17', notes: source } },
    ];
    for (const item of items) receipt = database.transaction(() => store.add(principal, id, receipt.revision, {
        id: item.id, kind: item.kind, envelope: seal(item.id, item.kind), byteLength: new TextEncoder().encode(JSON.stringify({ text: 'SYNTHETIC_DECISION' })).length,
        documentHash: item.kind === 'pdf' ? 'a'.repeat(64) : null,
    })).immediate();
    receipt = database.transaction(() => store.close(principal, id, receipt.revision)).immediate();
    const revision = receipt.revision;
    const byKind = (kind: string) => items.find(item => item.kind === kind)!;
    return {
        id, mandate, mandates, items, byKind,
        keep(kind: string, patientId = fixture.patientId, decision: 'keep' | 'correct' = 'keep', values?: Record<string, unknown>): KeepInput {
            const item = byKind(kind);
            return { visitId: id, cassetteRevision: revision, decision, patientId, expectedVersion: version(patientId),
                item: { ...item, values: { ...item.values, ...values } } as AgentApplicationInput['items'][number] };
        },
        discard(kind: string): DiscardInput {
            const item = byKind(kind);
            return { visitId: id, cassetteRevision: revision, decision: 'discard', itemId: item.id, kind: item.kind };
        },
        rest(...decided: string[]): AgentApplicationInput {
            return { visitId: id, phase: 'review', patientId: fixture.patientId, expectedVersion: version(), cassetteRevision: revision,
                items: items.filter(item => !decided.includes(item.kind)) };
        },
    };
}

test('Tieni writes only that proposal into the chart, with its source and an audited decision; the visit stays in the queue', async () => {
    const f = await visit(), before = clinicalSnapshot(), versionBefore = version();
    const receipt = decideAgentVisitItem(request, fixture.session, f.keep('therapy'));
    assert.equal(receipt.visitState, 'partial');
    assert.equal(receipt.patientVersion, versionBefore + 1);
    const therapy = f.byKind('therapy');
    const rows = database.prepare('SELECT id, patient_id, drug_name, dosage, motivation FROM therapies WHERE id=?').all(therapy.id) as Array<Record<string, string>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.patient_id, fixture.patientId);
    assert.equal(rows[0]!.dosage, '25.000 UI ogni 15 giorni');
    assert.equal(rows[0]!.motivation, (therapy.values as { motivation: string }).motivation);
    const after = clinicalSnapshot();
    assert.deepEqual(after.map((rows, index) => rows.length - before[index]!.length), [0, 0, 1, 0, 0, 0, 0, 0]);
    assert.deepEqual(agentAppliedItemIds(f.id), [therapy.id]);
    const audit = database.prepare('SELECT actor_ref, proposer_ref, mandate_ref, occurred_at FROM audit_events WHERE event_id=?').get(receipt.eventId) as Record<string, unknown>;
    assert.equal(audit.actor_ref, fixture.session.userId);
    assert.equal(audit.mandate_ref, f.mandate.id);
    assert.ok(Number(audit.occurred_at) > 0);
    assert.deepEqual(flagsOf('agent.item.applied', therapy.id), [['item', 'kept']]);
    assert.ok(database.prepare("SELECT 1 FROM audit_events WHERE event_type='therapy.created' AND subject_ref=? AND request_id=?").get(therapy.id, f.id));
    assert.ok(queued(f.id));
});

test('Scarta writes no clinical data and records who discarded the proposal and when', async () => {
    const f = await visit(), before = clinicalSnapshot();
    const receipt = decideAgentVisitItem(request, fixture.session, f.discard('therapy'));
    assert.equal(receipt.patientVersion, null);
    assert.deepEqual(clinicalSnapshot(), before);
    assert.deepEqual(agentDiscardedItemIds(f.id), [f.byKind('therapy').id]);
    assert.deepEqual(agentAppliedItemIds(f.id), []);
    const audit = database.prepare('SELECT event_type, actor_ref, occurred_at, request_id FROM audit_events WHERE event_id=?').get(receipt.eventId) as Record<string, unknown>;
    assert.equal(audit.event_type, 'agent.item.discarded');
    assert.equal(audit.actor_ref, fixture.session.userId);
    assert.equal(audit.request_id, f.id);
    assert.ok(Number(audit.occurred_at) > 0);
    assert.ok(queued(f.id));
});

test('Correggi writes the physician value, not the deposited one, and marks the decision as corrected', async () => {
    const f = await visit();
    decideAgentVisitItem(request, fixture.session, f.keep('therapy', fixture.patientId, 'correct', { dosage: '25.000 UI ogni 30 giorni' }));
    const therapy = f.byKind('therapy');
    assert.deepEqual(database.prepare('SELECT dosage FROM therapies WHERE id=?').all(therapy.id), [{ dosage: '25.000 UI ogni 30 giorni' }]);
    assert.deepEqual(flagsOf('agent.item.applied', therapy.id), [['item', 'corrected']]);
    assert.deepEqual(agentCorrectedItemIds(f.id), [therapy.id]);
    decideAgentVisitItem(request, fixture.session, f.keep('observation', fixture.patientId, 'correct', { value: '1.3' }));
    assert.deepEqual(database.prepare('SELECT value FROM observations WHERE id=?').all(f.byKind('observation').id), [{ value: '1.3' }]);
});

test('a repeated request writes once: the same body returns the same receipt, any other decision on a decided item changes nothing', async () => {
    const f = await visit();
    const keep = f.keep('therapy'), first = decideAgentVisitItem(request, fixture.session, keep), afterFirst = fullSnapshot();
    const again = decideAgentVisitItem(request, fixture.session, keep);
    assert.equal(again.eventId, first.eventId);
    assert.equal(again.patientVersion, first.patientVersion);
    assert.deepEqual(fullSnapshot(), afterFirst);
    for (const refused of [f.discard('therapy'), { ...f.keep('therapy'), decision: 'correct' as const }, { ...keep, expectedVersion: version() }]) {
        assert.throws(() => decideAgentVisitItem(request, fixture.session, refused), /AGENT_APPLICATION_DENIED/);
    }
    const discard = f.discard('observation');
    const discarded = decideAgentVisitItem(request, fixture.session, discard), afterDiscard = fullSnapshot();
    assert.equal(decideAgentVisitItem(request, fixture.session, discard).eventId, discarded.eventId);
    assert.throws(() => decideAgentVisitItem(request, fixture.session, f.keep('observation')), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(fullSnapshot(), afterDiscard);
    assert.deepEqual(database.prepare('SELECT count(*) AS n FROM therapies WHERE id=?').get(f.byKind('therapy').id), { n: 1 });
});

test('a denied, expired or stale request writes nothing', async () => {
    const f = await visit(), before = fullSnapshot();
    const otherGeneration = { ...fixture.session, id: 'synthetic-unbound-session' };
    const refused: Array<[AgentItemDecisionInput, typeof fixture.session]> = [
        [{ ...f.keep('therapy'), expectedVersion: version() - 1 }, fixture.session],
        [{ ...f.keep('therapy'), cassetteRevision: 1 }, fixture.session],
        [{ ...f.discard('therapy'), cassetteRevision: 1 }, fixture.session],
        [{ ...f.discard('therapy'), kind: 'note' as const }, fixture.session],
        [{ ...f.discard('therapy'), itemId: randomUUID() }, fixture.session],
        [{ ...f.keep('therapy'), patientId: 'missing-synthetic-patient' }, fixture.session],
        [f.keep('therapy'), otherGeneration],
        [f.discard('therapy'), otherGeneration],
    ];
    for (const [input, session] of refused) assert.throws(() => decideAgentVisitItem(request, session, input));
    assert.deepEqual(fullSnapshot(), before);
    f.mandates.revoke(f.mandate.id, fixture.session.userId, f.mandate.archiveGeneration);
    const revoked = fullSnapshot();
    assert.throws(() => decideAgentVisitItem(request, fixture.session, f.keep('therapy')));
    assert.throws(() => decideAgentVisitItem(request, fixture.session, f.discard('therapy')));
    assert.deepEqual(fullSnapshot(), revoked);
    assert.deepEqual(agentAppliedItemIds(f.id), []);
    assert.deepEqual(agentDiscardedItemIds(f.id), []);
});

test('the proposals of one visit never reach a second chart', async () => {
    const f = await visit();
    decideAgentVisitItem(request, fixture.session, f.keep('therapy'));
    const before = fullSnapshot();
    assert.throws(() => decideAgentVisitItem(request, fixture.session, f.keep('observation', otherPatientId)), /AGENT_APPLICATION_DENIED/);
    assert.throws(() => applyAgentVisit(request, fixture.session, { ...f.rest('therapy'), patientId: otherPatientId, expectedVersion: version(otherPatientId) }), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(fullSnapshot(), before);
    assert.deepEqual(database.prepare('SELECT count(*) AS n FROM observations WHERE patient_id=?').get(otherPatientId), { n: 0 });
});

test('a visit decided in part is never reported as applied in full', async () => {
    const f = await visit();
    decideAgentVisitItem(request, fixture.session, f.discard('therapy'));
    for (const kind of ['note', 'pdf']) assert.equal(decideAgentVisitItem(request, fixture.session, f.keep(kind)).visitState, 'partial');
    const last = decideAgentVisitItem(request, fixture.session, f.keep('observation'));
    assert.equal(last.visitState, 'decided');
    assert.deepEqual(flagsOf('agent.visit.decided', f.id), [['item', 'discarded']]);
    assert.deepEqual(flagsOf('agent.visit.applied', f.id), []);
    assert.ok(!queued(f.id));
    assert.ok(!(database.prepare("SELECT redacted_metadata FROM audit_events WHERE subject_ref=? AND redacted_metadata LIKE '%cassette_complete%'").get(f.id)));
});

test('after a discard «Applica la visita» writes only the rest, refuses the discarded proposal and closes the visit as decided', async () => {
    const f = await visit();
    decideAgentVisitItem(request, fixture.session, f.discard('therapy'));
    const before = fullSnapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, f.rest()), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(fullSnapshot(), before);
    const receipt = applyAgentVisit(request, fixture.session, f.rest('therapy'));
    assert.equal(receipt.itemCount, 3);
    assert.deepEqual(database.prepare('SELECT count(*) AS n FROM therapies WHERE id=?').get(f.byKind('therapy').id), { n: 0 });
    assert.deepEqual(flagsOf('agent.visit.applied', f.id), [['review']]);
    assert.deepEqual(flagsOf('agent.visit.decided', f.id), [['item', 'discarded']]);
    assert.ok(!queued(f.id));
});

test('a visit kept one proposal at a time is applied in full and leaves the queue', async () => {
    const f = await visit();
    const states = ['note', 'pdf', 'therapy', 'observation'].map(kind => decideAgentVisitItem(request, fixture.session, f.keep(kind)).visitState);
    assert.deepEqual(states, ['partial', 'partial', 'partial', 'applied']);
    assert.deepEqual(flagsOf('agent.visit.applied', f.id), [['item', 'cassette_complete']]);
    assert.ok(!queued(f.id));
    assert.throws(() => applyAgentVisit(request, fixture.session, f.rest()), /AGENT_APPLICATION_DENIED/);
});

test('after a proposal is kept, the whole visit applies only the remaining proposals', async () => {
    const f = await visit();
    decideAgentVisitItem(request, fixture.session, f.keep('therapy'));
    const before = fullSnapshot();
    assert.throws(() => applyAgentVisit(request, fixture.session, f.rest()), /AGENT_APPLICATION_DENIED/);
    assert.deepEqual(fullSnapshot(), before);
    applyAgentVisit(request, fixture.session, f.rest('therapy'));
    assert.deepEqual(database.prepare('SELECT count(*) AS n FROM therapies WHERE id=?').get(f.byKind('therapy').id), { n: 1 });
    assert.deepEqual(flagsOf('agent.visit.applied', f.id), [['review', 'cassette_complete']]);
    assert.ok(!queued(f.id));
});
