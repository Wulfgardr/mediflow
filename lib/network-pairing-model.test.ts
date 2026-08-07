import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import {
    buildNetworkNodeSummary,
    createPairingIntentDraft,
    NETWORK_MODE_KEY,
} from './network-contract.ts';
/* @Codex */
import {
    addPendingPairingIntent,
    confirmPendingPairingIntent,
    hashNetworkPairedClientToken,
    NETWORK_PAIRED_CLIENT_ID_HEADER,
    NETWORK_PAIRED_CLIENT_TOKEN_HEADER,
    removePairedClient,
    type NetworkPairingState,
    type StoredNetworkPairedClient,
} from './network-pairing-model.ts';
/* @Codex */
import { authenticatePairedClientRequest } from './network-paired-client-auth.ts';

function buildHomeBaseIntent() {
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
            deviceName: 'Desk iPad',
            clientPlatform: 'ipados',
            requestedCapabilities: ['network.replica.readonly-patients'],
        },
        now: new Date('2026-04-04T09:00:00.000Z'),
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected a valid pairing intent draft.');
    }

    return result.value;
}

test('confirmPendingPairingIntent removes the intent and persists only the token hash', () => {
    const intent = buildHomeBaseIntent();
    const state = addPendingPairingIntent({ intents: [], clients: [] }, intent, new Date('2026-04-04T09:00:00.000Z'));

    const result = confirmPendingPairingIntent({
        state,
        intentId: intent.intentId,
        now: new Date('2026-04-04T09:02:00.000Z'),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.status, 'paired');
    assert.equal(result.value.pairedClient.grantedCapabilities[0], 'network.replica.readonly-patients');
    assert.equal(result.nextState.intents.length, 0);
    assert.equal(result.nextState.clients.length, 1);
    assert.notEqual(result.value.pairedClientToken, result.nextState.clients[0].tokenHash);
    assert.equal(
        hashNetworkPairedClientToken(result.value.pairedClientToken),
        result.nextState.clients[0].tokenHash,
    );
});

test('confirmPendingPairingIntent rejects expired intents', () => {
    const intent = buildHomeBaseIntent();
    const state = addPendingPairingIntent({ intents: [], clients: [] }, intent, new Date('2026-04-04T09:00:00.000Z'));

    const result = confirmPendingPairingIntent({
        state,
        intentId: intent.intentId,
        now: new Date('2026-04-04T09:11:00.000Z'),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.equal(result.value.code, 'PAIRING_INTENT_EXPIRED');
});

test('authenticatePairedClientRequest requires both paired client headers', () => {
    const intent = buildHomeBaseIntent();
    const state = addPendingPairingIntent({ intents: [], clients: [] }, intent, new Date('2026-04-04T09:00:00.000Z'));
    const result = confirmPendingPairingIntent({
        state,
        intentId: intent.intentId,
        now: new Date('2026-04-04T09:02:00.000Z'),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const request = new Request('https://127.0.0.1:3443/api/v1/network/patients', {
        headers: {
            [NETWORK_PAIRED_CLIENT_ID_HEADER]: result.value.pairedClient.clientId,
            [NETWORK_PAIRED_CLIENT_TOKEN_HEADER]: result.value.pairedClientToken,
        },
    });

    const authenticated = authenticatePairedClientRequest(request, result.nextState.clients);
    assert.ok(authenticated);
    assert.equal(authenticated?.clientId, result.value.pairedClient.clientId);

    const invalidRequest = new Request('https://127.0.0.1:3443/api/v1/network/patients', {
        headers: {
            [NETWORK_PAIRED_CLIENT_ID_HEADER]: result.value.pairedClient.clientId,
            [NETWORK_PAIRED_CLIENT_TOKEN_HEADER]: 'wrong-token',
        },
    });
    assert.equal(authenticatePairedClientRequest(invalidRequest, result.nextState.clients), null);
});

/* @Codex */
function buildStoredClient(clientId: string, token: string): StoredNetworkPairedClient {
    return {
        clientId,
        deviceName: `${clientId} device`,
        clientPlatform: 'ipados',
        appVersion: '1.0.0',
        grantedCapabilities: ['network.replica.readonly-patients'],
        pairedAt: '2026-07-29T09:00:00.000Z',
        lastSeenAt: null,
        sourceIntentId: `${clientId}-intent`,
        tokenHash: hashNetworkPairedClientToken(token),
    };
}

/* @Codex */
function buildRemovalState(): NetworkPairingState {
    return {
        intents: [buildHomeBaseIntent()],
        clients: [
            buildStoredClient('client-remove', 'token-remove'),
            buildStoredClient('client-keep', 'token-keep'),
        ],
    };
}

test('removePairedClient removes only the requested client', () => {
    const state = buildRemovalState();
    const result = removePairedClient(state, 'client-remove');

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 200);
    assert.deepEqual(result.value, { removedClientId: 'client-remove' });
    assert.deepEqual(result.nextState.clients.map((client) => client.clientId), ['client-keep']);
    assert.equal(result.nextState.intents, state.intents);
    assert.equal(state.clients.length, 2);
});

test('removePairedClient returns 404 for an unknown client id', () => {
    const state = buildRemovalState();
    const result = removePairedClient(state, 'client-unknown');

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
    assert.deepEqual(result.value, {
        error: 'Not Found',
        code: 'PAIRING_CLIENT_NOT_FOUND',
        message: 'Paired client not found.',
    });
});

test('removed paired credentials no longer authenticate', () => {
    const result = removePairedClient(buildRemovalState(), 'client-remove');
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const request = new Request('https://127.0.0.1:3443/api/v1/network/node', {
        headers: {
            [NETWORK_PAIRED_CLIENT_ID_HEADER]: 'client-remove',
            [NETWORK_PAIRED_CLIENT_TOKEN_HEADER]: 'token-remove',
        },
    });
    assert.equal(authenticatePairedClientRequest(request, result.nextState.clients), null);
});

test('removing one paired client preserves authentication for other clients', () => {
    const result = removePairedClient(buildRemovalState(), 'client-remove');
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const request = new Request('https://127.0.0.1:3443/api/v1/network/node', {
        headers: {
            [NETWORK_PAIRED_CLIENT_ID_HEADER]: 'client-keep',
            [NETWORK_PAIRED_CLIENT_TOKEN_HEADER]: 'token-keep',
        },
    });
    const authenticated = authenticatePairedClientRequest(request, result.nextState.clients);
    assert.equal(authenticated?.clientId, 'client-keep');
});
