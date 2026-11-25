import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { agentCassetteFixture } from './test-fixtures/agent-cassette';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { db, type Patient } from './db';
import { agentItemAwaitsDecision, agentVisitAwaitsReview, inspectAgentVisit, prepareAgentApplication, prepareAgentItemDecision } from './agent-visit-review';
import type { AgentItemKind } from './agent-cassette-crypto';

const cf = 'RSSMRA80A01F205X';
const quote = 'LOINC 2345-7. Glucosio 100 mg/dL intervallo 70 110';
const observation = { code: '2345-7', display: 'Glucosio', value: '100', unitCode: 'mg/dL', unit: 'mg/dL', observedAt: '2026-11-17', refLow: '70', refHigh: '110', refText: '70 110' };
const pdfText = (text: string) => async () => ({ text, beyondText: false });
const patient = (): Patient => ({ id: 'synthetic-' + cf, taxCode: cf, firstName: 'Persona', lastName: 'Sintetica',
    address: '', phone: '', updatedAt: new Date(), createdAt: new Date(), version: 1 });

async function fixture() {
    const f = await agentCassetteFixture(undefined, 'local', false);
    db.setKey(f.masterKey);
    const visitId = randomUUID();
    const seal = (id: string, kind: AgentItemKind, value: unknown) => {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        return { bytes, envelope: sealAgentItemNode(f.mandate.publicKey, { mandateRef: f.mandate.id, visitId, itemId: id, kind }, bytes) };
    };
    let receipt = f.run(() => f.store.open(f.principal, visitId, seal(visitId, 'anchor', { fiscalCode: cf }).envelope));
    const bytes = Buffer.from('%PDF-1.4\nSYNTHETIC_PDF_DECISION\n%%EOF');
    const pdfId = randomUUID(), pdf = seal(pdfId, 'pdf', { name: 'synthetic.pdf', base64: bytes.toString('base64') });
    const documentHash = createHash('sha256').update(bytes).digest('hex');
    receipt = f.run(() => f.store.add(f.principal, visitId, receipt.revision, { id: pdfId, kind: 'pdf', envelope: pdf.envelope, byteLength: pdf.bytes.length, documentHash }));
    const proposalId = randomUUID(), proposal = seal(proposalId, 'observation', { values: observation, quote, source: { sha256: documentHash, fileName: 'synthetic.pdf' } });
    receipt = f.run(() => f.store.add(f.principal, visitId, receipt.revision, { id: proposalId, kind: 'observation', envelope: proposal.envelope,
        byteLength: proposal.bytes.length, documentHash: null }));
    f.run(() => f.store.close(f.principal, visitId, receipt.revision));
    const row = (discardedItemIds: string[] = []) => ({ ...f.rows()[0], appliedItemIds: [], discardedItemIds });
    return { row, pdfId, proposalId, close() { db.setKey(null); f.database.close(); } };
}

test('one proposal of a visit is prepared alone, with the chart version the physician saw', async () => {
    const f = await fixture();
    const query = mock.method(db.observations, 'query', () => ({ toArray: async () => [] }));
    const get = mock.method(db.patients, 'get', async () => patient());
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row(), [patient()], null, signal, pdfText('Paziente CF ' + cf + '\n' + quote));
        assert.equal(agentItemAwaitsDecision(review, f.proposalId), true);
        const keep = await prepareAgentItemDecision(review, f.proposalId, 'keep', signal);
        assert.ok(keep && keep.decision === 'keep');
        assert.equal(keep.item.id, f.proposalId);
        assert.equal(keep.item.kind, 'observation');
        assert.equal(keep.expectedVersion, 1);
        const corrected = await prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { value: '110', display: 'Altro esame' });
        assert.ok(corrected && corrected.decision === 'correct' && corrected.item.kind === 'observation');
        assert.equal(corrected.item.values.value, '110');
        assert.equal(corrected.item.values.display, 'Glucosio');
        assert.deepEqual(await prepareAgentItemDecision(review, f.proposalId, 'discard', signal),
            { visitId: review.visit.cassette.id, cassetteRevision: review.visit.cassette.revision, decision: 'discard', itemId: f.proposalId, kind: 'observation' });
        assert.equal(await prepareAgentItemDecision(review, f.pdfId, 'correct', signal), null);
        assert.equal(await prepareAgentItemDecision({ ...review, appliedItemIds: [f.proposalId] }, f.proposalId, 'keep', signal), null);
        assert.equal(await prepareAgentItemDecision({ ...review, patient: null }, f.proposalId, 'keep', signal), null);
    } finally { get.mock.restore(); query.mock.restore(); f.close(); }
});

test('a proposal without a verified source cannot be kept as is, but can be corrected or discarded, and once discarded no longer blocks the visit', async () => {
    const f = await fixture();
    const query = mock.method(db.observations, 'query', () => ({ toArray: async () => [] }));
    const get = mock.method(db.patients, 'get', async () => patient());
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row(), [patient()], null, signal, pdfText('Paziente CF ' + cf));
        assert.ok(review.itemBlockers.get(f.proposalId)?.length);
        assert.equal(agentVisitAwaitsReview(review), false);
        assert.equal(await prepareAgentItemDecision(review, f.proposalId, 'keep', signal), null);
        assert.ok(await prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { value: '100' }));
        assert.ok(await prepareAgentItemDecision(review, f.proposalId, 'discard', signal));
        const afterDiscard = await inspectAgentVisit(f.row([f.proposalId]), [patient()], null, signal, pdfText('Paziente CF ' + cf));
        assert.deepEqual([...afterDiscard.blockers, ...afterDiscard.proposalBlockers], []);
        assert.equal(agentVisitAwaitsReview(afterDiscard), true);
        assert.deepEqual((await prepareAgentApplication(afterDiscard, signal))?.items.map(item => item.id), [f.pdfId]);
    } finally { get.mock.restore(); query.mock.restore(); f.close(); }
});
