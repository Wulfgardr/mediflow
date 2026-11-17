import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { agentCassetteFixture } from './test-fixtures/agent-cassette';
import { sealAgentItemNode } from '../packages/agent-client/src/cassette-crypto';
import { db, type Patient } from './db';
import { inspectAgentVisit, prepareAgentApplication } from './agent-visit-review';
import { AGENT_ITEM_OPERATION } from './agent-cassette-contract';

const cfA = 'RSSMRA80A01F205X', cfB = 'RSSMRA85T10A562S';
function patient(cf: string): Patient { return { id: 'synthetic-' + cf, taxCode: cf, firstName: 'Persona', lastName: 'Sintetica',
    address: '', phone: '', updatedAt: new Date(), createdAt: new Date(), version: 1 }; }
async function fixture(cf = cfA, wrongHash = false) {
    const f = await agentCassetteFixture();
    db.setKey(f.masterKey);
    const visitId = randomUUID();
    const seal = (id: string, kind: 'anchor' | 'pdf', value: unknown) => {
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
    f.run(() => f.store.close(f.principal, visitId, receipt.revision));
    return { row: { ...f.rows()[0], appliedItemIds: [] }, close() { db.setKey(null); f.database.close(); } };
}

test('a PDF with another patient tax code blocks the whole cassette and produces no automatic application', async () => {
    const f = await fixture();
    try {
        const signal = new AbortController().signal;
        const review = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], null, signal, async () => 'Paziente CF ' + cfB);
        assert.ok(review.blockers.length);
        assert.match(review.blockers.join(' '), new RegExp(cfB));
        assert.equal(await prepareAgentApplication(review, 'automatic', signal), null);
    } finally { f.close(); }
});

test('a prescription bearing patient and physician tax codes matches only the existing patient', async () => {
    const f = await fixture();
    try {
        const review = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], cfB, new AbortController().signal,
            async () => `Paziente CF ${cfA}\nMedico prescrittore\nCodice fiscale del medico: ${cfB}`);
        assert.deepEqual(review.blockers, []);
        assert.equal(review.patient?.taxCode, cfA);
    } finally { f.close(); }
});

test('two visits deposited at the same time are linked by their PDF tax codes, never by time', async () => {
    for (const cf of [cfA, cfB]) {
        const f = await fixture(cf);
        try {
            f.row.depositedAt = 1900000000000;
            const review = await inspectAgentVisit(f.row, [patient(cfA), patient(cfB)], null, new AbortController().signal, async () => 'Paziente CF ' + cf);
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
            const review = await inspectAgentVisit(f.row, [...patients], null, new AbortController().signal, async () => pdf);
            assert.ok(review.blockers.length);
        }
    } finally { f.close(); }
});

test('a changed PDF hash never reaches the browser parser', async () => {
    const f = await fixture(cfA, true);
    try {
        let parsed = false;
        const review = await inspectAgentVisit(f.row, [patient(cfA)], null, new AbortController().signal, async () => { parsed = true; return 'Paziente CF ' + cfA; });
        assert.equal(parsed, false);
        assert.ok(review.blockers.length);
    } finally { f.close(); }
});

test('locking during local PDF inspection discards the result', async () => {
    const f = await fixture();
    try {
        const controller = new AbortController();
        await assert.rejects(inspectAgentVisit(f.row, [patient(cfA)], null, controller.signal, async () => { controller.abort(); return 'Paziente CF ' + cfA; }));
    } finally { f.close(); }
});
