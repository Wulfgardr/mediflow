/* @Codex: browser state only, with an abort-ignoring synthetic fetcher. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { AccountStatus } from './account-contract';

const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
mkdirSync(dataDir, { recursive: true });
const { createAccountBrowser } = await import('./account-browser.ts');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const connected: AccountStatus = { state: 'connected', notice: null, plan: 'pro', loginExpiresAt: null,
    actions: ['read_models', 'logout'], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
const disconnected: AccountStatus = { ...connected, state: 'disconnected', plan: null, actions: ['connect'] };
const models = { status: connected, models: [{ id: 'synthetic-model', model: 'synthetic-model', isDefault: true }] };

for (const phase of ['fetch', 'body'] as const) test(`deadline rejects a late ${phase} even if abort is ignored`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const network = deferred<Response>(); const body = deferred<unknown>();
    let signal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_url, init) => {
        signal = init?.signal;
        if (phase === 'fetch') return network.promise;
        const response = Response.json({});
        response.json = () => body.promise;
        return response;
    };
    const browser = createAccountBrowser(fetcher); t.after(() => browser.dispose());
    browser.setActive(true);
    const pending = browser.run('models'); await tick();
    t.mock.timers.tick(20_000);
    assert.equal(signal?.aborted, true);
    network.resolve(Response.json(models)); body.resolve(models);
    await pending;
    assert.equal(browser.snapshot().status, null);
    assert.equal(browser.snapshot().models, null);
    assert.equal(browser.snapshot().kind, 'error');
    assert.equal(browser.snapshot().busy, null);
    assert.ok(browser.snapshot().error);
});

test('an on-time catalog remains accepted with an inert timeout afterward', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls: RequestInit[] = [];
    const browser = createAccountBrowser(async (_url, init) => { calls.push(init!); return Response.json(models); });
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('models');
    assert.equal(browser.snapshot().kind, 'ready'); assert.deepEqual(browser.snapshot().models, models.models);
    assert.equal(browser.snapshot().status?.inferenceEnabled, false);
    t.mock.timers.tick(20_000); assert.deepEqual(browser.snapshot().models, models.models);
    assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].body, '{}');
    assert.equal(calls[0].cache, 'no-store'); assert.equal(calls[0].credentials, 'same-origin');
});

test('logout invalidates an older catalog response without losing the logout snapshot', async t => {
    const late = deferred<Response>(); let count = 0;
    const browser = createAccountBrowser(async () => ++count === 1 ? late.promise : Response.json(disconnected));
    t.after(() => browser.dispose()); browser.setActive(true);
    const pending = browser.run('models'); await browser.run('logout');
    late.resolve(Response.json(models)); await pending;
    assert.equal(browser.snapshot().status?.state, 'disconnected'); assert.equal(browser.snapshot().models, null);
});

test('locking the browser while a body is pending discards its account and login URL', async t => {
    const body = deferred<unknown>(); const response = Response.json({}); response.json = () => body.promise;
    const browser = createAccountBrowser(async () => response); t.after(() => browser.dispose()); browser.setActive(true);
    const pending = browser.run('login/start'); await tick(); browser.setActive(false);
    body.resolve({ status: { ...disconnected, state: 'awaiting_login', actions: ['cancel_login'] }, authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-test' });
    await pending;
    assert.equal(browser.snapshot().kind, 'locked'); assert.equal(browser.snapshot().status, null); assert.equal(browser.snapshot().authUrl, null);
});

test('an on-time unauthorized response locks and erases the account view', async t => {
    const browser = createAccountBrowser(async () => new Response(null, { status: 401 }));
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('status');
    assert.equal(browser.snapshot().kind, 'locked'); assert.equal(browser.snapshot().status, null);
});
