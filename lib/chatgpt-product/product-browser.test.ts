/* @Codex — browser controller -> actual strict HTTP/root/binding, no socket. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { createProductFixture, deferred, tick } = await import('./product-production.test.ts');
const { createProductBrowser } = await import('./product-browser.ts');
const { PRODUCT_NAMESPACE } = await import('./product-contract.ts');
async function ready(f: ReturnType<typeof createProductFixture>) {
    f.browser.setActive(true); await f.browser.run('status'); await f.browser.run('consent');
    await f.browser.run('login/start'); f.transport.login(); await f.browser.run('status');
    await f.browser.run('login/complete'); await f.browser.run('models');
    assert.equal(f.browser.snapshot().snapshot?.state, 'ready', JSON.stringify(f.browser.snapshot()));
}
test('full browser chain uses dedicated real routes and never auto-selects or auto-generates', async t => {
    const f = createProductFixture(t); await ready(f);
    assert.equal(f.browser.snapshot().selection, null); assert.equal(f.browser.snapshot().login, null);
    await f.browser.run('generate'); assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
    const choice = f.browser.snapshot().snapshot!.catalog!.choices[1]; await f.browser.select(choice.optionId);
    assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
    await f.browser.run('status'); assert.equal(f.browser.snapshot().selection?.modelOptionId, choice.optionId);
    await f.browser.run('generate'); const result = f.browser.snapshot().snapshot!.result!;
    assert.ok(result, JSON.stringify(f.browser.snapshot())); assert.equal(result.provenance.effort, 'xhigh');
    assert.ok(result.citations[0].sourceSha256); assert.equal(result.proposalOnly, true); assert.equal(result.clinicalWrites, 0);
    assert.ok(f.paths.every(path => path.startsWith(PRODUCT_NAMESPACE))); assert.ok(f.responses.every(status => status === 200));
    await f.browser.run('logout'); assert.equal(f.browser.snapshot().snapshot!.result, null);
});
test('catalog refresh erases explicit choice, no silent replacement', async t => {
    const f = createProductFixture(t); await ready(f); await f.browser.select(f.browser.snapshot().snapshot!.catalog!.choices[0].optionId);
    await f.browser.run('models'); assert.equal(f.browser.snapshot().selection, null);
    await f.browser.run('generate'); assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
});
test('selection change during generation cancels without a replacement turn', async t => {
    const f = createProductFixture(t); await ready(f); const choices = f.browser.snapshot().snapshot!.catalog!.choices;
    await f.browser.select(choices[0].optionId); f.transport.autoFinish = false;
    const reached = deferred<void>(); f.transport.override = method => { if (method === 'turn/start') reached.resolve(); };
    const work = f.browser.run('generate'); await reached.promise; await tick(); await f.browser.select(choices[1].optionId); await work;
    f.transport.finish(); await tick(); assert.equal(f.browser.snapshot().selection, null);
    assert.equal(f.browser.snapshot().snapshot?.result ?? null, null); assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 1);
    assert.ok(f.paths.includes(PRODUCT_NAMESPACE + 'cancel'));
});
test('lock/unmount withdraws only through cancel and cannot revive delayed results', async t => {
    const f = createProductFixture(t); await ready(f); await f.browser.select(f.browser.snapshot().snapshot!.catalog!.choices[0].optionId);
    f.transport.autoFinish = false; const reached = deferred<void>(); f.transport.override = method => { if (method === 'turn/start') reached.resolve(); };
    const work = f.browser.run('generate'); await reached.promise; await tick(); f.browser.setActive(false); await work; f.transport.finish(); await tick();
    assert.equal(f.browser.snapshot().active, false); assert.equal(f.browser.snapshot().snapshot, null); assert.equal(f.browser.snapshot().login, null);
    assert.ok(f.paths.includes(PRODUCT_NAMESPACE + 'cancel')); assert.equal(f.transport.closed, true);
});
test('401 clears account/model/result metadata and disables browser until new activation', async t => {
    const f = createProductFixture(t); await ready(f); f.retire(); await f.browser.run('status');
    assert.equal(f.browser.snapshot().active, false); assert.equal(f.browser.snapshot().snapshot, null);
});
test('late local status cannot restore a selected option after deactivation', async t => {
    const f = createProductFixture(t); const response = await f.call('status'); const late = deferred<Response>();
    const browser = createProductBrowser(async () => late.promise); t.after(() => browser.dispose());
    browser.setActive(true); const work = browser.run('status'); browser.setActive(false); late.resolve(response); await work;
    assert.equal(browser.snapshot().active, false); assert.equal(browser.snapshot().snapshot, null);
});
test('malformed and oversized responses expose no response body or upstream error message', async t => {
    const bodies = ['PRIVATE_RESPONSE_SENTINEL', '{"snapshot":null}', 'x'.repeat(262145), '{"error":"PRIVATE_RESPONSE_SENTINEL"}'];
    for (const body of bodies) {
        const browser = createProductBrowser(async () => new Response(body)); t.after(() => browser.dispose());
        browser.setActive(true); await browser.run('status'); assert.equal(browser.snapshot().snapshot, null);
        assert.doesNotMatch(JSON.stringify(browser.snapshot()), /PRIVATE_RESPONSE_SENTINEL/);
    }
});
for (const corruption of ['missing-array', 'receipt', 'source', 'egress', 'qualifier'] as const) test(`invalid DTO ${corruption} is rejected before rendering`, async t => {
    const f = createProductFixture(t); const reply = structuredClone(await f.request('status')) as unknown as { snapshot: Record<string, unknown> };
    if (corruption === 'missing-array') delete (reply.snapshot.qualification as Record<string, unknown>).missing;
    if (corruption === 'receipt') reply.snapshot.receipt = null;
    if (corruption === 'source') (reply.snapshot.disclosure as Record<string, unknown>).sources = [null];
    if (corruption === 'egress') (reply.snapshot.disclosure as Record<string, unknown>).egress = ['https://other.invalid'];
    if (corruption === 'qualifier') (reply.snapshot.qualification as Record<string, unknown>).state = 'whatever';
    const browser = createProductBrowser(async () => Response.json(reply)); t.after(() => browser.dispose()); browser.setActive(true); await browser.run('status');
    assert.equal(browser.snapshot().snapshot, null); assert.ok(browser.snapshot().error);
});
async function pendingLogin(f: ReturnType<typeof createProductFixture>) {
    f.browser.setActive(true); await f.browser.run('status'); await f.browser.run('consent'); await f.browser.run('login/start');
    const challenge = f.browser.snapshot().login, snapshot = f.browser.snapshot().snapshot;
    assert.ok(challenge); assert.ok(snapshot); assert.equal(snapshot.state, 'awaiting_login');
    await f.browser.run('login/complete');
    assert.equal(f.responses.at(-1), 409); assert.deepEqual(f.browser.snapshot().login, challenge);
    assert.equal(f.browser.snapshot().snapshot?.contextRevision, snapshot.contextRevision);
    assert.match(f.browser.snapshot().error!, /Completa prima l’accesso ufficiale/u);
    return { challenge, snapshot, message: f.browser.snapshot().error };
}
test('409 login_pending preserves the owned challenge, context and message through repeated local polls and matching completion', async t => {
    const f = createProductFixture(t); const pending = await pendingLogin(f);
    const calls = f.transport.calls.length;
    for (let index = 0; index < 4; index++) {
        await f.browser.run('status');
        assert.deepEqual(f.browser.snapshot().login, pending.challenge);
        assert.equal(f.browser.snapshot().error, pending.message);
        assert.equal(f.browser.snapshot().snapshot?.state, 'awaiting_login');
        assert.equal(f.browser.snapshot().snapshot?.contextRevision, pending.snapshot.contextRevision);
        assert.equal(f.browser.snapshot().snapshot?.consentExpiresAt, pending.snapshot.consentExpiresAt);
        assert.equal(f.browser.snapshot().snapshot?.loginExpiresAt, pending.snapshot.loginExpiresAt);
        assert.equal(f.transport.calls.length, calls, 'GET polling is local, without RPC');
    }
    assert.equal(f.created(), 1); assert.equal(f.transport.calls.filter(x => x.method === 'account/login/start').length, 1);
    assert.equal(f.transport.calls.filter(x => x.method === 'model/list' || x.method === 'thread/start' || x.method === 'turn/start').length, 0);
    f.transport.login(); await f.browser.run('status');
    assert.equal(f.browser.snapshot().snapshot?.state, 'verifying'); assert.deepEqual(f.browser.snapshot().login, pending.challenge);
    await f.browser.run('login/complete');
    assert.equal(f.browser.snapshot().snapshot?.state, 'connected');
    assert.equal(f.browser.snapshot().snapshot?.authenticatedProcess, 'dedicated_execution');
    assert.equal(f.browser.snapshot().login, null); assert.equal(f.browser.snapshot().error, null);
    assert.equal(f.transport.calls.filter(x => x.method === 'config/read').length, 2);
    assert.equal(f.transport.calls.filter(x => x.method === 'account/read').length, 2);
    assert.equal(f.transport.calls.filter(x => x.method === 'model/list' || x.method === 'turn/start').length, 0);
    assert.doesNotMatch(JSON.stringify((await f.request('status')).snapshot), /verificationUrl|FAKE-TEST|fixture-login/u);
});
for (const operation of ['cancel', 'login/cancel', 'logout'] as const) test(`${operation} erases a pending challenge synchronously and never revives it on status`, async t => {
    const f = createProductFixture(t); await pendingLogin(f);
    const work = f.browser.run(operation);
    assert.equal(f.browser.snapshot().login, null, 'erase before any awaited response');
    assert.equal(f.browser.snapshot().error, null);
    await work; f.transport.login(); await f.browser.run('status');
    assert.equal(f.browser.snapshot().login, null); assert.equal(f.browser.snapshot().snapshot?.state, 'canceled');
    assert.equal(f.transport.calls.filter(call => call.method === 'turn/start').length, 0);
});
for (const cause of ['lock', 'unmount', 'owner', 'qualification'] as const) test(`pending challenge is not retained after ${cause}`, async t => {
    const f = createProductFixture(t); await pendingLogin(f);
    if (cause === 'lock') f.browser.setActive(false);
    if (cause === 'unmount') f.browser.dispose();
    if (cause === 'owner') { f.retire(); await f.browser.run('status'); }
    if (cause === 'qualification') {
        f.setQualification({ platform: 'synthetic-test-only', state: 'unqualified', revision: 'revoked', missing: ['fake-revocation'] });
        await f.browser.run('status');
    }
    assert.equal(f.browser.snapshot().login, null);
    f.transport.login(); await tick(); await f.browser.run('status');
    assert.equal(f.browser.snapshot().login, null);
    assert.equal(f.transport.calls.filter(call => call.method === 'account/login/start').length, 1);
    assert.equal(f.transport.calls.filter(call => call.method === 'turn/start').length, 0);
});
test('pending challenge expiry clears transients without another login or relying on the next poll', async t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = createProductFixture(t); const pending = await pendingLogin(f);
    const remaining = Math.min(pending.snapshot.consentExpiresAt!, pending.snapshot.loginExpiresAt!) - now;
    now += remaining; t.mock.timers.tick(remaining); await tick();
    assert.equal(f.browser.snapshot().login, null); assert.equal(f.browser.snapshot().snapshot, null);
    assert.match(f.browser.snapshot().error!, /scaduto/u);
    assert.equal(f.transport.calls.filter(call => call.method === 'account/login/start').length, 1);
    assert.equal(f.transport.calls.filter(call => call.method === 'turn/start').length, 0);
});
test('late login/start cannot publish its challenge after cancellation of that context', async t => {
    const f = createProductFixture(t), responseReady = deferred<void>(), release = deferred<void>();
    const browser = createProductBrowser(async (input, init) => {
        const operation = String(input).slice(PRODUCT_NAMESPACE.length) as Parameters<typeof f.call>[0];
        const response = await f.call(operation, init?.body ? JSON.parse(String(init.body)) : {});
        if (operation === 'login/start') { responseReady.resolve(); await release.promise; }
        return response;
    }); t.after(() => browser.dispose());
    browser.setActive(true); await browser.run('status'); await browser.run('consent');
    const pending = browser.run('login/start'); await responseReady.promise;
    await browser.run('cancel'); release.resolve(); await pending;
    assert.equal(browser.snapshot().login, null); assert.equal(browser.snapshot().snapshot?.state, 'canceled');
    assert.equal(f.created(), 1); assert.equal(f.transport.closed, true);
});
test('a status from a different genuine owner/context never inherits the locally owned challenge', async t => {
    const first = createProductFixture(t), second = createProductFixture(t);
    let foreignStatus = false;
    const browser = createProductBrowser(async (input, init) => {
        const operation = String(input).slice(PRODUCT_NAMESPACE.length) as Parameters<typeof first.call>[0];
        const target = foreignStatus && operation === 'status' ? second : first;
        return target.call(operation, init?.body ? JSON.parse(String(init.body)) : {});
    }); t.after(() => browser.dispose());
    browser.setActive(true); await browser.run('status'); await browser.run('consent'); await browser.run('login/start');
    await browser.run('login/complete'); assert.ok(browser.snapshot().login);
    await second.consent(); await second.request('login/start');
    foreignStatus = true; await browser.run('status');
    assert.equal(browser.snapshot().snapshot?.state, 'awaiting_login');
    assert.equal(browser.snapshot().login, null); assert.equal(browser.snapshot().error, null);
});
for (const status of [400, 500]) test(`login_pending on HTTP ${status} is not treated as a pending-state grant`, async t => {
    const f = createProductFixture(t);
    const browser = createProductBrowser(async (input, init) => {
        const operation = String(input).slice(PRODUCT_NAMESPACE.length) as Parameters<typeof f.call>[0];
        if (operation === 'login/complete') return Response.json({ error: 'login_pending' }, { status });
        return f.call(operation, init?.body ? JSON.parse(String(init.body)) : {});
    }); t.after(() => browser.dispose()); browser.setActive(true);
    await browser.run('status'); await browser.run('consent'); await browser.run('login/start');
    assert.ok(browser.snapshot().login); await browser.run('login/complete');
    assert.equal(browser.snapshot().login, null); assert.equal(browser.snapshot().snapshot, null);
});
