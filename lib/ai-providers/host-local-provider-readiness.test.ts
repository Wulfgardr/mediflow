/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostLocalProviderReadinessForTest, type HostLocalProviderReadinessResult } from './host-local-provider-readiness.ts';
import { OllamaLocalityError, type OllamaLocalAttestation } from './ollama-locality.ts';
import { localProviderRegistry, type LocalProviderResolution } from './registry.ts';

const resolution = (): LocalProviderResolution => localProviderRegistry.resolve({
    task: 'clinical',
    provider: 'ollama',
    models: { clinical: 'synthetic-local-model' },
    endpoint: 'http://127.0.0.1:11434',
    disableThinking: true,
    chatTimeoutMs: 1_000,
});

const attestation: OllamaLocalAttestation = {
    authorityPlane: 'clinical_application',
    provider: 'ollama',
    executionMode: 'local',
    endpointClass: 'loopback',
    requestedModel: 'synthetic-local-model',
    canonicalModel: 'synthetic-local-model:latest',
    digest: 'sha256:synthetic-readiness',
    serverVersion: '0.32.5',
    checkedAt: '2026-08-22T00:00:00.000Z',
};

const PROVIDER_DENIED = { status: 'denied', code: 'provider_unready', observation: { venue: 'local_process', state: 'offline', reason: 'daemon_unreachable' } } as const;
const MODEL_DENIED = { status: 'denied', code: 'model_unavailable', observation: { venue: 'local_process', state: 'degraded', reason: null } } as const;

function assertDenied(result: HostLocalProviderReadinessResult, expected: typeof PROVIDER_DENIED | typeof MODEL_DENIED): void {
    assert.deepEqual(result, expected);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.observation), true);
}

test('attesta una volta il binding clinico e restituisce solo readiness locale congelata', async () => {
    const calls: unknown[][] = [];
    const observer = createHostLocalProviderReadinessForTest(async (...args) => { calls.push(args); return attestation; });
    const result = await observer.observeClinical(resolution());
    assert.deepEqual(result, {
        status: 'available',
        code: null,
        observation: { venue: 'local_process', state: 'available', reason: null },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], 'http://127.0.0.1:11434');
    assert.equal(calls[0]?.[1], 'synthetic-local-model');
    assert.equal(calls[0]?.[2] instanceof AbortSignal, true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.observation), true);
});

test('legge una volta provider, adapter, base e modello prima della attestazione', async () => {
    const stable = resolution();
    const reads = { adapter: 0, provider: 0, receiptModel: 0, base: 0, model: 0 };
    const adapter = {
        ...stable.adapter,
        id: 'ollama',
        kind: 'local' as const,
        getBaseUrl: () => (++reads.base === 1 ? 'http://127.0.0.1:11434' : ['https:', '//remote.invalid'].join('')),
        getModel: () => (++reads.model === 1 ? 'synthetic-local-model' : 'remote:cloud'),
    };
    const receipt = { ...stable.receipt };
    Object.defineProperties(receipt, {
        provider: { enumerable: true, get: () => (++reads.provider === 1 ? 'ollama' : 'remote') },
        model: { enumerable: true, get: () => (++reads.receiptModel === 1 ? 'synthetic-local-model' : 'remote:cloud') },
    });
    const stateful = { ...stable, receipt } as LocalProviderResolution;
    Object.defineProperty(stateful, 'adapter', {
        enumerable: true,
        get: () => { reads.adapter += 1; return adapter; },
    });

    const result = await createHostLocalProviderReadinessForTest(async () => attestation).observeClinical(stateful);
    assert.equal(result.status, 'available');
    assert.deepEqual(reads, { adapter: 1, provider: 1, receiptModel: 1, base: 1, model: 1 });
});

test('mappa gli errori locality in dinieghi fissi senza dettagli raw', async () => {
    for (const code of ['endpoint_not_loopback', 'provider_unready'] as const) {
        const result = await createHostLocalProviderReadinessForTest(async () => { throw new OllamaLocalityError(code); })
            .observeClinical(resolution());
        assertDenied(result, PROVIDER_DENIED);
    }
    for (const code of ['model_cloud_reference', 'model_not_local', 'model_pull_disabled', 'response_not_local'] as const) {
        const result = await createHostLocalProviderReadinessForTest(async () => { throw new OllamaLocalityError(code); })
            .observeClinical(resolution());
        assertDenied(result, MODEL_DENIED);
    }
    const unexpected = await createHostLocalProviderReadinessForTest(async () => { throw new Error('synthetic raw exception'); })
        .observeClinical(resolution());
    assertDenied(unexpected, PROVIDER_DENIED);
    assert.equal(JSON.stringify(unexpected).includes('synthetic raw exception'), false);
});

test('nega provider, adapter, endpoint o modello incoerenti senza attestare', async () => {
    let calls = 0;
    const observer = createHostLocalProviderReadinessForTest(async () => { calls += 1; return attestation; });
    const valid = resolution();
    const withAdapter = (override: object) => ({ ...valid, adapter: Object.assign(
        Object.create(Object.getPrototypeOf(valid.adapter)), valid.adapter, override,
    ) }) as LocalProviderResolution;
    const cases: [LocalProviderResolution, typeof PROVIDER_DENIED | typeof MODEL_DENIED][] = [
        [{ ...valid, receipt: { ...valid.receipt, provider: 'other' as never } }, PROVIDER_DENIED],
        [withAdapter({ id: 'other' }), PROVIDER_DENIED],
        [withAdapter({ getBaseUrl: () => ['https:', '//remote.invalid'].join('') }), PROVIDER_DENIED],
        [withAdapter({ getModel: () => 'different-local-model' }), MODEL_DENIED],
        [{ ...valid, receipt: { ...valid.receipt, task: 'reasoning' } }, PROVIDER_DENIED],
    ];
    for (const [candidate, expected] of cases) {
        assertDenied(await observer.observeClinical(candidate), expected);
    }
    assert.equal(calls, 0);
});
