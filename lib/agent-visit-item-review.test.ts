import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { agentCassetteFixture } from './test-fixtures/agent-cassette';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { db, type Patient } from './db';
import { agentItemAwaitsDecision, agentVisitAwaitsReview, inspectAgentVisit, prepareAgentApplication, prepareAgentItemDecision } from './agent-visit-review';
import type { AgentItemKind } from './agent-cassette-crypto';
import { decryptData } from './security/security';

const cf = 'RSSMRA80A01F205X';
const quote = 'LOINC 2345-7. Glucosio 100 mg/dL intervallo 70 110';
const observation = { code: '2345-7', display: 'Glucosio', value: '100', unitCode: 'mg/dL', unit: 'mg/dL', observedAt: '2026-11-17', refLow: '70', refHigh: '110', refText: '70 110' };
const pdfText = (text: string) => async () => ({ text, beyondText: false });
const patient = (): Patient => ({ id: 'synthetic-' + cf, taxCode: cf, firstName: 'Persona', lastName: 'Sintetica',
    address: '', phone: '', updatedAt: new Date(), createdAt: new Date(), version: 1 });

type Proposal = { kind: 'observation' | 'therapy' | 'diagnosis'; values: Record<string, string>; quote: string };
async function fixture(proposalInput: Proposal = { kind: 'observation', values: observation, quote }) {
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
    const proposalId = randomUUID(), proposal = seal(proposalId, proposalInput.kind, { values: proposalInput.values, quote: proposalInput.quote, source: { sha256: documentHash, fileName: 'synthetic.pdf' } });
    receipt = f.run(() => f.store.add(f.principal, visitId, receipt.revision, { id: proposalId, kind: proposalInput.kind, envelope: proposal.envelope,
        byteLength: proposal.bytes.length, documentHash: null }));
    f.run(() => f.store.close(f.principal, visitId, receipt.revision));
    const row = (discardedItemIds: string[] = []) => ({ ...f.rows()[0], appliedItemIds: [], discardedItemIds });
    const opened = async (sealed: string | null | undefined) => {
        const [, iv, data] = (sealed ?? '').split(':');
        return decryptData(data!, iv!, f.masterKey) as Promise<Record<string, unknown>>;
    };
    return { row, pdfId, proposalId, opened, close() { db.setKey(null); f.database.close(); } };
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

const therapyQuote = 'Prescrivo Eutirox levotiroxina 50 mcg una compressa al mattino, AIC 023935010, ATC H03AA01.';
const therapy = { drugName: 'Eutirox', activePrinciple: 'levotiroxina', dosage: '50 mcg una compressa al mattino', status: 'active', startDate: '2026-11-17', aic: '023935010', atc: 'H03AA01' };

test('a correction that changes the drug drops the deposited AIC and ATC codes; a dose correction keeps them', async () => {
    const f = await fixture({ kind: 'therapy', values: therapy, quote: therapyQuote });
    const query = mock.method(db.therapies, 'query', () => ({ toArray: async () => [] }));
    const get = mock.method(db.patients, 'get', async () => patient());
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row(), [patient()], null, signal, pdfText('Paziente CF ' + cf + '\nData Prescrizione: 17/11/2026\n' + therapyQuote));
        const codes = (input: Awaited<ReturnType<typeof prepareAgentItemDecision>>) => {
            assert.ok(input && input.decision !== 'discard' && input.item.kind === 'therapy');
            return { aic: input.item.values.aic ?? null, atc: input.item.values.atc ?? null };
        };
        assert.deepEqual(codes(await prepareAgentItemDecision(review, f.proposalId, 'keep', signal)), { aic: '023935010', atc: 'H03AA01' });
        assert.deepEqual(codes(await prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { dosage: '75 mcg una compressa al mattino' })), { aic: '023935010', atc: 'H03AA01' });
        assert.deepEqual(codes(await prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { drugName: 'Tirosint' })), { aic: null, atc: null });
        assert.deepEqual(codes(await prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { activePrinciple: 'liotironina' })), { aic: null, atc: null });
        assert.deepEqual(codes(await prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { drugName: ' eutirox ' })), { aic: '023935010', atc: 'H03AA01' });
    } finally { get.mock.restore(); query.mock.restore(); f.close(); }
});

const diagnosisQuote = 'Diagnosi: diabete mellito tipo 2 E11.9 ICD-10 confermata.';
const diagnosis = { description: 'diabete mellito tipo 2', code: 'E11.9', system: 'ICD-10', date: '2026-11-17' };
const withDiagnosis = (): Patient => ({ ...patient(), diagnoses: [{ code: 'E11.9', system: 'ICD-10', description: 'Diabete tipo 2', date: new Date('2020-01-01') }] });

test('a diagnosis already in the chart is neither kept nor corrected in silence; the whole visit still shows it in the chart', async () => {
    const f = await fixture({ kind: 'diagnosis', values: diagnosis, quote: diagnosisQuote });
    const get = mock.method(db.patients, 'get', async () => withDiagnosis());
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row(), [withDiagnosis()], null, signal, pdfText('Paziente CF ' + cf + '\n' + diagnosisQuote));
        assert.match(review.currentSummary.get(f.proposalId) ?? '', /E11\.9/);
        await assert.rejects(prepareAgentItemDecision(review, f.proposalId, 'keep', signal), /già in scheda/);
        await assert.rejects(prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { description: 'diabete mellito tipo 2 in compenso' }), /già in scheda/);
        assert.deepEqual(review.inRecordItemIds, [f.proposalId]);
        const recoded = await prepareAgentItemDecision(review, f.proposalId, 'correct', signal, { code: 'E11.65' });
        assert.ok(recoded && recoded.decision === 'correct' && recoded.item.kind === 'diagnosis');
        assert.ok(await prepareAgentItemDecision(review, f.proposalId, 'discard', signal));
        assert.equal(agentVisitAwaitsReview(review), true);
    } finally { get.mock.restore(); f.close(); }
});

const recipeQuote = 'FARMACO SINTETICO 150MG 28 compresse';
const recipeText = 'Paziente CF ' + cf + '\nData Prescrizione: 23/11/2026\nRp/\n' + recipeQuote + '\nConfezioni: 1';

test('a therapy from a prescription that states no status asks the physician for it, and Tieni writes only the status chosen', async () => {
    const f = await fixture({ kind: 'therapy', values: { drugName: 'FARMACO SINTETICO 150MG' }, quote: recipeQuote });
    const query = mock.method(db.therapies, 'query', () => ({ toArray: async () => [] }));
    const get = mock.method(db.patients, 'get', async () => patient());
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row(), [patient()], null, signal, pdfText(recipeText));
        const shown = [...(review.itemBlockers.get(f.proposalId) ?? []), ...review.proposalBlockers];
        assert.ok(!shown.some(message => /status|Campo obbligatorio|non valido/u.test(message)), shown.join(' | '));
        assert.deepEqual(review.itemNeeds.get(f.proposalId), ['status']);
        assert.equal(review.itemBlockers.has(f.proposalId), false);
        assert.equal(agentItemAwaitsDecision(review, f.proposalId), true);
        assert.equal(agentVisitAwaitsReview(review), false);
        assert.equal(await prepareAgentApplication(review, signal), null);
        assert.equal(await prepareAgentItemDecision(review, f.proposalId, 'keep', signal), null);
        assert.equal(await prepareAgentItemDecision(review, f.proposalId, 'keep', signal, { status: 'attiva' }), null);
        const kept = await prepareAgentItemDecision(review, f.proposalId, 'keep', signal, { status: 'active', dosage: '2 compresse', drugName: 'Altro' });
        assert.ok(kept && kept.decision === 'keep' && kept.item.kind === 'therapy');
        assert.equal(kept.item.values.status, 'active');
        assert.equal(kept.item.values.dosage, 'non indicata nel documento');
        assert.equal(kept.item.values.drugName, 'FARMACO SINTETICO 150MG');
        assert.deepEqual(JSON.parse(String(await f.opened(kept.item.values.motivation))).physicianFields, ['status']);
        assert.equal(new Date(kept.item.values.startDate).toISOString().slice(0, 10), '2026-11-23');
    } finally { get.mock.restore(); query.mock.restore(); f.close(); }
});

test('a therapy whose source states the status is kept as deposited, without asking', async () => {
    const quoteInUse = 'Prescrivo FARMACO SINTETICO 150MG una compressa al giorno';
    const f = await fixture({ kind: 'therapy', values: { drugName: 'FARMACO SINTETICO 150MG', dosage: 'una compressa al giorno' }, quote: quoteInUse });
    const query = mock.method(db.therapies, 'query', () => ({ toArray: async () => [] }));
    const get = mock.method(db.patients, 'get', async () => patient());
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row(), [patient()], null, signal, pdfText('Paziente CF ' + cf + '\nData Prescrizione: 23/11/2026\n' + quoteInUse));
        assert.equal(review.itemNeeds.has(f.proposalId), false);
        assert.equal(agentVisitAwaitsReview(review), true);
        const kept = await prepareAgentItemDecision(review, f.proposalId, 'keep', signal, { status: 'completed' });
        assert.ok(kept && kept.decision === 'keep' && kept.item.kind === 'therapy');
        assert.equal(kept.item.values.status, 'active');
        assert.equal(JSON.parse(String(await f.opened(kept.item.values.motivation))).physicianFields, undefined);
    } finally { get.mock.restore(); query.mock.restore(); f.close(); }
});

test('a first visit with a prescription therapy without status waits for the physician choice, then the whole visit carries that status', async () => {
    const f = await fixture({ kind: 'therapy', values: { drugName: 'FARMACO SINTETICO 150MG' }, quote: recipeQuote });
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row(), [], null, signal, pdfText(recipeText), 'synthetic-ambulatory');
        assert.ok(review.newPatient);
        assert.deepEqual(review.itemNeeds.get(f.proposalId), ['status']);
        assert.equal(agentItemAwaitsDecision(review, f.proposalId), false);
        assert.equal(agentVisitAwaitsReview(review), false);
        assert.equal(await prepareAgentApplication(review, signal), null);
        assert.equal(agentVisitAwaitsReview(review, { [f.proposalId]: { status: 'attiva' } }), false);
        assert.equal(await prepareAgentApplication(review, signal, { [f.proposalId]: { status: 'attiva' } }), null);
        const choices = { [f.proposalId]: { status: 'suspended', drugName: 'Altro', dosage: '1 compressa' } };
        assert.equal(agentVisitAwaitsReview(review, choices), true);
        const plan = await prepareAgentApplication(review, signal, choices);
        assert.ok(plan && plan.newPatient?.taxCode === cf);
        const therapy = plan.items.find(item => item.id === f.proposalId);
        assert.ok(therapy && therapy.kind === 'therapy');
        assert.equal(therapy.values.status, 'suspended');
        assert.equal(therapy.values.drugName, 'FARMACO SINTETICO 150MG');
        assert.equal(therapy.values.dosage, 'non indicata nel documento');
        assert.deepEqual(JSON.parse(String(await f.opened(therapy.values.motivation))).physicianFields, ['status']);
    } finally { f.close(); }
});
