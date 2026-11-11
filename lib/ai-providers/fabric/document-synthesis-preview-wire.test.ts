import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    parseDocumentSynthesisPreviewWire,
    serializeDocumentSynthesisPreviewWire,
} from './document-synthesis-preview-wire.ts';

/* Risposte reali del modello locale con campi strutturati inventati (codici ICD,
 * priorità, farmaci): file condiviso con il client Rust di GPUI. */
const INVENTED = JSON.parse(fs.readFileSync(new URL('../../../experiments/gpui-patient-pilot/transport/tests/fixtures/document_synthesis/model-output-invented-fields.json', import.meta.url), 'utf8')) as {
    cases: { name: string; output: { summary: string; data: { qualityLevel: string } }; invented: string[] }[];
};
const STRUCTURED_KEYS = ['data', 'qualityReason', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions', 'claims', 'priority', 'explicitCode', 'code'];

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
    if (Array.isArray(value)) for (const item of value) keysOf(item, into);
    else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) { into.add(key); keysOf(item, into); }
    return into;
}

function publication(output?: unknown) {
    const providerReceipt = Object.freeze({
        schemaVersion: 'mediflow.document-synthesis.provider-binding.v1',
        capability: 'document_synthesis', registryTask: 'reasoning', provider: 'ollama',
        model: 'synthetic-local:latest', venue: 'local_process', egress: 'none',
        fallback: 'none', runtimeReadiness: 'required',
    });
    const fabricReceipt = Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'document_synthesis',
        class: 'generative', venue: 'local_process',
        egressProfile: Object.freeze({ id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' }),
        provider: 'ollama', model: 'synthetic-local:latest', providerReceipt: null, fallbackCount: 0,
    });
    return Object.freeze({
        schemaVersion: 'mediflow.document-synthesis.publication.v1',
        output: output ?? Object.freeze({
            schemaVersion: 'mediflow.ai.extract.v1', task: 'document_synthesis', summary: 'Sintesi sintetica.',
            data: Object.freeze({ qualityLevel: 'green', medications: Object.freeze([]), diagnoses: Object.freeze([]), problemStatements: Object.freeze([]), therapyCandidates: Object.freeze([]), servicePrescriptions: Object.freeze([]) }),
        }),
        citations: Object.freeze([Object.freeze({ label: 'S1', quote: 'Fonte sintetica.', startByte: 0, endByte: 17, quoteSha256: 'a'.repeat(64) })]),
        claims: Object.freeze([Object.freeze({ claimPath: 'summary', labels: Object.freeze(['S1']) })]),
        receipt: Object.freeze({
            schemaVersion: 'mediflow.document-synthesis.publication-receipt.v1', capability: 'document_synthesis',
            outputSha256: 'b'.repeat(64), claimCitationsDigestSha256: Object.freeze(Array(32).fill(1)),
            sourceSetDigestSha256: Object.freeze(Array(32).fill(2)), providerBindingReceipt: providerReceipt,
            reviewOnly: true, applyPolicy: 'none', writesPerformed: 0,
        }),
        provenance: Object.freeze({
            schemaVersion: 'mediflow.document-synthesis.publication-provenance.v1', capability: 'document_synthesis',
            sourceSetAuthority: 'application_host', inputDigestScope: 'ordered_normalized_provider_projection_set',
            citationSupport: 'provider_declared_host_membership_and_locator_validated', modelCausality: 'not_established',
            fabricProvenance: Object.freeze({
                schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'document_synthesis', venue: 'local_process',
                provider: 'ollama', model: 'synthetic-local:latest', preprocessing: Object.freeze(['context_minimization']), receipt: fabricReceipt,
            }),
        }),
    });
}

test('serializes and parses the exact review-only publication disclosure', () => {
    const wire = serializeDocumentSynthesisPreviewWire(publication());
    assert.ok(wire);
    assert.deepEqual(Reflect.ownKeys(wire), ['schemaVersion', 'status', 'publication']);
    assert.equal(wire.status, 'available');
    assert.equal(wire.publication.receipt.reviewOnly, true);
    assert.equal(wire.publication.receipt.applyPolicy, 'none');
    assert.equal(wire.publication.receipt.writesPerformed, 0);
    assert.equal(wire.publication.provenance.sourceSetAuthority, 'application_host');
    assert.equal(wire.publication.provenance.modelCausality, 'not_established');
    assert.equal(parseDocumentSynthesisPreviewWire(JSON.parse(JSON.stringify(wire)))?.publication.output.summary, 'Sintesi sintetica.');
});

test('rejects drift, forged writes, unavailable citations, and provider/venue changes', () => {
    type MutableWire = {
        extra?: boolean;
        publication: {
            citations: unknown[];
            receipt: { writesPerformed: number; providerBindingReceipt: { provider: string } };
            provenance: { modelCausality: string; fabricProvenance: { venue: string } };
        };
    };
    const base = JSON.parse(JSON.stringify(serializeDocumentSynthesisPreviewWire(publication()))) as MutableWire;
    for (const mutate of [
        (value: MutableWire) => { value.extra = true; },
        (value: MutableWire) => { value.publication.receipt.writesPerformed = 1; },
        (value: MutableWire) => { value.publication.citations = []; },
        (value: MutableWire) => { value.publication.receipt.providerBindingReceipt.provider = 'cloud'; },
        (value: MutableWire) => { value.publication.provenance.fabricProvenance.venue = 'cloud'; },
        (value: MutableWire) => { value.publication.provenance.modelCausality = 'established'; },
    ]) {
        const hostile = structuredClone(base); mutate(hostile);
        assert.equal(parseDocumentSynthesisPreviewWire(hostile), null);
    }
});

for (const sample of INVENTED.cases) {
    test(`campi strutturati inventati dal modello restano fuori dal filo dell'anteprima (${sample.name})`, () => {
        // La fixture porta davvero i valori inventati: senza, il test non proverebbe nulla.
        const source = JSON.stringify(sample.output);
        for (const needle of sample.invented) assert.ok(source.includes(needle), `fixture senza ${needle}`);
        const wire = serializeDocumentSynthesisPreviewWire(publication(sample.output));
        assert.ok(wire, 'l\'host accetta la proposta con campi strutturati pieni');
        const text = JSON.stringify(wire);
        for (const needle of sample.invented) assert.ok(!text.includes(needle), `${needle} arriva al client`);
        for (const key of STRUCTURED_KEYS) assert.ok(!keysOf(wire).has(key), `chiave ${key} sul filo`);
        assert.deepEqual(Reflect.ownKeys(wire.publication), ['output', 'citations', 'receipt', 'provenance']);
        assert.deepEqual(Reflect.ownKeys(wire.publication.output), ['schemaVersion', 'task', 'summary', 'qualityLevel']);
        assert.equal(wire.publication.output.summary, sample.output.summary);
        assert.equal(wire.publication.output.qualityLevel, sample.output.data.qualityLevel);

        // Il parser del Web rifiuta per intero un filo che porti anche i campi strutturati.
        const base = JSON.parse(text);
        assert.ok(parseDocumentSynthesisPreviewWire(structuredClone(base)));
        const withData = structuredClone(base); withData.publication.output.data = sample.output.data;
        assert.equal(parseDocumentSynthesisPreviewWire(withData), null);
        const sourceShape = structuredClone(base); sourceShape.publication.output = sample.output;
        assert.equal(parseDocumentSynthesisPreviewWire(sourceShape), null);
        const besideOutput = structuredClone(base); besideOutput.publication.data = sample.output.data;
        assert.equal(parseDocumentSynthesisPreviewWire(besideOutput), null);
    });
}
