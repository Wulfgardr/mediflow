/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalOcrAppleVisionExecutionAdapter } from './local-ocr-apple-vision-execution.ts';

const freeze = <T>(value: T): T => Object.freeze(value);
const evidence = freeze({
    status: 'composed', code: null,
    binding: freeze({ provider: 'apple_vision', venue: 'on_device', egress: 'none' }),
    receipt: freeze({ schemaVersion: 'mediflow.ai.local-ocr-provider-receipt.v1', provider: 'apple_vision', venue: 'on_device', egress: 'none', authority: 'review_only', applyPolicy: 'none', writesPerformed: 0 }),
    provenance: freeze({ schemaVersion: 'mediflow.ai.local-ocr-provider-provenance.v1', provider: 'apple_vision', venue: 'on_device', egress: 'none', receiptProvider: 'apple_vision' }),
    fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0,
});
const request = (overrides: Record<string, unknown> = {}) => ({ evidence, image: { source: 'host_attachment', mimeType: 'image/png', payload: 'c3ludGhldGljLW9jci1pbWFnZQ==' }, mode: 'full', ...overrides });

test('denies hostile options, requests, and host evidence before any Apple runner can be reached', async () => {
    let reads = 0;
    const adapter = createLocalOcrAppleVisionExecutionAdapter({ readHostEvidence: async () => { reads += 1; return evidence; } });
    for (const input of [
        new Proxy(request(), {}),
        request({ provider: 'apple_vision' }),
        request({ image: { source: 'host_attachment', mimeType: 'image/png', payload: 'data:synthetic' } }),
        request({ mode: 'apply' }),
    ]) assert.equal((await adapter.execute(input)).code, 'request_invalid');
    assert.equal(reads, 0);
    let traps = 0;
    const hostile = new Proxy({ readHostEvidence: async () => evidence }, { get: () => { traps += 1; throw new Error('trap'); } });
    assert.equal((await createLocalOcrAppleVisionExecutionAdapter(hostile).execute(request())).code, 'host_unavailable');
    assert.equal(traps, 0);
    const thenable = request();
    Object.defineProperty(thenable, 'then', { enumerable: true, get: () => { traps += 1; throw new Error('then trap'); } });
    assert.equal((await adapter.execute(thenable)).code, 'request_invalid');
    const hostileCallable = new Proxy(async () => evidence, { apply: () => { traps += 1; return evidence; } });
    assert.equal((await createLocalOcrAppleVisionExecutionAdapter({ readHostEvidence: hostileCallable }).execute(request())).code, 'host_unavailable');
    assert.equal((await createLocalOcrAppleVisionExecutionAdapter({ readHostEvidence: async () => ({ ...evidence }) }).execute(request())).code, 'host_evidence_invalid');
    assert.equal((await createLocalOcrAppleVisionExecutionAdapter({ readHostEvidence: async () => { throw new Error('sanitized'); } }).execute(request())).code, 'host_unavailable');
    assert.equal(traps, 0);
});

test('returns one frozen, review-only no-fallback denial when the fixed system boundary is unavailable', async () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
    try {
        const result = await createLocalOcrAppleVisionExecutionAdapter({ readHostEvidence: async () => evidence }).execute(request());
        assert.deepEqual(result, {
            status: 'denied', code: 'platform_unavailable', binding: null, mode: null, output: null, receipt: null, provenance: null,
            fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0,
        });
        assert.equal(Object.isFrozen(result), true);
    } finally { Object.defineProperty(process, 'platform', { configurable: true, value: original }); }
});
