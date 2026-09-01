/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ICDClientError,
    checkApiStatus,
    createICDReferenceDataClient,
    icdClientErrorMessage,
    icdReadinessMessage,
} from './icd-service.ts';

const RECEIPT = Object.freeze({
    schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v1',
    operation: 'mediflow.reference_data.icd11.search.v1',
    releaseId: '2026-01',
    language: 'en',
    source: 'live',
    resultCount: 1,
    latencyMs: 4,
    completedAt: '2027-01-15T08:00:00.000Z',
});

function json(value: unknown, status = 200): Response {
    return Response.json(value, { status });
}

test('parses only the strict MediFlow search response and preserves its PHI-safe receipt', async () => {
    const requests: string[] = [];
    const client = createICDReferenceDataClient(async (input) => {
        requests.push(String(input));
        return json({
            schemaVersion: 'mediflow.reference-data.icd11-search-response.v1',
            entries: [{ code: 'BA00', description: 'Essential hypertension', system: 'ICD-11' }],
            receipt: RECEIPT,
        });
    });
    const result = await client.search(' synthetic  hypertension ');
    assert.deepEqual(requests, ['/api/icd/proxy?q=synthetic%20hypertension']);
    assert.deepEqual(result, [{
        code: 'BA00', description: 'Essential hypertension', system: 'ICD-11', isLegacy: false,
    }]);
    assert.deepEqual(client.lastReceipt(), RECEIPT);
});

test('rejects raw WHO, HTML-bearing, fallback and extra-key payloads', async () => {
    const payloads = [
        { destinationEntities: [{ theCode: 'BA00', title: 'Hypertension' }] },
        {
            schemaVersion: 'mediflow.reference-data.icd11-search-response.v1',
            entries: [{ code: 'BA00', description: '<em>Hypertension</em>', system: 'ICD-11' }],
            receipt: RECEIPT,
        },
        {
            schemaVersion: 'mediflow.reference-data.icd11-search-response.v1',
            entries: [{ code: 'N/A', description: 'Unknown', system: 'ICD-11' }],
            receipt: RECEIPT,
        },
        {
            schemaVersion: 'mediflow.reference-data.icd11-search-response.v1',
            entries: [{ code: 'BA00', description: 'Hypertension', system: 'ICD-11', vendor: 'WHO' }],
            receipt: RECEIPT,
        },
    ];
    for (const body of payloads) {
        const client = createICDReferenceDataClient(async () => json(body));
        await assert.rejects(client.search('synthetic'),
            (error: unknown) => error instanceof ICDClientError && error.code === 'response_invalid');
    }
});

test('reads non-available readiness from a 503 body without claiming connectivity', async () => {
    const client = createICDReferenceDataClient(async () => json({
        schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1',
        status: 'configured',
        releaseId: '2026-01',
        language: 'en',
    }, 503));
    assert.deepEqual(await client.readiness(), {
        schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1',
        status: 'configured',
        releaseId: '2026-01',
        language: 'en',
    });
    assert.equal(await checkApiStatus(client), false);
});

test('requires an exact available readiness body before reporting the service online', async () => {
    const valid = createICDReferenceDataClient(async () => json({
        schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1',
        status: 'available', releaseId: '2026-01', language: 'en',
    }));
    assert.equal(await checkApiStatus(valid), true);

    const extra = createICDReferenceDataClient(async () => json({
        schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1',
        status: 'available', releaseId: '2026-01', language: 'en', vendor: 'WHO',
    }));
    assert.equal(await checkApiStatus(extra), false);
});

test('maps only bounded public error codes and does not surface server content', async () => {
    const client = createICDReferenceDataClient(async () => json({
        schemaVersion: 'mediflow.reference-data.icd11-error.v1',
        code: 'upstream_timeout',
        detail: 'private-looking-query',
    }, 504));
    await assert.rejects(client.search('private-looking-query'), (error: unknown) => {
        assert.ok(error instanceof ICDClientError);
        assert.equal(error.code, 'upstream_timeout');
        assert.doesNotMatch(error.message, /private-looking-query/u);
        assert.equal(icdClientErrorMessage(error), 'Il servizio WHO ICD-11 non ha risposto entro il tempo previsto.');
        return true;
    });
});

test('rejects unsafe and oversized queries before issuing a request', async () => {
    let calls = 0;
    const client = createICDReferenceDataClient(async () => { calls += 1; return json({}); });
    for (const query of ['', '<script>', 'a'.repeat(161)]) {
        await assert.rejects(client.search(query),
            (error: unknown) => error instanceof ICDClientError && error.code === 'request_invalid');
    }
    assert.equal(calls, 0);
});

test('renders every governed readiness state without turning configuration into availability', () => {
    assert.equal(icdReadinessMessage('disabled'), 'Servizio WHO ICD-11 disattivato.');
    assert.equal(icdReadinessMessage('credentials_absent'), 'Credenziali WHO ICD-11 non configurate.');
    assert.equal(icdReadinessMessage('offline'), 'Accesso di rete WHO ICD-11 disattivato.');
    assert.equal(icdReadinessMessage('configured'),
        'WHO ICD-11 configurato; disponibilità non ancora verificata.');
    assert.equal(icdReadinessMessage('available'), 'WHO ICD-11 disponibile e verificato.');
    assert.equal(icdReadinessMessage('unavailable'), 'Servizio WHO ICD-11 non disponibile.');
});
