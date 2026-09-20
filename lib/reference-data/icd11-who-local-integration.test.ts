/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createIcd11WhoLocalRuntime } from './icd11-who-local-runtime.ts';
import { createIcd11WhoHttpRoute } from './icd11-who-http-route.ts';
import { createICDReferenceDataClient, ICDClientError } from '../icd-service.ts';
import { parseWhoLocalSearchResponse, parseWhoLocalReadiness } from './icd11-who-local-contract.ts';

// Synthetic fixture: these digests/identifiers do not describe installed WHO artifacts.
const URI = 'http:' + '//id.who.int/icd/release/11/2026-01/mms/1000000001';
function fixture() {
    const env: Record<string, string> = {
        MEDIFLOW_ICD_WHO_ENABLED: '1', MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
        MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID: `sha256:${'b'.repeat(64)}`,
    };
    let calls = 0, authorized = true;
    const runtime = createIcd11WhoLocalRuntime({ readEnvironment: key => env[key],
        now: () => Date.parse('2026-09-06T10:00:00.000Z'), audit: () => undefined,
        async transport() { calls++; return { status: 200, body: JSON.stringify({ error: false, resultChopped: true,
            destinationEntities: [{ id: URI, theCode: 'AA00', title: 'Synthetic term' }] }) }; },
    });
    const route = createIcd11WhoHttpRoute({ authorize: async () => authorized, getRuntime: () => runtime });
    const client = createICDReferenceDataClient(async input => route(new Request(new URL(String(input), 'http://localhost'))));
    return { env, runtime, route, client, calls: () => calls, unauthorize: () => { authorized = false; } };
}

test('local runtime -> unchanged authenticated route -> strict client preserves v2 provenance', async () => {
    const f = fixture();
    const ready = await f.client.readiness();
    assert.equal(ready.schemaVersion, 'mediflow.reference-data.icd11-who-readiness.v2');
    assert.equal(ready.status, 'configured');
    assert.equal(f.calls(), 0);
    const entries = await f.client.search('synthetic');
    assert.equal(entries[0]?.canonicalUri, URI);
    assert.equal(entries[0]?.reference?.datasetSnapshotId, f.env.MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID);
    assert.equal(entries[0]?.partial, true);
    assert.equal(f.client.lastReceipt()?.schemaVersion, 'mediflow.reference-data.icd11-search-receipt.v2');
    assert.equal((await f.client.readiness()).status, 'available');
    assert.equal(f.calls(), 1);
    f.unauthorize();
    await assert.rejects(f.client.search('synthetic'), error => error instanceof ICDClientError && error.code === 'unauthorized');
    assert.equal(f.client.lastReceipt(), null);
    assert.equal(f.calls(), 1);
});

test('v2 rejects extra fields, mismatched bindings, stale receipts and wrong URI namespaces', async () => {
    const f = fixture();
    const result = await f.runtime.search('synthetic');
    const valid = { schemaVersion: 'mediflow.reference-data.icd11-search-response.v2', ...result };
    assert.ok(parseWhoLocalSearchResponse(valid));
    for (const bad of [
        { ...valid, endpoint: 'caller-controlled' },
        { ...valid, receipt: { ...result.receipt, deployment: 'online' } },
        { ...valid, receipt: { ...result.receipt, completedAt: result.receipt.expiresAt } },
        { ...valid, receipt: { ...result.receipt, imageDigest: 'latest' } },
        { ...valid, entries: [{ ...result.entries[0], canonicalUri: URI.replace('2026-01', '2025-01') }] },
        { ...valid, entries: [{ ...result.entries[0], vendor: true }] },
    ]) {
        assert.equal(parseWhoLocalSearchResponse(bad), null);
        const client = createICDReferenceDataClient(async () => Response.json(bad));
        await assert.rejects(client.search('synthetic'), error => error instanceof ICDClientError && error.code === 'response_invalid');
    }
    const readiness = f.runtime.readiness();
    assert.equal(parseWhoLocalReadiness({ ...readiness, endpoint: 'caller-controlled' }), null);
    assert.equal(parseWhoLocalReadiness({ ...readiness, lastLiveObservedAt: null }), null);
});

test('readiness and rejected parameter/auth requests never probe or alter local configuration', async () => {
    const f = fixture();
    for (const suffix of ['', '?q=synthetic&host=elsewhere', '?q=synthetic&q=again', '?code=AA00']) {
        const response = await f.route(new Request(`http://localhost/api/icd/proxy${suffix}`));
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(response.status, suffix ? 400 : 503);
    }
    assert.equal(f.calls(), 0);
    f.unauthorize();
    const denied = await f.route(new Request('http://localhost/api/icd/proxy?q=synthetic'));
    assert.equal(denied.status, 401);
    assert.equal(f.calls(), 0);
});
