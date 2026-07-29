/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DETERMINISTIC_CAPABILITY_DESCRIPTORS } from './deterministic-catalog.ts';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog.ts';
import {
    FabricPolicyError,
    type FabricCapabilityDescriptor,
    type FabricExecutionPolicy,
} from './contract.ts';
import { advanceOnboarding, startOnboarding, type ProviderOnboardingState } from './onboarding.ts';
import { admitProvider, transitionProviderLifecycle } from './provider-lifecycle.ts';
import { routeCandidateCapability } from './candidate-router.ts';
import { observeVenue } from './routing-observability.ts';

const deterministic = DETERMINISTIC_CAPABILITY_DESCRIPTORS.icd_lookup;
const generative = GENERATIVE_CAPABILITY_DESCRIPTORS.patient_insight;
const binding = {
    task: 'caller_value_is_ignored',
    models: { clinical: 'qwen3.5:35b-a3b', reasoning: 'reasoning-model', ocr: 'ocr-model' },
    endpoint: 'http://127.0.0.1:11434',
    chatTimeoutMs: 1_000,
};

function policyFor(descriptor: FabricCapabilityDescriptor): FabricExecutionPolicy {
    return {
        schemaVersion: 'mediflow.ai.execution-policy.v1',
        requestId: 'synthetic-candidate-request',
        capability: descriptor.id,
        authorityPlane: 'clinical_application',
        operation: descriptor.operation,
        dataClass: descriptor.dataClass,
        allowedVenues: descriptor.venues,
        egressProfileId: descriptor.egressProfileId,
        consentRef: null,
        retention: 'not_persisted',
        review: descriptor.review,
        provenanceRequired: true,
        fallback: 'none',
    };
}

function enabledLocal(provider = 'ollama'): ProviderOnboardingState {
    const declared = startOnboarding(provider, 'local_model');
    const configured = advanceOnboarding(declared, { type: 'configure' });
    const credentialed = advanceOnboarding(configured, { type: 'credential_declared' });
    const attested = advanceOnboarding(credentialed, { type: 'attest_local' });
    return advanceOnboarding(attested, { type: 'enable' });
}

function availableLocal(provider = 'ollama') {
    return admitProvider(enabledLocal(provider));
}

test('il core deterministico resta disponibile e produce una receipt in_house', () => {
    const result = routeCandidateCapability({
        policy: policyFor(deterministic),
        request: { descriptor: deterministic, venue: 'local_process' },
        observations: [observeVenue('local_process', 'available', null)],
    });

    assert.equal(result.decision.outcome, 'resolved');
    assert.equal(result.decision.receipt?.provider, 'in_house');
    assert.equal(result.decision.fallback, 'denied_by_contract');
    assert.equal(result.resolution?.receipt.provider, 'in_house');
});

test('snapshotta identificatori candidati una sola volta e respinge valori non PHI-safe', () => {
    let requestIdReads = 0;
    const policy = {
        ...policyFor(deterministic),
        get requestId() {
            requestIdReads += 1;
            return requestIdReads === 1 ? 'safe-request-1' : 'Mario Rossi';
        },
    } as FabricExecutionPolicy;
    const resolved = routeCandidateCapability({
        policy,
        request: { descriptor: deterministic, venue: 'local_process' },
        observations: [observeVenue('local_process', 'available', null)],
    });
    assert.equal(resolved.decision.requestId, 'safe-request-1');
    assert.equal(requestIdReads, 1);
    assert.equal(JSON.stringify(resolved.decision).includes('Mario Rossi'), false);

    for (const input of [
        {
            policy: { ...policyFor(deterministic), requestId: 'Mario Rossi' },
            request: { descriptor: deterministic, venue: 'local_process' },
        },
        {
            policy: { ...policyFor(deterministic), capability: 'patient name' },
            request: { descriptor: deterministic, venue: 'local_process' },
        },
        {
            policy: policyFor(deterministic),
            request: { descriptor: deterministic, venue: 'patient name' },
        },
    ] as const) {
        assert.throws(
            () => routeCandidateCapability({
                ...input,
                observations: [observeVenue('local_process', 'available', null)],
            } as never),
            (error) => error instanceof FabricPolicyError && error.code === 'policy_invalid',
        );
    }
});

test('una generativa richiede onboarding enabled, lifecycle disponibile e receipt coerente', () => {
    const result = routeCandidateCapability({
        policy: policyFor(generative),
        request: { descriptor: generative, venue: 'local_process', generative: binding },
        observations: [observeVenue('local_process', 'available', null)],
        onboarding: enabledLocal(),
        lifecycle: availableLocal(),
    });

    assert.equal(result.decision.outcome, 'resolved');
    assert.equal(result.decision.receipt?.provider, 'ollama');
    assert.equal(result.decision.receipt?.providerReceipt?.provider, 'ollama');
    assert.equal(result.decision.fallback, 'denied_by_contract');
});

test('revoca, degrado e mismatch onboarding/provider non producono receipt', () => {
    const available = availableLocal();
    const cases = [
        transitionProviderLifecycle(available, 'degrade'),
        transitionProviderLifecycle(available, 'revoke'),
        availableLocal('other_provider'),
    ];

    for (const lifecycle of cases) {
        const result = routeCandidateCapability({
            policy: policyFor(generative),
            request: { descriptor: generative, venue: 'local_process', generative: binding },
            observations: [observeVenue('local_process', 'available', null)],
            onboarding: lifecycle.provider === 'other_provider' ? enabledLocal('other_provider') : enabledLocal(),
            lifecycle,
        });
        assert.equal(result.decision.outcome, 'denied');
        assert.equal(result.decision.receipt, null);
        assert.equal(result.resolution, null);
    }

    const incomplete = routeCandidateCapability({
        policy: policyFor(generative),
        request: { descriptor: generative, venue: 'local_process', generative: binding },
        observations: [observeVenue('local_process', 'available', null)],
        onboarding: startOnboarding('ollama', 'local_model'),
        lifecycle: available,
    });
    assert.equal(incomplete.decision.denialCode, 'provider_onboarding_required');
    assert.equal(incomplete.decision.receipt, null);
});

test('offline, unknown e degraded negano senza cambio venue né receipt', () => {
    for (const [state, reason, denialCode] of [
        ['offline', 'daemon_unreachable', 'venue_offline'],
        ['unknown', 'not_probed', 'venue_unknown'],
        ['degraded', 'daemon_unreachable', 'venue_degraded'],
    ] as const) {
        const result = routeCandidateCapability({
            policy: policyFor(deterministic),
            request: { descriptor: deterministic, venue: 'local_process' },
            observations: [observeVenue('local_process', state, reason)],
        });
        assert.equal(result.decision.denialCode, denialCode);
        assert.equal(result.decision.requestedVenue, 'local_process');
        assert.equal(result.decision.receipt, null);
    }
});

test('home_base accetta soltanto reconnessione trusted e non espone PHI', () => {
    const nonTrusted = [
        're_login_required',
        're_pairing_required',
        'wait_mode_enabled',
        'locked_out_wait',
    ] as const;

    for (const reconnection of nonTrusted) {
        const result = routeCandidateCapability({
            policy: policyFor(deterministic),
            request: { descriptor: deterministic, venue: 'home_base' },
            observations: [observeVenue('home_base', 'available', null)],
            reconnection,
        });
        assert.equal(result.decision.denialCode, 'paired_trust_denied');
        assert.equal(result.decision.receipt, null);
    }

    const trusted = routeCandidateCapability({
        policy: policyFor(deterministic),
        request: { descriptor: deterministic, venue: 'home_base' },
        observations: [observeVenue('home_base', 'available', null)],
        reconnection: 'trusted',
    });
    assert.equal(trusted.decision.receipt?.provider, 'in_house');
    assert.equal(JSON.stringify(trusted.decision).includes('endpoint'), false);
    assert.equal(JSON.stringify(trusted.decision).includes('token'), false);
});

test('cloud, on_device e classi consumer non producono una receipt candidata', () => {
    for (const venue of ['cloud', 'on_device'] as const) {
        const result = routeCandidateCapability({
            policy: policyFor(deterministic),
            request: { descriptor: deterministic, venue },
            observations: [observeVenue(venue, 'available', null)],
        });
        assert.equal(result.decision.outcome, 'denied');
        assert.equal(result.decision.receipt, null);
    }

    const consumerOnboarding = Object.freeze({
        schemaVersion: 'mediflow.ai.provider-onboarding.v1' as const,
        provider: 'ollama',
        credentialClass: 'consumer_login' as const,
        step: 'enabled' as const,
        attestation: 'none' as const,
    });
    const deniedConsumer = routeCandidateCapability({
        policy: policyFor(generative),
        request: { descriptor: generative, venue: 'local_process', generative: binding },
        observations: [observeVenue('local_process', 'available', null)],
        onboarding: consumerOnboarding,
        lifecycle: availableLocal(),
    });
    assert.equal(deniedConsumer.decision.denialCode, 'provider_onboarding_required');
    assert.equal(deniedConsumer.decision.receipt, null);
});
