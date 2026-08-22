/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SmartImportProjection } from '../../smart-import-projection';
import {
    buildPatientSmartImportCapabilityPrompt,
    parsePatientSmartImportCapabilityProposal,
    PatientSmartImportCapabilityError,
} from './patient-smart-import-capability-contract';

const sourceId = 'source.synthetic.0001';
const projection: SmartImportProjection = Object.freeze({
    schemaVersion: 'mediflow.smart-import.projection.v1',
    capability: 'smart_import',
    patientRef: 'patient.synthetic.0001',
    selectionEpoch: 4,
    patientRevision: 7,
    sourceRevision: 9,
    capturedAt: '2026-08-22T09:00:00.000Z',
    currentDiagnoses: Object.freeze([{ system: 'ICD-11', code: '5A11', description: 'Diagnosi sintetica corrente' }]),
    currentActiveTherapies: Object.freeze([{ drugName: 'Farmaco sintetico', activePrinciple: 'Principio sintetico', dosage: '1 dose/die', aic: null, atc: null }]),
    therapyCandidateHints: Object.freeze([{ sourceId, label: 'Candidato sintetico', excerpt: 'Terapia sintetica da rivedere' }]),
    sources: Object.freeze([{ id: sourceId, kind: 'clinical-entry' as const, label: 'Fonte sintetica', date: '2026-08-22T08:55:00.000Z', content: 'Contenuto clinico interamente sintetico.' }]),
});

type Binding = string | null | undefined;

function responseWithBindings(bindings: { diagnosis?: Binding; therapy?: Binding; prescription?: Binding; item?: Binding } = {}): string {
    const source = (value: Binding) => value === null ? {} : { sourceId: value ?? sourceId };
    return JSON.stringify({
        schemaVersion: 'mediflow.ai.extract.v1', task: 'smart_import', summary: 'Proposta sintetica', ignoredRaw: 'raw-provider-marker',
        data: {
            diagnoses: [{ label: 'Diagnosi proposta', icdQuery: 'synthetic diagnosis', confidence: 'high', evidence: 'Evidenza sintetica', ...source(bindings.diagnosis) }],
            therapies: [{ drugMention: 'Farmaco proposto', drugQuery: 'synthetic drug', confidence: 'medium', evidence: 'Terapia sintetica', ...source(bindings.therapy) }],
            servicePrescriptions: [{ serviceName: 'Esame sintetico', category: 'lab', confidence: 'low', evidence: 'Richiesta sintetica', ...source(bindings.prescription),
                items: [{ serviceName: 'Analita sintetico', category: 'lab', confidence: 'low', evidence: 'Dettaglio sintetico', ...source(bindings.item) }] }],
        },
    });
}

test('builds the Smart Import prompt from only the typed clinical projection fields', () => {
    const prompt = buildPatientSmartImportCapabilityPrompt(projection);
    const payload = JSON.parse(prompt.split('CONTESTO STRUTTURATO:\n')[1] ?? 'null');

    assert.deepEqual(Object.keys(payload), ['currentDiagnoses', 'currentActiveTherapies', 'therapyCandidateHints', 'sources']);
    assert.deepEqual(payload.sources, projection.sources);
    for (const forbidden of ['patientRef', 'selectionEpoch', 'patientRevision', 'sourceRevision', 'capturedAt', 'sessionRef', 'handle', 'model', 'endpoint', 'fabric']) {
        assert.equal(Object.hasOwn(payload, forbidden), false);
    }
    assert.equal(prompt.includes(projection.patientRef), false);
});

test('returns a detached deep-frozen review-only proposal without raw provider material', () => {
    const proposal = parsePatientSmartImportCapabilityProposal(responseWithBindings(), projection, '2026-08-22T09:00:01.000Z');

    assert.equal(proposal.schemaVersion, 'mediflow.smart-import.proposal.v1');
    assert.equal(proposal.writesPerformed, 0);
    assert.equal(proposal.servicePrescriptions[0]?.items?.[0]?.sourceId, sourceId);
    assert.equal(Object.isFrozen(proposal), true);
    assert.equal(Object.isFrozen(proposal.servicePrescriptions), true);
    assert.equal(Object.isFrozen(proposal.servicePrescriptions[0]?.items), true);
    assert.equal(JSON.stringify(proposal).includes('raw-provider-marker'), false);
    assert.equal('rawJson' in proposal, false);
});

test('fails closed when any suggestion source is missing or not projection-bound', () => {
    const unbound = 'source.synthetic.unbound';
    const cases = [
        { diagnosis: null }, { diagnosis: unbound },
        { therapy: null }, { therapy: unbound },
        { prescription: null }, { prescription: unbound },
        { item: null }, { item: unbound },
    ];
    for (const bindings of cases) {
        assert.throws(
            () => parsePatientSmartImportCapabilityProposal(responseWithBindings(bindings), projection, '2026-08-22T09:00:01.000Z'),
            (error) => error instanceof PatientSmartImportCapabilityError
                && error.code === 'source_binding_invalid'
                && !error.message.includes('raw-provider-marker'),
        );
    }
});

test('uses fixed PHI-safe errors for invalid provider output and host inputs', () => {
    assert.throws(
        () => parsePatientSmartImportCapabilityProposal('raw-provider-marker', projection, '2026-08-22T09:00:01.000Z'),
        (error) => error instanceof PatientSmartImportCapabilityError
            && error.code === 'provider_output_invalid'
            && error.message === 'Patient Smart Import capability rejected: provider_output_invalid',
    );
    assert.throws(
        () => parsePatientSmartImportCapabilityProposal(responseWithBindings(), projection, 'not-an-iso-timestamp'),
        (error) => error instanceof PatientSmartImportCapabilityError && error.code === 'prompt_input_invalid',
    );
    const throwingProjection = Object.defineProperty({}, 'currentDiagnoses', {
        get: () => { throw new Error('raw-projection-marker'); },
    }) as SmartImportProjection;
    assert.throws(
        () => buildPatientSmartImportCapabilityPrompt(throwingProjection),
        (error) => error instanceof PatientSmartImportCapabilityError
            && error.code === 'prompt_input_invalid'
            && !error.message.includes('raw-projection-marker'),
    );
});
