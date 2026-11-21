import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { agentCassetteFixture } from './test-fixtures/agent-cassette';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { db, type Patient } from './db';
import { agentVisitAwaitsReview, inspectAgentVisit, prepareAgentApplication } from './agent-visit-review';
import type { AgentMandateInput } from './agent-mandate-contract';
import type { AgentItemKind } from './agent-cassette-crypto';
import { AGENT_ITEM_OPERATION } from './agent-cassette-contract';
import { readPatientDiaryMetadata } from './patient-diary-metadata';
import { agentVisitPdfText } from './agent-visit-pdf-text';

const pdfText = (text: string) => async () => ({ text, beyondText: false });

const cfA = 'RSSMRA80A01F205X', cfB = 'RSSMRA85T10A562S';
function patient(cf: string): Patient { return { id: 'synthetic-' + cf, taxCode: cf, firstName: 'Persona', lastName: 'Sintetica',
    address: '', phone: '', updatedAt: new Date(), createdAt: new Date(), version: 1 }; }
async function fixture(cf = cfA, wrongHash = false, proposal?: { kind: 'service' | 'observation' | 'therapy'; values: Record<string, string>; quote: string },
    provider: AgentMandateInput['provider'] = 'local', allowsClinicalEgress = provider !== 'local') {
    const f = await agentCassetteFixture(undefined, provider, allowsClinicalEgress);
    db.setKey(f.masterKey);
    const visitId = randomUUID();
    const seal = (id: string, kind: AgentItemKind, value: unknown) => {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        return { bytes, envelope: sealAgentItemNode(f.mandate.publicKey, { mandateRef: f.mandate.id, visitId, itemId: id, kind }, bytes) };
    };
    const anchor = seal(visitId, 'anchor', { fiscalCode: cf });
    let receipt = f.run(() => f.store.open(f.principal, visitId, anchor.envelope));
    const bytes = Buffer.from('%PDF-1.4\nSYNTHETIC_PDF_IDENTITY\n%%EOF');
    const id = randomUUID(), payload = seal(id, 'pdf', { name: 'synthetic.pdf', base64: bytes.toString('base64') });
    const item = { id, kind: 'pdf' as const, envelope: payload.envelope, byteLength: payload.bytes.length,
        documentHash: wrongHash ? 'a'.repeat(64) : createHash('sha256').update(bytes).digest('hex') };
    receipt = f.run(() => f.store.add(f.principal, visitId, receipt.revision, item));
    assert.equal(AGENT_ITEM_OPERATION[item.kind], 'visita.allega');
    if (proposal) {
        const proposalId = randomUUID(), value = seal(proposalId, proposal.kind, { values: proposal.values, quote: proposal.quote,
            source: { sha256: item.documentHash, fileName: 'synthetic.pdf' } });
        receipt = f.run(() => f.store.add(f.principal, visitId, receipt.revision, { id: proposalId, kind: proposal.kind,
            envelope: value.envelope, byteLength: value.bytes.length, documentHash: null }));
    }
    f.run(() => f.store.close(f.principal, visitId, receipt.revision));
    return { row: { ...f.rows()[0], appliedItemIds: [] }, close() { db.setKey(null); f.database.close(); } };
}

test('a PDF with another patient tax code blocks the whole cassette and produces no automatic application', async () => {
    const f = await fixture();
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], null, signal, pdfText('Paziente CF ' + cfB));
        assert.ok(review.blockers.length);
        assert.match(review.blockers.join(' '), new RegExp(cfB));
        assert.equal(await prepareAgentApplication(review, signal), null);
    } finally { f.close(); }
});

test('a prescription bearing patient and physician tax codes matches only the existing patient', async () => {
    const f = await fixture();
    try {
        const review = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], cfB, new AbortController().signal,
            pdfText(`Paziente CF ${cfA}\nMedico prescrittore\nCodice fiscale del medico: ${cfB}`));
        assert.deepEqual(review.blockers, []);
        assert.equal(review.patient?.taxCode, cfA);
    } finally { f.close(); }
});

test('two visits deposited at the same time are linked by their PDF tax codes, never by time', async () => {
    for (const cf of [cfA, cfB]) {
        const f = await fixture(cf);
        try {
            f.row.depositedAt = 1900000000000;
            const review = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], null, new AbortController().signal, pdfText('Paziente CF ' + cf));
            assert.deepEqual(review.blockers, []);
            assert.equal(review.patient?.taxCode, cf);
        } finally { f.close(); }
    }
});

test('missing, unlabelled, unregistered or duplicated patient identity prevents automatic application', async () => {
    const f = await fixture();
    try {
        for (const [patients, pdf] of [[[], 'Paziente CF ' + cfA], [[patient(cfA), { ...patient(cfA), id: 'synthetic-duplicate' }], 'Paziente CF ' + cfA],
            [[patient(cfA)], 'Documento sintetico senza identità'], [[patient(cfA)], cfA]] as const) {
            const review = await inspectAgentVisit(f.row, [...patients], null, new AbortController().signal, pdfText(pdf));
            assert.ok(review.blockers.length);
        }
    } finally { f.close(); }
});

test('a changed PDF hash never reaches the browser parser', async () => {
    const f = await fixture(cfA, true);
    try {
        let parsed = false;
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, new AbortController().signal, async () => { parsed = true; return { text: 'Paziente CF ' + cfA, beyondText: false }; });
        assert.equal(parsed, false);
        assert.ok(review.blockers.length);
    } finally { f.close(); }
});

test('locking during local PDF inspection discards the result', async () => {
    const f = await fixture();
    try {
        const controller = new AbortController();
        await assert.rejects(inspectAgentVisit(f.row, [patient(cfA)], null, controller.signal, async () => { controller.abort(); return { text: 'Paziente CF ' + cfA, beyondText: false }; }));
    } finally { f.close(); }
});

test('an already cancelled cassette PDF removes the preview listener', async ({ mock: mocks }) => {
    mocks.timers.enable({ apis: ['setTimeout'] });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(agentVisitPdfText(new Uint8Array([1]), controller.signal));
    assert.deepEqual(getEventListeners(controller.signal, 'abort'), []);
});

for (const [prefix, suffix, blocked] of [
    ['Non assume ', '', true], ['La madre assume ', '', true], ['', ', sospeso.', true], ['Visita odierna. ', '', false],
] as const) {
    test(`a therapy quote keeps the qualifiers from the source (${(prefix || suffix).trim()})`, async () => {
        const quote = 'Farmaco Sintetico 1 compressa al giorno dal 2026-11-17';
        const f = await fixture(cfA, false, { kind: 'therapy', quote, values: {
            drugName: 'Farmaco Sintetico', dosage: '1 compressa al giorno', status: 'active', startDate: '2026-11-17',
        } });
        const query = mock.method(db.therapies, 'query', () => ({ toArray: async () => [] }));
        try {
            const review = await inspectAgentVisit(f.row, [patient(cfA)], null, new AbortController().signal,
                pdfText('Paziente CF ' + cfA + '\n' + prefix + quote + suffix));
            assert.deepEqual(review.blockers, []);
            assert.equal(review.proposalBlockers.length > 0, blocked);
        } finally { query.mock.restore(); f.close(); }
    });
}


for (const [provider, allowsClinicalEgress] of [['openai', false], ['anthropic', false], ['openai', true], ['local', false]] as const) {
    test(`L2: the ${provider} cassette with egress ${allowsClinicalEgress} brings its PDF to the doctor`, async () => {
        const f = await fixture(cfA, false, undefined, provider, allowsClinicalEgress);
        const get = mock.method(db.patients, 'get', async () => patient(cfA));
        try {
            const signal = new AbortController().signal;
            const review = await inspectAgentVisit(f.row, [patient(cfA)], null, signal, pdfText('Paziente CF ' + cfA));
            assert.deepEqual([...review.blockers, ...review.proposalBlockers], []);
            const reviewed = await prepareAgentApplication(review, signal);
            assert.equal(reviewed?.phase, 'review');
            assert.deepEqual(reviewed?.items.map(item => item.kind), ['pdf']);
            assert.equal(agentVisitAwaitsReview(review), true);
            assert.equal(agentVisitAwaitsReview({ ...review, appliedItemIds: review.visit.items.map(item => item.id) }), false);
        } finally { get.mock.restore(); f.close(); }
    });
}

test('a proposal waits with the PDF it cites, and alone once the PDF entered under the previous rule', async () => {
    const quote = 'LOINC 2345-7. Glucosio 100 mg/dL intervallo 70 110';
    const f = await fixture(cfA, false, { kind: 'observation', values: { code: '2345-7', display: 'Glucosio', value: '100', unitCode: 'mg/dL', unit: 'mg/dL', observedAt: '2026-11-17', refLow: '70', refHigh: '110', refText: '70 110' }, quote });
    const query = mock.method(db.observations, 'query', () => ({ toArray: async () => [] }));
    const get = mock.method(db.patients, 'get', async () => patient(cfA));
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, signal, pdfText('Paziente CF ' + cfA + '\n' + quote));
        assert.deepEqual([...review.blockers, ...review.proposalBlockers], []);
        const pdf = review.visit.items.find(item => item.kind === 'pdf')!.id;
        assert.equal(agentVisitAwaitsReview(review), true);
        assert.deepEqual((await prepareAgentApplication(review, signal))?.items.map(item => item.kind), ['pdf', 'observation']);
        assert.deepEqual((await prepareAgentApplication({ ...review, appliedItemIds: [pdf] }, signal))?.items.map(item => item.kind), ['observation']);
    } finally { get.mock.restore(); query.mock.restore(); f.close(); }
});

test('a patient revision changed after the displayed review cannot be silently adopted', async () => {
    const f = await fixture();
    const original = db.patients.get;
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, signal, pdfText('Paziente CF ' + cfA));
        assert.deepEqual(review.blockers, []);
        db.patients.get = async () => ({ ...patient(cfA), version: 2 });
        await assert.rejects(prepareAgentApplication(review, signal), /scheda è cambiata/);
    } finally { db.patients.get = original; f.close(); }
});


test('a deposited note has readable diary metadata and preserves the document reference', async () => {
    const f = await fixture();
    const get = mock.method(db.patients, 'get', async () => patient(cfA));
    const quote = 'Sintesi clinica sintetica';
    const source = { sha256: 'a'.repeat(64), fileName: 'synthetic.pdf' };
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, signal, pdfText('Paziente CF ' + cfA));
        review.visit.items.push({ kind: 'note', id: randomUUID(), value: { text: quote, quote, source } });
        const application = await prepareAgentApplication(review, signal);
        assert.deepEqual(application?.items.map(item => item.kind), ['pdf', 'note']);
        const note = application?.items.find(item => item.kind === 'note');
        assert.ok(note?.kind === 'note');
        const metadata = readPatientDiaryMetadata(await db.openLocalDraft(note.values.metadata));
        assert.equal(metadata.state, 'readable');
        assert.equal(metadata.value?.sourceLabel, 'Cassetta della visita');
        assert.deepEqual(metadata.value?.provenance, { visitId: f.row.id, source, quote });
    } finally { get.mock.restore(); f.close(); }
});

test('service line items absent from the cited PDF cannot enter the no-doubts batch', async () => {
    const quote = 'Prestazione Sintetica prescritta il 2026-11-17';
    const f = await fixture(cfA, false, { kind: 'service', values: { serviceName: 'Prestazione Sintetica', prescribedAt: '2026-11-17', category: 'other', items: 'Esame aggiunto senza fonte' }, quote });
    const query = mock.method(db.servicePrescriptions, 'query', () => ({ toArray: async () => [] }));
    try {
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, new AbortController().signal, pdfText('Paziente CF ' + cfA + '\n' + quote));
        assert.deepEqual(review.blockers, []);
        assert.match(review.proposalBlockers.join(' '), /Voci della prestazione/);
    } finally { query.mock.restore(); f.close(); }
});

test('a reviewed observation preserves the reference range present in its source', async () => {
    const quote = 'LOINC 2345-7. Glucosio 100 mg/dL intervallo 70 110';
    const f = await fixture(cfA, false, { kind: 'observation', values: { code: '2345-7', display: 'Glucosio', value: '100', unitCode: 'mg/dL', unit: 'mg/dL', observedAt: '2026-11-17', refLow: '70', refHigh: '110', refText: '70 110' }, quote });
    const query = mock.method(db.observations, 'query', () => ({ toArray: async () => [] }));
    const get = mock.method(db.patients, 'get', async () => patient(cfA));
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, signal, pdfText('Paziente CF ' + cfA + '\n' + quote));
        assert.deepEqual([...review.blockers, ...review.proposalBlockers], []);
        const application = await prepareAgentApplication(review, signal);
        const values = application?.items.find(item => item.kind === 'observation')?.values as Record<string, unknown>;
        assert.equal(values.refLow, '70');
        assert.equal(values.refHigh, '110');
        assert.equal(values.refText, '70 110');
    } finally { get.mock.restore(); query.mock.restore(); f.close(); }
});


test('an observation code absent from its cited source remains a proposal with a coding doubt', async () => {
    const quote = 'Glucosio 100 mg/dL osservato il 2026-11-17';
    const f = await fixture(cfA, false, { kind: 'observation', values: { code: '2345-7', display: 'Glucosio', value: '100', unit: 'mg/dL', unitCode: 'mg/dL', observedAt: '2026-11-17' }, quote });
    const query = mock.method(db.observations, 'query', () => ({ toArray: async () => [] }));
    try {
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, new AbortController().signal, pdfText('Paziente CF ' + cfA + '\n' + quote));
        assert.deepEqual(review.blockers, []);
        assert.match(review.proposalBlockers.join(' '), /Codice dell’osservazione/);
    } finally { query.mock.restore(); f.close(); }
});

test('WUL-925: RefertoCittadino with specialist CF in header, footer, or signature passes without profile physician CF, while unlabeled CF blocks', async () => {
    const specialistCf = 'MEDPRS00A01A000W';
    const reports = [
        `ASST Sintetica - U.O. Cardiologia - Medico refertante: Dott. Luca Bianchi - C.F.: ${specialistCf}\nAssistito: Mario Rossi\nCodice fiscale assistito: ${cfA}`,
        `RefertoCittadino\nAssistito codice fiscale ${cfA}\nIl medico\nDott. Luca Bianchi\nC.F.: ${specialistCf}`,
        `RefertoCittadino\nPaziente codice fiscale ${cfA}\nFirmato digitalmente da: BIANCHI LUCA (CF: ${specialistCf})`,
    ];
    for (const text of reports) {
        const f = await fixture(cfA);
        try {
            const review = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], null, new AbortController().signal, pdfText(text));
            assert.deepEqual(review.blockers, [], text);
            assert.equal(review.patient?.taxCode, cfA);
        } finally { f.close(); }
    }
    const f = await fixture(cfA);
    try {
        const blocked = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], null, new AbortController().signal, pdfText(`Assistito codice fiscale ${cfA}\n${specialistCf}`));
        assert.ok(blocked.blockers.length > 0);
    } finally { f.close(); }
});
