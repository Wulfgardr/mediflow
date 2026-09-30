import assert from 'node:assert/strict';
import test from 'node:test';
import { createICDReferenceDataClient, ICDClientError } from '../icd-service.ts';
import { WHO_CLOUD_REFERENCE, parseWhoCloudSearchResponse } from './icd11-who-cloud-contract.ts';
import { createIcd11WhoHttpRoute } from './icd11-who-http-route.ts';
import { parseIcd11WhoOfficialSearchBody } from './icd11-who-official-search-parser.ts';
import { createIcd11WhoReferenceDataService, Icd11WhoServiceError } from './icd11-who-service.ts';

// Invented entity/code/title, no WHO or patient calls; URI has the official syntax only.
const URI = 'http:' + '//id.who.int/icd/release/11/2026-01/mms/900000009';
const entity = { id: URI, theCode: 'ZZ01', title: 'Synthetic source title' };
const body = (item: unknown = entity) => JSON.stringify({ destinationEntities: [item], error: false, resultChopped: false });
const ENABLED = { schemaVersion: 'mediflow.reference-data.icd11-who-runtime.v1',
    network: 'online', egress: 'enabled', credential: 'enabled' };
const transportResult = () => parseIcd11WhoOfficialSearchBody(body())!;
const receipt = { ...WHO_CLOUD_REFERENCE, schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v3',
    operation: 'mediflow.reference_data.icd11.search.v3', source: 'live', resultCount: 1,
    latencyMs: 0, completedAt: '2026-09-30T00:00:00.000Z' };
const response = () => ({ schemaVersion: 'mediflow.reference-data.icd11-search-response.v3',
    entries: [{ code: entity.theCode, description: entity.title, system: 'ICD-11', canonicalUri: URI }], receipt });

test('synthetic WHO fields survive parser, service, cache, HTTP and consumer with bound attribution', async () => {
    let calls = 0; let state = ENABLED; const audits: unknown[] = [];
    const service = createIcd11WhoReferenceDataService({ readRuntimeState: () => state,
        now: () => Date.parse(receipt.completedAt), audit: value => { audits.push(value); },
        transport: () => { calls += 1; return transportResult(); } });
    const route = createIcd11WhoHttpRoute({ authorize: async () => true, getRuntime: () => ({
        readiness: () => ({ schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1' as const,
            status: 'configured' as const, releaseId: '2026-01' as const, language: 'en' as const }),
        search: (query: string) => service.search({ query }),
    }) });
    const client = createICDReferenceDataClient(async input => route(new Request(`http://localhost/${String(input).replace(/^\//u, '')}`)));
    for (const source of ['live', 'cache']) {
        const result = await client.search('synthetic title');
        assert.deepEqual(result, [{ ...response().entries[0], isLegacy: false, sourceReference: WHO_CLOUD_REFERENCE }]);
        assert.equal(client.lastReceipt()?.source, source);
        assert.equal(client.lastReceipt()?.releaseId, '2026-01');
        state = { ...ENABLED, network: 'offline', egress: 'disabled', credential: 'revoked_local' };
    }
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(audits).includes(entity.title), false);
    assert.equal(JSON.stringify(audits).includes(URI), false);
    service.dispose();
});

test('official parser rejects absent/non-WHO/wrong-release/malformed URI without inventing identity', () => {
    const { id: _id, ...missing } = entity;
    assert.equal(parseIcd11WhoOfficialSearchBody(body(missing)), null);
    for (const id of [null, '', 'urn:synthetic', URI.replace('2026-01', '2025-01'),
        URI.replace('/mms/', '/foundation/'), URI + '?q=private', URI + '#title',
        URI.replace('id.who.int', 'id.who.int.invalid'), `${URI} & ${URI}`]) {
        assert.equal(parseIcd11WhoOfficialSearchBody(body({ ...entity, id })), null);
    }
});

test('service fails closed before audit/cache on wrong binding/version and URI-less transport', async () => {
    const good = transportResult(); const { canonicalUri: _uri, ...missing } = good.entries[0]!;
    for (const invalid of [{ ...good, bindingId: 'other' }, { ...good, releaseId: '2025-01' },
        { ...good, language: 'it' }, { ...good, schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1' },
        { ...good, entries: [missing] }, { ...good, entries: [{ ...good.entries[0], canonicalUri: URI + '/invalid' }] }]) {
        let calls = 0;
        const service = createIcd11WhoReferenceDataService({ readRuntimeState: () => ENABLED, now: () => 1000,
            audit: () => assert.fail('invalid response cannot be published'), transport: () => { calls += 1; return invalid; } });
        for (let attempt = 0; attempt < 2; attempt += 1) await assert.rejects(service.search({ query: 'synthetic' }),
            (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'response_invalid');
        assert.equal(calls, 2); service.dispose();
    }
});

test('consumer rejects old URI-less cloud v1, corrupted bindings, attribution and identity', async () => {
    const good = response(); const { canonicalUri: _uri, ...missing } = good.entries[0]!;
    const candidates: unknown[] = [{ schemaVersion: 'mediflow.reference-data.icd11-search-response.v1',
        entries: [missing], receipt: { schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1',
            operation: 'mediflow.reference_data.icd11.search.v1', releaseId: '2026-01', language: 'en',
            source: 'live', resultCount: 1, latencyMs: 0, completedAt: receipt.completedAt } },
        { ...good, entries: [missing] }, { ...good, entries: [{ ...good.entries[0], canonicalUri: 'https:' + '//invalid.example/1' }] }];
    for (const key of ['apiVersion', 'releaseId', 'linearization', 'language', 'bindingId', 'attribution', 'schemaVersion', 'operation']) {
        candidates.push({ ...good, receipt: { ...receipt, [key]: 'wrong' } });
    }
    for (const invalid of candidates) {
        assert.equal(parseWhoCloudSearchResponse(invalid), null);
        const client = createICDReferenceDataClient(async () => Response.json(invalid));
        await assert.rejects(client.search('synthetic'),
            (error: unknown) => error instanceof ICDClientError && error.code === 'response_invalid');
        assert.equal(client.lastReceipt(), null);
    }
});

test('disabled/offline/unavailable remain failures without a provider call or a success receipt', async () => {
    for (const [state, code] of [[{ ...ENABLED, egress: 'disabled' }, 'egress_disabled'],
        [{ ...ENABLED, network: 'offline' }, 'offline_unavailable'],
        [{ ...ENABLED, credential: 'absent' }, 'credential_unavailable']] as const) {
        const service = createIcd11WhoReferenceDataService({ readRuntimeState: () => state, now: () => 1000,
            audit: () => assert.fail('no success audit'), transport: () => assert.fail('no egress') });
        await assert.rejects(service.search({ query: 'synthetic' }),
            (error: unknown) => error instanceof Icd11WhoServiceError && error.code === code);
        service.dispose();
    }
    const client = createICDReferenceDataClient(async () => Response.json({ code: 'service_unavailable' }, { status: 503 }));
    await assert.rejects(client.search('synthetic'),
        (error: unknown) => error instanceof ICDClientError && error.code === 'service_unavailable');
    assert.equal(client.lastReceipt(), null);
});


test('CodeInfo identity must match the entire code and preserve the supplied URI exactly', () => {
    const code = 'ZZ01&XZ001';
    const uri = 'http:' + '//id.who.int/icd/release/11/2026-01/mms/codeinfo/' + encodeURIComponent(code);
    const result = parseIcd11WhoOfficialSearchBody(body({ ...entity, theCode: code, id: uri }));
    assert.equal(result?.entries[0]?.canonicalUri, uri);
    assert.equal(result?.entries[0]?.code, code);
    assert.equal(parseIcd11WhoOfficialSearchBody(body({ ...entity, theCode: 'ZZ01&XZ002', id: uri })), null);
});
