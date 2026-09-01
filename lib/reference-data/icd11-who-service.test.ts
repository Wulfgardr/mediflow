/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createIcd11WhoReferenceDataService, Icd11WhoServiceError } from './icd11-who-service.ts';

const ENABLED = Object.freeze({
    schemaVersion: 'mediflow.reference-data.icd11-who-runtime.v1',
    network: 'online', egress: 'enabled', credential: 'enabled',
});

test('cerca ICD-11 sul target WHO opaco con binding host-owned e audit PHI-safe', async () => {
    const ticks = [1_000, 1_025]; const audits: unknown[] = []; let calls = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED,
        now: () => ticks.shift(),
        audit: async (receipt) => { audits.push(receipt); },
        transport: async (request) => {
            calls += 1;
            assert.equal(request.target, 'who.icd-api.v2.official');
            assert.equal('url' in request, false);
            assert.equal('headers' in request, false);
            assert.equal(request.releaseId, '2026-01');
            assert.equal(request.linearization, 'mms');
            assert.equal(request.language, 'en');
            assert.equal(request.query, 'type 2 diabetes mellitus');
            assert.equal(request.limit, 25);
            assert.equal(request.maxResponseBytes, 65_536);
            return Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
                releaseId: '2026-01', language: 'en',
                entries: Object.freeze([
                    Object.freeze({ code: '5A11', description: 'Type 2 diabetes mellitus' }),
                    Object.freeze({ code: '5A11.0', description: 'Type 2 diabetes mellitus without complications' }),
                ]),
            });
        },
    });

    const result = await service.search({ query: '  type   2 diabetes mellitus  ' });
    assert.deepEqual(result.entries, [
        { code: '5A11', description: 'Type 2 diabetes mellitus', system: 'ICD-11' },
        { code: '5A11.0', description: 'Type 2 diabetes mellitus without complications', system: 'ICD-11' },
    ]);
    assert.deepEqual(result.receipt, {
        schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1',
        operation: 'mediflow.reference_data.icd11.search.v1', releaseId: '2026-01', language: 'en',
        source: 'live', resultCount: 2, latencyMs: 25, completedAt: '1970-01-01T00:00:01.025Z',
    });
    assert.deepEqual(audits, [result.receipt]);
    assert.equal(JSON.stringify(result.receipt).includes('diabetes'), false);
    assert.equal(calls, 1);
});

test('riusa solo la cache RAM fresca quando rete, egress e credenziale sono chiusi', async () => {
    let state: unknown = ENABLED; let calls = 0; const ticks = [2_000, 2_010, 3_000];
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => state, now: () => ticks.shift(), audit: async () => undefined,
        transport: async () => {
            calls += 1;
            return { schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
                releaseId: '2026-01', language: 'en',
                entries: [{ code: '1A00', description: 'Cholera' }] };
        },
    });
    const live = await service.search({ query: 'cholera' });
    state = { schemaVersion: 'mediflow.reference-data.icd11-who-runtime.v1',
        network: 'offline', egress: 'disabled', credential: 'revoked_local' };
    const cached = await service.search({ query: '  CHOLERA  ' });

    assert.equal(live.receipt.source, 'live');
    assert.equal(cached.receipt.source, 'cache');
    assert.equal(cached.receipt.latencyMs, 0);
    assert.equal(cached.receipt.completedAt, '1970-01-01T00:00:03.000Z');
    assert.deepEqual(cached.entries, live.entries);
    assert.equal(calls, 1);
});

test('nega authority caller-supplied e cache miss quando un gate host-owned e chiuso', async () => {
    const cases = [
        [{ network: 'offline', egress: 'enabled', credential: 'enabled' }, 'offline_unavailable'],
        [{ network: 'online', egress: 'disabled', credential: 'enabled' }, 'egress_disabled'],
        [{ network: 'online', egress: 'enabled', credential: 'configured' }, 'credential_unavailable'],
    ] as const;
    for (const [runtime, code] of cases) {
        let calls = 0;
        const service = createIcd11WhoReferenceDataService({
            readRuntimeState: () => ({ schemaVersion: ENABLED.schemaVersion, ...runtime }),
            now: () => 3_500, audit: async () => assert.fail('denials are not audited as successes'),
            transport: async () => { calls += 1; return undefined; },
        });
        await assert.rejects(service.search({ query: 'synthetic term', authority: 'agent' }),
            (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'input_invalid');
        await assert.rejects(service.search({ query: 'synthetic term' }),
            (error: unknown) => error instanceof Icd11WhoServiceError && error.code === code);
        assert.equal(calls, 0);
    }
});

test('dispose cancella le ricerche in corso e scarta completamenti tardivi', async () => {
    let signal: AbortSignal | undefined; let complete: ((value: unknown) => void) | undefined;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 4_000, audit: async () => assert.fail('no audit after cancellation'),
        transport: async (request) => {
            signal = request.signal;
            return new Promise((resolve) => { complete = resolve; });
        },
    });
    const pending = service.search({ query: 'synthetic diagnosis' });
    await Promise.resolve();
    service.dispose();
    assert.equal(signal?.aborted, true);
    complete?.({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
        releaseId: '2026-01', language: 'en', entries: [] });
    await assert.rejects(pending,
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'request_cancelled');
    await assert.rejects(service.search({ query: 'another diagnosis' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'service_disposed');
});

test('applica il timeout host-owned senza dipendere dal transport', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let signal: AbortSignal | undefined;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 5_000, audit: async () => assert.fail('no audit after timeout'),
        transport: async (request) => { signal = request.signal; return new Promise(() => undefined); },
    });
    const pending = service.search({ query: 'synthetic timeout' });
    await Promise.resolve();
    context.mock.timers.tick(5_000);
    await Promise.resolve();
    assert.equal(signal?.aborted, true);
    await assert.rejects(pending,
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'request_timeout');
});

test('nega dependency accessor senza invocare il getter ostile', () => {
    let getterCalls = 0;
    const dependencies = { readRuntimeState: () => ENABLED, now: () => 0, audit: async () => undefined } as Record<string, unknown>;
    Object.defineProperty(dependencies, 'transport', { enumerable: true, get() {
        getterCalls += 1; return async () => ({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: [] });
    } });
    assert.throws(() => createIcd11WhoReferenceDataService(dependencies as never),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'input_invalid');
    assert.equal(getterCalls, 0);
});

test('nega array e record transport ostili senza materializzare accessor', async () => {
    let getterCalls = 0;
    const entries: unknown[] = [];
    Object.defineProperty(entries, '0', { enumerable: true, get() {
        getterCalls += 1; return { code: '1A00', description: 'Cholera' };
    } });
    Object.defineProperty(entries, 'length', { value: 1 });
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 6_000, audit: async () => assert.fail('invalid response is not audited'),
        transport: async () => ({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries }),
    });
    await assert.rejects(service.search({ query: 'synthetic hostile response' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'response_invalid');
    assert.equal(getterCalls, 0);
});

test('nega testo WHO non normalizzato prima di UI, audit e cache', async () => {
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 7_000, audit: async () => assert.fail('invalid text is not audited'),
        transport: async () => ({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: [{ code: '1A00', description: ' Cholera ' }] }),
    });
    await assert.rejects(service.search({ query: 'cholera' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'response_invalid');
});

test('nega un input Proxy revocato con il codice chiuso input_invalid', async () => {
    const hostile = Proxy.revocable({ query: 'synthetic term' }, {}); hostile.revoke();
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => assert.fail('invalid input does not read runtime state'),
        now: () => assert.fail('invalid input does not read the clock'),
        audit: async () => assert.fail('invalid input is not audited'),
        transport: async () => assert.fail('invalid input does not reach transport'),
    });
    await assert.rejects(service.search(hostile.proxy),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'input_invalid');
});

test('nega un runtime state Proxy revocato con il codice chiuso runtime_state_invalid', async () => {
    const hostile = Proxy.revocable(ENABLED, {}); hostile.revoke(); let transportCalls = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => hostile.proxy, now: () => 7_500,
        audit: async () => assert.fail('invalid runtime state is not audited'),
        transport: async () => { transportCalls += 1; return undefined; },
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'runtime_state_invalid');
    assert.equal(transportCalls, 0);
});

test('nega una risposta transport Proxy con il codice chiuso response_invalid', async () => {
    const hostile = new Proxy({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
        releaseId: '2026-01', language: 'en', entries: [] }, {});
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 7_750,
        audit: async () => assert.fail('invalid response is not audited'), transport: () => hostile,
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'response_invalid');
});

test('nega un array transport Proxy revocato con il codice chiuso response_invalid', async () => {
    const hostile = Proxy.revocable([{ code: '1A00', description: 'Cholera' }], {}); hostile.revoke();
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 8_000,
        audit: async () => assert.fail('invalid response is not audited'),
        transport: async () => ({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: hostile.proxy }),
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'response_invalid');
});

test('dispose reentrant dal clock ferma la ricerca prima di runtime, transport e audit', async () => {
    let runtimeReads = 0; let transportCalls = 0; let audits = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => { runtimeReads += 1; return ENABLED; },
        now: () => { service.dispose(); return 9_000; },
        audit: async () => { audits += 1; },
        transport: async () => { transportCalls += 1; return {
            schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: [],
        }; },
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'service_disposed');
    assert.deepEqual({ runtimeReads, transportCalls, audits }, { runtimeReads: 0, transportCalls: 0, audits: 0 });
});

test('dispose reentrant dal runtime state ferma la ricerca prima di transport e audit', async () => {
    let transportCalls = 0; let audits = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => { service.dispose(); return ENABLED; }, now: () => 10_000,
        audit: async () => { audits += 1; },
        transport: async () => { transportCalls += 1; return {
            schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: [],
        }; },
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'service_disposed');
    assert.deepEqual({ transportCalls, audits }, { transportCalls: 0, audits: 0 });
});

test('dispose reentrant dal clock di completamento ferma audit e risultato', async () => {
    let clockReads = 0; let audits = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED,
        now: () => { clockReads += 1; if (clockReads === 2) service.dispose(); return 10_500 + clockReads; },
        audit: async () => { audits += 1; },
        transport: async () => ({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: [] }),
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'service_disposed');
    assert.deepEqual({ clockReads, audits }, { clockReads: 2, audits: 0 });
});

test('dispose reentrant da audit nega la pubblicazione del risultato', async () => {
    const ticks = [11_000, 11_010]; let audits = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => ticks.shift(),
        audit: async () => { audits += 1; await Promise.resolve(); service.dispose(); },
        transport: async () => ({ schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: [{ code: '1A00', description: 'Cholera' }] }),
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'service_disposed');
    assert.equal(audits, 1);
});

test('dispose reentrant dal transport nega audit e risultato senza rejection sfuggite', async () => {
    let audits = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 11_500,
        audit: async () => { audits += 1; },
        transport: () => { service.dispose(); return {
            schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1',
            releaseId: '2026-01', language: 'en', entries: [],
        }; },
    });
    await assert.rejects(service.search({ query: 'synthetic term' }),
        (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'service_disposed');
    assert.equal(audits, 0);
});

test('nega un thenable transport che dispone il servizio e lancia un errore vendor', async () => {
    let thenReads = 0; let audits = 0;
    const service = createIcd11WhoReferenceDataService({
        readRuntimeState: () => ENABLED, now: () => 12_000,
        audit: async () => { audits += 1; },
        transport: () => Object.defineProperty({}, 'then', { get() {
            thenReads += 1; service.dispose(); throw new Error('vendor-sensitive-detail');
        } }),
    });
    await assert.rejects(service.search({ query: 'synthetic term' }), (error: unknown) =>
        error instanceof Icd11WhoServiceError && error.code === 'service_disposed'
        && !error.message.includes('vendor-sensitive-detail'));
    assert.deepEqual({ thenReads, audits }, { thenReads: 1, audits: 0 });
});
