/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DETERMINISTIC_CAPABILITY_IDS,
    FabricPolicyError,
    GENERATIVE_CAPABILITY_IDS,
} from './contract.ts';
import {
    FABRIC_CAPABILITY_DESCRIPTORS,
    getFabricCapabilityDescriptor,
} from './catalog.ts';

const EXPECTED_IDS = [...GENERATIVE_CAPABILITY_IDS, ...DETERMINISTIC_CAPABILITY_IDS].sort();

test('unisce esattamente tutte le capability del contratto', () => {
    assert.equal(EXPECTED_IDS.length, 16);
    assert.deepEqual(Object.keys(FABRIC_CAPABILITY_DESCRIPTORS).sort(), EXPECTED_IDS);
    assert.equal(Object.isFrozen(FABRIC_CAPABILITY_DESCRIPTORS), true);
});

test('restituisce il descrittore registrato per una capability nota', () => {
    const descriptor = getFabricCapabilityDescriptor('patient_insight');
    assert.equal(descriptor, FABRIC_CAPABILITY_DESCRIPTORS.patient_insight);
});

test('rifiuta capability sconosciute fail-closed', () => {
    assert.throws(
        () => getFabricCapabilityDescriptor('unknown_capability'),
        (error) => error instanceof FabricPolicyError && error.code === 'capability_unknown',
    );
});
