/* @Codex — bounded in-memory streams, real root and owner; no HTTP listener. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { createProductFixture, deferred, tick } = await import('./product-production.test.ts');
const { PRODUCT_NAMESPACE } = await import('./product-contract.ts');
test('body stalled after first byte is canceled at the fixed body deadline', async t => {
    const f = createProductFixture(t); let canceled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { canceled = true; } });
    const request = new Request('http://localhost:3987' + PRODUCT_NAMESPACE + 'consent', { method: 'POST', headers: { origin: 'http://localhost:3987', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    const response = await f.root.handle(request, 'consent'); assert.equal(response.status, 400); assert.equal(canceled, true); assert.equal(f.created(), 0);
});
test('retirement while strict body is pending cancels stream and denies before consent or process', async t => {
    const f = createProductFixture(t); const reached = deferred<void>(); let canceled = false;
    const body = new ReadableStream({ pull() { reached.resolve(); }, cancel() { canceled = true; } });
    const request = new Request('http://localhost:3987' + PRODUCT_NAMESPACE + 'consent', { method: 'POST', headers: { origin: 'http://localhost:3987', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    const pending = f.root.handle(request, 'consent'); await reached.promise; await tick(); f.retire();
    assert.equal((await pending).status, 401); assert.equal(canceled, true); assert.equal(f.created(), 0);
});
