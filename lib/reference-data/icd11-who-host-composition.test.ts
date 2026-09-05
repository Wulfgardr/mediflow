/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    Icd11WhoHostCompositionError,
    createIcd11WhoHostComposition,
} from './icd11-who-host-composition.ts';
import {
    ICD11_WHO_CREDENTIAL_TARGET,
    ICD11_WHO_SECRET_REFERENCE,
    ICD11_WHO_TOKEN_TARGET,
} from './icd11-who-credential-lease.ts';
import type { Icd11WhoOfficialHttpsClientRequest } from './icd11-who-official-https-client.ts';
import { ICD11_WHO_TRANSPORT_TARGET, Icd11WhoServiceError } from './icd11-who-service.ts';

const NOW = 1_800_000_000_000;
const CLIENT_ID = 'synthetic-client-id-085';
const CLIENT_SECRET = 'SYNTHETIC_WHO_SECRET_085_0123456789';
const ACCESS_TOKEN = 'SYNTHETIC_WHO_TOKEN_085_ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

function sources(overrides: Record<string, unknown> = {}) {
    const clientCalls: Icd11WhoOfficialHttpsClientRequest[] = [];
    const audits: unknown[] = [];
    let secretCalls = 0;
    const value = Object.freeze({
        now: () => NOW,
        resolveSecretReference: async (request: Readonly<{
            target: string;
            secretRef: unknown;
            generation: number;
            signal: AbortSignal;
        }>) => {
            secretCalls += 1;
            assert.equal(request.target, ICD11_WHO_CREDENTIAL_TARGET);
            assert.equal(request.secretRef, ICD11_WHO_SECRET_REFERENCE);
            assert.equal(request.generation, 1);
            assert.equal(request.signal.aborted, false);
            return Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1',
                presentCredentials(sink: { set(clientId: string, clientSecret: string): unknown }) {
                    sink.set(CLIENT_ID, CLIENT_SECRET);
                },
            });
        },
        audit: async (receipt: unknown) => { audits.push(receipt); },
        client: async (request: Icd11WhoOfficialHttpsClientRequest) => {
            clientCalls.push(request);
            if (request.target === ICD11_WHO_TOKEN_TARGET) {
                assert.equal(request.headers.get('Authorization')?.startsWith('Basic '), true);
                assert.equal(request.form.get('grant_type'), 'client_credentials');
                return Object.freeze({
                    status: 200,
                    finalUrl: 'https://icdaccessmanagement.who.int/connect/token',
                    redirected: false,
                    body: JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3_600,
                        token_type: 'Bearer', scope: 'icdapi_access' }),
                });
            }
            assert.equal(request.target, ICD11_WHO_TRANSPORT_TARGET);
            if (request.target !== ICD11_WHO_TRANSPORT_TARGET) assert.fail('expected Search request');
            assert.equal(request.headers.get('Authorization'), `Bearer ${ACCESS_TOKEN}`);
            const query = request.query.get('q');
            return Object.freeze({
                status: 200,
                finalUrl: `https://id.who.int/icd/release/11/2026-01/mms/search?q=${encodeURIComponent(query ?? '')}`
                    + '&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false',
                redirected: false,
                body: JSON.stringify({
                    destinationEntities: [{ theCode: 'BA00', title: 'Essential hypertension' }],
                    error: false,
                    resultChopped: false,
                }),
            });
        },
        ...overrides,
    });
    return { value, clientCalls, audits, secretCalls: () => secretCalls };
}

function isServiceError(code: string) {
    return (error: unknown) => error instanceof Icd11WhoServiceError && error.code === code;
}

function isHostError(code: string) {
    return (error: unknown) => error instanceof Icd11WhoHostCompositionError && error.code === code;
}

test('starts OFF and denies before secret resolution, audit or network', async () => {
    const fixture = sources();
    const host = createIcd11WhoHostComposition(fixture.value);

    assert.deepEqual(host.status(), Object.freeze({
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
    await assert.rejects(host.search({ query: 'synthetic hypertension' }), isServiceError('offline_unavailable'));
    assert.equal(fixture.secretCalls(), 0);
    assert.equal(fixture.clientCalls.length, 0);
    assert.equal(fixture.audits.length, 0);
});

test('composes logical secret, OAuth, Search, audit and PHI-safe receipt after explicit enable', async () => {
    const fixture = sources();
    const host = createIcd11WhoHostComposition(fixture.value);
    host.configure(config());

    const result = await host.search({ query: 'synthetic hypertension' });

    assert.deepEqual(result.entries, [{ code: 'BA00', description: 'Essential hypertension', system: 'ICD-11' }]);
    assert.equal(result.receipt.source, 'live');
    assert.equal(fixture.secretCalls(), 1);
    assert.deepEqual(fixture.clientCalls.map((request) => request.target), [
        ICD11_WHO_TOKEN_TARGET,
        ICD11_WHO_TRANSPORT_TARGET,
    ]);
    assert.equal(fixture.audits.length, 1);
    assert.doesNotMatch(JSON.stringify([host.status(), result.receipt, fixture.audits]),
        /synthetic hypertension|SYNTHETIC_WHO|synthetic-client|secret|token/iu);
});

test('maps secret absence to credential_unavailable and keeps default-deny state explicit', async () => {
    const fixture = sources({ resolveSecretReference: async () => undefined });
    const host = createIcd11WhoHostComposition(fixture.value);
    host.configure(config());

    await assert.rejects(host.search({ query: 'synthetic hypertension' }),
        isServiceError('credential_unavailable'));
    assert.equal(fixture.clientCalls.length, 0);
    assert.equal(fixture.audits.length, 0);
    assert.equal(host.status().credential, 'enabled');
});

test('keeps network, egress and local revocation as independent host-owned gates', async () => {
    const fixture = sources();
    const host = createIcd11WhoHostComposition(fixture.value);

    host.configure(config({ network: 'offline' }));
    await assert.rejects(host.search({ query: 'synthetic hypertension' }),
        isServiceError('offline_unavailable'));
    host.configure(config({ generation: 2, egress: 'disabled' }));
    await assert.rejects(host.search({ query: 'synthetic hypertension' }),
        isServiceError('egress_disabled'));
    host.configure(config({ generation: 3, credential: 'revoked_local' }));
    await assert.rejects(host.search({ query: 'synthetic hypertension' }),
        isServiceError('credential_unavailable'));

    assert.equal(fixture.secretCalls(), 0);
    assert.equal(fixture.clientCalls.length, 0);
    assert.equal(fixture.audits.length, 0);
});

test('rejects hostile sources and configuration without invoking getters or ports', () => {
    let traps = 0;
    const accessor = Object.defineProperty({}, 'now', {
        enumerable: true,
        get() { traps += 1; return () => NOW; },
    });
    assert.throws(() => createIcd11WhoHostComposition(accessor), isHostError('input_invalid'));
    assert.throws(() => createIcd11WhoHostComposition(new Proxy({}, {
        ownKeys() { traps += 1; throw new Error('synthetic trap'); },
    })), isHostError('input_invalid'));

    const fixture = sources();
    const host = createIcd11WhoHostComposition(fixture.value);
    assert.throws(() => host.configure(new Proxy({}, {
        ownKeys() { traps += 1; throw new Error('synthetic trap'); },
    })), isHostError('config_invalid'));
    assert.equal(fixture.secretCalls(), 0);
    assert.equal(fixture.clientCalls.length, 0);
    assert.equal(traps, 0);
});

test('rejects config replay, mismatches, extra keys and stale use after restart or dispose', async () => {
    const fixture = sources();
    const host = createIcd11WhoHostComposition(fixture.value);
    host.configure(config());
    assert.throws(() => host.configure(config()), isHostError('config_invalid'));
    assert.throws(() => host.configure(config({ generation: 2, endpoint: 'https://caller.invalid' })),
        isHostError('config_invalid'));
    assert.throws(() => host.configure(config({ generation: 2, credential: 'configured' })),
        isHostError('config_invalid'));

    assert.equal(host.restart(), true);
    assert.equal(host.status().restartGeneration, 1);
    assert.deepEqual((await host.search({ query: 'synthetic hypertension' })).entries,
        [{ code: 'BA00', description: 'Essential hypertension', system: 'ICD-11' }]);
    assert.equal(host.dispose(), true);
    assert.equal(host.dispose(), false);
    await assert.rejects(host.search({ query: 'synthetic hypertension' }), isHostError('host_disposed'));
    assert.throws(() => host.status(), isHostError('host_disposed'));
});
