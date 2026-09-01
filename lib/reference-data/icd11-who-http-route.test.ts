/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createIcd11WhoHttpRoute } from './icd11-who-http-route.ts';
import { Icd11WhoServiceError } from './icd11-who-service.ts';

const SEARCH_RESULT = Object.freeze({
    entries: Object.freeze([
        Object.freeze({ code: 'BA00', description: 'Essential hypertension', system: 'ICD-11' as const }),
    ]),
    receipt: Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1' as const,
        operation: 'mediflow.reference_data.icd11.search.v1' as const,
        releaseId: '2026-01' as const,
        language: 'en' as const,
        source: 'live' as const,
        resultCount: 1,
        latencyMs: 3,
        completedAt: '2027-01-15T08:00:00.000Z',
    }),
});

function fixture(options: Readonly<{
    authorized?: boolean;
    readiness?: 'disabled' | 'credentials_absent' | 'offline' | 'configured' | 'available' | 'unavailable';
    searchError?: Error;
}> = {}) {
    const calls: string[] = [];
    const searches: string[] = [];
    const handler = createIcd11WhoHttpRoute(Object.freeze({
        async authorize() {
            calls.push('authorize');
            return options.authorized !== false;
        },
        getRuntime() {
            calls.push('runtime');
            return Object.freeze({
                readiness: () => Object.freeze({
                    schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1' as const,
                    status: options.readiness ?? 'available',
                    releaseId: '2026-01' as const,
                    language: 'en' as const,
                }),
                async search(query: string) {
                    searches.push(query);
                    if (options.searchError) throw options.searchError;
                    return SEARCH_RESULT;
                },
            });
        },
    }));
    return { handler, calls, searches };
}

async function payload(response: Response): Promise<unknown> {
    return response.json();
}

test('authenticates before parsing parameters or resolving the WHO runtime', async () => {
    const current = fixture({ authorized: false });
    const response = await current.handler(new Request('https://mediflow.local/api/icd/proxy?q=synthetic'));
    assert.equal(response.status, 401);
    assert.deepEqual(await payload(response), { error: 'Unauthorized' });
    assert.deepEqual(current.calls, ['authorize']);
    assert.deepEqual(current.searches, []);
});

test('reports only observed WHO readiness and never promotes configured to available', async () => {
    const available = fixture({ readiness: 'available' });
    const availableResponse = await available.handler(new Request('https://mediflow.local/api/icd/proxy'));
    assert.equal(availableResponse.status, 200);
    assert.deepEqual(await payload(availableResponse), {
        schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1',
        status: 'available',
        releaseId: '2026-01',
        language: 'en',
    });

    const configured = fixture({ readiness: 'configured' });
    const configuredResponse = await configured.handler(new Request('https://mediflow.local/api/icd/proxy'));
    assert.equal(configuredResponse.status, 503);
    assert.equal((await payload(configuredResponse) as { status: string }).status, 'configured');
});

test('accepts exactly one bounded q parameter and passes a normalized query', async () => {
    const current = fixture();
    const response = await current.handler(new Request(
        'https://mediflow.local/api/icd/proxy?q=%20synthetic%20%20hypertension%20',
    ));
    assert.equal(response.status, 200);
    assert.deepEqual(current.searches, ['synthetic hypertension']);
    assert.deepEqual(await payload(response), {
        schemaVersion: 'mediflow.reference-data.icd11-search-response.v1',
        entries: SEARCH_RESULT.entries,
        receipt: SEARCH_RESULT.receipt,
    });
});

test('rejects duplicate, extra, empty, unsafe and oversized parameters without searching', async () => {
    const urls = [
        'https://mediflow.local/api/icd/proxy?q=a&q=b',
        'https://mediflow.local/api/icd/proxy?q=a&limit=2',
        'https://mediflow.local/api/icd/proxy?q=%20%20',
        'https://mediflow.local/api/icd/proxy?q=%3Cscript%3E',
        `https://mediflow.local/api/icd/proxy?q=${'a'.repeat(161)}`,
    ];
    for (const url of urls) {
        const current = fixture();
        const response = await current.handler(new Request(url));
        assert.equal(response.status, 400);
        assert.deepEqual(await payload(response), {
            schemaVersion: 'mediflow.reference-data.icd11-error.v1',
            code: 'request_invalid',
        });
        assert.deepEqual(current.calls, ['authorize']);
        assert.deepEqual(current.searches, []);
    }
});

test('maps bounded service failures without returning raw errors or query content', async () => {
    const cases = [
        ['input_invalid', 400, 'request_invalid'],
        ['response_invalid', 502, 'upstream_response_invalid'],
        ['request_timeout', 504, 'upstream_timeout'],
        ['credential_unavailable', 503, 'service_unavailable'],
        ['offline_unavailable', 503, 'service_unavailable'],
        ['audit_unavailable', 503, 'service_unavailable'],
    ] as const;
    for (const [serviceCode, status, publicCode] of cases) {
        const current = fixture({ searchError: new Icd11WhoServiceError(serviceCode) });
        const response = await current.handler(new Request(
            'https://mediflow.local/api/icd/proxy?q=private-looking-query',
        ));
        assert.equal(response.status, status);
        const body = await payload(response);
        assert.deepEqual(body, {
            schemaVersion: 'mediflow.reference-data.icd11-error.v1',
            code: publicCode,
        });
        assert.doesNotMatch(JSON.stringify(body), /private-looking-query|credential|audit/iu);
    }
});

test('the production route has no Docker target and wires session auth before the server-only runtime', () => {
    const source = readFileSync(new URL('../../app/api/icd/proxy/route.ts', import.meta.url), 'utf8');
    assert.match(source, /requireSession/u);
    assert.match(source, /getIcd11WhoProductionRuntime/u);
    assert.match(source, /createIcd11WhoHttpRoute/u);
    assert.doesNotMatch(source, /ICD_BASE_URL|127\.0\.0\.1:8888|validateLocalTarget|destinationEntities|console\./u);
});
