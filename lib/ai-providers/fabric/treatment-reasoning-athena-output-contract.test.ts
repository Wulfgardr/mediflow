/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createTreatmentReasoningAthenaOutputContract } from './treatment-reasoning-athena-output-contract';

const refs = () => ['evidence.synthetic.alpha', 'evidence.synthetic.beta'];
const sourceBindings = () => [
    { claimPath: 'summary', claim: 'Synthetic review summary.', evidenceRefs: ['evidence.synthetic.alpha'] },
    { claimPath: 'data.recommendation', claim: 'Review the bounded evidence before a clinical decision.', evidenceRefs: ['evidence.synthetic.alpha'] },
    { claimPath: 'data.reasoning.0', claim: 'The evidence needs clinician review.', evidenceRefs: ['evidence.synthetic.alpha'] },
    { claimPath: 'data.caveats.0', claim: 'Synthetic fixture; not a prescription.', evidenceRefs: ['evidence.synthetic.beta'] },
];
const output = (extra: Record<string, unknown> = {}) => ({
    schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary: 'Synthetic review summary.',
    data: {
        recommendation: 'Review the bounded evidence before a clinical decision.',
        keyEvidence: [{ id: 'evidence.synthetic.finding', statement: 'Synthetic source-bound evidence.', evidenceRefs: ['evidence.synthetic.alpha'] }],
        reasoning: ['The evidence needs clinician review.'], caveats: ['Synthetic fixture; not a prescription.'],
        safetyFlags: [{ id: 'safety.synthetic.flag', severity: 'caution', label: 'Review required', rationale: 'The outcome remains review-only.', evidenceRefs: ['evidence.synthetic.beta'] }],
        suggestedActions: [{ id: 'action.synthetic.review', intent: 'review_only', label: 'Review evidence', rationale: 'No clinical write is permitted.', writePolicy: 'review_only', evidenceRefs: ['evidence.synthetic.alpha'] }],
        trace: { mode: 'local_model', toolsUsed: ['tool.synthetic.local'], limitations: ['No external lookup.'] },
    },
    sourceBindings: sourceBindings(),
    ...extra,
});
const contract = () => createTreatmentReasoningAthenaOutputContract({ allowedEvidenceRefs: refs() });
const denied = (value: unknown) => assert.deepEqual(contract().normalize(value), {
    status: 'denied', code: 'output_invalid', value: null, writesPerformed: 0, applyPolicy: 'none',
});

test('is server-only and normalizes the canonical minimized review-only output', () => {
    const source = readFileSync(new URL('./treatment-reasoning-athena-output-contract.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u);
    assert.doesNotMatch(source, /(?:fetch\(|AIService|https?:\/\/|invoke\()/u);
    const result = contract().normalize(output());
    assert.equal(result.status, 'accepted');
    if (result.status === 'accepted') {
        assert.equal(result.value.schemaVersion, 'mediflow.treatment_reasoning.v1');
        assert.equal(result.value.data.trace.model, undefined);
        assert.deepEqual(result.sourceBindings, sourceBindings());
        assert.equal(result.writesPerformed, 0);
        assert.equal(result.applyPolicy, 'none');
        assert.equal(Object.isFrozen(result.value), true);
        assert.equal(Object.isFrozen(result.value.data.keyEvidence), true);
        assert.equal(Object.isFrozen(result.sourceBindings), true);
        assert.equal(Object.isFrozen(result.sourceBindings[0]), true);
        assert.equal(Object.isFrozen(result.sourceBindings[0].evidenceRefs), true);
    }
});

test('binds every evidence-bearing statement, flag, and action to the request allowlist', () => {
    const unknownEvidence = output();
    unknownEvidence.data.keyEvidence[0].evidenceRefs = ['evidence.synthetic.unknown'];
    const unboundFlag = output();
    unboundFlag.data.safetyFlags[0].evidenceRefs = [];
    const unboundAction = output();
    unboundAction.data.suggestedActions[0].evidenceRefs = [];
    for (const value of [unknownEvidence, unboundFlag, unboundAction]) denied(value);
});

test('rejects substantive provider claims without explicit source bindings', () => {
    const summary = output();
    summary.summary = 'Unsupported synthetic claim without an evidence binding.';
    const recommendation = output();
    recommendation.data.recommendation = 'Unbound synthetic recommendation.';
    const reasoning = output();
    reasoning.data.reasoning[0] = 'Unbound synthetic reasoning.';
    const caveat = output();
    caveat.data.caveats[0] = 'Unbound synthetic caveat.';
    for (const value of [summary, recommendation, reasoning, caveat]) denied(value);
});

test('requires one exact allowlisted binding for every substantive claim', () => {
    const missing = output();
    missing.sourceBindings.pop();
    const unknown = output();
    unknown.sourceBindings[0].claimPath = 'data.unknown';
    const duplicate = output();
    duplicate.sourceBindings[3] = { ...duplicate.sourceBindings[2] };
    const extra = output();
    extra.sourceBindings.push({ claimPath: 'data.reasoning.1', claim: 'Count drift.', evidenceRefs: ['evidence.synthetic.alpha'] });
    const empty = output();
    empty.sourceBindings[0].evidenceRefs = [];
    const unknownRef = output();
    unknownRef.sourceBindings[0].evidenceRefs = ['evidence.synthetic.unknown'];
    const duplicateRef = output();
    duplicateRef.sourceBindings[0].evidenceRefs = ['evidence.synthetic.alpha', 'evidence.synthetic.alpha'];
    for (const value of [missing, unknown, duplicate, extra, empty, unknownRef, duplicateRef]) denied(value);
});

test('rejects claim paths that drift from the exact canonical spelling', () => {
    const driftedPaths = [
        ' summary', 'summary ', 'summary\n', 'Summary', 'data/recommendation',
        'data.reasoning[0]', 'data.reasoning.00', 'data.caveats.0\u0000',
    ];
    for (const claimPath of driftedPaths) {
        const value = output();
        value.sourceBindings[0].claimPath = claimPath;
        denied(value);
    }
});

test('accepts complete bindings in any input order and emits canonical frozen order', () => {
    const value = output();
    value.sourceBindings = [value.sourceBindings[3], value.sourceBindings[1], value.sourceBindings[0], value.sourceBindings[2]];
    const result = contract().normalize(value);
    assert.equal(result.status, 'accepted');
    if (result.status === 'accepted') {
        assert.deepEqual(result.sourceBindings, sourceBindings());
        assert.equal(Object.isFrozen(result.sourceBindings), true);
        assert.equal(Object.isFrozen(result.sourceBindings[0]), true);
    }
});

test('rejects hostile source bindings without reading accessors or proxy traps', () => {
    let reads = 0;
    let traps = 0;
    const accessor = output();
    Object.defineProperty(accessor.sourceBindings[0], 'claim', { enumerable: true, get() { reads += 1; return 'Synthetic review summary.'; } });
    const bindingProxy = output();
    bindingProxy.sourceBindings[0] = new Proxy(bindingProxy.sourceBindings[0], {
        get() { traps += 1; return undefined; }, getPrototypeOf() { traps += 1; return Object.prototype; }, ownKeys() { traps += 1; return []; },
    });
    const arrayProxy = output();
    arrayProxy.sourceBindings = new Proxy(arrayProxy.sourceBindings, {
        get() { traps += 1; return undefined; }, getPrototypeOf() { traps += 1; return Array.prototype; }, ownKeys() { traps += 1; return []; },
    });
    const hidden = output();
    Object.defineProperty(hidden.sourceBindings[0], 'claim', { enumerable: false, value: 'Synthetic review summary.' });
    const sparse = output();
    delete sparse.sourceBindings[0];
    for (const value of [accessor, bindingProxy, arrayProxy, hidden, sparse]) denied(value);
    assert.equal(reads, 0);
    assert.equal(traps, 0);
});

test('rejects hostile closed records without reading accessors, proxies, or ambient then', () => {
    const accessor = output();
    Object.defineProperty(accessor.data, 'recommendation', { enumerable: true, get() { throw new Error('must not read'); } });
    const hidden = output();
    Object.defineProperty(hidden.data, 'recommendation', { enumerable: false, value: 'hidden' });
    const sparse = output();
    delete sparse.data.reasoning[0];
    const symbol = output() as Record<PropertyKey, unknown>;
    symbol[Symbol('extra')] = true;
    const custom = Object.assign(Object.create({ inherited: true }), output());
    const trapped = new Proxy(output(), { get() { throw new Error('trap'); }, getPrototypeOf() { throw new Error('trap'); }, ownKeys() { throw new Error('trap'); } });
    const nestedProxy = output();
    nestedProxy.data.keyEvidence[0] = new Proxy(nestedProxy.data.keyEvidence[0], {});
    const nestedAccessor = output();
    Object.defineProperty(nestedAccessor.data.trace, 'mode', { enumerable: true, get() { throw new Error('must not read'); } });
    const revocable = Proxy.revocable(output(), {});
    revocable.revoke();
    for (const value of [accessor, hidden, sparse, symbol, custom, trapped, nestedProxy, nestedAccessor, revocable.proxy]) denied(value);
    let reads = 0;
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { reads += 1; return undefined; } });
    try { assert.equal(contract().normalize(output()).status, 'accepted'); }
    finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});

test('rejects oversize, noncanonical records, and caller-controlled host metadata', () => {
    const oversize = output();
    oversize.data.reasoning = Array.from({ length: 9 }, () => 'bounded string') as never;
    const duplicate = output();
    duplicate.data.keyEvidence = [duplicate.data.keyEvidence[0], { ...duplicate.data.keyEvidence[0] }] as never;
    const cases = [
        oversize, duplicate, { ...output(), prompt: 'free prompt' }, { ...output(), rawPrompt: 'raw prompt' },
        { ...output(), patientRef: 'patient.synthetic.01' }, { ...output(), identity: 'synthetic identity' },
        { ...output(), authority: 'physician' }, { ...output(), egress: 'cloud' }, { ...output(), apply: true },
        { ...output(), provider: 'athena_mlx' }, { ...output(), model: 'forged' }, { ...output(), venue: 'local_process' },
        { ...output(), receiptRef: 'receipt.synthetic' }, { ...output(), provenanceRef: 'provenance.synthetic' },
        { ...output(), writesPerformed: 1 }, { ...output(), applyPolicy: 'apply' },
        { ...output(), data: { ...output().data, trace: { ...output().data.trace, model: 'forged' } } },
        { ...output(), data: { ...output().data, suggestedActions: [{ ...output().data.suggestedActions[0], prefill: { identity: 'forbidden' } }] } },
    ];
    for (const value of cases) denied(value);
});

test('rejects hostile configuration and freezes a private allowlist snapshot', () => {
    assert.throws(() => createTreatmentReasoningAthenaOutputContract({ allowedEvidenceRefs: ['evidence.synthetic.alpha', 'evidence.synthetic.alpha'] }));
    const allowed = refs();
    const service = createTreatmentReasoningAthenaOutputContract({ allowedEvidenceRefs: allowed });
    allowed[0] = 'evidence.synthetic.changed';
    assert.equal(service.normalize(output()).status, 'accepted');
    denied({ ...output(), data: { ...output().data, keyEvidence: [{ ...output().data.keyEvidence[0], evidenceRefs: ['evidence.synthetic.changed'] }] } });
});
