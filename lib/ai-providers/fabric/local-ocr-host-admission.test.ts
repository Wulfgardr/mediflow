/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostLocalOcrAdmissionService, type HostLocalOcrAdmissionResult } from './local-ocr-host-admission.ts';

type Provider = 'ollama_ocr' | 'apple_vision';
const venue = (provider: Provider) => provider === 'ollama_ocr' ? 'local_process' : 'on_device';
const policy = (provider: Provider) => ({ provider, venue: venue(provider), egress: 'none', authority: 'review_only', applyPolicy: 'none' });
const readiness = (provider: Provider, state: 'available' | 'unavailable' = 'available') => ({ provider, venue: venue(provider), state });
const service = (hostPolicy: unknown, hostReadiness: unknown) => createHostLocalOcrAdmissionService({
    readPolicy: async () => hostPolicy as never, readReadiness: async () => hostReadiness as never,
});
const deny = (code: string) => ({ status: 'denied', code, binding: null, readiness: null,
    fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0 });

test('binds exactly the host-selected available local provider with frozen local-only readiness', async () => {
    for (const provider of ['ollama_ocr', 'apple_vision'] as const) {
        const result = await service(policy(provider), readiness(provider)).admit();
        assert.deepEqual(result, { status: 'admitted', code: null,
            binding: { provider, venue: venue(provider), egress: 'none' },
            readiness: { provider, venue: venue(provider), egress: 'none', state: 'available', schemaVersion: 'mediflow.ai.local-ocr-host-readiness.v1' },
            fallback: 'denied_by_contract', applyPolicy: 'none', writesPerformed: 0 });
        assert.ok(Object.isFrozen(result));
        assert.ok(Object.isFrozen(result.binding));
        assert.ok(Object.isFrozen(result.readiness));
    }
});

test('denies unavailable, mismatched, and caller-supplied alternate providers without fallback', async () => {
    const unavailable = service(policy('ollama_ocr'), readiness('ollama_ocr', 'unavailable'));
    const result = await (unavailable.admit as (input: unknown) => Promise<HostLocalOcrAdmissionResult>)({ provider: 'apple_vision' });
    assert.deepEqual(result, deny('provider_unavailable'));
    assert.equal(JSON.stringify(result).includes('apple_vision'), false);
    for (const input of [readiness('apple_vision'), { ...readiness('ollama_ocr'), venue: 'on_device' }]) {
        assert.deepEqual(await service(policy('ollama_ocr'), input).admit(), deny('readiness_mismatch'));
    }
});

test('rejects ambiguous, hostile, accessor, and prototype host inputs without reading accessors', async () => {
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'provider', { enumerable: true, get: () => { reads += 1; return 'ollama_ocr'; } });
    const inherited = Object.assign(Object.create({ inherited: true }), readiness('ollama_ocr'));
    for (const [hostPolicy, hostReadiness, code] of [
        [{ ...policy('ollama_ocr'), fallback: 'apple_vision' }, readiness('ollama_ocr'), 'policy_invalid'],
        [accessor, readiness('ollama_ocr'), 'policy_invalid'],
        [policy('ollama_ocr'), { ...readiness('ollama_ocr'), extra: true }, 'readiness_invalid'],
        [policy('ollama_ocr'), accessor, 'readiness_invalid'],
        [policy('ollama_ocr'), inherited, 'readiness_invalid'],
    ] as const) assert.deepEqual(await service(hostPolicy, hostReadiness).admit(), deny(code));
    assert.equal(reads, 0);
});

test('redacts host reader failures', async () => {
    const failedPolicy = createHostLocalOcrAdmissionService({ readPolicy: async () => { throw new Error('synthetic policy secret'); }, readReadiness: async () => readiness('ollama_ocr') });
    const failedReadiness = createHostLocalOcrAdmissionService({ readPolicy: async () => policy('ollama_ocr'), readReadiness: async () => { throw new Error('synthetic readiness secret'); } });
    const results = [await failedPolicy.admit(), await failedReadiness.admit()];
    assert.deepEqual(results, [deny('policy_unavailable'), deny('readiness_unavailable')]);
    assert.equal(JSON.stringify(results).includes('synthetic'), false);
});
