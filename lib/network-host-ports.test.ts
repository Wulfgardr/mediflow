import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildNetworkCapabilitiesResponse } from './network-contract';
import { projectNetworkCapabilitiesForDiscoveryAuth } from './network-discovery-auth';

test('host port discovery declares revisions and scopes without granting authority', () => {
    const response = buildNetworkCapabilitiesResponse({
        nodeId: 'synthetic-host', snapshot: { 'network.mode': 'network-home-base' }, platform: 'darwin',
    });
    const projected = projectNetworkCapabilitiesForDiscoveryAuth(response, {
        authMode: 'paired-client',
        pairedClient: {
            clientId: 'synthetic-device', deviceName: 'Synthetic', clientPlatform: 'macos', appVersion: null,
            grantedCapabilities: [], pairedAt: '2026-10-23T08:00:00Z', lastSeenAt: null,
            sourceIntentId: 'synthetic-intent', tokenHash: 'synthetic-hash',
        },
    });
    assert.deepEqual(projected.hostPorts, {
        revision: 1, writer: 'host', ports: [
            { id: 'clinical', revision: 1, scope: 'ambulatory', authority: 'paired-operator', state: 'available' },
            { id: 'account-profile', revision: 1, scope: 'operator', authority: 'operator-session', state: 'available' },
            { id: 'ai-preferences', revision: 1, scope: 'operator', authority: 'explicit-admin-grant', state: 'available' },
            { id: 'administrative', revision: 1, scope: 'operation', authority: 'explicit-admin-grant', state: 'not-exposed' },
            { id: 'provider', revision: 1, scope: 'operation', authority: 'explicit-egress-consent', state: 'not-exposed' },
            { id: 'document-derived', revision: 1, scope: 'ambulatory', authority: 'named-host-service', state: 'not-exposed' },
            { id: 'voice', revision: 1, scope: 'operation', authority: 'explicit-microphone-permission', state: 'not-exposed' },
            { id: 'file', revision: 1, scope: 'chosen-file', authority: 'explicit-file-choice', state: 'client-local' },
        ],
    });
    assert.deepEqual(projected.hostPorts, JSON.parse(readFileSync(new URL('../experiments/gpui-patient-pilot/transport/tests/fixtures/host-ports.json', import.meta.url), 'utf8')));
    assert.ok(projected.capabilities.filter(c => c.requiresPairing).every(c => c.status !== 'available'));
});
