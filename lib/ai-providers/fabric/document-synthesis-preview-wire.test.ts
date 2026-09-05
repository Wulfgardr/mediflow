/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    parseDocumentSynthesisPreviewWire,
    serializeDocumentSynthesisPreviewWire,
} from './document-synthesis-preview-wire.ts';

function publication() {
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
        output: Object.freeze({
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
