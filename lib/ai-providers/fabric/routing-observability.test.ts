/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderRegistryError } from '../registry.ts';
import {
    FabricPolicyError,
    type FabricCapabilityDescriptor,
    type FabricExecutionPolicy,
} from './contract.ts';
import { DETERMINISTIC_CAPABILITY_DESCRIPTORS } from './deterministic-catalog.ts';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog.ts';
import {
    buildObservabilitySnapshot,
    observeAndResolve,
    observeVenue,
    type VenueObservation,
} from './routing-observability.ts';

const deterministic = DETERMINISTIC_CAPABILITY_DESCRIPTORS.icd_lookup;
const generative = GENERATIVE_CAPABILITY_DESCRIPTORS.patient_insight;

function policyFor(descriptor: FabricCapabilityDescriptor): FabricExecutionPolicy {
    return {
        schemaVersion: 'mediflow.ai.execution-policy.v1',
        requestId: 'synthetic-routing-request',
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

const binding = {
    task: 'caller_value_is_ignored',
    models: {
        clinical: 'qwen3.5:35b-a3b',
        reasoning: 'reasoning-model',
        ocr: 'ocr-model',
    },
    endpoint: 'http://127.0.0.1:11434',
    chatTimeoutMs: 1_000,
};

test('venue offline nega senza invocare il resolver', () => {
    const result = observeAndResolve(
        policyFor(generative),
        { descriptor: generative, venue: 'local_process' },
        [observeVenue('local_process', 'offline', 'daemon_unreachable')],
    );

    assert.equal(result.decision.outcome, 'denied');
    assert.equal(result.decision.denialCode, 'venue_offline');
    assert.equal(result.resolution, null);
    assert.equal(result.error, null);
});

test('venue degraded rispetta denyOnDegraded', () => {
    const observations = [observeVenue('local_process', 'degraded', 'daemon_unreachable')];
    const denied = observeAndResolve(
        policyFor(generative),
        { descriptor: generative, venue: 'local_process' },
        observations,
        { denyOnDegraded: true },
    );
    assert.equal(denied.decision.denialCode, 'venue_degraded');
    assert.equal(denied.error, null);

    const attempted = observeAndResolve(
        policyFor(generative),
        { descriptor: generative, venue: 'local_process' },
        observations,
    );
    assert.equal(attempted.decision.denialCode, 'class_mismatch');
    assert.equal(attempted.error instanceof FabricPolicyError, true);
});

test('risolve una capability deterministica canonica', () => {
    const result = observeAndResolve(
        policyFor(deterministic),
        { descriptor: deterministic, venue: 'local_process' },
        [observeVenue('local_process', 'available', null)],
    );

    assert.equal(result.decision.outcome, 'resolved');
    assert.equal(result.decision.denialCode, null);
    assert.ok(result.decision.receipt);
    assert.equal(result.decision.receipt.provider, 'in_house');
    assert.equal(result.resolution?.receipt, result.decision.receipt);
    assert.equal(result.error, null);
    assert.equal(Object.isFrozen(result.decision), true);
    assert.equal(Object.isFrozen(result.decision.observations), true);
    assert.equal(Object.isFrozen(result.decision.receipt), true);
    assert.equal(Object.isFrozen(result.decision.receipt.egressProfile), true);
});

test('cattura FabricPolicyError e ProviderRegistryError con il codice originale', () => {
    const fabricResult = observeAndResolve(
        { ...policyFor(deterministic), operation: 'projection' },
        { descriptor: deterministic, venue: 'local_process' },
        [observeVenue('local_process', 'available', null)],
    );
    assert.equal(fabricResult.decision.denialCode, 'policy_invalid');
    assert.equal(fabricResult.error instanceof FabricPolicyError, true);
    assert.equal((fabricResult.error as FabricPolicyError).code, 'policy_invalid');

    const providerResult = observeAndResolve(
        policyFor(generative),
        {
            descriptor: generative,
            venue: 'local_process',
            generative: { ...binding, provider: 'synthetic-unregistered-provider' },
        },
        [observeVenue('local_process', 'available', null)],
    );
    assert.equal(providerResult.decision.denialCode, 'provider_not_registered');
    assert.equal(providerResult.error instanceof ProviderRegistryError, true);
    assert.equal(
        (providerResult.error as ProviderRegistryError).code,
        'provider_not_registered',
    );
});

test('osservazione mancante diventa unknown/not_probed senza bloccare la risoluzione', () => {
    const result = observeAndResolve(
        policyFor(deterministic),
        { descriptor: deterministic, venue: 'local_process' },
        [observeVenue('home_base', 'offline', 'mode_disabled')],
    );

    assert.equal(result.decision.outcome, 'resolved');
    assert.deepEqual(
        result.decision.observations.find(({ venue }) => venue === 'local_process'),
        { venue: 'local_process', state: 'unknown', reason: 'not_probed' },
    );
});

test('observeVenue valida reason, congela gli oggetti e usa un solo snapshot', () => {
    assert.throws(
        () => observeVenue('local_process', 'offline', null),
        (error) => error instanceof FabricPolicyError && error.code === 'policy_invalid',
    );
    assert.throws(
        () => observeVenue('local_process', 'unknown', null),
        (error) => error instanceof FabricPolicyError && error.code === 'policy_invalid',
    );
    assert.equal(Object.isFrozen(observeVenue('local_process', 'available', null)), true);

    let iterations = 0;
    const observations = [observeVenue('local_process', 'offline', 'daemon_unreachable')];
    Object.defineProperty(observations, Symbol.iterator, {
        value: function* () {
            iterations += 1;
            yield iterations === 1
                ? observeVenue('local_process', 'offline', 'daemon_unreachable')
                : observeVenue('local_process', 'available', null);
        },
    });

    const result = observeAndResolve(
        policyFor(generative),
        { descriptor: generative, venue: 'local_process' },
        observations,
    );
    assert.equal(iterations, 1);
    assert.equal(result.decision.denialCode, 'venue_offline');
});

test('snapshot osservabilita valida, ordina e congela le venue', () => {
    const snapshot = buildObservabilitySnapshot([
        observeVenue('cloud', 'offline', 'egress_profile_closed'),
        observeVenue('local_process', 'available', null),
        observeVenue('on_device', 'unknown', 'not_implemented'),
        observeVenue('home_base', 'offline', 'mode_disabled'),
    ]);

    assert.deepEqual(
        snapshot.observations.map(({ venue }) => venue),
        ['local_process', 'home_base', 'on_device', 'cloud'],
    );
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.observations), true);
    for (const observation of snapshot.observations) {
        assert.equal(Object.isFrozen(observation), true);
    }
    assert.throws(
        () => buildObservabilitySnapshot('not-an-array' as unknown as VenueObservation[]),
        (error) => error instanceof FabricPolicyError && error.code === 'policy_invalid',
    );
});

test('RoutingDecision serializzato non contiene endpoint', () => {
    const result = observeAndResolve(
        policyFor(deterministic),
        { descriptor: deterministic, venue: 'local_process' },
        [observeVenue('local_process', 'available', null)],
    );

    assert.equal(JSON.stringify(result.decision).includes('http'), false);
});
