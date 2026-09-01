/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    ICD11_WHO_ENVIRONMENT_KEYS,
    createIcd11WhoProductionRuntime,
} from './icd11-who-production-runtime.ts';
import {
    ICD11_WHO_CREDENTIAL_TARGET,
    ICD11_WHO_SECRET_REFERENCE,
} from './icd11-who-credential-lease.ts';
import { Icd11WhoServiceError } from './icd11-who-service.ts';

const CLIENT_ID = 'synthetic-client-id-085';
const CLIENT_SECRET = 'SYNTHETIC_WHO_SECRET_085_0123456789';

function fixture(environment: Readonly<Record<string, string | undefined>>, searchResult?: unknown) {
    const reads: string[] = [];
    const configs: unknown[] = [];
    const audits: unknown[] = [];
    let ports: Record<string, unknown> | null = null;
    const owner = Object.freeze({
        bind(value: unknown) { ports = value as Record<string, unknown>; return true; },
        configure(value: unknown) { configs.push(value); },
        async search() {
            if (searchResult instanceof Error) throw searchResult;
            return searchResult ?? Object.freeze({
                entries: Object.freeze([{ code: 'BA00', description: 'Essential hypertension', system: 'ICD-11' }]),
                receipt: Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1',
                    operation: 'mediflow.reference_data.icd11.search.v1', releaseId: '2026-01', language: 'en',
                    source: 'live', resultCount: 1, latencyMs: 1, completedAt: '2027-01-15T08:00:00.000Z' }),
            });
        },
    });
    const runtime = createIcd11WhoProductionRuntime(Object.freeze({
        owner,
        now: () => Date.parse('2027-01-15T08:00:00.000Z'),
        readEnvironment(name: string) { reads.push(name); return environment[name]; },
        audit(receipt: unknown) { audits.push(receipt); },
    }));
    return { runtime, reads, configs, audits, ports: () => ports };
}

test('is disabled by default without reading credential environment', () => {
    const current = fixture({});
    assert.deepEqual(current.runtime.readiness(), Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1',
        status: 'disabled', releaseId: '2026-01', language: 'en',
    }));
    assert.deepEqual(current.reads, [ICD11_WHO_ENVIRONMENT_KEYS.enabled]);
    assert.deepEqual(current.configs, [Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-host-config.v1', generation: 1,
        network: 'offline', egress: 'disabled', credential: 'absent',
    })]);
});

test('distinguishes absent credentials and explicit offline policy without exposing values', () => {
    const absent = fixture({
        [ICD11_WHO_ENVIRONMENT_KEYS.enabled]: '1',
        [ICD11_WHO_ENVIRONMENT_KEYS.network]: 'online',
    });
    assert.equal(absent.runtime.readiness().status, 'credentials_absent');

    const offline = fixture({
        [ICD11_WHO_ENVIRONMENT_KEYS.enabled]: '1',
        [ICD11_WHO_ENVIRONMENT_KEYS.network]: 'offline',
        [ICD11_WHO_ENVIRONMENT_KEYS.clientId]: CLIENT_ID,
        [ICD11_WHO_ENVIRONMENT_KEYS.clientSecret]: CLIENT_SECRET,
    });
    assert.equal(offline.runtime.readiness().status, 'offline');
    assert.doesNotMatch(JSON.stringify([offline.runtime.readiness(), offline.configs]),
        /synthetic-client|SYNTHETIC_WHO|secret|token/iu);
});

test('binds the fixed logical secret through an ephemeral presenter and starts configured-unverified', () => {
    const current = fixture({
        [ICD11_WHO_ENVIRONMENT_KEYS.enabled]: '1',
        [ICD11_WHO_ENVIRONMENT_KEYS.network]: 'online',
        [ICD11_WHO_ENVIRONMENT_KEYS.clientId]: CLIENT_ID,
        [ICD11_WHO_ENVIRONMENT_KEYS.clientSecret]: CLIENT_SECRET,
    });
    assert.equal(current.runtime.readiness().status, 'configured');
    const resolver = current.ports()?.resolveSecretReference as (request: unknown) => Promise<unknown>;
    assert.equal(typeof resolver, 'function');
    return resolver(Object.freeze({ target: ICD11_WHO_CREDENTIAL_TARGET, secretRef: ICD11_WHO_SECRET_REFERENCE,
        generation: 1, signal: new AbortController().signal })).then((resolved) => {
        const values: string[] = [];
        (resolved as { presentCredentials(sink: { set(id: string, secret: string): void }): void })
            .presentCredentials({ set(id, secret) { values.push(id, secret); } });
        assert.deepEqual(values, [CLIENT_ID, CLIENT_SECRET]);
        assert.throws(() => (resolved as { presentCredentials(sink: unknown): void }).presentCredentials({}),
            /credential_unavailable/u);
    });
});

test('publishes available only after a successful search and unavailable after a bounded failure', async () => {
    const environment = {
        [ICD11_WHO_ENVIRONMENT_KEYS.enabled]: '1',
        [ICD11_WHO_ENVIRONMENT_KEYS.network]: 'online',
        [ICD11_WHO_ENVIRONMENT_KEYS.clientId]: CLIENT_ID,
        [ICD11_WHO_ENVIRONMENT_KEYS.clientSecret]: CLIENT_SECRET,
    };
    const success = fixture(environment);
    await success.runtime.search('synthetic hypertension');
    assert.equal(success.runtime.readiness().status, 'available');

    const failure = fixture(environment, new Icd11WhoServiceError('upstream_unavailable'));
    await assert.rejects(failure.runtime.search('synthetic hypertension'),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'upstream_unavailable');
    assert.equal(failure.runtime.readiness().status, 'unavailable');
});

test('forwards only the PHI-safe receipt to the audit port', () => {
    const current = fixture({});
    const audit = current.ports()?.audit as (receipt: unknown) => void;
    const receipt = Object.freeze({ schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1',
        operation: 'mediflow.reference_data.icd11.search.v1', releaseId: '2026-01', language: 'en', source: 'live',
        resultCount: 1, latencyMs: 2, completedAt: '2027-01-15T08:00:00.000Z' });
    audit(receipt);
    assert.deepEqual(current.audits, [receipt]);
});

test('production facade is server-only, singleton and audits without query or result content', () => {
    const source = readFileSync(new URL('./icd11-who-production.ts', import.meta.url), 'utf8');
    assert.match(source, /^\/\* @Codex \*\/\nimport 'server-only';/u);
    assert.equal(source.match(/\bcreateIcd11WhoProductionRuntime\s*\(/gu)?.length, 1);
    assert.match(source, /reference_data\.icd11\.search/u);
    assert.doesNotMatch(source, /receipt\.(?:query|entries|description|code)|console\.|\bfetch\b/iu);
});
