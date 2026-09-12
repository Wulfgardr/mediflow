/* @Codex — actual Web owner, registry, HTTP and service; synthetic substrate only. */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { WebSessionProjection } from '../security/web-auth-lifecycle-owner-adapter';
import type { ProductPreparation, ProductResponse, QualificationSnapshot } from './product-contract';
const { createChatGptProduct } = await import('./product-production.ts');
const { createProductSessionRegistry } = await import('./product-session.ts');
const { createProductService } = await import('./product-service.ts');
const { ProductError, PRODUCT_NAMESPACE, PRODUCT_OPERATION, PRODUCT_DATA_CLASS } = await import('./product-contract.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('../security/web-auth-lifecycle-owner-test-fixture.ts');
const { resolve: resolveOwner } = await import('../security/web-auth-lifecycle-owner-adapter.ts');
const { SyntheticProductTransport, deferred, tick } = await import('./product-production.test.ts');
const { createProductBrowser } = await import('./product-browser.ts');
let sequence = 0;
function fixture(t: TestContext) {
    const context = issueSyntheticWebSessionContext({ id: `preparation-${++sequence}`, username: 'synthetic', role: 'doctor' }, `preparation-${sequence}`);
    const transport = new SyntheticProductTransport(`/synthetic/preparation-${sequence}/work`);
    let projection: ProductPreparation = { state: 'not_prepared', expiresAt: null };
    let qualification: QualificationSnapshot = { platform: 'synthetic-test-only', state: 'unqualified', revision: 'held', missing: [] };
    let calls = 0, takes = 0, closes = 0;
    let pending: ReturnType<typeof deferred<void>> | undefined;
    let prepareSignal: AbortSignal | undefined;
    const platform = {
        snapshot: () => qualification,
        preparation: () => projection,
        async prepare(signal: AbortSignal, lifetimeMs: number) {
            calls++; prepareSignal = signal;
            projection = { state: 'preparing', expiresAt: Math.floor(Date.now() + lifetimeMs) };
            if (pending) await pending.promise;
            if (signal.aborted) { projection = { ...projection, state: 'closed' }; throw new ProductError('canceled'); }
            qualification = { ...qualification, state: 'qualified', revision: `ready-${calls}` };
            projection = { ...projection, state: 'ready' };
        },
        async create(signal: AbortSignal) {
            assert.equal(signal, prepareSignal, 'same lifetime controller, not a new grant controller');
            assert.equal(signal.aborted, false); takes++; projection = { ...projection, state: 'in_use' };
            return { transport, cwd: transport.cwd, boundaryQualified: () => !signal.aborted,
                close: () => transport.close(), cleanupComplete: () => transport.closed };
        },
        async close() {
            closes++; projection = { ...projection, state: 'closing' };
            qualification = { ...qualification, state: 'unqualified', revision: 'closed' };
            if (pending) await pending.promise;
            await transport.close();
            projection = { ...projection, state: 'closed' };
        },
    };
    const root = createChatGptProduct({ resolveSession: async () => {
        const resolution = resolveOwner(context.session.id, context.controlId);
        return resolution.status === 'active' ? resolution.projection : null;
    }, platform });
    async function call(operation: Parameters<typeof root.handle>[1], body: unknown = {}, signal?: AbortSignal) {
        return root.handle(new Request(`http://localhost:3987${PRODUCT_NAMESPACE}${operation}`, {
            method: operation === 'status' ? 'GET' : 'POST',
            headers: { origin: 'http://localhost:3987', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
            ...(operation === 'status' ? {} : { body: JSON.stringify(body) }), signal,
        }), operation);
    }
    async function request(operation: Parameters<typeof call>[0], body: unknown = {}) {
        const response = await call(operation, body), value = await response.json();
        assert.equal(response.status, 200, operation + ": " + JSON.stringify(value)); return value as ProductResponse;
    }
    const grant = (r: ProductResponse) => ({ operation: PRODUCT_OPERATION, dataClass: PRODUCT_DATA_CLASS, expectedDisclosureRevision: r.snapshot.disclosure.revision });
    t.after(() => { pending?.resolve(); root.dispose(); retireSyntheticWebSession(context.session); });
    return { root, platform, context, transport, call, request, grant,
        hold() { pending = deferred<void>(); return pending; },
        counts: () => ({ calls, takes, closes }), signal: () => prepareSignal };
}
test('passive construction/status; prepare binds a new disclosure and same-host explicit full chain', async t => {
    const f = fixture(t), old = await f.request('status');
    assert.deepEqual(f.counts(), { calls: 0, takes: 0, closes: 0 });
    const prepared = await f.request('prepare');
    assert.equal(prepared.snapshot.state, 'needs_consent'); assert.equal(prepared.snapshot.preparation.state, 'ready');
    assert.equal(f.transport.calls.length, 0); assert.equal(f.counts().takes, 0);
    assert.equal((await f.call('consent', f.grant(old))).status, 409);
    const accepted = await f.request('consent', f.grant(prepared));
    assert.equal(accepted.snapshot.contextRevision, prepared.snapshot.contextRevision);
    assert.ok(accepted.snapshot.consentExpiresAt! <= prepared.snapshot.preparation.expiresAt!);
    await f.request('login/start'); f.transport.login(); await f.request('login/complete');
    const models = await f.request('models');
    const result = await f.request('generate', { modelOptionId: models.snapshot.catalog!.choices[0].optionId, expectedCatalogRevision: models.snapshot.catalog!.revision });
    assert.ok(result.snapshot.result); assert.equal(result.snapshot.state, 'completed');
    assert.equal(f.counts().calls, 1); assert.equal(f.counts().takes, 1);
    assert.equal((await f.call('login/start')).status, 409);
    await f.request('cancel'); assert.equal((await f.request('status')).snapshot.result, null);
});
test('prepare rejects payloads and repeated startup; cancel owns a late preparation', async t => {
    const f = fixture(t), pending = f.hold();
    assert.equal((await f.call('prepare', { binaryPath: '/untrusted' })).status, 400);
    const work = f.call('prepare'); await tick();
    assert.equal(f.counts().calls, 1); assert.equal((await f.call('prepare')).status, 409);
    await f.request('cancel'); assert.equal(f.signal()?.aborted, true);
    assert.notEqual((await work).status, 200);
    assert.equal((await f.call('prepare')).status, 409);
    pending.resolve(); await tick();
    assert.equal((await f.request('status')).snapshot.preparation.state, 'closed');
    assert.equal(f.counts().takes, 0);
});
test('owner retirement while preparing aborts startup and suppresses late publication', async t => {
    const f = fixture(t), pending = f.hold(); const work = f.call('prepare'); await tick();
    retireSyntheticWebSession(f.context.session); assert.equal(f.signal()?.aborted, true);
    pending.resolve(); assert.notEqual((await work).status, 200); await tick();
    assert.equal(f.counts().takes, 0); assert.ok(f.counts().closes > 0);
});
for (const failure of ['render', 'abort'] as const) test(`prepare publication ${failure} failure withdraws the attempt outside the owner binding`, async t => {
    const f = fixture(t);
    const registry = createProductSessionRegistry((session, isCurrent) => createProductService({ session, isCurrent, platform: f.platform }));
    t.after(() => registry.dispose());
    const handle = registry.acquire(f.context.session as WebSessionProjection), abort = new AbortController();
    await assert.rejects(handle.respond('prepare', {}, () => {
        if (failure === 'render') throw new Error('synthetic render failure');
        abort.abort(); return new Response('must not publish');
    }, abort.signal));
    await tick(); assert.equal(f.signal()?.aborted, true); assert.ok(f.counts().closes > 0); assert.equal(f.counts().takes, 0);
});
test('deactivation cancels an already-prepared pre-consent environment', async t => {
    const f = fixture(t), paths: string[] = [];
    const browser = createProductBrowser(async (url, init) => {
        const operation = String(url).slice(PRODUCT_NAMESPACE.length) as Parameters<typeof f.call>[0]; paths.push(operation);
        return f.call(operation, JSON.parse(String(init?.body ?? '{}')), init?.signal ?? undefined);
    }); t.after(() => browser.dispose());
    browser.setActive(true); await browser.run('status'); await browser.run('prepare');
    assert.equal(browser.snapshot().snapshot?.preparation.state, 'ready');
    browser.setActive(false); await tick();
    assert.ok(paths.includes('cancel')); assert.equal(f.signal()?.aborted, true); assert.equal(f.counts().takes, 0);
});
test('failed publication from an old attempt cannot withdraw a newer preparation', async t => {
    const f = fixture(t); let service: ReturnType<typeof createProductService> | undefined;
    const registry = createProductSessionRegistry((session, isCurrent) => service = createProductService({ session, isCurrent, platform: f.platform }));
    t.after(() => registry.dispose());
    const handle = registry.acquire(f.context.session as WebSessionProjection);
    let old: ProductResponse | undefined;
    await handle.respond('prepare', {}, value => { old = value; return Response.json(value); });
    await handle.respond('cancel', {}, value => Response.json(value)); await tick();
    await handle.respond('prepare', {}, value => Response.json(value));
    const currentSignal = f.signal(); assert.equal(currentSignal?.aborted, false);
    service!.abandon(old!); assert.equal(currentSignal?.aborted, false);
    assert.equal(service!.snapshot().snapshot.state, 'needs_consent');
});
test('preparation HTTP timeout withdraws but does not release a pending owner', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t), pending = f.hold(); const work = f.call('prepare'); await tick();
    t.mock.timers.tick(120000); await tick();
    assert.equal((await work).status, 504); assert.equal(f.signal()?.aborted, true);
    assert.equal((await f.call('prepare')).status, 409);
    pending.resolve(); await tick(); assert.equal(f.counts().takes, 0);
});
test('ready preparation expires before consent; a delayed click does not renew it', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const f = fixture(t), ready = await f.request('prepare');
    now = ready.snapshot.preparation.expiresAt! + 1;
    const status = await f.request('status');
    assert.equal(status.snapshot.state, 'error'); assert.equal(f.signal()?.aborted, true);
    assert.notEqual((await f.call('consent', f.grant(ready))).status, 200);
    assert.equal(f.counts().takes, 0);
});

test('startup completing after its deadline cannot beat a delayed timeout callback', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const f = fixture(t), pending = f.hold(), work = f.call('prepare'); await tick();
    now += 120000; pending.resolve();
    assert.equal((await work).status, 504); await tick();
    assert.equal(f.signal()?.aborted, true); assert.equal(f.counts().takes, 0);
});
