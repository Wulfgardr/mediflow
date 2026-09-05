/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPatientInsightPreviewRequest,
    parsePatientInsightPreviewRequest,
    parsePatientInsightPreviewWireRoot,
    serializePatientInsightPreviewWireRoot,
} from './patient-insight-preview-contract.ts';

const capturedAt = '2026-09-01T10:00:00.000Z';
const requestId = 'pi_01234567-89ab-cdef-0123-456789abcdef';

test('captures only the bounded typed Patient Insight projection and detaches caller data', () => {
    const patient = {
        id: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01', version: 4,
        firstName: 'Synthetic', lastName: 'Person', taxCode: 'SYNTHETIC0000000',
        diagnoses: [{ code: 'S-1', description: '  synthetic   condition  ', system: 'synthetic', date: new Date() }],
    };
    const therapy = {
        id: 'therapy.synthetic.01', patientId: patient.id, drugName: ' synthetic drug ', dosage: ' one unit ', status: 'active' as const,
        startDate: new Date(), createdAt: new Date(),
    };
    const entry = {
        id: 'entry.synthetic.01', patientId: patient.id, date: new Date('2026-08-31T10:00:00.000Z'), type: 'note' as const,
        title: ' synthetic review ', content: ` ${'x'.repeat(280)} `, createdAt: new Date(), updatedAt: new Date(),
    };
    const request = buildPatientInsightPreviewRequest({ patient, therapies: [therapy], entries: [entry], requestId, capturedAt });

    assert.deepEqual(Object.keys(request), ['schemaVersion', 'requestId', 'patientId', 'ambulatoryId', 'patientRevision', 'capturedAt', 'sources']);
    assert.equal(request.sources.focus.summary, 'Valutazione manuale del follow-up clinico attuale');
    assert.deepEqual(request.sources.conditions, [{ label: 'synthetic condition (S-1)' }]);
    assert.deepEqual(request.sources.activeTherapies, [{ label: 'synthetic drug — one unit' }]);
    assert.ok(request.sources.recentEvents[0].summary.length <= 240);
    assert.doesNotMatch(JSON.stringify(request), /Synthetic Person|SYNTHETIC0000000/u);
    assert.equal(Object.isFrozen(request), true);
    assert.equal(Object.isFrozen(request.sources.conditions), true);

    patient.diagnoses[0].description = 'mutated';
    therapy.drugName = 'mutated';
    entry.content = 'mutated';
    assert.deepEqual(request.sources.conditions, [{ label: 'synthetic condition (S-1)' }]);
    assert.deepEqual(request.sources.activeTherapies, [{ label: 'synthetic drug — one unit' }]);
});

test('parses the exact preview request and rejects identity, prompt, authority, stale shapes, and accessors', () => {
    const base = buildPatientInsightPreviewRequest({
        patient: { id: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01', version: 4, diagnoses: [] },
        therapies: [], entries: [], requestId, capturedAt,
    });
    assert.deepEqual(parsePatientInsightPreviewRequest(JSON.parse(JSON.stringify(base))), base);
    let reads = 0;
    const accessor = { ...base } as Record<string, unknown>;
    Object.defineProperty(accessor, 'patientId', { enumerable: true, get() { reads += 1; throw new Error('must not read'); } });
    for (const invalid of [
        { ...base, prompt: 'free prompt' }, { ...base, fullName: 'Synthetic Person' }, { ...base, authority: 'physician' },
        { ...base, patientRevision: 0 }, { ...base, capturedAt: 'not-a-date' },
        { ...base, sources: { ...base.sources, provider: 'caller-selected' } }, accessor,
    ]) assert.equal(parsePatientInsightPreviewRequest(invalid), null);
    assert.equal(reads, 0);
});

test('round-trips only a strict review proposal with Fabric receipt, provenance, and currentness', () => {
    const receipt = {
        schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'patient_insight', class: 'generative', venue: 'local_process',
        egressProfile: { id: 'local_only', version: 'mediflow.ai.egress-profile.v1', egress: 'none' }, provider: 'ollama', model: 'synthetic:latest',
        providerReceipt: { schemaVersion: 'mediflow.ai.provider-selection.v1', authorityPlane: 'clinical_application', task: 'clinical', provider: 'ollama', model: 'synthetic:latest', execution: 'local', endpointClass: 'loopback', egress: 'none', runtimeReadiness: 'required', fallbackCount: 0 }, fallbackCount: 0,
    };
    const provenance = { schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'patient_insight', venue: 'local_process', provider: 'ollama', model: 'synthetic:latest', preprocessing: ['context_minimization', 'envelope_validation'], receipt };
    const proposal = {
        schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true, summary: 'Synthetic summary [S1]',
        currentState: ['Synthetic state [S1]'], alerts: [], nextSteps: ['Synthetic review [S1]'], gaps: [], generatedAt: capturedAt,
        currentness: { selectionEpoch: 7, patientRevision: 4, projectionDigest: `sha256_${'a'.repeat(64)}`, capturedAt, verifiedAt: capturedAt },
    };
    const root = serializePatientInsightPreviewWireRoot({ preview: { writesPerformed: 0, apply: 'denied', status: 'available', code: null, proposal, receipt, provenance, reviewRef: `review_${'b'.repeat(32)}` } });
    assert.ok(root);
    const parsed = parsePatientInsightPreviewWireRoot(JSON.parse(JSON.stringify(root)));
    assert.deepEqual(parsed, root);
    assert.equal(parsed?.preview.status, 'available');
    if (parsed?.preview.status === 'available') {
        assert.equal(parsed.preview.receipt.egress, 'none');
        assert.deepEqual(parsed.preview.provenance.preprocessing, ['context_minimization', 'envelope_validation']);
        assert.equal(parsed.preview.proposal.currentness.patientRevision, 4);
    }
    assert.equal(parsePatientInsightPreviewWireRoot({ preview: { ...(root?.preview as object), writesPerformed: 1 } }), null);
    assert.equal(parsePatientInsightPreviewWireRoot({ preview: { ...(root?.preview as object), apply: 'allowed' } }), null);
});
