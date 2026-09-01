/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    bindProviderLifecycleToInstanceProfileV2,
    snapshotProviderInstanceProfileV2,
} from './provider-instance-profile.ts';
import { createAbsentProviderLifecycleV2, transitionProviderLifecycleV2 } from './provider-lifecycle.ts';

const PROFILE = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-instance-profile.v2',
    providerType: 'openai',
    providerInstance: Object.freeze({
        instanceRef: 'pvi_0123456789abcdef0123456789abcdef',
        workspaceRef: 'pws_0123456789abcdef0123456789abcdef',
    }),
    auth: Object.freeze({
        schemaVersion: 'mediflow.ai.provider-auth-policy.v2',
        credentialClass: 'api_key',
        authRef: 'par_0123456789abcdef0123456789abcdef',
    }),
    model: 'gpt-5.4-mini',
    capabilities: Object.freeze(['document_synthesis']),
    groups: Object.freeze(['group.review-only.v1']),
    bindings: Object.freeze([
        Object.freeze({ operation: 'document_synthesis', groupRef: 'group.review-only.v1' }),
    ]),
    functionAllowlist: Object.freeze([]),
    venue: 'cloud',
    egress: 'official_provider_api',
    egressProfileRef: 'egress.synthetic.v1',
    residency: 'provider_managed',
    residencyProfileRef: 'residency.provider-managed.v1',
    retention: 'provider_declared',
    retentionProfileRef: 'retention.standard.v1',
    dataUse: 'synthetic_nonclinical',
    dataUseProfileRef: 'data-use.synthetic-nonclinical.v1',
});
const LIFECYCLE_BINDING = Object.freeze({
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

function lifecycle(overrides: Record<string, unknown> = {}) {
    return transitionProviderLifecycleV2(createAbsentProviderLifecycleV2(), {
        type: 'configure', binding: { ...LIFECYCLE_BINDING, ...overrides },
    });
}

function rejectsProfile(value: unknown): void {
    assert.throws(() => snapshotProviderInstanceProfileV2(value), (error: unknown) => (
        error instanceof Error && 'code' in error && error.code === 'profile_invalid'
    ));
}

test('materializza un profilo provider instance exact-key e profondamente immutabile', () => {
    const snapshot = snapshotProviderInstanceProfileV2(PROFILE);

    assert.deepEqual(snapshot, PROFILE);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.providerInstance), true);
    assert.equal(Object.isFrozen(snapshot.auth), true);
    assert.equal(Object.isFrozen(snapshot.capabilities), true);
    assert.equal(Object.isFrozen(snapshot.groups), true);
    assert.equal(Object.isFrozen(snapshot.bindings), true);
    assert.equal(Object.isFrozen(snapshot.bindings[0]), true);
    assert.equal(Object.isFrozen(snapshot.functionAllowlist), true);
});

test('lega il lifecycle a una sola instance e prova provider modello e operation correnti', () => {
    const configured = lifecycle();

    assert.deepEqual(bindProviderLifecycleToInstanceProfileV2({
        schemaVersion: 'mediflow.ai.provider-instance-lifecycle-binding.v2',
        providerInstanceRef: 'pvi_0123456789abcdef0123456789abcdef',
        profile: PROFILE,
        lifecycle: configured,
    }), {
        schemaVersion: 'mediflow.ai.provider-instance-lifecycle-link.v2',
        providerInstanceRef: 'pvi_0123456789abcdef0123456789abcdef',
        providerType: 'openai',
        operation: 'document_synthesis',
        model: 'gpt-5.4-mini',
        groupRef: 'group.review-only.v1',
        functionAllowlist: [],
        venue: 'cloud',
        egress: 'official_provider_api',
        egressProfileRef: 'egress.synthetic.v1',
        residency: 'provider_managed',
        residencyProfileRef: 'residency.provider-managed.v1',
        retention: 'provider_declared',
        retentionProfileRef: 'retention.standard.v1',
        dataUse: 'synthetic_nonclinical',
        dataUseProfileRef: 'data-use.synthetic-nonclinical.v1',
        generation: 1,
    });
});

test('nega link con chiavi extra o accessor senza materializzare authority caller-supplied', () => {
    let lifecycleReads = 0;
    const accessor = Object.defineProperties({}, {
        schemaVersion: { enumerable: true, value: 'mediflow.ai.provider-instance-lifecycle-binding.v2' },
        providerInstanceRef: { enumerable: true, value: 'pvi_0123456789abcdef0123456789abcdef' },
        profile: { enumerable: true, value: PROFILE },
        lifecycle: { enumerable: true, get() { lifecycleReads += 1; return {}; } },
    });
    for (const value of [
        {
            schemaVersion: 'mediflow.ai.provider-instance-lifecycle-binding.v2',
            providerInstanceRef: 'pvi_0123456789abcdef0123456789abcdef',
            profile: PROFILE,
            lifecycle: {},
            authority: 'caller',
        },
        accessor,
    ]) {
        assert.throws(() => bindProviderLifecycleToInstanceProfileV2(value), (error: unknown) => (
            error instanceof Error && 'code' in error && error.code === 'lifecycle_mismatch'
        ));
    }
    assert.equal(lifecycleReads, 0);
});

test('nega proxy e accessor lifecycle root o nested senza eseguire trap o getter', () => {
    let rootProxyTraps = 0;
    let nestedProxyTraps = 0;
    let rootAccessorReads = 0;
    let nestedAccessorReads = 0;
    const proxyHandler = (recordTrap: () => void): ProxyHandler<object> => ({
        get() { recordTrap(); throw new Error('get trap'); },
        getOwnPropertyDescriptor() { recordTrap(); throw new Error('descriptor trap'); },
        getPrototypeOf() { recordTrap(); throw new Error('prototype trap'); },
        ownKeys() { recordTrap(); throw new Error('ownKeys trap'); },
    });
    const configured = lifecycle();
    const rootProxy = new Proxy(configured, proxyHandler(() => { rootProxyTraps += 1; }));
    const nestedProxy = {
        ...configured,
        binding: new Proxy(configured.binding!, proxyHandler(() => { nestedProxyTraps += 1; })),
    };
    const rootAccessor = Object.defineProperty({ ...configured }, 'status', {
        enumerable: true,
        get() { rootAccessorReads += 1; return 'configured'; },
    });
    const nestedAccessor = {
        ...configured,
        binding: Object.defineProperty({ ...configured.binding }, 'model', {
            enumerable: true,
            get() { nestedAccessorReads += 1; return 'gpt-5.4-mini'; },
        }),
    };

    for (const rawLifecycle of [rootProxy, nestedProxy, rootAccessor, nestedAccessor]) {
        assert.throws(() => bindProviderLifecycleToInstanceProfileV2({
            schemaVersion: 'mediflow.ai.provider-instance-lifecycle-binding.v2',
            providerInstanceRef: 'pvi_0123456789abcdef0123456789abcdef',
            profile: PROFILE,
            lifecycle: rawLifecycle,
        }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lifecycle_mismatch');
    }
    assert.deepEqual([rootProxyTraps, nestedProxyTraps, rootAccessorReads, nestedAccessorReads], [0, 0, 0, 0]);
});

test('nega endpoint, secret inline e reference di policy fuori namespace', () => {
    for (const profile of [
        { ...PROFILE, model: ['https:', '', 'api.openai.com', 'v1', 'responses'].join('/') },
        { ...PROFILE, model: 'api.openai.com/v1/responses' },
        { ...PROFILE, model: 'gpt-5.4' },
        { ...PROFILE, egressProfileRef: 'sk-proj-synthetic-inline-secret' },
        { ...PROFILE, egressProfileRef: 'egress.sk-proj-synthetic-inline-secret' },
        { ...PROFILE, egressProfileRef: 'egress.other.v1' },
        { ...PROFILE, egressProfileRef: 'egress.' },
        { ...PROFILE, apiKey: 'sk-proj-synthetic-inline-secret' },
    ]) {
        assert.throws(() => snapshotProviderInstanceProfileV2(profile), (error: unknown) => (
            error instanceof Error && 'code' in error && error.code === 'profile_invalid'
        ));
    }
});

test('risolve model ed egress da allowlist host-owned per provider e capability', () => {
    const anthropic = snapshotProviderInstanceProfileV2({
        ...PROFILE,
        providerType: 'anthropic',
        model: 'claude-sonnet-4-6',
    });
    assert.equal(anthropic.providerType, 'anthropic');
    assert.equal(anthropic.model, 'claude-sonnet-4-6');
    assert.equal(anthropic.egressProfileRef, 'egress.synthetic.v1');

    rejectsProfile({ ...PROFILE, providerType: 'anthropic' });
    rejectsProfile({
        ...PROFILE,
        capabilities: ['patient_insight'],
        bindings: [{ operation: 'patient_insight', groupRef: 'group.review-only.v1' }],
    });
});

test('nega record ostili, duplicati, binding impliciti e function escalation', () => {
    let authReads = 0;
    const authAccessor = Object.defineProperty({ ...PROFILE }, 'auth', {
        enumerable: true, get() { authReads += 1; return PROFILE.auth; },
    });
    const revoked = Proxy.revocable({ ...PROFILE }, {});
    revoked.revoke();
    for (const profile of [
        authAccessor,
        revoked.proxy,
        { ...PROFILE, capabilities: ['document_synthesis', 'document_synthesis'] },
        { ...PROFILE, groups: ['group.review-only.v1', 'group.review-only.v1'] },
        { ...PROFILE, bindings: [{ operation: 'patient_insight', groupRef: 'group.review-only.v1' }] },
        { ...PROFILE, groups: ['group.review-only.v1', 'group.unused.v1'] },
        { ...PROFILE, functionAllowlist: ['mediflow.function.synthetic.v1'] },
    ]) rejectsProfile(profile);
    assert.equal(authReads, 0);
});

test('mantiene le classi auth disgiunte e accetta Ollama solo local-model', () => {
    for (const credentialClass of ['provider_oauth', 'host_subscription', 'local_model']) {
        rejectsProfile({ ...PROFILE, auth: { ...PROFILE.auth, credentialClass } });
    }
    rejectsProfile({ ...PROFILE, providerType: 'ollama' });

    const local = snapshotProviderInstanceProfileV2({
        ...PROFILE,
        providerType: 'ollama',
        providerInstance: { ...PROFILE.providerInstance, workspaceRef: null },
        auth: { ...PROFILE.auth, credentialClass: 'local_model', authRef: null },
        model: 'qwen3.5:35b-a3b',
        venue: 'local_process',
        egress: 'none',
        egressProfileRef: 'egress.local.v1',
        residency: 'local_device',
        residencyProfileRef: 'residency.local-device.v1',
        retention: 'local_only',
        retentionProfileRef: 'retention.local-only.v1',
        dataUse: 'clinical_identifiable',
        dataUseProfileRef: 'data-use.clinical-identifiable.v1',
    });
    assert.equal(local.providerType, 'ollama');
    assert.equal(local.auth.credentialClass, 'local_model');
    assert.equal(local.auth.authRef, null);
});

test('nega link su mismatch di provider modello operation e policy', () => {
    for (const rawLifecycle of [
        lifecycle({ providerId: 'anthropic' }),
        lifecycle({ model: 'gpt-5.4' }),
        lifecycle({ operation: 'patient_insight' }),
        lifecycle({ venue: 'home_base', kind: 'local', providerId: 'ollama' }),
        lifecycle({ egressProfileRef: 'egress.other.v1' }),
        lifecycle({ retentionProfileRef: 'retention.other.v1' }),
        lifecycle({ dataClass: 'redacted_clinical' }),
    ]) {
        assert.throws(() => bindProviderLifecycleToInstanceProfileV2({
            schemaVersion: 'mediflow.ai.provider-instance-lifecycle-binding.v2',
            providerInstanceRef: 'pvi_0123456789abcdef0123456789abcdef',
            profile: PROFILE,
            lifecycle: rawLifecycle,
        }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lifecycle_mismatch');
    }

    assert.throws(() => bindProviderLifecycleToInstanceProfileV2({
        schemaVersion: 'mediflow.ai.provider-instance-lifecycle-binding.v2',
        providerInstanceRef: 'pvi_ffffffffffffffffffffffffffffffff',
        profile: PROFILE,
        lifecycle: lifecycle(),
    }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'lifecycle_mismatch');
});
