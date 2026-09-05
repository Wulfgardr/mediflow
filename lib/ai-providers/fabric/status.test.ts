/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './catalog.ts';
import { FABRIC_SCHEMA_VERSION } from './contract.ts';
import { buildFabricStatusSnapshot } from './status.ts';

const SNAPSHOT_KEYS = [
    'capabilities',
    'contractVersion',
    'egressGateOpen',
    'providerDisclosure',
    'readinessNote',
    'schemaVersion',
];
const CAPABILITY_KEYS = [
    'availabilityDisposition',
    'class',
    'contractSchema',
    'egressProfile',
    'id',
    'killSwitch',
    'operation',
    'review',
    'venues',
];
const EGRESS_PROFILE_KEYS = ['egress', 'id', 'version'];

test('espone uno snapshot minimo, ordinato e congelato', () => {
    const snapshot = buildFabricStatusSnapshot({
        ollama: () => ({ status: 'denied', reason: 'missing' }),
        athena: () => ({ status: 'denied', reason: 'corrupt' }),
    });

    assert.deepEqual(Object.keys(snapshot).sort(), SNAPSHOT_KEYS);
    assert.equal(snapshot.schemaVersion, 'mediflow.ai.fabric-status.v1');
    assert.equal(snapshot.contractVersion, FABRIC_SCHEMA_VERSION);
    assert.equal(snapshot.egressGateOpen, false);
    assert.equal(snapshot.readinessNote, 'available_unqualified');
    assert.deepEqual(snapshot.providerDisclosure.providers.map(({ id }) => id), [
        'ollama', 'athena_mlx', 'openai', 'anthropic',
    ]);
    assert.equal(snapshot.providerDisclosure.providers[0].effective.lifecycle, 'missing');
    assert.equal(snapshot.providerDisclosure.providers[1].effective.lifecycle, 'corrupt');
    assert.equal(snapshot.capabilities.length, 16);
    assert.deepEqual(
        snapshot.capabilities.map((capability) => capability.id),
        Object.keys(FABRIC_CAPABILITY_DESCRIPTORS).sort(),
    );

    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.providerDisclosure), true);
    assert.equal(Object.isFrozen(snapshot.providerDisclosure.providers), true);
    assert.equal(Object.isFrozen(snapshot.capabilities), true);
    for (const capability of snapshot.capabilities) {
        assert.deepEqual(Object.keys(capability).sort(), CAPABILITY_KEYS);
        assert.deepEqual(Object.keys(capability.egressProfile).sort(), EGRESS_PROFILE_KEYS);
        assert.equal(Object.isFrozen(capability), true);
        assert.equal(Object.isFrozen(capability.venues), true);
        assert.equal(Object.isFrozen(capability.egressProfile), true);
        assert.equal(capability.killSwitch === null || typeof capability.killSwitch === 'string', true);
    }
});

test('espone disposition truthful senza trasformarla in readiness provider', () => {
    const snapshot = buildFabricStatusSnapshot();
    const byId = Object.fromEntries(snapshot.capabilities.map((capability) => [capability.id, capability]));

    for (const id of ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning']) {
        assert.equal(byId[id]?.availabilityDisposition, 'proposal_only', id);
    }
    assert.equal(byId.ocr?.availabilityDisposition, 'unavailable');
    assert.deepEqual(byId.ocr?.venues, []);
    assert.equal(byId.ocr?.killSwitch, null);
    assert.equal('provider' in byId.ocr, false);
    assert.equal('fallback' in byId.ocr, false);

    for (const capability of snapshot.capabilities.filter((item) => item.class === 'deterministic')) {
        assert.equal(capability.availabilityDisposition, 'available', capability.id);
    }
});

test('non serializza endpoint o altri URL', () => {
    assert.equal(JSON.stringify(buildFabricStatusSnapshot()).toLowerCase().includes('http'), false);
});
