/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDocumentSynthesisProviderBindingForTest,
    resolveDocumentSynthesisProviderBinding,
} from './document-synthesis-provider-binding.ts';
import type { OllamaLocalAttestation } from '../ollama-locality.ts';
import { localProviderRegistry } from '../registry.ts';

const SETTINGS = Object.freeze({
    aiProvider: 'ollama', aiModel_reasoning: 'reasoning-local', aiUrl: 'http://localhost:11434/v1',
});
const ATTESTATION = Object.freeze({
    authorityPlane: 'clinical_application', provider: 'ollama', executionMode: 'local', endpointClass: 'loopback',
    requestedModel: 'reasoning-local', canonicalModel: 'reasoning-local:latest', digest: 'sha256:synthetic', serverVersion: '0.32.5', checkedAt: '2026-08-25T12:00:00.000Z',
});

function service(
    settings: unknown = SETTINGS,
    attest: (endpoint: string, model: string, signal: AbortSignal) => Promise<OllamaLocalAttestation> = async () => ATTESTATION,
) {
    return createDocumentSynthesisProviderBindingForTest({ readSettings: async () => settings, attest });
}

test('binds the canonical reasoning settings once and issues a private execution token', async () => {
    const calls: unknown[][] = [];
    const result = await service(SETTINGS, async (...args) => { calls.push(args); return ATTESTATION; }).bind();
    assert.equal(result.status, 'available');
    if (result.status !== 'available') return;
    assert.deepEqual({ ...result.receipt }, {
        schemaVersion: 'mediflow.document-synthesis.provider-binding.v1', capability: 'document_synthesis', registryTask: 'reasoning',
        provider: 'ollama', model: 'reasoning-local', venue: 'local_process', egress: 'none', fallback: 'none', runtimeReadiness: 'required',
    });
    assert.deepEqual({ ...result.readiness }, {
        schemaVersion: 'mediflow.document-synthesis.provider-readiness.v1', state: 'available_unqualified',
        modelAttestation: 'observed_not_causal',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], 'http://127.0.0.1:11434');
    assert.equal(calls[0]?.[1], 'reasoning-local');
    assert.equal(calls[0]?.[2] instanceof AbortSignal, true);
    assert.equal(Object.getPrototypeOf(result), null);
    assert.equal(Object.getPrototypeOf(result.receipt), null);
    assert.equal(Object.getPrototypeOf(result.readiness), null);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.receipt), true);
    assert.equal(Object.isFrozen(result.readiness), true);
    assert.equal(JSON.stringify(result).includes('127.0.0.1'), false);
    const resolution = resolveDocumentSynthesisProviderBinding(result.token);
    assert.equal(resolution?.receipt.task, 'reasoning');
    assert.equal(resolution?.receipt.model, 'reasoning-local');
    assert.throws(() => { (resolution as { receipt: unknown }).receipt = null; });
    assert.equal(resolveDocumentSynthesisProviderBinding(result.token)?.receipt.task, 'reasoning');
});

test('uses reasoning then legacy model and canonical endpoint fallback only', async () => {
    for (const [settings, model, endpoint] of [
        [{ aiModel: 'legacy-reasoning', ollamaUrl: 'http://localhost:11434/v1' }, 'legacy-reasoning', 'http://127.0.0.1:11434'],
        [{ aiModel_reasoning: ' reasoning-local ', aiModel: 'legacy', aiUrl: 'http://127.0.0.1:8080', ollamaUrl: 'http://localhost:11434' }, 'reasoning-local', 'http://127.0.0.1:11434'],
    ] as const) {
        const result = await service(settings, async (_url, requested) => ({ ...ATTESTATION, requestedModel: requested, canonicalModel: `${requested}:latest` })).bind();
        assert.equal(result.status, 'available'); if (result.status !== 'available') continue;
        assert.equal(result.receipt.model, model);
        assert.equal(resolveDocumentSynthesisProviderBinding(result.token)?.adapter.getBaseUrl(), endpoint);
    }
});

test('fails closed for hostile settings, provider/model/endpoint/task drift, and unavailable readiness', async () => {
    const denied = async (
        settings: unknown,
        attest: (endpoint: string, model: string, signal: AbortSignal) => Promise<OllamaLocalAttestation> = async () => ATTESTATION,
    ) => {
        const result = await service(settings, attest).bind(); assert.equal(result.status, 'denied'); return result;
    };
    const nonEnumerable = { ...SETTINGS }; Object.defineProperty(nonEnumerable, 'aiProvider', { enumerable: false });
    const symbolic = { ...SETTINGS, [Symbol('synthetic')]: true };
    for (const value of [null, [], { ...SETTINGS, extra: true }, nonEnumerable, symbolic, { ...SETTINGS, aiProvider: 'remote' },
        { ...SETTINGS, aiModel_reasoning: 'remote:cloud' }, { ...SETTINGS, aiUrl: ['https:', '//remote.invalid'].join('') },
        Object.create({ aiProvider: 'ollama' }), new Proxy(SETTINGS, {})]) {
        const result = await denied(value); assert.equal(resolveDocumentSynthesisProviderBinding(result.token), null);
    }
    let reads = 0;
    const accessor = {}; Object.defineProperty(accessor, 'aiProvider', { enumerable: true, get() { reads += 1; return 'ollama'; } });
    assert.equal((await denied(accessor)).code, 'settings_corrupt'); assert.equal(reads, 0);
    for (const attestation of [
        { ...ATTESTATION, provider: 'other' }, { ...ATTESTATION, canonicalModel: 'other-local' },
        { ...ATTESTATION, executionMode: 'cloud' }, new Proxy(ATTESTATION, {}),
    ]) assert.equal((await denied(SETTINGS, async () => attestation as OllamaLocalAttestation)).code, 'model_unavailable');
    const originalResolve = localProviderRegistry.resolve;
    localProviderRegistry.resolve = () => ({ ...originalResolve.call(localProviderRegistry, { task: 'reasoning', models: { reasoning: 'reasoning-local' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1 }), receipt: { ...originalResolve.call(localProviderRegistry, { task: 'reasoning', models: { reasoning: 'reasoning-local' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1 }).receipt, task: 'clinical' } });
    try { assert.equal((await denied(SETTINGS)).code, 'provider_invalid'); } finally { localProviderRegistry.resolve = originalResolve; }
    assert.equal((await denied(SETTINGS, async () => { throw new Error('offline'); })).code, 'provider_unready');
});

test('does not accept forged, cloned, proxied, or cross-module token values', async () => {
    const result = await service().bind(); assert.equal(result.status, 'available'); if (result.status !== 'available') return;
    const sameModule = await import('./document-synthesis-provider-binding.ts');
    for (const token of [{}, { ...result.token }, new Proxy(result.token, {}), Object.create(null), sameModule]) {
        assert.equal(resolveDocumentSynthesisProviderBinding(token), null);
    }
    assert.notEqual(resolveDocumentSynthesisProviderBinding(result.token), null);
});

test('does not mutate a registry resolution and rejects later raw-adapter drift', async () => {
    const originalResolve = localProviderRegistry.resolve;
    const raw = originalResolve.call(localProviderRegistry, { task: 'reasoning', models: { reasoning: 'reasoning-local' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1 });
    localProviderRegistry.resolve = () => raw;
    try {
        const result = await service().bind(); assert.equal(result.status, 'available'); if (result.status !== 'available') return;
        const bound = resolveDocumentSynthesisProviderBinding(result.token); assert.notEqual(bound?.adapter, raw.adapter);
        assert.equal(Object.isFrozen(raw.adapter), false); assert.equal(Object.isFrozen(raw.adapter.capabilities), false);
        (raw.adapter as { getBaseUrl(): string }).getBaseUrl = () => ['https:', '//drift.invalid'].join('');
        await assert.rejects(() => bound!.adapter.chat([]), { code: 'provider_not_local' });
    } finally { localProviderRegistry.resolve = originalResolve; }
});

test('contains dependency failure and ambient thenables without publishing a token', async () => {
    const unavailable = createDocumentSynthesisProviderBindingForTest({ readSettings: async () => Promise.reject(new Error('rejected')), attest: async () => ATTESTATION });
    assert.equal((await unavailable.bind()).code, 'settings_unavailable');
    const thenable = createDocumentSynthesisProviderBindingForTest({ readSettings: () => ({ then() { throw new Error('ambient'); } }) as never, attest: async () => ATTESTATION });
    assert.equal((await thenable.bind()).code, 'settings_unavailable');
    const result = await service(SETTINGS, () => Promise.reject(new Error('rejected attestation'))).bind();
    assert.equal(result.status, 'denied'); assert.equal(result.token, null);
});
