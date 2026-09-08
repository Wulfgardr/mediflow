/* @Codex: real browser client -> HTTP -> session registry -> owner -> service;
   only the external account transport is synthetic. No listener or live login. */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { AccountMethod, AccountNotification, AccountTransport } from './account-protocol';
import type { AccountOperation } from './account-contract';
const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
mkdirSync(dataDir, { recursive: true });
const { createAccountBrowser } = await import('./account-browser.ts');
const { presentAccount } = await import('./account-presentation.ts');
const { createAccountService } = await import('./account-service.ts');
const { createAccountSessionRegistry } = await import('./account-session.ts');
const { createAccountHttp } = await import('./account-http.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('../security/web-auth-lifecycle-owner-test-fixture.ts');
const { resolve: resolveOwner } = await import('../security/web-auth-lifecycle-owner-adapter.ts');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class SyntheticAccount implements AccountTransport {
    calls: AccountMethod[] = []; listener: AccountNotification = () => {}; closed = 0; connected = true;
    override?: (method: AccountMethod) => unknown;
    initialized() {}
    subscribe(listener: AccountNotification) { this.listener = listener; return () => { this.listener = () => {}; }; }
    async close() { this.closed++; return true; }
    async request(method: AccountMethod): Promise<unknown> {
        this.calls.push(method); const custom = this.override?.(method); if (custom !== undefined) return custom;
        switch (method) {
            case 'initialize': return { userAgent: 'synthetic-product' };
            case 'account/login/start': return { type: 'chatgpt', loginId: 'synthetic-product', authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-product' };
            case 'account/read': return { requiresOpenaiAuth: true, account: this.connected ? { type: 'chatgpt', planType: 'pro', email: 'invented@example.invalid' } : null };
            case 'model/list': return { data: [{ id: 'synthetic-model', model: 'synthetic-model', hidden: false, isDefault: true }], nextCursor: null };
            case 'account/rateLimits/read': return { rateLimitsByLimitId: { codex: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null }, secondary: null } } };
            case 'account/logout': this.connected = false; return {};
            case 'account/login/cancel': return { status: 'canceled' };
            default: throw new Error('Unimplemented synthetic account method');
        }
    }
}
function setup(t: TestContext, suffix: string) {
    const context = issueSyntheticWebSessionContext({ id: `invented-${suffix}`, username: 'invented', role: 'doctor' }, suffix);
    const resolution = resolveOwner(context.session.id, context.controlId);
    assert.ok(resolution.status === 'active');
    const projection = resolution.projection;
    const transport = new SyntheticAccount(); const responses: number[] = []; const operations: string[] = [];
    const registry = createAccountSessionRegistry(() => createAccountService({ configured: true, createTransport: async () => transport }));
    const http = createAccountHttp({ acquire: async () => registry.acquire(projection) });
    const browser = createAccountBrowser(async (input, init) => {
        const path = String(input); assert.ok(path.startsWith('/api/settings/ai/chatgpt/'));
        const op = path.slice('/api/settings/ai/chatgpt/'.length) as AccountOperation | 'status'; operations.push(op);
        assert.equal(init?.body, op === 'status' ? undefined : '{}');
        const headers = new Headers(init?.headers);
        if (op !== 'status') { headers.set('origin', 'http://localhost:3210'); headers.set('sec-fetch-site', 'same-origin'); }
        const response = await http(new Request(`http://localhost:3210${path}`, { ...init, headers }), op);
        responses.push(response.status); assert.equal(response.headers.get('cache-control'), 'no-store');
        return response;
    });
    browser.setActive(true);
    t.after(() => { browser.dispose(); registry.dispose(); retireSyntheticWebSession(context.session); });
    async function connect() {
        await browser.run('status'); assert.equal(transport.calls.length, 0, 'GET status never launches the transport');
        await browser.run('login/start'); assert.equal(browser.snapshot().status?.state, 'awaiting_login');
        transport.listener('account/login/completed', { loginId: 'synthetic-product', success: true });
        await browser.run('status'); assert.equal(browser.snapshot().status?.state, 'verifying');
        await browser.run('login/complete'); assert.equal(browser.snapshot().status?.state, 'connected');
        assert.equal(browser.snapshot().authUrl, null);
    }
    return { browser, transport, responses, operations, context, connect };
}

test('integrated account lifecycle renders connected, informational catalog and suspended functions through logout', async t => {
    const f = setup(t, 'lifecycle'); await f.connect();
    await f.browser.run('models'); await f.browser.run('rate-limits');
    assert.equal(presentAccount(f.browser.snapshot(), true).accountLabel, 'Account collegato');
    assert.equal(presentAccount(f.browser.snapshot(), true).executionLabel, 'Uso nelle funzioni sospeso');
    assert.equal(f.browser.snapshot().models?.[0].model, 'synthetic-model'); assert.equal(f.browser.snapshot().limits?.primary?.usedPercent, 25);
    assert.doesNotMatch(JSON.stringify(f.browser.snapshot()), /invented@example/);
    const calls = f.transport.calls.length; await f.browser.run('status'); assert.equal(f.transport.calls.length, calls);
    await f.browser.run('read'); assert.equal(f.browser.snapshot().models, null); assert.equal(f.browser.snapshot().limits, null);
    await f.browser.run('logout'); assert.equal(f.browser.snapshot().status?.state, 'disconnected');
    assert.equal(f.browser.snapshot().status?.notice, null); assert.equal(f.transport.closed, 1);
    assert.ok(f.responses.every(value => value === 200));
    assert.ok(f.transport.calls.every(method => !method.startsWith('thread/') && !method.startsWith('turn/')));
});

test('owner-bound catalog error is visible, erases previous metadata and requires explicit recovery', async t => {
    const f = setup(t, 'error'); await f.connect(); await f.browser.run('models');
    f.transport.override = method => method === 'model/list' ? Promise.reject(new Error('invented-provider-error')) : undefined;
    await f.browser.run('models'); assert.equal(f.responses.at(-1), 503);
    assert.equal(f.browser.snapshot().models, null); assert.ok(f.browser.snapshot().error);
    assert.equal(presentAccount(f.browser.snapshot(), true).pollDelay, null);
    f.transport.override = undefined; await f.browser.run('status');
    assert.equal(f.browser.snapshot().error, null); assert.equal(f.browser.snapshot().models, null);
});

test('logout wins over a delayed real-registry catalog response without republishing metadata', async t => {
    const f = setup(t, 'late-logout'); await f.connect(); await f.browser.run('models');
    const late = deferred<unknown>(); t.after(() => late.resolve({ data: [], nextCursor: null }));
    f.transport.override = method => method === 'model/list' ? late.promise : undefined;
    const pending = f.browser.run('models'); await tick();
    await f.browser.run('logout'); late.resolve({ data: [{ id: 'late', model: 'late', hidden: false, isDefault: false }], nextCursor: null }); await pending;
    assert.equal(f.browser.snapshot().status?.state, 'disconnected'); assert.equal(f.browser.snapshot().models, null);
    assert.equal(f.browser.snapshot().modelsObservedAt, null); assert.equal(f.transport.closed, 1);
    assert.equal(f.responses.at(-1), 401, 'The real owner/session path rejects the late catalog');
});

test('real owner retirement during a pending read locks the browser and clears all account observations', async t => {
    const f = setup(t, 'retirement'); await f.connect(); await f.browser.run('models');
    const late = deferred<unknown>(); t.after(() => late.resolve({ data: [], nextCursor: null }));
    f.transport.override = method => method === 'model/list' ? late.promise : undefined;
    const pending = f.browser.run('models'); await tick(); retireSyntheticWebSession(f.context.session);
    late.resolve({ data: [], nextCursor: null }); await pending;
    assert.equal(f.responses.at(-1), 401); assert.equal(f.browser.snapshot().kind, 'locked');
    assert.equal(f.browser.snapshot().models, null); assert.equal(f.browser.snapshot().modelsObservedAt, null);
    assert.equal(presentAccount(f.browser.snapshot(), true).pollDelay, null); assert.equal(f.transport.closed, 1);
});

test('unconfirmed remote logout remains explicit and cannot retain the catalog', async t => {
    const f = setup(t, 'unconfirmed'); await f.connect(); await f.browser.run('models');
    f.transport.override = method => method === 'account/logout' ? {} : undefined;
    await f.browser.run('logout');
    assert.equal(f.browser.snapshot().status?.state, 'disconnected');
    assert.equal(f.browser.snapshot().status?.notice, 'logout_unconfirmed');
    assert.equal(f.browser.snapshot().models, null); assert.equal(f.browser.snapshot().authUrl, null);
});
