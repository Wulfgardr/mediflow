/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalOcrOllamaExecutionAdapter, type HostInjectedLocalOcrOllamaInvocation } from './local-ocr-ollama-execution.ts';

const model = 'synthetic-ocr-model';
const policy = { provider: 'ollama_ocr', venue: 'local_process', endpoint: 'http://127.0.0.1:11434', model, readiness: { provider: 'ollama', model, state: 'available' }, egress: 'none' } as const;
const frozen = <T>(value: T) => Object.freeze(value);
const evidence = (provider: 'ollama_ocr' | 'apple_vision' = 'ollama_ocr') => {
    const venue = provider === 'ollama_ocr' ? 'local_process' : 'on_device';
    return frozen({ status: 'composed', code: null, binding: frozen({ provider, venue, egress: 'none' }), receipt: frozen({ schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1', provider, venue, egress: 'none', authority: 'review_only', applyPolicy: 'none', writesPerformed: 0 }), provenance: frozen({ schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1', provider, venue, egress: 'none', receiptProvider: provider }), fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0 });
};
const input = (overrides: Record<string, unknown> = {}) => ({ evidence: evidence(), image: { source: 'host_attachment', mimeType: 'image/png', payload: 'c3ludGhldGljLW9jci1pbWFnZQ==' }, mode: 'full', ...overrides });
const adapter = (invoke: HostInjectedLocalOcrOllamaInvocation) => createLocalOcrOllamaExecutionAdapter({ policy, invoke });

test('executes exactly one injected loopback Ollama call and returns frozen review-only receipt and provenance', async () => {
    let calls = 0;
    const result = await adapter(async (request) => { calls += 1; assert.deepEqual(request.image, { mimeType: 'image/png', payload: 'c3ludGhldGljLW9jci1pbWFnZQ==' }); assert.equal(request.model, model); assert.match(request.instruction, /^Transcribe the image exactly/); return { model, text: 'Synthetic OCR result' }; }).execute(input());
    assert.equal(calls, 1); assert.equal(result.status, 'succeeded');
    if (result.status === 'succeeded') { assert.deepEqual(result.binding, { provider: 'ollama_ocr', venue: 'local_process', egress: 'none' }); assert.deepEqual(result.readiness, { provider: 'ollama', model, state: 'available' }); assert.equal(result.output.text, 'Synthetic OCR result'); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.output)); assert.equal(result.receipt && (result.receipt as { provider: string }).provider, 'ollama_ocr'); }
    assert.equal(result.fallback, 'denied_by_contract'); assert.equal(result.applyPolicy, 'none'); assert.equal(result.writesPerformed, 0);
});

test('rejects descriptors before proxy traps, accessors, non-enumerables, symbols, prototypes, or an ambient then can run', async () => {
    let invoked = 0; const invoke = async () => { invoked += 1; return { model, text: 'safe' }; };
    const counts = { factory: 0, callable: 0, input: 0, then: 0, accessor: 0 };
    const traps = (key: keyof typeof counts) => new Proxy({ policy, invoke }, { get: () => { counts[key] += 1; throw new Error('trap'); }, ownKeys: () => { counts[key] += 1; throw new Error('trap'); }, getOwnPropertyDescriptor: () => { counts[key] += 1; throw new Error('trap'); }, getPrototypeOf: () => { counts[key] += 1; throw new Error('trap'); } });
    for (const options of [traps('factory'), { policy, invoke: new Proxy(invoke, { get: () => { counts.callable += 1; throw new Error('trap'); } }) }]) assert.equal((await (createLocalOcrOllamaExecutionAdapter as (value: unknown) => { execute(value: unknown): Promise<{ code: string | null }> })(options).execute(input())).code, 'policy_invalid');
    const accessor = { invoke }; Object.defineProperty(accessor, 'policy', { enumerable: true, get: () => { counts.accessor += 1; throw new Error('read'); } });
    const nonEnumerable = { policy, invoke }; Object.defineProperty(nonEnumerable, 'policy', { enumerable: false, value: policy });
    const symbolic = { policy, invoke, [Symbol('x')]: true }; const prototyped = Object.assign(Object.create({ inherited: true }), { policy, invoke });
    for (const options of [accessor, nonEnumerable, symbolic, prototyped]) assert.equal((await (createLocalOcrOllamaExecutionAdapter as (value: unknown) => { execute(value: unknown): Promise<{ code: string | null }> })(options).execute(input())).code, 'policy_invalid');
    const ambientThen = input(); Object.defineProperty(ambientThen, 'then', { enumerable: true, get: () => { counts.then += 1; throw new Error('read'); } });
    assert.equal((await adapter(invoke).execute(new Proxy(input(), { get: () => { counts.input += 1; throw new Error('trap'); } }))).code, 'envelope_invalid');
    assert.equal((await adapter(invoke).execute(ambientThen)).code, 'envelope_invalid');
    assert.deepEqual(counts, { factory: 0, callable: 0, input: 0, then: 0, accessor: 0 }); assert.equal(invoked, 0);
});

test('denies Apple Vision evidence before invocation and does not choose a fallback', async () => {
    let calls = 0; const result = await adapter(async () => { calls += 1; return { model, text: 'safe' }; }).execute(input({ evidence: evidence('apple_vision') }));
    assert.equal(result.code, 'envelope_invalid'); assert.equal(calls, 0); assert.equal(result.fallback, 'denied_by_contract');
});

test('maps mismatch, oversize, low-signal, raw and throwing-thenable responses without retrying', async () => {
    for (const [value, code] of [[{ model: 'other', text: 'safe' }, 'response_mismatch'], [{ model, text: 'x'.repeat(64 * 1024 + 1) }, 'response_oversized'], [{ model, text: ' ' }, 'low_signal']] as const) assert.equal((await adapter(async () => value).execute(input())).code, code);
    assert.equal((await adapter((() => ({ model, text: 'raw response' })) as unknown as HostInjectedLocalOcrOllamaInvocation).execute(input())).code, null);
    let reads = 0; const thenable = {}; Object.defineProperty(thenable, 'then', { get: () => { reads += 1; throw new Error('then trap'); } });
    assert.equal((await adapter((() => thenable) as unknown as HostInjectedLocalOcrOllamaInvocation).execute(input())).code, 'provider_unavailable'); assert.equal(reads, 1);
});

test('times out an invoker that ignores cancellation and ignores a late completion', async () => {
    const original = AbortSignal.timeout; const controller = new AbortController(); let calls = 0; let complete: ((value: unknown) => void) | undefined;
    Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => controller.signal });
    try {
        const pending = adapter(async () => { calls += 1; return new Promise((resolve) => { complete = resolve; }); }).execute(input());
        controller.abort(); const result = await pending; complete?.({ model, text: 'late response' }); await Promise.resolve();
        assert.equal(result.code, 'provider_timeout'); assert.equal(calls, 1);
    } finally { Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: original }); }
});
