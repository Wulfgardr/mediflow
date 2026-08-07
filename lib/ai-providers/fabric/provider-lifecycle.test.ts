/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    admitProvider,
    ProviderLifecycleError,
    snapshotProviderLifecycle,
    transitionProviderLifecycle,
} from './provider-lifecycle.ts';
import { advanceOnboarding, startOnboarding, type ProviderOnboardingState } from './onboarding.ts';

function enabledLocal(provider = 'ollama'): ProviderOnboardingState {
    const declared = startOnboarding(provider, 'local_model');
    const configured = advanceOnboarding(declared, { type: 'configure' });
    const credentialed = advanceOnboarding(configured, { type: 'credential_declared' });
    const attested = advanceOnboarding(credentialed, { type: 'attest_local' });
    return advanceOnboarding(attested, { type: 'enable' });
}

function expectCode(code: ProviderLifecycleError['code'], run: () => unknown): void {
    assert.throws(run, (error) => error instanceof ProviderLifecycleError && error.code === code);
}

test('ammette solo un onboarding locale enabled e congela il snapshot minimo', () => {
    const lifecycle = admitProvider(enabledLocal());

    assert.deepEqual(lifecycle, {
        schemaVersion: 'mediflow.ai.provider-lifecycle.v1',
        provider: 'ollama',
        credentialClass: 'local_model',
        status: 'available_unqualified',
    });
    assert.equal(Object.isFrozen(lifecycle), true);
    assert.equal(JSON.stringify(lifecycle).includes('token'), false);
    assert.equal(JSON.stringify(lifecycle).includes('endpoint'), false);
    assert.equal(JSON.stringify(lifecycle).includes('payload'), false);
});

test('revoca e degrado rispettano transizioni fail-closed', () => {
    const available = admitProvider(enabledLocal());
    const degraded = transitionProviderLifecycle(available, 'degrade');
    assert.equal(degraded.status, 'degraded');
    assert.equal(transitionProviderLifecycle(degraded, 'recover').status, 'available_unqualified');

    const revoked = transitionProviderLifecycle(degraded, 'revoke');
    assert.equal(revoked.status, 'revoked');
    expectCode('transition_invalid', () => transitionProviderLifecycle(revoked, 'recover'));
    expectCode('transition_invalid', () => transitionProviderLifecycle(revoked, 'degrade'));
    expectCode('transition_invalid', () => transitionProviderLifecycle(revoked, 'revoke'));
    expectCode('transition_invalid', () => transitionProviderLifecycle(available, 'recover'));
    expectCode('transition_invalid', () => transitionProviderLifecycle(
        available,
        'revoke_then_recover' as never,
    ));
});

test('rifiuta onboarding non enabled o classi che non concedono un provider', () => {
    expectCode('onboarding_not_enabled', () => admitProvider(startOnboarding('ollama', 'local_model')));

    for (const credentialClass of ['consumer_login', 'subscription'] as const) {
        const nonGrantEnabled = Object.freeze({
            schemaVersion: 'mediflow.ai.provider-onboarding.v1' as const,
            provider: 'consumer_provider',
            credentialClass,
            step: 'enabled' as const,
            attestation: 'none' as const,
        });
        expectCode('credential_class_forbidden', () => admitProvider(nonGrantEnabled));
    }

    const cloudEnabled = Object.freeze({
        schemaVersion: 'mediflow.ai.provider-onboarding.v1' as const,
        provider: 'cloud_provider',
        credentialClass: 'api_key' as const,
        step: 'enabled' as const,
        attestation: 'none' as const,
    });
    expectCode('egress_profile_unsatisfied', () => admitProvider(cloudEnabled));
});

test('snapshot runtime legge getter stateful una sola volta', () => {
    let providerReads = 0;
    let statusReads = 0;
    const lifecycle = {
        schemaVersion: 'mediflow.ai.provider-lifecycle.v1',
        get provider() {
            providerReads += 1;
            return providerReads === 1 ? 'ollama' : 'second_provider';
        },
        credentialClass: 'local_model',
        get status() {
            statusReads += 1;
            return statusReads === 1 ? 'available_unqualified' : 'revoked';
        },
    };
    const snapshot = snapshotProviderLifecycle(lifecycle);
    assert.equal(snapshot.provider, 'ollama');
    assert.equal(snapshot.status, 'available_unqualified');
    assert.equal(providerReads, 1);
    assert.equal(statusReads, 1);

    let onboardingProviderReads = 0;
    const onboarding = {
        schemaVersion: 'mediflow.ai.provider-onboarding.v1',
        get provider() {
            onboardingProviderReads += 1;
            return onboardingProviderReads === 1 ? 'ollama' : 'second_provider';
        },
        credentialClass: 'local_model',
        step: 'enabled',
        attestation: 'available_unqualified',
    } as ProviderOnboardingState;
    assert.equal(admitProvider(onboarding).provider, 'ollama');
    assert.equal(onboardingProviderReads, 1);
});

test('snapshot runtime rifiuta campi non contrattuali e non li propaga', () => {
    const lifecycle = admitProvider(enabledLocal());
    const restored = snapshotProviderLifecycle({ ...lifecycle });
    assert.notEqual(restored, lifecycle);
    assert.deepEqual(restored, lifecycle);

    expectCode('snapshot_invalid', () => snapshotProviderLifecycle({
        ...lifecycle,
        endpoint: 'http://127.0.0.1:11434',
    }));
    expectCode('snapshot_invalid', () => snapshotProviderLifecycle({
        ...lifecycle,
        token: 'synthetic-secret',
    }));
    expectCode('snapshot_invalid', () => snapshotProviderLifecycle({
        ...lifecycle,
        provider: 'provider with space',
    }));
});
