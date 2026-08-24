/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TreatmentReasoningAthenaExecutionConfigurationError, createTreatmentReasoningAthenaExecution } from './treatment-reasoning-athena-execution.ts';

const MODEL = 'mims-harvard/ATHENA-R1-Qwen3-8B';
const refs = () => ['evidence.synthetic.alpha', 'evidence.synthetic.beta'];
const preview = () => Object.freeze({ schema: 'mediflow.ai.treatment-reasoning-preview-envelope.v1', capability: 'treatment_reasoning', stage: 'preview', review: 'required', uncertainty: Object.freeze({ level: 'low', source: 'degraded_default' }), evidence: Object.freeze({ source: 'host_minimized', count: 2 }), provenanceRef: 'provenance_synthetic_01', receiptRef: 'receipt_synthetic_01' });
const input = () => ({ preview: preview(), evidenceRefs: refs() });
const policy = (extra: Record<string, unknown> = {}) => ({ provider: 'athena_mlx', venue: 'local_process', credentialClass: 'local_model', model: MODEL, receiptRef: 'receipt_synthetic_01', provenanceRef: 'provenance_synthetic_01', ...extra });
const output = (extra: Record<string, unknown> = {}) => ({ schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary: 'Synthetic review summary.', data: { recommendation: 'Review the bounded evidence before a clinical decision.', keyEvidence: [{ id: 'evidence.synthetic.finding', statement: 'Synthetic source-bound evidence.', evidenceRefs: ['evidence.synthetic.alpha'] }], reasoning: ['The evidence needs clinician review.'], caveats: ['Synthetic fixture; not a prescription.'], safetyFlags: [{ id: 'safety.synthetic.flag', severity: 'caution', label: 'Review required', rationale: 'The outcome remains review-only.', evidenceRefs: ['evidence.synthetic.beta'] }], suggestedActions: [{ id: 'action.synthetic.review', intent: 'review_only', label: 'Review evidence', rationale: 'No clinical write is permitted.', writePolicy: 'review_only', evidenceRefs: ['evidence.synthetic.alpha'] }], trace: { mode: 'local_model', toolsUsed: ['tool.synthetic.local'], limitations: ['No external lookup.'] } }, sourceBindings: [{ claimPath: 'summary', claim: 'Synthetic review summary.', evidenceRefs: ['evidence.synthetic.alpha'] }, { claimPath: 'data.recommendation', claim: 'Review the bounded evidence before a clinical decision.', evidenceRefs: ['evidence.synthetic.alpha'] }, { claimPath: 'data.reasoning.0', claim: 'The evidence needs clinician review.', evidenceRefs: ['evidence.synthetic.alpha'] }, { claimPath: 'data.caveats.0', claim: 'Synthetic fixture; not a prescription.', evidenceRefs: ['evidence.synthetic.beta'] }], ...extra });
const service = (invoke: (value: Readonly<{ instruction: string; signal: AbortSignal }>) => unknown, host = () => policy(), timeoutMs = 20) => createTreatmentReasoningAthenaExecution({ host: { policy: host, invoke }, timeoutMs });
type Result = Awaited<ReturnType<ReturnType<typeof service>['execute']>>;
const denied = (result: Result, code: string) => { assert.equal(result.status, 'denied'); assert.equal(result.code, code); assert.equal(result.envelope, null); assert.equal(result.sourceBindings, null); assert.equal(result.host, null); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); assert.equal(result.fallback, 'denied_by_contract'); };

test('runs exactly once as fixed local ATHENA and returns the canonical source-bound review envelope', async () => {
    const source = readFileSync(new URL('./treatment-reasoning-athena-execution.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u); assert.match(source, /createTreatmentReasoningAthenaOutputContract/u); assert.doesNotMatch(source, /(?:structuredClone|fetch\(|AIService|https?:\/\/)/u);
    let policyCalls = 0; let calls = 0;
    const result = await service(({ instruction, signal }) => { calls += 1; assert.equal(signal.aborted, false); assert.match(instruction, /evidence_refs=evidence\.synthetic\.alpha,evidence\.synthetic\.beta/u); return output(); }, () => { policyCalls += 1; return policy(); }).execute(input());
    assert.equal(policyCalls, 1); assert.equal(calls, 1); assert.equal(result.status, 'completed');
    if (result.status === 'completed') { assert.equal(result.envelope.schemaVersion, 'mediflow.treatment_reasoning.v1'); assert.deepEqual(result.sourceBindings.map((item) => item.claimPath), ['summary', 'data.recommendation', 'data.reasoning.0', 'data.caveats.0']); assert.deepEqual(result.host, policy()); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); assert.equal(result.fallback, 'denied_by_contract'); assert.equal(Object.isFrozen(result), true); }
});

test('denies malformed or hostile input and host drift before invocation', async () => {
    const hostilePreview: Record<string, unknown> = { ...preview() }; Object.defineProperty(hostilePreview, 'receiptRef', { enumerable: true, get: () => 'receipt_synthetic_01' }); Object.freeze(hostilePreview);
    const accessor = { preview: hostilePreview, evidenceRefs: refs() };
    const sparse = input(); delete sparse.evidenceRefs[1];
    const trapped = new Proxy(input(), { get() { throw new Error('must not read'); }, getPrototypeOf() { throw new Error('must not inspect'); }, ownKeys() { throw new Error('must not enumerate'); } });
    for (const value of [accessor, sparse, trapped, { ...input(), prompt: 'free prompt' }, { ...input(), route: '/api' }]) { let calls = 0; denied(await service(() => { calls += 1; return output(); }).execute(value), 'input_invalid'); assert.equal(calls, 0); }
    for (const drift of [policy({ provider: 'ollama' }), policy({ venue: 'cloud' }), policy({ credentialClass: 'subscription' }), policy({ model: 'other' }), policy({ receiptRef: 'receipt_other' }), { ...policy(), apply: true }]) { let calls = 0; denied(await service(() => { calls += 1; return output(); }, () => drift).execute(input()), 'host_invalid'); assert.equal(calls, 0); }
});

test('validates the provider result after its one invocation and rejects metadata, authority, and source-binding drift', async () => {
    const unknownEvidence = output(); unknownEvidence.data.keyEvidence[0].evidenceRefs = ['evidence.synthetic.unknown'];
    for (const value of [unknownEvidence, { ...output(), provider: 'athena_mlx' }, { ...output(), receiptRef: 'receipt_synthetic_01' }, { ...output(), apply: true }, { ...output(), data: { ...output().data, suggestedActions: [{ ...output().data.suggestedActions[0], writePolicy: 'apply' }] } }]) { let calls = 0; denied(await service(() => { calls += 1; return value; }).execute(input()), 'provider_invalid'); assert.equal(calls, 1); }
    assert.throws(() => createTreatmentReasoningAthenaExecution({ host: { policy: () => policy() }, timeoutMs: 20 }), TreatmentReasoningAthenaExecutionConfigurationError);
});

test('aborts on timeout, discards late completion, and does not retry or fall back', async () => {
    let calls = 0; let aborted = false;
    const result = await service(({ signal }) => new Promise((resolve) => { calls += 1; signal.addEventListener('abort', () => { aborted = true; }); setTimeout(() => resolve(output()), 40); }), () => policy(), 10).execute(input());
    denied(result, 'execution_timeout'); assert.equal(calls, 1); assert.equal(aborted, true);
    calls = 0; denied(await service(() => { calls += 1; throw new Error('synthetic provider failure'); }).execute(input()), 'provider_failed'); assert.equal(calls, 1);
});
