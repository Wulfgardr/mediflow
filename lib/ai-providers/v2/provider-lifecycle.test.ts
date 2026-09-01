/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createAbsentProviderLifecycleV2,
    transitionProviderLifecycleV2,
} from './provider-lifecycle.ts';
import { localProviderRegistry, ProviderRegistryError } from '../registry.ts';

const HOST_BINDING = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-binding.v2',
    operation: 'document_synthesis',
    providerId: 'openai',
    kind: 'cloud',
    venue: 'cloud',
    model: 'gpt-5.4-mini',
    dataClass: 'synthetic_nonclinical',
    egressProfileRef: 'egress.synthetic.v1',
    retentionProfileRef: 'retention.standard.v1',
    consentRef: null,
    timeoutMs: 15_000,
    maxInputBytes: 32_768,
    maxOutputBytes: 16_384,
    fallback: 'none',
});

test('configura il binding host-owned come snapshot v2 esatto e immutabile', () => {
    const absent = createAbsentProviderLifecycleV2();
    const configured = transitionProviderLifecycleV2(absent, { type: 'configure', binding: HOST_BINDING });

    assert.deepEqual(configured, {
        schemaVersion: 'mediflow.ai.provider-lifecycle.v2',
        generation: 1,
        status: 'configured',
        binding: HOST_BINDING,
    });
    assert.deepEqual(Reflect.ownKeys(configured), ['schemaVersion', 'generation', 'status', 'binding']);
    assert.equal(Object.isFrozen(configured), true);
    assert.equal(Object.isFrozen(configured.binding), true);
});

test('rende la revoca terminale per generation e accetta solo una nuova configurazione', () => {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding: HOST_BINDING });
    const revoked = transitionProviderLifecycleV2(configured, { type: 'revoke_local' });
    assert.deepEqual(revoked, {
        schemaVersion: 'mediflow.ai.provider-lifecycle.v2', generation: 1, status: 'revoked_local', binding: null,
    });
    for (const type of ['validate', 'enable', 'disable', 'degrade', 'revoke_local']) {
        assert.throws(() => transitionProviderLifecycleV2(revoked, { type }), (error: unknown) => (
            error instanceof Error && 'code' in error && error.code === 'transition_invalid'
        ));
    }
    const next = transitionProviderLifecycleV2(revoked, { type: 'configure', binding: { ...HOST_BINDING, model: 'gpt-5.4' } });
    assert.equal(next.generation, 2);
    assert.equal(next.status, 'configured');
    assert.equal(next.binding?.model, 'gpt-5.4');
});

test('nega eventi malformati o fuori sequenza e lascia invariato lo snapshot corrente', () => {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding: HOST_BINDING });
    for (const [event, code] of [
        [{ type: 'enable' }, 'transition_invalid'],
        [{ type: 'validate', providerId: 'anthropic' }, 'event_invalid'],
        [{ type: 'recover' }, 'event_invalid'],
        [{ binding: HOST_BINDING }, 'event_invalid'],
        [null, 'event_invalid'],
    ] as const) {
        assert.throws(() => transitionProviderLifecycleV2(configured, event), (error: unknown) => (
            error instanceof Error && 'code' in error && error.code === code
        ));
        assert.equal(configured.status, 'configured');
        assert.equal(configured.generation, 1);
        assert.equal(configured.binding?.providerId, 'openai');
    }
    let bindingReads = 0;
    const overbroad = Object.defineProperties({ authority: 'caller' }, {
        type: { enumerable: true, value: 'configure' },
        binding: { enumerable: true, get() { bindingReads += 1; return HOST_BINDING; } },
    });
    assert.throws(() => transitionProviderLifecycleV2(configured, overbroad));
    assert.equal(bindingReads, 0);
});

test('materializza getter una sola volta e rifiuta binding extra o con prototipo ostile', () => {
    let typeReads = 0; let bindingReads = 0; let providerReads = 0; let modelReads = 0;
    const binding = Object.defineProperties({ ...HOST_BINDING }, {
        providerId: { enumerable: true, get() { providerReads += 1; return providerReads === 1 ? 'openai' : 'anthropic'; } },
        model: { enumerable: true, get() { modelReads += 1; return modelReads === 1 ? 'gpt-5.4-mini' : 'forged'; } },
    });
    const event = Object.defineProperties({}, {
        type: { enumerable: true, get() { typeReads += 1; return typeReads === 1 ? 'configure' : 'revoke_local'; } },
        binding: { enumerable: true, get() { bindingReads += 1; return binding; } },
    });
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), event);
    assert.equal(configured.binding?.providerId, 'openai');
    assert.equal(configured.binding?.model, 'gpt-5.4-mini');
    assert.deepEqual([typeReads, bindingReads, providerReads, modelReads], [1, 1, 1, 1]);

    for (const invalid of [
        { ...HOST_BINDING, endpoint: 'https://api.openai.com' },
        { ...HOST_BINDING, providerId: 'openai', kind: 'local', venue: 'local_process' },
        { ...HOST_BINDING, timeoutMs: 120_001 },
        { ...HOST_BINDING, maxInputBytes: 1_048_577 },
        { ...HOST_BINDING, maxOutputBytes: 262_145 },
        Object.assign(Object.create({ authority: 'caller' }), HOST_BINDING),
    ]) {
        assert.throws(
            () => transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding: invalid }),
            (error: unknown) => error instanceof Error && 'code' in error && error.code === 'binding_invalid',
        );
    }
});

test('accetta Ollama locale sul processo o home base senza estendere la venue cloud', () => {
    for (const venue of ['local_process', 'home_base']) {
        const state = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), {
            type: 'configure', binding: { ...HOST_BINDING, providerId: 'ollama', kind: 'local', venue, model: 'qwen3.5:35b-a3b' },
        });
        assert.equal(state.binding?.venue, venue);
    }
});

test('converte getter che lanciano in denial chiusi e materializza lo snapshot una volta', () => {
    const configured = transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding: HOST_BINDING });
    let statusReads = 0;
    const state = Object.defineProperty({ ...configured }, 'status', {
        enumerable: true, get() { statusReads += 1; return statusReads === 1 ? 'configured' : 'enabled'; },
    });
    assert.equal(transitionProviderLifecycleV2(state, { type: 'validate' }).status, 'validated');
    assert.equal(statusReads, 1);

    const badBinding = Object.defineProperty({ ...HOST_BINDING }, 'providerId', {
        enumerable: true, get() { throw new Error('hostile binding getter'); },
    });
    const badState = Object.defineProperty({ ...configured }, 'status', {
        enumerable: true, get() { throw new Error('hostile state getter'); },
    });
    const badEvent = Object.defineProperty({}, 'type', {
        enumerable: true, get() { throw new Error('hostile event getter'); },
    });
    for (const [run, code] of [
        [() => transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), { type: 'configure', binding: badBinding }), 'binding_invalid'],
        [() => transitionProviderLifecycleV2(badState, { type: 'validate' }), 'snapshot_invalid'],
        [() => transitionProviderLifecycleV2(configured, badEvent), 'event_invalid'],
    ] as const) assert.throws(run, (error: unknown) => error instanceof Error && 'code' in error && error.code === code);
});

test('lascia il registry v1 locale e incapace di risolvere provider cloud', () => {
    const binding = { task: 'clinical', models: { clinical: 'qwen3.5:35b-a3b' }, endpoint: 'http://localhost:11434', chatTimeoutMs: 1_000 };
    assert.equal(localProviderRegistry.resolve(binding).receipt.provider, 'ollama');
    assert.throws(
        () => localProviderRegistry.resolve({ ...binding, provider: 'openai' }),
        (error: unknown) => error instanceof ProviderRegistryError && error.code === 'provider_not_registered',
    );
});

test('copre la matrice chiusa di transizione e incrementa ogni nuova configuration', () => {
    const absent = createAbsentProviderLifecycleV2();
    const configured = transitionProviderLifecycleV2(absent, { type: 'configure', binding: HOST_BINDING });
    const validated = transitionProviderLifecycleV2(configured, { type: 'validate' });
    const enabled = transitionProviderLifecycleV2(validated, { type: 'enable' });
    const disabled = transitionProviderLifecycleV2(enabled, { type: 'disable' });
    const degraded = transitionProviderLifecycleV2(enabled, { type: 'degrade' });
    const revoked = transitionProviderLifecycleV2(configured, { type: 'revoke_local' });
    const events = ['validate', 'enable', 'disable', 'degrade', 'revoke_local'] as const;
    const rows = [
        [absent, {}],
        [configured, { validate: 'validated', revoke_local: 'revoked_local' }],
        [validated, { enable: 'enabled', revoke_local: 'revoked_local' }],
        [enabled, { disable: 'disabled', degrade: 'degraded', revoke_local: 'revoked_local' }],
        [disabled, { enable: 'enabled', revoke_local: 'revoked_local' }],
        [degraded, { enable: 'enabled', disable: 'disabled', revoke_local: 'revoked_local' }],
        [revoked, {}],
    ] as const;
    for (const [state, legal] of rows) {
        for (const type of events) {
            const target = legal[type as keyof typeof legal];
            if (!target) { assert.throws(() => transitionProviderLifecycleV2(state, { type })); continue; }
            const transitioned = transitionProviderLifecycleV2(state, { type });
            assert.equal(transitioned.status, target);
            assert.equal(transitioned.generation, state.generation);
            assert.deepEqual(transitioned.binding, target === 'revoked_local' ? null : state.binding);
        }
        const next = transitionProviderLifecycleV2(state, { type: 'configure', binding: HOST_BINDING });
        assert.equal(next.status, 'configured');
        assert.equal(next.generation, state.generation + 1);
    }
});
