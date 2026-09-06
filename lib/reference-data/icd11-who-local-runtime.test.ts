/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createIcd11WhoLocalRuntime } from './icd11-who-local-runtime.ts';
import { Icd11WhoServiceError } from './icd11-who-service.ts';

// Synthetic lock identifiers and terminology; never provisioning artifacts.
const IMAGE = `sha256:${'a'.repeat(64)}`;
const DATASET = `sha256:${'b'.repeat(64)}`;
const URI = 'http:' + '//id.who.int/icd/release/11/2026-01/mms/1000000001';
const body = (changes: Record<string, unknown> = {}) => JSON.stringify({
    error: false, resultChopped: false,
    destinationEntities: [{ theCode: 'AA00', title: 'Synthetic term', id: URI }], ...changes,
});

function fixture(options: { enabled?: boolean; transport?: (query: string, signal: AbortSignal) => Promise<{ status: number; body: string }>; audit?: () => void | Promise<void> } = {}) {
    const environment: Record<string, string | undefined> = options.enabled === false ? {} : {
        MEDIFLOW_ICD_WHO_ENABLED: '1', MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST: IMAGE,
        MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID: DATASET,
    };
    const reads: string[] = [];
    const queries: string[] = [];
    const audits: unknown[] = [];
    let now = Date.parse('2026-09-06T10:00:00.000Z');
    const runtime = createIcd11WhoLocalRuntime({
        readEnvironment(name) { reads.push(name); return environment[name]; },
        now: () => now,
        async transport(query, signal) {
            queries.push(query);
            return options.transport ? options.transport(query, signal) : { status: 200, body: body() };
        },
        async audit(receipt) { audits.push(receipt); await options.audit?.(); },
    });
    return { runtime, environment, reads, queries, audits, advance: (ms: number) => { now += ms; } };
}

const rejectsWith = (code: string) => (error: unknown) => error instanceof Icd11WhoServiceError && error.code === code;

test('default OFF: passive readiness and searches never read OAuth or contact a transport', async () => {
    const f = fixture({ enabled: false });
    assert.equal(f.runtime.readiness().status, 'disabled');
    await assert.rejects(f.runtime.search('synthetic'), rejectsWith('egress_disabled'));
    assert.deepEqual([...new Set(f.reads)], ['MEDIFLOW_ICD_WHO_ENABLED']);
    assert.deepEqual(f.queries, []);
});

test('missing artifact identities block activation; configured is not an observed response', async () => {
    const f = fixture();
    assert.equal(f.runtime.readiness().status, 'configured');
    assert.deepEqual(f.queries, []);
    delete f.environment.MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST;
    assert.equal(f.runtime.readiness().status, 'configuration_required');
    await assert.rejects(f.runtime.search('synthetic'), rejectsWith('runtime_state_invalid'));
    assert.equal(f.queries.length, 0);
    assert.ok(f.reads.every(name => !/CLIENT|SECRET|NETWORK/u.test(name)));
});

test('Search preserves canonical URI/partial and audits only metadata', async () => {
    const f = fixture({ transport: async () => ({ status: 200, body: body({ resultChopped: true }) }) });
    const result = await f.runtime.search(' synthetic   term ');
    assert.deepEqual(f.queries, ['synthetic term']);
    assert.equal(result.entries[0]?.canonicalUri, URI);
    assert.equal(result.entries[0]?.description, 'Synthetic term');
    assert.equal(result.partial, true);
    assert.equal(result.receipt.deployment, 'local');
    assert.equal(result.receipt.source, 'live');
    assert.equal(result.receipt.imageDigest, IMAGE);
    assert.equal(result.receipt.datasetSnapshotId, DATASET);
    assert.equal(f.runtime.readiness().status, 'available');
    assert.doesNotMatch(JSON.stringify(f.audits), /Synthetic term|synthetic term|1000000001|AA00|127\.0\.0\.1/u);
});

test('warm cache has absolute freshness and does not claim a new direct observation', async () => {
    const f = fixture();
    const first = await f.runtime.search('synthetic');
    f.advance(1000);
    const hit = await f.runtime.search('synthetic');
    assert.equal(f.queries.length, 1);
    assert.equal(hit.receipt.source, 'cache');
    assert.equal(hit.receipt.fetchedAt, first.receipt.fetchedAt);
    assert.equal(hit.receipt.expiresAt, first.receipt.expiresAt);
    assert.notEqual(hit.receipt.completedAt, first.receipt.completedAt);
    assert.equal(f.runtime.readiness().lastLiveObservedAt, first.receipt.fetchedAt);
    f.advance(86_400_000);
    assert.equal(f.runtime.readiness().status, 'configured');
    await f.runtime.search('synthetic');
    assert.equal(f.queries.length, 2);
});

test('disable and dataset changes clear cache before any hit can be returned', async () => {
    const f = fixture();
    await f.runtime.search('synthetic');
    f.environment.MEDIFLOW_ICD_WHO_ENABLED = '0';
    await assert.rejects(f.runtime.search('synthetic'), rejectsWith('egress_disabled'));
    f.environment.MEDIFLOW_ICD_WHO_ENABLED = '1';
    await f.runtime.search('synthetic');
    f.environment.MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID = `sha256:${'c'.repeat(64)}`;
    const changed = await f.runtime.search('synthetic');
    assert.equal(f.queries.length, 3);
    assert.equal(changed.receipt.source, 'live');
    assert.equal(changed.receipt.datasetSnapshotId, f.environment.MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID);
});

test('pending transport cannot publish across a configuration change or disposal', async () => {
    for (const dispose of [false, true]) {
        let release!: (value: { status: number; body: string }) => void;
        let signal!: AbortSignal;
        const f = fixture({ transport: async (_query, inputSignal) => {
            signal = inputSignal;
            return new Promise(resolve => { release = resolve; });
        } });
        const pending = f.runtime.search('synthetic');
        if (dispose) f.runtime.dispose();
        else { f.environment.MEDIFLOW_ICD_WHO_ENABLED = '0'; f.runtime.readiness(); }
        assert.equal(signal.aborted, true);
        release({ status: 200, body: body() });
        await assert.rejects(pending);
        assert.equal(f.audits.length, 0);
    }
});

test('audit failure or disable during audit denies results and cache insertion', async () => {
    const failed = fixture({ audit: () => { throw new Error('private audit detail'); } });
    await assert.rejects(failed.runtime.search('synthetic'), rejectsWith('audit_unavailable'));
    await assert.rejects(failed.runtime.search('synthetic'));
    assert.equal(failed.queries.length, 2);
    const f = fixture({ audit: () => { f.environment.MEDIFLOW_ICD_WHO_ENABLED = '0'; } });
    await assert.rejects(f.runtime.search('synthetic'));
});

test('input, response, URI namespace and redirect/status limits fail closed without fallback', async () => {
    const f = fixture();
    for (const query of ['', '<script>', 'a'.repeat(161), '\u0000']) {
        await assert.rejects(f.runtime.search(query), rejectsWith('input_invalid'));
    }
    assert.equal(f.queries.length, 0);
    const invalidBodies = [
        'x'.repeat(65_537), '<html>vendor detail</html>',
        body({ destinationEntities: Array.from({ length: 26 }, (_, i) => ({ theCode: `AA${i}`, title: 'Synthetic', id: URI })) }),
        body({ destinationEntities: [{ theCode: 'AA00', title: 'Synthetic', id: URI.replace('2026-01', '2025-01') }] }),
        body({ destinationEntities: [{ theCode: 'AA00', title: 'Synthetic', id: URI + '?redirect=1' }] }),
        body({ destinationEntities: [{ theCode: 'AA00', title: 'Synthetic' }] }),
        body({ unexpected: true }),
    ];
    for (const raw of invalidBodies) {
        const bad = fixture({ transport: async () => ({ status: 200, body: raw }) });
        await assert.rejects(bad.runtime.search('synthetic'), rejectsWith('response_invalid'));
        assert.equal(bad.queries.length, 1);
    }
    for (const status of [301, 404, 429, 500]) {
        const bad = fixture({ transport: async () => ({ status, body: 'vendor detail' }) });
        await assert.rejects(bad.runtime.search('synthetic'), rejectsWith('upstream_unavailable'));
        assert.equal(bad.queries.length, 1);
    }
});

test('cache capacity evicts least recently used query, and clock rollback invalidates it', async () => {
    const f = fixture();
    for (let i = 0; i < 257; i++) await f.runtime.search(`synthetic ${i}`);
    await f.runtime.search('synthetic 0');
    assert.equal(f.queries.length, 258);
    f.advance(-1000);
    await f.runtime.search('synthetic 0');
    assert.equal(f.queries.length, 259);
});

test('over 25 valid upstream entries yield the first 25 with partial; malformed omitted entries still fail', async () => {
    const entities = Array.from({ length: 30 }, (_, i) => ({ theCode: `AA${i}`,
        title: `Synthetic term ${i}`, id: URI.slice(0, -1) + (i + 10) }));
    const f = fixture({ transport: async () => ({ status: 200, body: body({ destinationEntities: entities }) }) });
    const result = await f.runtime.search('synthetic');
    assert.equal(result.entries.length, 25);
    assert.deepEqual(result.entries.map(row => row.code), entities.slice(0, 25).map(row => row.theCode));
    assert.equal(result.partial, true);
    assert.equal(result.receipt.resultCount, 25);
    assert.equal((await f.runtime.search('synthetic')).partial, true);
    for (const last of [{ ...entities[29], title: '<invalid>' }, entities[0], { ...entities[29], id: 'wrong-binding' }]) {
        const bad = fixture({ transport: async () => ({ status: 200,
            body: body({ destinationEntities: [...entities.slice(0, 29), last] }) }) });
        await assert.rejects(bad.runtime.search('synthetic'), rejectsWith('response_invalid'));
    }
    const empty = fixture({ transport: async () => ({ status: 200, body: body({ destinationEntities: [] }) }) });
    assert.deepEqual((await empty.runtime.search('synthetic')).entries, []);
});

test('transport deadline aborts an uncooperative promise and rejects late publication', async () => {
    let signal!: AbortSignal;
    const f = fixture({ transport: async (_query, s) => { signal = s; return new Promise(() => {}); } });
    await assert.rejects(f.runtime.search('synthetic'), rejectsWith('request_timeout'));
    assert.equal(signal.aborted, true);
    assert.equal(f.audits.length, 0);
});

test('a cache hit after a failed direct request does not restore sidecar availability', async () => {
    let fail = false;
    const f = fixture({ transport: async () => ({ status: fail ? 503 : 200, body: body() }) });
    const direct = await f.runtime.search('synthetic');
    fail = true;
    await assert.rejects(f.runtime.search('synthetic other'));
    f.advance(1000);
    assert.equal((await f.runtime.search('synthetic')).receipt.source, 'cache');
    assert.equal(f.runtime.readiness().status, 'unavailable');
    assert.equal(f.runtime.readiness().lastLiveObservedAt, direct.receipt.fetchedAt);
    assert.equal(f.runtime.readiness().lastResultSource, 'cache');
});

test('byte capacity evicts entries before the key cap is reached', async () => {
    const entities = Array.from({ length: 15 }, (_, i) => ({
        theCode: `AA${i}`, title: 'Synthetic ' + 'x'.repeat(3990), id: URI.slice(0, -1) + (i + 10),
    }));
    const f = fixture({ transport: async () => ({ status: 200, body: body({ destinationEntities: entities }) }) });
    for (let i = 0; i < 80; i++) await f.runtime.search(`synthetic ${i}`);
    assert.equal((await f.runtime.search('synthetic 79')).receipt.source, 'cache');
    assert.equal((await f.runtime.search('synthetic 0')).receipt.source, 'live');
    assert.equal(f.queries.length, 81);
});

test('audit deadline prevents result publication and cache insertion', async () => {
    let release!: () => void;
    const f = fixture({ audit: () => new Promise<void>(resolve => { release = resolve; }) });
    await assert.rejects(f.runtime.search('synthetic'), rejectsWith('audit_unavailable'));
    release();
    assert.equal(f.runtime.readiness().status, 'unavailable');
    assert.equal(f.runtime.readiness().lastLiveObservedAt, null);
    const pending = f.runtime.search('synthetic');
    assert.equal(f.queries.length, 2);
    f.runtime.dispose();
    await assert.rejects(pending);
});
