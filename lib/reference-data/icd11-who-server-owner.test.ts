/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    Icd11WhoServerOwnerError,
    createIcd11WhoServerProcessOwner,
} from './icd11-who-server-owner-internal.ts';
import { Icd11WhoServiceError } from './icd11-who-service.ts';

const NOW = 1_800_000_000_000;

function ports(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        now: () => NOW,
        resolveSecretReference: async () => undefined,
        audit: async () => undefined,
        ...overrides,
    });
}

function config(overrides: Record<string, unknown> = {}) {
    return Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-host-config.v1',
        generation: 1,
        network: 'online',
        egress: 'enabled',
        credential: 'enabled',
        ...overrides,
    });
}

function isOwnerError(code: string) {
    return (error: unknown) => error instanceof Icd11WhoServerOwnerError && error.code === code;
}

test('server-only singleton facade constructs exactly one fixed process owner', () => {
    const source = readFileSync(new URL('./icd11-who-server-owner.ts', import.meta.url), 'utf8');
    assert.match(source, /^\/\* @Codex \*\/\nimport 'server-only';/u);
    assert.equal(source.match(/\bcreateIcd11WhoServerProcessOwner\s*\(/gu)?.length, 1);
    assert.doesNotMatch(source, /process\.env|globalThis|\bfetch\b|endpoint|proxy|client|secret|token/iu);
});

test('process owner is default OFF, requires one host-port bind and never accepts a client', async () => {
    const owner = createIcd11WhoServerProcessOwner();
    assert.deepEqual(owner.status(), Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-host-status.v1',
        generation: 0,
        restartGeneration: 0,
        network: 'offline',
        egress: 'disabled',
        credential: 'absent',
        operation: 'mediflow.reference_data.icd11.search.v1',
        releaseId: '2026-01',
        language: 'en',
    }));
    assert.throws(() => owner.configure(config()), isOwnerError('ports_unbound'));
    await assert.rejects(owner.search({ query: 'synthetic hypertension' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'offline_unavailable');

    assert.equal(owner.bind(ports()), true);
    assert.throws(() => owner.bind(ports()), isOwnerError('ports_already_bound'));
    assert.throws(() => owner.bind(ports({ client: async () => undefined })),
        isOwnerError('ports_already_bound'));
    owner.configure(config());
    await assert.rejects(owner.search({ query: 'synthetic hypertension' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'credential_unavailable');
});

test('host-port binding rejects extra fields, accessors and proxies without invocation', () => {
    let calls = 0;
    const owner = createIcd11WhoServerProcessOwner();
    assert.throws(() => owner.bind(ports({ endpoint: 'https://caller.invalid' })),
        isOwnerError('input_invalid'));
    assert.throws(() => owner.bind(Object.defineProperty({}, 'now', {
        enumerable: true, get() { calls += 1; return () => NOW; },
    })), isOwnerError('input_invalid'));
    assert.throws(() => owner.bind(new Proxy({}, {
        ownKeys() { calls += 1; throw new Error('synthetic trap'); },
    })), isOwnerError('input_invalid'));
    assert.equal(calls, 0);
});

test('restart preserves host policy after bind and dispose is terminal', () => {
    const owner = createIcd11WhoServerProcessOwner();
    owner.bind(ports());
    owner.configure(config({ network: 'offline' }));
    assert.equal(owner.restart(), true);
    assert.equal(owner.status().restartGeneration, 1);
    assert.equal(owner.status().network, 'offline');
    assert.equal(owner.dispose(), true);
    assert.equal(owner.dispose(), false);
    assert.throws(() => owner.status(), isOwnerError('owner_disposed'));
    assert.throws(() => owner.bind(ports()), isOwnerError('owner_disposed'));
});
