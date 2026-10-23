import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildNetworkCapabilitiesResponse } from './network-contract';
import { projectNetworkCapabilitiesForDiscoveryAuth } from './network-discovery-auth';
import type { HostPortsContract } from './network-host-ports';

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
    } as const satisfies HostPortsContract);
    assert.deepEqual(projected.hostPorts, JSON.parse(readFileSync(new URL('../experiments/gpui-patient-pilot/transport/tests/fixtures/host-ports.json', import.meta.url), 'utf8')));
    assert.ok(projected.capabilities.filter(c => c.requiresPairing).every(c => c.status !== 'available'));
});

test('capabilities schema requires hostPorts and accepts the complete host response', () => {
    const loadPackage = createRequire(import.meta.url);
    const spec = loadPackage('js-yaml').load(readFileSync(new URL('../docs/openapi/mediflow-v1.yaml', import.meta.url), 'utf8'));
    const Ajv = loadPackage('ajv');
    const validate = new Ajv({ logger: false }).compile({
        $ref: '#/components/schemas/NetworkCapabilitiesResponse',
        components: spec.components,
    });
    const response = buildNetworkCapabilitiesResponse({
        nodeId: 'synthetic-host', snapshot: { 'network.mode': 'network-home-base' }, platform: 'darwin',
    });
    assert.equal(validate(response), true, JSON.stringify(validate.errors));
    const missingPorts: Partial<typeof response> = { ...response };
    delete missingPorts.hostPorts;
    assert.equal(validate(missingPorts), false);
    assert.ok(validate.errors.some((error: { keyword: string; params: { missingProperty?: string } }) =>
        error.keyword === 'required' && error.params.missingProperty === 'hostPorts'));
});

test('protocol 1.14 schema admits only the complete canonical host port roster', () => {
    const loadPackage = createRequire(import.meta.url);
    const spec = loadPackage('js-yaml').load(readFileSync(new URL('../docs/openapi/mediflow-v1.yaml', import.meta.url), 'utf8'));
    const Ajv = loadPackage('ajv');
    const validate = new Ajv({ logger: false }).compile({
        $ref: '#/components/schemas/HostPortsContract', components: spec.components,
    });
    const fixture = JSON.parse(readFileSync(new URL('../experiments/gpui-patient-pilot/transport/tests/fixtures/host-ports.json', import.meta.url), 'utf8'));
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
    const reordered = structuredClone(fixture);
    reordered.ports.reverse();
    assert.equal(validate(reordered), true, 'roster order is not negotiated');
    const reject = (value: typeof fixture, label: string) => assert.equal(validate(value), false, label);
    reject({ ...fixture, ports: [] }, 'empty roster');
    reject({ ...fixture, ports: fixture.ports.slice(1) }, 'missing port');
    reject({ ...fixture, ports: [...fixture.ports, fixture.ports[0]] }, 'extra port');
    for (let index = 0; index < fixture.ports.length; index++) {
        for (const field of ['id', 'revision', 'scope', 'authority', 'state']) {
            const invalid = structuredClone(fixture);
            invalid.ports[index][field] = field === 'revision' ? 2 : 'unknown';
            reject(invalid, `port ${index}: ${field}`);
        }
        for (const field of ['scope', 'authority', 'state']) {
            for (const other of fixture.ports) {
                if (other[field] === fixture.ports[index][field]) continue;
                const invalid = structuredClone(fixture);
                invalid.ports[index][field] = other[field];
                reject(invalid, `port ${index}: incompatible known ${field} ${other[field]}`);
            }
        }
        const duplicate = structuredClone(fixture);
        duplicate.ports[index] = fixture.ports[(index + 1) % fixture.ports.length];
        reject(duplicate, `duplicate ID replacing port ${index}`);
    }
});
