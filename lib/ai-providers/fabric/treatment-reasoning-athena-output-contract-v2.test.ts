/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTreatmentReasoningAthenaOutputContractV2 } from './treatment-reasoning-athena-output-contract-v2';

const refs = () => ['evidence.synthetic.alpha', 'evidence.synthetic.beta'];
const attestation = () => ({ schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1', readiness: 'available_unqualified', provider: 'athena_mlx', venue: 'local_process', egress: 'none', receiptRef: 'receipt.synthetic.01', provenanceRef: 'provenance.synthetic.01' });
const bindings = () => [
    { claimPath: 'summary', claim: 'Synthetic review summary.', evidenceRefs: ['evidence.synthetic.alpha'] },
    { claimPath: 'data.recommendation', claim: 'Review the bounded evidence before a clinical decision.', evidenceRefs: ['evidence.synthetic.alpha'] },
    { claimPath: 'data.reasoning.0', claim: 'Evidence needs clinician review.', evidenceRefs: ['evidence.synthetic.alpha'] },
    { claimPath: 'data.caveats.0', claim: 'Synthetic fixture; not a prescription.', evidenceRefs: ['evidence.synthetic.beta'] },
];
const output = (extra: Record<string, unknown> = {}) => ({
    schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary: 'Synthetic review summary.',
    data: { recommendation: 'Review the bounded evidence before a clinical decision.', keyEvidence: [{ id: 'evidence.synthetic.finding', statement: 'Synthetic source-bound evidence.', evidenceRefs: ['evidence.synthetic.alpha'] }], reasoning: ['Evidence needs clinician review.'], caveats: ['Synthetic fixture; not a prescription.'], safetyFlags: [{ id: 'safety.synthetic.flag', severity: 'caution', label: 'Review required', rationale: 'The outcome remains review-only.', evidenceRefs: ['evidence.synthetic.beta'] }], suggestedActions: [{ id: 'action.synthetic.review', intent: 'review_only', label: 'Review evidence', rationale: 'No clinical write is permitted.', writePolicy: 'review_only', evidenceRefs: ['evidence.synthetic.alpha'] }], trace: { mode: 'local_model', toolsUsed: ['tool.synthetic.local'], limitations: ['No external lookup.'] } },
    sourceBindings: bindings(), ...extra,
});
const contract = () => createTreatmentReasoningAthenaOutputContractV2({ allowedEvidenceRefs: refs(), attestation: attestation() });
const denied = (value: unknown) => assert.deepEqual(contract().normalize(value), { status: 'denied', code: 'output_invalid', value: null, sourceBindings: null, attestation: null, writesPerformed: 0, applyPolicy: 'none' });

test('normalizes the distinct v2 source-bound review-only result and host attestation', () => {
    const result = contract().normalize(output());
    assert.equal(result.status, 'accepted');
    if (result.status === 'accepted') {
        assert.equal(result.resultSchema, 'mediflow.ai.treatment-reasoning-athena-output-result.v2');
        assert.deepEqual(result.sourceBindings, bindings());
        assert.deepEqual(result.attestation, attestation());
        assert.equal(result.writesPerformed, 0);
        assert.equal(result.applyPolicy, 'none');
        assert.equal(Object.isFrozen(result.value), true);
        assert.equal(Object.isFrozen(result.sourceBindings), true);
        assert.equal(Object.isFrozen(result.attestation), true);
    }
});

test('rejects forged payload authority and provenance fields; only the host mints attestation', () => {
    for (const key of ['identity', 'freePrompt', 'prompt', 'rawPrompt', 'provider', 'venue', 'egress', 'readiness', 'authority', 'apply', 'applyPolicy', 'writesPerformed', 'attestation', 'sourceBinding'] as const) {
        denied({ ...output(), [key]: key === 'apply' ? true : 'forged.synthetic' });
    }
    for (const forged of [
        { allowedEvidenceRefs: refs(), attestation: { ...attestation(), provider: 'forged' } },
        { allowedEvidenceRefs: refs(), attestation: { ...attestation(), egress: 'cloud' } },
        { allowedEvidenceRefs: refs(), attestation: { ...attestation(), readiness: 'ready' } },
        { allowedEvidenceRefs: refs(), attestation: { ...attestation(), venue: 'remote' } },
    ]) assert.throws(() => createTreatmentReasoningAthenaOutputContractV2(forged));
    let reads = 0;
    let traps = 0;
    const accessor = { allowedEvidenceRefs: refs(), attestation: attestation() };
    Object.defineProperty(accessor.attestation, 'provider', { enumerable: true, get() { reads += 1; return 'athena_mlx'; } });
    const proxy = new Proxy({ allowedEvidenceRefs: refs(), attestation: attestation() }, { get() { traps += 1; return undefined; } });
    for (const value of [accessor, proxy]) assert.throws(() => createTreatmentReasoningAthenaOutputContractV2(value));
    assert.equal(reads, 0);
    assert.equal(traps, 0);
});

test('fails closed before proxy traps or accessor reads, including closed source bindings', () => {
    let reads = 0;
    let traps = 0;
    const accessor = output();
    Object.defineProperty(accessor, 'summary', { enumerable: true, get() { reads += 1; return 'must not read'; } });
    const hidden = output();
    Object.defineProperty(hidden, 'summary', { enumerable: false, value: 'hidden' });
    const sparse = output(); delete sparse.sourceBindings[0];
    const symbol = output() as Record<PropertyKey, unknown>; symbol[Symbol('extra')] = true;
    const custom = Object.assign(Object.create({ inherited: true }), output());
    const trapped = new Proxy(output(), { get() { traps += 1; return undefined; }, getPrototypeOf() { traps += 1; return Object.prototype; }, ownKeys() { traps += 1; return []; } });
    const nested = output(); nested.sourceBindings[0] = new Proxy(nested.sourceBindings[0], { get() { traps += 1; return undefined; } });
    for (const value of [accessor, hidden, sparse, symbol, custom, trapped, nested]) denied(value);
    assert.equal(reads, 0);
    assert.equal(traps, 0);
});

test('rejects extra or unbound claims and ignores ambient then poisoning', () => {
    const extra = output(); (extra.data as Record<string, unknown>).authority = 'forged';
    const unbound = output(); unbound.sourceBindings[0].claim = 'different claim';
    for (const value of [extra, unbound]) denied(value);
    let reads = 0;
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { reads += 1; return undefined; } });
    try { assert.equal(contract().normalize(output()).status, 'accepted'); }
    finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});

test('preserves V1 substantive evidence, action, and trace denials', () => {
    const unknownEvidence = output(); unknownEvidence.data.keyEvidence[0].evidenceRefs = ['evidence.synthetic.unknown'];
    const unboundFlag = output(); unboundFlag.data.safetyFlags[0].evidenceRefs = [];
    const badSeverity = output(); badSeverity.data.safetyFlags[0].severity = 'safe';
    const unboundAction = output(); unboundAction.data.suggestedActions[0].evidenceRefs = [];
    const badIntent = output(); badIntent.data.suggestedActions[0].intent = 'apply_now';
    const badPolicy = output(); badPolicy.data.suggestedActions[0].writePolicy = 'apply';
    const remoteTrace = output(); remoteTrace.data.trace.mode = 'remote_model';
    const duplicateEvidence = output(); duplicateEvidence.data.keyEvidence.push({ ...duplicateEvidence.data.keyEvidence[0] });
    for (const value of [unknownEvidence, unboundFlag, badSeverity, unboundAction, badIntent, badPolicy, remoteTrace, duplicateEvidence]) denied(value);
});
