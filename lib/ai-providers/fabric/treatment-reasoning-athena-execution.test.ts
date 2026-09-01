/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TreatmentReasoningAthenaExecutionConfigurationError, createTreatmentReasoningAthenaExecution } from './treatment-reasoning-athena-execution.ts';

const MODEL = 'mims-harvard/ATHENA-R1-Qwen3-8B';
const refs = () => ['therapy:therapy.synthetic.alpha', 'entry:entry.synthetic.beta'];
const preview = () => Object.freeze({ schema: 'mediflow.ai.treatment-reasoning-preview-envelope.v1', capability: 'treatment_reasoning', stage: 'preview', review: 'required', uncertainty: Object.freeze({ level: 'low', source: 'degraded_default' }), evidence: Object.freeze({ source: 'host_minimized', count: 2 }), provenanceRef: 'provenance_synthetic_01', receiptRef: 'receipt_synthetic_01' });
const projection = () => Object.freeze({
    schemaVersion: 'mediflow.ai.treatment-reasoning-projection-attachment.v1', capability: 'treatment_reasoning', patientRevision: 7,
    sourceRevision: 'source_synthetic_01', capturedAt: '2026-09-01T10:00:00.000Z', therapyRefs: Object.freeze(['therapy:therapy.synthetic.alpha']),
    evidenceRefs: Object.freeze(refs()), sources: Object.freeze([
        Object.freeze({ id: 'therapy:therapy.synthetic.alpha', sourceKind: 'therapy', label: 'Terapia sintetica', excerpt: 'Farmaco sintetico 5 mg.', date: '2026-09-01T09:00:00.000Z' }),
        Object.freeze({ id: 'entry:entry.synthetic.beta', sourceKind: 'clinical-entry', label: 'Nota sintetica', excerpt: 'Controllare il parametro sintetico.', date: null }),
    ]),
});
const input = () => ({ preview: preview(), evidenceRefs: refs(), projection: projection() });
const policy = (extra: Record<string, unknown> = {}) => ({ readiness: 'available_unqualified', provider: 'athena_mlx', venue: 'local_process', egress: 'none', credentialClass: 'local_model', model: MODEL, receiptRef: 'receipt_synthetic_01', provenanceRef: 'provenance_synthetic_01', ...extra });
const output = (extra: Record<string, unknown> = {}) => ({ schemaVersion: 'mediflow.treatment_reasoning.v1', task: 'treatment_reasoning', summary: 'Synthetic review summary.', data: { recommendation: 'Review the bounded evidence before a clinical decision.', keyEvidence: [{ id: 'evidence.synthetic.finding', statement: 'Synthetic source-bound evidence.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] }], reasoning: ['The evidence needs clinician review.'], caveats: ['Synthetic fixture; not a prescription.'], safetyFlags: [{ id: 'safety.synthetic.flag', severity: 'caution', label: 'Review required', rationale: 'The outcome remains review-only.', evidenceRefs: ['entry:entry.synthetic.beta'] }], suggestedActions: [{ id: 'action.synthetic.review', intent: 'review_only', label: 'Review evidence', rationale: 'No clinical write is permitted.', writePolicy: 'review_only', evidenceRefs: ['therapy:therapy.synthetic.alpha'] }], trace: { mode: 'local_model', toolsUsed: ['tool.synthetic.local'], limitations: ['No external lookup.'] } }, sourceBindings: [{ claimPath: 'summary', claim: 'Synthetic review summary.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] }, { claimPath: 'data.recommendation', claim: 'Review the bounded evidence before a clinical decision.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] }, { claimPath: 'data.reasoning.0', claim: 'The evidence needs clinician review.', evidenceRefs: ['therapy:therapy.synthetic.alpha'] }, { claimPath: 'data.caveats.0', claim: 'Synthetic fixture; not a prescription.', evidenceRefs: ['entry:entry.synthetic.beta'] }], ...extra });
const service = (invoke: (value: Readonly<{ instruction: string; signal: Readonly<{ isAborted: () => boolean }> }>) => unknown, host = () => policy(), timeoutMs = 20) => createTreatmentReasoningAthenaExecution({ host: { policy: host, invoke }, timeoutMs });
type Result = Awaited<ReturnType<ReturnType<typeof service>['execute']>>;
const denied = (result: Result, code: string) => { const observed = result as unknown as Record<string, unknown>; assert.equal(result.status, 'denied'); assert.equal(result.code, code); assert.equal(observed.value, null); assert.equal(result.sourceBindings, null); assert.equal(observed.attestation, null); assert.equal('envelope' in observed, false); assert.equal('host' in observed, false); assert.equal('fallback' in observed, false); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); };

test('runs exactly once as fixed local ATHENA and returns the distinct V2 source-bound review result', async () => {
    const source = readFileSync(new URL('./treatment-reasoning-athena-execution.ts', import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';\n/u); assert.match(source, /createTreatmentReasoningAthenaOutputContractV2/u); assert.doesNotMatch(source, /createTreatmentReasoningAthenaOutputContract(?!V2)|fallback/u); assert.doesNotMatch(source, /(?:structuredClone|fetch\(|AIService|https?:\/\/)/u);
    let policyCalls = 0; let calls = 0;
    const result = await service(({ instruction, signal }) => { calls += 1; assert.equal(signal.isAborted(), false); assert.match(instruction, /evidence_refs=therapy:therapy\.synthetic\.alpha,entry:entry\.synthetic\.beta/u); assert.match(instruction, /Farmaco sintetico 5 mg\./u); assert.match(instruction, /source_revision=source_synthetic_01/u); assert.doesNotMatch(instruction, /caller_question|patientId|provider=/u); return JSON.stringify(output()); }, () => { policyCalls += 1; return policy(); }).execute(input());
    assert.equal(policyCalls, 1); assert.equal(calls, 1); assert.equal(result.status, 'completed');
    if (result.status === 'completed') { const observed = result as unknown as Record<string, unknown>; const value = observed.value as { schemaVersion: string }; const attestation = observed.attestation as Record<string, unknown>; assert.equal(observed.resultSchema, 'mediflow.ai.treatment-reasoning-athena-output-result.v2'); assert.equal(value.schemaVersion, 'mediflow.treatment_reasoning.v1'); assert.deepEqual(result.sourceBindings.map((item) => item.claimPath), ['summary', 'data.recommendation', 'data.reasoning.0', 'data.caveats.0']); assert.deepEqual(attestation, { schema: 'mediflow.ai.treatment-reasoning-athena-attestation.v1', readiness: 'available_unqualified', provider: 'athena_mlx', venue: 'local_process', egress: 'none', receiptRef: 'receipt_synthetic_01', provenanceRef: 'provenance_synthetic_01' }); assert.equal('envelope' in observed, false); assert.equal('host' in observed, false); assert.equal('fallback' in observed, false); assert.equal(result.writesPerformed, 0); assert.equal(result.applyPolicy, 'none'); assert.equal(Object.isFrozen(result), true); }
});

test('denies malformed or hostile input and host drift before invocation', async () => {
    const hostilePreview: Record<string, unknown> = { ...preview() }; Object.defineProperty(hostilePreview, 'receiptRef', { enumerable: true, get: () => 'receipt_synthetic_01' }); Object.freeze(hostilePreview);
    const accessor = { preview: hostilePreview, evidenceRefs: refs() };
    const sparse = input(); delete sparse.evidenceRefs[1];
    const trapped = new Proxy(input(), { get() { throw new Error('must not read'); }, getPrototypeOf() { throw new Error('must not inspect'); }, ownKeys() { throw new Error('must not enumerate'); } });
    for (const value of [accessor, sparse, trapped, { ...input(), prompt: 'free prompt' }, { ...input(), route: '/api' }]) { let calls = 0; denied(await service(() => { calls += 1; return output(); }).execute(value), 'input_invalid'); assert.equal(calls, 0); }
    for (const drift of [policy({ readiness: 'ready' }), policy({ provider: 'ollama' }), policy({ venue: 'cloud' }), policy({ egress: 'cloud' }), policy({ credentialClass: 'subscription' }), policy({ model: 'other' }), policy({ receiptRef: 'receipt_other' }), { ...policy(), apply: true }]) { let calls = 0; denied(await service(() => { calls += 1; return output(); }, () => drift).execute(input()), 'host_invalid'); assert.equal(calls, 0); }
});

test('validates the provider result after its one invocation and rejects metadata, authority, and source-binding drift', async () => {
    const unknownEvidence = output(); unknownEvidence.data.keyEvidence[0].evidenceRefs = ['evidence.synthetic.unknown'];
    let thenReads = 0; let traps = 0;
    const thenable = output() as Record<string, unknown>; Object.defineProperty(thenable, 'then', { enumerable: true, get: () => { thenReads += 1; return () => undefined; } });
    const proxy = new Proxy(output(), { get() { traps += 1; throw new Error('must not read'); }, getPrototypeOf() { traps += 1; throw new Error('must not inspect'); }, ownKeys() { traps += 1; throw new Error('must not enumerate'); } });
    const accessor = output(); Object.defineProperty(accessor.data, 'recommendation', { enumerable: true, get: () => { throw new Error('must not read'); } });
    for (const value of [unknownEvidence, thenable, proxy, accessor, { ...output(), provider: 'athena_mlx' }, { ...output(), receiptRef: 'receipt_synthetic_01' }, { ...output(), apply: true }, { ...output(), data: { ...output().data, suggestedActions: [{ ...output().data.suggestedActions[0], writePolicy: 'apply' }] } }]) { let calls = 0; denied(await service(() => { calls += 1; return value; }).execute(input()), 'provider_invalid'); assert.equal(calls, 1); }
    assert.equal(thenReads, 0); assert.equal(traps, 0);
    assert.throws(() => createTreatmentReasoningAthenaExecution({ host: { policy: () => policy() }, timeoutMs: 20 }), TreatmentReasoningAthenaExecutionConfigurationError);
    assert.throws(() => createTreatmentReasoningAthenaExecution({ host: { policy: () => policy(), invoke: () => output() }, timeoutMs: 430_001 }), TreatmentReasoningAthenaExecutionConfigurationError);
});

test('uses a data-only cancellation capability, discards late completion, and does not retry or fall back', async () => {
    let calls = 0; let cancellation: Readonly<{ isAborted: () => boolean }> | null = null; let lateObserved = false; let escaped: unknown = null;
    const onUncaught = (error: unknown) => { escaped = error; }; const onUnhandled = (reason: unknown) => { escaped = reason; };
    process.once('uncaughtException', onUncaught); process.once('unhandledRejection', onUnhandled);
    try {
        const result = await service(({ signal }) => new Promise((resolve) => { calls += 1; cancellation = signal; const descriptor = Object.getOwnPropertyDescriptor(signal, 'isAborted'); const abortListener = () => { throw new Error('must stay contained'); }; assert.deepEqual(Reflect.ownKeys(signal), ['isAborted']); assert.equal(Object.getPrototypeOf(signal), null); assert.equal(Object.isFrozen(signal), true); assert.equal(descriptor?.enumerable, true); assert.equal('value' in (descriptor ?? {}), true); assert.equal(descriptor?.get, undefined); assert.equal(descriptor?.set, undefined); assert.equal(typeof descriptor?.value, 'function'); assert.equal(descriptor?.value.length, 0); assert.equal('addEventListener' in signal, false); assert.throws(() => (signal as unknown as { addEventListener: (event: string, listener: () => void) => void }).addEventListener('abort', abortListener)); setTimeout(() => { lateObserved = signal.isAborted(); resolve(output()); }, 40); }), () => policy(), 10).execute(input());
        denied(result, 'execution_timeout'); assert.equal(calls, 1); assert.equal((cancellation as Readonly<{ isAborted: () => boolean }> | null)?.isAborted(), true); await new Promise((resolve) => setTimeout(resolve, 45)); assert.equal(lateObserved, true); assert.equal(escaped, null);
    } finally { process.removeListener('uncaughtException', onUncaught); process.removeListener('unhandledRejection', onUnhandled); }
    calls = 0; denied(await service(() => { calls += 1; throw new Error('synthetic provider failure'); }).execute(input()), 'provider_failed'); assert.equal(calls, 1);
});

test('does not read ambient Object.prototype.then inside success or any denial path', async () => {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); let reads = 0;
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { if ((new Error().stack ?? '').includes('/lib/ai-providers/fabric/treatment-reasoning-athena-execution.ts:')) reads += 1; return undefined; } });
    try {
        assert.equal((await service(() => output()).execute(input())).status, 'completed');
        denied(await service(() => output()).execute({}), 'input_invalid');
        denied(await service(() => output(), () => policy({ egress: 'cloud' })).execute(input()), 'host_invalid');
        denied(await service(() => ({ ...output(), provider: 'athena_mlx' })).execute(input()), 'provider_invalid');
        denied(await service(() => { throw new Error('synthetic provider failure'); }).execute(input()), 'provider_failed');
        denied(await service(() => new Promise((resolve) => setTimeout(() => resolve(output()), 30)), () => policy(), 5).execute(input()), 'execution_timeout');
    } finally { if (prior) Object.defineProperty(Object.prototype, 'then', prior); else delete (Object.prototype as { then?: unknown }).then; }
    assert.equal(reads, 0);
});
