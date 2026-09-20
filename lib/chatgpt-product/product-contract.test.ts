/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
const { parseProductRequest, PRODUCT_MUTATIONS, ProductError } = await import('./product-contract.ts');
const invalid = (error: unknown) => error instanceof ProductError && error.code === 'invalid_request';
test('all public bodies are exact and have no generic RPC/data/credential channel', () => {
    const consent = { operation: 'synthetic_synthesis', dataClass: 'synthetic_fixture', expectedDisclosureRevision: randomUUID() };
    const request = { modelOptionId: randomUUID(), expectedCatalogRevision: randomUUID() };
    assert.deepEqual(parseProductRequest('consent', consent), consent); assert.deepEqual(parseProductRequest('generate', request), request);
    for (const operation of PRODUCT_MUTATIONS) {
        const correct = operation === 'consent' ? consent : operation === 'generate' ? request : {};
        for (const extra of ['text', 'prompt', 'credential', 'provider', 'writer', 'hostPath', '__proto__', 'method', 'sourceIds', 'endpoint']) {
            assert.throws(() => parseProductRequest(operation, { ...correct, [extra]: 'forbidden' }), invalid);
        }
        for (const value of [null, [], true, 'value', 12]) assert.throws(() => parseProductRequest(operation, value), invalid);
    }
    assert.throws(() => parseProductRequest('generate', { ...request, expectedCatalogRevision: 'not-an-opaque-choice' }), invalid);
    assert.throws(() => parseProductRequest('consent', { ...consent, dataClass: 'patient_record' }), invalid);
    assert.throws(() => parseProductRequest('consent', { ...consent, operation: 'clinical_summary' }), invalid);
    assert.throws(() => parseProductRequest('arbitrary' as never, {}), invalid);
});
test('inherited contract fields do not satisfy required own fields', () => {
    const inherited = Object.assign(Object.create({ operation: 'synthetic_synthesis' }), { dataClass: 'synthetic_fixture', expectedDisclosureRevision: randomUUID(), extra: 'x' });
    assert.throws(() => parseProductRequest('consent', inherited), invalid);
});
