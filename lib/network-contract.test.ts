import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import {
    buildNetworkCapabilitiesResponse,
    buildNetworkNodeSummary,
    buildNetworkReplicaSummary,
    buildNetworkSessionSummary,
    createPairingIntentDraft,
    NETWORK_MODE_KEY,
} from './network-contract.ts';

test('buildNetworkNodeSummary falls back to clinic or host name and keeps local-only as default', () => {
    const summary = buildNetworkNodeSummary({
        nodeId: 'node-1',
        snapshot: {
            clinicName: 'MediFlow Studio',
        },
        hostName: 'mediflow-mac.local',
    });

    assert.equal(summary.displayName, 'MediFlow Studio');
    assert.equal(summary.operatingMode, 'local-only');
    assert.equal(summary.transport.localTlsPort, 3443);
    assert.equal(summary.protocolVersion, '1.9.0');
});

test('buildNetworkSessionSummary exposes network-unpaired when home-base mode is enabled', () => {
    const summary = buildNetworkSessionSummary({
        nodeId: 'node-1',
        snapshot: {
            [NETWORK_MODE_KEY]: 'network-home-base',
        },
    });

    assert.equal(summary.operatingMode, 'network-home-base');
    assert.equal(summary.sessionState, 'network-unpaired');
    assert.equal(summary.pairingState, 'required');
    assert.equal(summary.trustedSession, false);
    assert.equal(summary.replica.state, 'unpaired');
    assert.equal(summary.replica.pendingAction, 'pairing-required');
});

test('buildNetworkSessionSummary exposes paired-online when at least one trusted client exists', () => {
    const summary = buildNetworkSessionSummary({
        nodeId: 'node-1',
        snapshot: {
            [NETWORK_MODE_KEY]: 'network-home-base',
        },
        hasPairedClients: true,
    });

    assert.equal(summary.sessionState, 'network-paired-online');
    assert.equal(summary.pairingState, 'paired');
    assert.equal(summary.trustedSession, true);
    assert.equal(summary.authMode, 'paired-client-plus-session');
    assert.equal(summary.replica.state, 'online');
});

test('buildNetworkCapabilitiesResponse disables pairing bootstrap while node stays local-only', () => {
    const response = buildNetworkCapabilitiesResponse({
        nodeId: 'node-1',
        snapshot: {},
        platform: 'darwin',
    });

    const pairingBootstrap = response.capabilities.find((item) => item.key === 'network.pairing.bootstrap');
    assert.ok(pairingBootstrap);
    assert.equal(pairingBootstrap.status, 'disabled');

    const scheduler = response.capabilities.find((item) => item.key === 'local.backup.scheduler.macos');
    assert.ok(scheduler);
    assert.equal(scheduler.status, 'available');

    const aiRuntime = response.capabilities.find((item) => item.key === 'network.ai.central-runtime');
    assert.ok(aiRuntime);
    assert.equal(aiRuntime.status, 'disabled');
});

test('buildNetworkCapabilitiesResponse surfaces centralized AI availability when the node runtime is ready', () => {
    const response = buildNetworkCapabilitiesResponse({
        nodeId: 'node-1',
        snapshot: {
            [NETWORK_MODE_KEY]: 'network-home-base',
        },
        platform: 'darwin',
        aiCentralRuntimeStatus: 'available',
    });

    const aiRuntime = response.capabilities.find((item) => item.key === 'network.ai.central-runtime');
    assert.ok(aiRuntime);
    assert.equal(aiRuntime.status, 'available');

    const readonlyPatients = response.capabilities.find((item) => item.key === 'network.replica.readonly-patients');
    assert.ok(readonlyPatients);
    assert.equal(readonlyPatients.status, 'available');

    const patientWrite = response.capabilities.find((item) => item.key === 'network.replica.write-patient-profile');
    assert.ok(patientWrite);
    assert.equal(patientWrite.status, 'available');
    assert.equal(patientWrite.requiresPairing, true);

    const diaryRead = response.capabilities.find((item) => item.key === 'network.replica.readonly-clinical-diary');
    assert.ok(diaryRead);
    assert.equal(diaryRead.status, 'available');
    assert.equal(diaryRead.requiresPairing, true);

    const diaryWrite = response.capabilities.find((item) => item.key === 'network.replica.write-clinical-diary');
    assert.ok(diaryWrite);
    assert.equal(diaryWrite.status, 'available');
    assert.equal(diaryWrite.requiresPairing, true);

    const therapyRead = response.capabilities.find((item) => item.key === 'network.replica.readonly-therapies');
    assert.ok(therapyRead);
    assert.equal(therapyRead.status, 'available');
    assert.equal(therapyRead.requiresPairing, true);

    const therapyWrite = response.capabilities.find((item) => item.key === 'network.replica.write-therapies');
    assert.ok(therapyWrite);
    assert.equal(therapyWrite.status, 'available');
    assert.equal(therapyWrite.requiresPairing, true);
});

test('buildNetworkReplicaSummary keeps offline-deferred and conflict-review as explicit preview states', () => {
    const deferred = buildNetworkReplicaSummary({
        operatingMode: 'network-home-base',
        sessionState: 'network-paired-offline-degraded',
        degradedReason: null,
    });
    assert.equal(deferred.state, 'offline-deferred');
    assert.equal(deferred.pendingAction, 'queue-snapshot');

    const conflict = buildNetworkReplicaSummary({
        operatingMode: 'network-home-base',
        sessionState: 'network-paired-offline-degraded',
        degradedReason: 'version-conflict-review',
    });
    assert.equal(conflict.state, 'conflict-review');
    assert.equal(conflict.pendingAction, 'manual-review');
});

test('createPairingIntentDraft rejects requests while home-base mode is disabled', () => {
    const result = createPairingIntentDraft({
        nodeSummary: buildNetworkNodeSummary({
            nodeId: 'node-1',
            snapshot: {},
            hostName: 'mediflow-mac.local',
        }),
        snapshot: {},
        payload: {
            deviceName: 'MediFlow iPad',
            clientPlatform: 'ipados',
        },
        now: new Date('2026-04-03T12:00:00.000Z'),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.equal(result.value.code, 'NETWORK_MODE_DISABLED');
});

test('createPairingIntentDraft emits a PHI-safe pending bootstrap when home-base mode is enabled', () => {
    const result = createPairingIntentDraft({
        nodeSummary: buildNetworkNodeSummary({
            nodeId: 'node-1',
            snapshot: {
                [NETWORK_MODE_KEY]: 'network-home-base',
                clinicName: 'MediFlow Studio',
            },
            hostName: 'mediflow-mac.local',
        }),
        snapshot: {
            [NETWORK_MODE_KEY]: 'network-home-base',
            clinicName: 'MediFlow Studio',
        },
        payload: {
            deviceName: 'Desk iPhone',
            clientPlatform: 'ios',
            requestedCapabilities: ['network.replica.readonly-patients', 'network.replica.readonly-patients'],
        },
        now: new Date('2026-04-03T12:00:00.000Z'),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 201);
    assert.equal(result.value.status, 'pending-home-base-confirmation');
    assert.equal(result.value.nodeDisplayName, 'MediFlow Studio');
    assert.deepEqual(result.value.requestedCapabilities, ['network.replica.readonly-patients']);
    assert.equal(result.value.requestedAt, '2026-04-03T12:00:00.000Z');
    assert.equal(result.value.expiresAt, '2026-04-03T12:10:00.000Z');
});
