/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    claimDocumentSynthesisProviderBindingForExecution,
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
    for (const token of [{}, { ...result.token }, new Proxy(result.token, {}), Object.create(null)]) {
        assert.equal(resolveDocumentSynthesisProviderBinding(token), null);
        assert.equal(claimDocumentSynthesisProviderBindingForExecution(token), null);
    }
    const replacements = [
        ["import 'server-only';", ''],
        ["'drizzle-orm'", `'${import.meta.resolve('drizzle-orm')}'`],
        ["'@/lib/ai-model-selection'", `'${new URL('../../ai-model-selection.ts', import.meta.url).href}'`],
        ["'@/lib/db-server'", `'${new URL('../../db-server.ts', import.meta.url).href}'`],
        ["'@/lib/schema'", `'${new URL('../../schema.ts', import.meta.url).href}'`],
        ["'../base-url'", `'${new URL('../base-url.ts', import.meta.url).href}'`],
        ["'../ollama-locality'", `'${new URL('../ollama-locality.ts', import.meta.url).href}'`],
        ["'../ollama'", `'${new URL('../ollama.ts', import.meta.url).href}'`],
        ["'../registry'", `'${new URL('../registry.ts', import.meta.url).href}'`],
        ["'../provider'", `'${new URL('../provider.ts', import.meta.url).href}'`],
    ] as const;
    let source = readFileSync(new URL('./document-synthesis-provider-binding.ts', import.meta.url), 'utf8');
    for (const [from, to] of replacements) source = source.replaceAll(from, to);
    const typescript = await import('typescript');
    const code = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ESNext } }).outputText;
    const foreign = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('./document-synthesis-provider-binding.ts');
    const foreignResult = await foreign.createDocumentSynthesisProviderBindingForTest({ readSettings: async () => SETTINGS, attest: async () => ATTESTATION }).bind();
    assert.equal(foreignResult.status, 'available'); if (foreignResult.status === 'available') {
        assert.equal(resolveDocumentSynthesisProviderBinding(foreignResult.token), null);
        assert.equal(claimDocumentSynthesisProviderBindingForExecution(foreignResult.token), null);
        assert.equal(foreign.claimDocumentSynthesisProviderBindingForExecution(result.token), null);
    }
    assert.notEqual(resolveDocumentSynthesisProviderBinding(result.token), null);
});

test('claims the exact frozen binding receipt once without consulting hostile token properties', async () => {
    const result = await service().bind(); assert.equal(result.status, 'available'); if (result.status !== 'available') return;
    const resolved = resolveDocumentSynthesisProviderBinding(result.token);
    assert.ok(resolved);
    const first = claimDocumentSynthesisProviderBindingForExecution(result.token);
    assert.ok(first);
    assert.equal(first.resolution, resolved);
    assert.equal(first.receipt, result.receipt);
    assert.equal(Object.getPrototypeOf(first.receipt), null);
    assert.equal(Object.isFrozen(first.receipt), true);
    assert.notEqual(first.resolution, null);
    assert.equal(resolveDocumentSynthesisProviderBinding(result.token), null);
    assert.equal(claimDocumentSynthesisProviderBindingForExecution(result.token), null);
    let traps = 0;
    let thenReads = 0;
    const hostile = new Proxy(Object.create(null), {
        get() { traps += 1; throw new Error('trap'); },
        getOwnPropertyDescriptor() { traps += 1; throw new Error('trap'); },
        getPrototypeOf() { traps += 1; throw new Error('trap'); },
    });
    const priorThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { thenReads += 1; return undefined; } });
    try {
        assert.equal(claimDocumentSynthesisProviderBindingForExecution(hostile), null);
        assert.equal(claimDocumentSynthesisProviderBindingForExecution({ ...result.token }), null);
        assert.equal(claimDocumentSynthesisProviderBindingForExecution(structuredClone(result.token)), null);
    } finally {
        if (priorThen) Object.defineProperty(Object.prototype, 'then', priorThen);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    assert.equal(traps, 0);
    assert.equal(thenReads, 0);
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

test('never executes raw adapter methods replaced after binding', async () => {
    const originalResolve = localProviderRegistry.resolve;
    const raw = originalResolve.call(localProviderRegistry, { task: 'reasoning', models: { reasoning: 'reasoning-local' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1 });
    localProviderRegistry.resolve = () => raw;
    try {
        const result = await service().bind(); assert.equal(result.status, 'available'); if (result.status !== 'available') return;
        let chatCalls = 0; let listCalls = 0;
        const mutable = raw.adapter as unknown as { chat(): Promise<never>; listModels(): Promise<never> };
        mutable.chat = async () => { chatCalls += 1; throw new Error('replacement executed'); };
        mutable.listModels = async () => { listCalls += 1; throw new Error('replacement executed'); };
        const bound = resolveDocumentSynthesisProviderBinding(result.token)!;
        await assert.rejects(() => bound.adapter.chat([]), { code: 'provider_not_local' });
        await assert.rejects(() => bound.adapter.listModels(), { code: 'provider_not_local' });
        assert.equal(chatCalls, 0); assert.equal(listCalls, 0);
    } finally { localProviderRegistry.resolve = originalResolve; }
});

test('rejects proxy registry resolution shapes before any trap or readiness attestation', async () => {
    const originalResolve = localProviderRegistry.resolve;
    const raw = originalResolve.call(localProviderRegistry, { task: 'reasoning', models: { reasoning: 'reasoning-local' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1 });
    for (const candidate of [
        (traps: { value: number }) => new Proxy(raw, { get() { traps.value += 1; throw new Error('trap'); } }),
        (traps: { value: number }) => ({ ...raw, adapter: new Proxy(raw.adapter, { get() { traps.value += 1; throw new Error('trap'); } }) }),
        (traps: { value: number }) => ({ ...raw, receipt: new Proxy(raw.receipt, { get() { traps.value += 1; throw new Error('trap'); } }) }),
        (traps: { value: number }) => ({ ...raw, manifest: new Proxy(raw.manifest, { get() { traps.value += 1; throw new Error('trap'); } }) }),
        (traps: { value: number }) => ({ ...raw, fallback: new Proxy(raw.fallback, { get() { traps.value += 1; throw new Error('trap'); } }) }),
    ]) {
        const traps = { value: 0 }; let attestations = 0; localProviderRegistry.resolve = () => candidate(traps) as typeof raw;
        const result = await service(SETTINGS, async () => { attestations += 1; return ATTESTATION; }).bind();
        assert.equal(result.code, 'provider_invalid'); assert.equal(traps.value, 0); assert.equal(attestations, 0);
    }
    localProviderRegistry.resolve = originalResolve;
});

test('contains dependency failure and ambient thenables without publishing a token', async () => {
    const unavailable = createDocumentSynthesisProviderBindingForTest({ readSettings: async () => Promise.reject(new Error('rejected')), attest: async () => ATTESTATION });
    assert.equal((await unavailable.bind()).code, 'settings_unavailable');
    const thenable = createDocumentSynthesisProviderBindingForTest({ readSettings: () => ({ then() { throw new Error('ambient'); } }) as never, attest: async () => ATTESTATION });
    assert.equal((await thenable.bind()).code, 'settings_unavailable');
    const result = await service(SETTINGS, () => Promise.reject(new Error('rejected attestation'))).bind();
    assert.equal(result.status, 'denied'); assert.equal(result.token, null);
});
