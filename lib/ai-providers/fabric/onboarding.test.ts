/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CredentialClass } from './contract.ts';
import {
    CREDENTIAL_CLASS_PROPERTIES,
    ONBOARDING_STEPS,
    OnboardingError,
    advanceOnboarding,
    startOnboarding,
    type OnboardingErrorCode,
    type ProviderOnboardingState,
} from './onboarding.ts';

const credentialClasses: readonly CredentialClass[] = [
    'local_model',
    'api_key',
    'oauth',
    'consumer_login',
    'subscription',
];

function expectCode(code: OnboardingErrorCode, run: () => unknown): void {
    assert.throws(run, (error) => error instanceof OnboardingError && error.code === code);
}

test('espone la matrice congelata delle classi di credenziale', () => {
    assert.deepEqual(ONBOARDING_STEPS, ['declared', 'configured', 'credentialed', 'attested', 'enabled']);
    assert.equal(Object.isFrozen(ONBOARDING_STEPS), true);
    assert.equal(Object.isFrozen(CREDENTIAL_CLASS_PROPERTIES), true);
    assert.deepEqual(CREDENTIAL_CLASS_PROPERTIES, {
        local_model: {
            grantsProviderAccess: true, requiresCredentialSecret: false,
            requiresLocalAttestation: true, cloudOnly: false,
        },
        api_key: {
            grantsProviderAccess: true, requiresCredentialSecret: true,
            requiresLocalAttestation: false, cloudOnly: true,
        },
        oauth: {
            grantsProviderAccess: true, requiresCredentialSecret: true,
            requiresLocalAttestation: false, cloudOnly: true,
        },
        consumer_login: {
            grantsProviderAccess: false, requiresCredentialSecret: true,
            requiresLocalAttestation: false, cloudOnly: true,
        },
        subscription: {
            grantsProviderAccess: false, requiresCredentialSecret: false,
            requiresLocalAttestation: false, cloudOnly: true,
        },
    });
    for (const properties of Object.values(CREDENTIAL_CLASS_PROPERTIES)) {
        assert.equal(Object.isFrozen(properties), true);
    }
});

test('la matrice completa si ferma ai limiti fail-closed correnti', () => {
    for (const credentialClass of credentialClasses) {
        const declared = startOnboarding(`synthetic-${credentialClass}`, credentialClass);
        const configured = advanceOnboarding(declared, { type: 'configure' });
        assert.equal(configured.step, 'configured');

        if (!CREDENTIAL_CLASS_PROPERTIES[credentialClass].grantsProviderAccess) {
            expectCode('credential_class_forbidden', () => advanceOnboarding(configured, { type: 'credential_declared' }));
            continue;
        }

        const credentialed = advanceOnboarding(configured, { type: 'credential_declared' });
        assert.equal(credentialed.step, 'credentialed');
        if (credentialClass === 'local_model') {
            const attested = advanceOnboarding(credentialed, { type: 'attest_local' });
            assert.equal(attested.step, 'attested');
            assert.equal(attested.attestation, 'available_unqualified');
            assert.equal(advanceOnboarding(attested, { type: 'enable' }).step, 'enabled');
            continue;
        }
        expectCode('egress_profile_unsatisfied', () => advanceOnboarding(credentialed, { type: 'attest_local' }));
    }
});

test('consumer login e subscription non superano mai configured', () => {
    for (const credentialClass of ['consumer_login', 'subscription'] as const) {
        const configured = advanceOnboarding(startOnboarding('synthetic-consumer', credentialClass), { type: 'configure' });
        expectCode('credential_class_forbidden', () => advanceOnboarding(configured, { type: 'credential_declared' }));
    }
});

test('nessuna classe cloud raggiunge enabled con il gate egress reale chiuso', () => {
    for (const credentialClass of credentialClasses) {
        if (!CREDENTIAL_CLASS_PROPERTIES[credentialClass].cloudOnly) continue;
        const attestedCloudState = Object.freeze({
            schemaVersion: 'mediflow.ai.provider-onboarding.v1' as const,
            provider: `synthetic-${credentialClass}`,
            credentialClass,
            step: 'attested' as const,
            attestation: 'none' as const,
        }) satisfies ProviderOnboardingState;
        expectCode('egress_profile_unsatisfied', () => advanceOnboarding(attestedCloudState, { type: 'enable' }));
    }
});

test('rifiuta eventi, classi e ordini non validi', () => {
    expectCode('invalid_event', () => startOnboarding(' ', 'local_model'));
    expectCode('credential_class_forbidden', () => startOnboarding('synthetic', 'browser_cookie' as CredentialClass));
    const declared = startOnboarding('synthetic-local', 'local_model');
    expectCode('invalid_event', () => advanceOnboarding(declared, { type: 'skip' } as never));
    expectCode('step_order_violation', () => advanceOnboarding(declared, { type: 'credential_declared' }));
    const configured = advanceOnboarding(declared, { type: 'configure' });
    expectCode('step_order_violation', () => advanceOnboarding(configured, { type: 'configure' }));
});

test('genera stati nuovi congelati senza mutare lo stato di partenza', () => {
    const declared = startOnboarding('synthetic-local', 'local_model');
    const configured = advanceOnboarding(declared, { type: 'configure' });
    assert.notEqual(configured, declared);
    assert.equal(declared.step, 'declared');
    assert.equal(Object.isFrozen(declared), true);
    assert.equal(Object.isFrozen(configured), true);
    assert.throws(() => {
        (configured as { step: string }).step = 'enabled';
    }, TypeError);
});

test('il sorgente non esporta etichette di attestazione vietate', () => {
    const source = readFileSync(new URL('./onboarding.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /['"](?:verified|ready|qualified)['"]/);
});
