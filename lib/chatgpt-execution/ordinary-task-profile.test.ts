/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDocumentSynthesisOrdinaryTaskProfile,
    createPatientInsightOrdinaryTaskProfile,
    createSmartImportOrdinaryTaskProfile,
    createTreatmentReasoningOrdinaryTaskProfile,
    readOrdinaryTaskProfile,
} from './ordinary-task-profile';
import type { TreatmentReasoningPromptInput } from '../treatment-reasoning-contract';
import { captureDocumentSynthesisSourceSet } from '../ai-providers/fabric/document-synthesis-source-set-contract';

const PI = { schemaVersion: 'mediflow.patient-insight.projection.v1', clinicalFocus: 'Controllo sintetico', activeConditions: ['Ipertensione'], currentTherapies: ['Farmaco sintetico'], recentClinicalEvents: ['Nessun evento'] } as const;
const SI = { schemaVersion: 'mediflow.smart-import.projection.v1', capability: 'smart_import', patientRef: 'patient_synthetic', selectionEpoch: 1, patientRevision: 1, sourceRevision: 1, capturedAt: '2026-09-12T10:00:00.000Z', currentDiagnoses: [], currentActiveTherapies: [], therapyCandidateHints: [], sources: [{ id: 'source_synthetic', kind: 'clinical-entry', label: 'Fonte sintetica', date: null, content: 'Testo sintetico' }] } as const;
const TR: TreatmentReasoningPromptInput = { question: 'Quale revisione e necessaria?', patientContext: 'Contesto sintetico.', sources: [{ id: 'source_synthetic', sourceKind: 'clinical-entry', label: 'Nota sintetica', excerpt: 'Dato sintetico' }] };

function documentSources() {
    const captured = captureDocumentSynthesisSourceSet({ sources: [{ documentSourceRef: 'doc-synthetic', documentRevision: BigInt(1), documentFreshnessEpoch: BigInt(1), sourceText: 'Documento sintetico.' }], sourceSetEpoch: BigInt(1), revocationGeneration: BigInt(1) });
    assert.equal(captured.status, 'available');
    return captured.sourceSet;
}
function trOutput() {
    return JSON.stringify({ schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary: 'Revisione richiesta.',
        data: { recommendation: 'Rivedere le fonti.', keyEvidence: [], reasoning: [], caveats: [], safetyFlags: [], suggestedActions: [], trace: { mode: 'chatgpt_subscription', toolsUsed: [], limitations: [] } },
        sourceBindings: [{ claimPath: 'summary', claim: 'Revisione richiesta.', evidenceRefs: ['source_synthetic'] }, { claimPath: 'data.recommendation', claim: 'Rivedere le fonti.', evidenceRefs: ['source_synthetic'] }] });
}

function piOutput(task = 'patient_insight') { return JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task, summary: 'Quadro stabile [S1]', data: { currentState: ['Stabile [S1]'], alerts: [], nextSteps: [], gaps: [] } }); }
function siOutput(task = 'smart_import') { return JSON.stringify({ schemaVersion: 'mediflow.ai.extract.v1', task, summary: 'Nessuna proposta', data: { diagnoses: [], therapies: [], servicePrescriptions: [] } }); }
function dsOutput(task = 'document_synthesis') { return JSON.stringify({ schemaVersion: 'mediflow.document-synthesis.provider-envelope.v2', output: { schemaVersion: 'mediflow.ai.extract.v1', task, summary: 'Sintesi sintetica', data: { qualityLevel: 'yellow', medications: [], diagnoses: [], problemStatements: [], therapyCandidates: [], servicePrescriptions: [] } }, citations: [{ label: 'S1', quote: 'Documento sintetico.' }], claims: [{ claimPath: 'summary', labels: ['S1'] }, { claimPath: 'data.qualityLevel', labels: ['S1'] }] }); }

test('four ordinary profiles preserve their canonical complete outputs', () => {
    const profiles = [
        [createPatientInsightOrdinaryTaskProfile(PI), piOutput(), 'patient_insight', (value: unknown) => assert.equal((value as { task: string }).task, 'patient_insight')],
        [createSmartImportOrdinaryTaskProfile({ projection: SI, generatedAt: '2026-09-12T10:00:00.000Z' }), siOutput(), 'smart_import', (value: unknown) => assert.equal((value as { schemaVersion: string }).schemaVersion, 'mediflow.smart-import.proposal.v1')],
        [createDocumentSynthesisOrdinaryTaskProfile(documentSources()), dsOutput(), 'document_synthesis', (value: unknown) => assert.equal((value as { output: { data: { qualityLevel: string } } }).output.data.qualityLevel, 'yellow')],
        [createTreatmentReasoningOrdinaryTaskProfile(TR), trOutput(), 'treatment_reasoning', (value: unknown) => assert.equal((value as { value: { data: { trace: { mode: string } } } }).value.data.trace.mode, 'chatgpt_subscription')],
    ] as const;
    for (const [profile, output, functionId, verify] of profiles) {
        const read = readOrdinaryTaskProfile(profile);
        assert.equal(read.functionId, functionId);
        assert.match(read.prompt, /.+/u);
        assert.match(read.inputSha256, /^sha256_[a-f0-9]{64}$/u);
        assert.ok(read.outputSchema);
        verify(read.parseOutput(output));
    }
});

test('profiles reject wrong function output and forged handles', () => {
    const profile = createPatientInsightOrdinaryTaskProfile(PI);
    assert.throws(() => readOrdinaryTaskProfile(profile).parseOutput(piOutput('smart_import')), /ordinary_task_output_invalid/u);
    assert.throws(() => readOrdinaryTaskProfile(profile).parseOutput('{"task":"patient_insight"}'), /ordinary_task_output_invalid/u);
    assert.throws(() => readOrdinaryTaskProfile({}), /ordinary_task_profile_invalid/u);
});

test('Patient Insight denies a claim that mixes a supported and a foreign source reference', () => {
    const profile = createPatientInsightOrdinaryTaskProfile(PI);
    const output = piOutput().replace('Quadro stabile [S1]', 'Quadro stabile [S1] e inventato [S999]');
    assert.throws(() => readOrdinaryTaskProfile(profile).parseOutput(output), /ordinary_task_output_invalid/u);
});

test('source-bound Document Synthesis and Treatment Reasoning reject foreign sources and wrong output', () => {
    const ds = readOrdinaryTaskProfile(createDocumentSynthesisOrdinaryTaskProfile(documentSources()));
    const tr = readOrdinaryTaskProfile(createTreatmentReasoningOrdinaryTaskProfile(TR));
    for (const invalid of [piOutput(), dsOutput('smart_import'), dsOutput().replace('Documento sintetico.', 'Inventato'), dsOutput().replace('"schemaVersion":', '"extra":1,"extra":2,"schemaVersion":')]) {
        assert.throws(() => ds.parseOutput(invalid), /ordinary_task_output_invalid/u);
    }
    for (const invalid of [piOutput(), trOutput().replaceAll('source_synthetic', 'source_foreign'), trOutput().replace('chatgpt_subscription', 'local_model')]) {
        assert.throws(() => tr.parseOutput(invalid), /ordinary_task_output_invalid/u);
    }
    assert.throws(() => createDocumentSynthesisOrdinaryTaskProfile({ ...documentSources() }), /ordinary_task_input_invalid/u);
    const si = readOrdinaryTaskProfile(createSmartImportOrdinaryTaskProfile({ projection: SI, generatedAt: SI.capturedAt }));
    assert.throws(() => si.parseOutput(piOutput()), /ordinary_task_output_invalid/u);
});

// Generation-only transport encoding maps optional null back to absence. It
// never repairs a required field or bypasses the canonical source validators.
test('nullable optional wire fields preserve absence while required null and foreign claims remain denied', () => {
    const ds = readOrdinaryTaskProfile(createDocumentSynthesisOrdinaryTaskProfile(documentSources()));
    const value = JSON.parse(dsOutput()); value.output.data.qualityReason = null;
    assert.doesNotThrow(() => ds.parseOutput(JSON.stringify(value)));
    value.output.summary = null;
    assert.throws(() => ds.parseOutput(JSON.stringify(value)), /ordinary_task_output_invalid/u);
    const inputs = [createPatientInsightOrdinaryTaskProfile(PI), createSmartImportOrdinaryTaskProfile({ projection: SI, generatedAt: SI.capturedAt }), createDocumentSynthesisOrdinaryTaskProfile(documentSources()), createTreatmentReasoningOrdinaryTaskProfile(TR)];
    function check(value: Record<string, unknown>) {
        if (value.type === 'object') {
            assert.equal(value.additionalProperties, false);
            assert.deepEqual(value.required, Object.keys(value.properties as object));
            Object.values(value.properties as Record<string, Record<string, unknown>>).forEach(check);
        }
        if (value.type === 'array') check(value.items as Record<string, unknown>);
        if (value.anyOf) (value.anyOf as Record<string, unknown>[]).forEach(check);
        assert.ok(Object.isFrozen(value));
    }
    for (const input of inputs) check(readOrdinaryTaskProfile(input).outputSchema);
});

test('input mutation cannot change captured prompt or hash', () => {
    const input = { ...PI, activeConditions: ['Ipertensione'] };
    const profile = createPatientInsightOrdinaryTaskProfile(input);
    const before = readOrdinaryTaskProfile(profile);
    input.activeConditions[0] = 'Mutato';
    const after = readOrdinaryTaskProfile(profile);
    assert.equal(after.prompt, before.prompt);
    assert.equal(after.inputSha256, before.inputSha256);
});

test('profiles deny getters, proxies, unsafe scalars and bounded snapshot overflow', () => {
    const factories = [
        () => createPatientInsightOrdinaryTaskProfile(PI),
        () => createSmartImportOrdinaryTaskProfile({ projection: SI, generatedAt: '2026-09-12T10:00:00.000Z' }),
        () => createDocumentSynthesisOrdinaryTaskProfile(documentSources()),
    ];
    for (const factory of factories) assert.doesNotThrow(factory);
    const getter = { ...PI }; Object.defineProperty(getter, 'clinicalFocus', { enumerable: true, get: () => 'Mai letto' });
    assert.throws(() => createPatientInsightOrdinaryTaskProfile(getter), /ordinary_task_input_invalid/u);
    assert.throws(() => createPatientInsightOrdinaryTaskProfile(new Proxy(PI, {})), /ordinary_task_input_invalid/u);
    assert.throws(() => createDocumentSynthesisOrdinaryTaskProfile({ rawText: 'x'.repeat(400_001) }), /ordinary_task_input_invalid/u);
    assert.throws(() => createTreatmentReasoningOrdinaryTaskProfile({ ...TR, patientContext: 'x'.repeat(400_001) }), /ordinary_task_input_invalid/u);
    assert.throws(() => createSmartImportOrdinaryTaskProfile({ projection: { ...SI, sources: [] }, generatedAt: SI.capturedAt }), /ordinary_task_input_invalid/u);
    assert.throws(() => createPatientInsightOrdinaryTaskProfile({ ...PI, selection: BigInt(1) } as unknown as typeof PI), /ordinary_task_input_invalid/u);
    assert.throws(() => createPatientInsightOrdinaryTaskProfile({ ...PI, activeConditions: [Number.NaN] } as unknown as typeof PI), /ordinary_task_input_invalid/u);
});
