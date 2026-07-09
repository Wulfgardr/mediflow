import assert from 'node:assert/strict';
import test from 'node:test';

import type { StoredNetworkPairedClient } from './network-pairing-model';

process.env.MEDIFLOW_LOCAL_API_TOKEN = 'network-discovery-auth-test-token';

function createPairedClient(): StoredNetworkPairedClient {
    return {
        clientId: 'client-1',
        deviceName: 'Desk iPad',
        clientPlatform: 'ipados',
        appVersion: null,
        grantedCapabilities: [],
        pairedAt: '2026-07-08T12:00:00.000Z',
        lastSeenAt: null,
        sourceIntentId: 'intent-1',
        tokenHash: 'hash',
    };
}

function unauthorizedResponse(): Response {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

test('resolveNetworkDiscoveryAuth accepts the local API token branch first', async () => {
    const { resolveNetworkDiscoveryAuth } = await import('./network-discovery-auth.ts');
    let pairedAuthCalled = false;
    const result = await resolveNetworkDiscoveryAuth(new Request('http://localhost/api/v1/network/node'), {
        requireLocalApiToken: () => null,
        authenticateNetworkPairedClient: async () => {
            pairedAuthCalled = true;
            return createPairedClient();
        },
        getNetworkModeGateResponse: async () => null,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authMode, 'local-token');
    assert.equal(pairedAuthCalled, false);
});

test('resolveNetworkDiscoveryAuth accepts paired credentials when local token is absent', async () => {
    const { resolveNetworkDiscoveryAuth } = await import('./network-discovery-auth.ts');
    const result = await resolveNetworkDiscoveryAuth(new Request('http://localhost/api/v1/network/capabilities'), {
        requireLocalApiToken: () => unauthorizedResponse() as never,
        authenticateNetworkPairedClient: async () => createPairedClient(),
        getNetworkModeGateResponse: async () => null,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.context.authMode, 'paired-client');
    assert.equal(result.context.pairedClient.clientId, 'client-1');
});

test('resolveNetworkDiscoveryAuth returns the standard 401 when both auth modes are absent', async () => {
    const { resolveNetworkDiscoveryAuth } = await import('./network-discovery-auth.ts');
    const result = await resolveNetworkDiscoveryAuth(new Request('http://localhost/api/v1/network/node'), {
        requireLocalApiToken: () => unauthorizedResponse() as never,
        authenticateNetworkPairedClient: async () => null,
        getNetworkModeGateResponse: async () => null,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.response.status, 401);
    assert.deepEqual(await result.response.json(), { error: 'Unauthorized' });
});

test('getPublicAppRevisionSummary exposes only public revision fields', async () => {
    const { getPublicAppRevisionSummary } = await import('./app-revision.ts');
    const summary = getPublicAppRevisionSummary();

    assert.deepEqual(Object.keys(summary).sort(), ['fingerprint', 'revision', 'sourceFingerprint']);
    assert.equal(Object.hasOwn(summary, 'branch'), false);
    assert.equal(Object.hasOwn(summary, 'worktreeHash'), false);
});

test('validateNetworkScopedPatientExport returns 404 before export validation when patient is outside scope', async () => {
    const { validateNetworkScopedPatientExport } = await import('./network-fse-validation.ts');
    let exportValidationCalled = false;

    const result = await validateNetworkScopedPatientExport('patient-outside-scope', 'amb-1', {
        getNetworkScopedPatientDetail: async () => null,
        validatePatientExport: async () => {
            exportValidationCalled = true;
            throw new Error('should not validate outside-scope patients');
        },
    });

    assert.equal(result.status, 404);
    assert.deepEqual(result.value, { error: 'Not found' });
    assert.equal(exportValidationCalled, false);
});
