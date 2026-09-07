/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountBrowser, parseAccountBrowserStatus } from '../../lib/chatgpt-account/account-browser';
import type { AccountAction, AccountState, AccountStatus } from '../../lib/chatgpt-account/account-contract';
import { deferred } from './account-test-fixture';

export function browserStatus(state: AccountState, notice: AccountStatus['notice'] = null): AccountStatus {
    const actions: AccountAction[] = state === 'connected' ? ['logout', 'refresh_account', 'read_models', 'read_rate_limits'] : state === 'awaiting_login' ? ['cancel_login'] : state === 'verifying' ? ['complete_login', 'cancel_login'] : state === 'unavailable' ? ['configure_host'] : ['connect'];
    return { state, notice, plan: state === 'connected' ? 'plus' : null, loginExpiresAt: state === 'awaiting_login' ? Date.now() + 300000 : null, actions, inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
}
const url = 'https://auth.openai.com/oauth/authorize?state=synthetic-browser-state';
function fixture() {
    let result: unknown = browserStatus('disconnected');
    const calls: { input: string; init?: RequestInit }[] = [];
    const client = createAccountBrowser((async (input, init) => { calls.push({ input: String(input), init }); return Response.json(result); }) as typeof fetch);
    client.setActive(true);
    return { client, calls, set(value: unknown) { result = value; } };
}
test('disconnected/status has no account RPC; explicit login uses fixed empty-body POST', async () => {
    const f = fixture(); await f.client.run('status'); assert.equal(f.client.snapshot().status?.state, 'disconnected');
    assert.equal(f.calls[0].init?.method, 'GET');
    f.set({ status: browserStatus('awaiting_login'), authUrl: url }); await f.client.run('login/start');
    assert.equal(f.client.snapshot().authUrl, url); assert.equal(f.calls[1].input, '/api/settings/ai/chatgpt/login/start');
    assert.equal(f.calls[1].init?.body, '{}'); assert.equal(f.calls[1].init?.credentials, 'same-origin');
    assert.equal(f.calls[1].init?.cache, 'no-store');
    f.client.dispose();
});
test('waiting/verifying/connected transition clears OAuth URL and never claims execution', async () => {
    const f = fixture(); f.set({ status: browserStatus('awaiting_login'), authUrl: url }); await f.client.run('login/start');
    f.set(browserStatus('verifying')); await f.client.run('status'); assert.equal(f.client.snapshot().authUrl, null);
    f.set(browserStatus('connected')); await f.client.run('login/complete');
    assert.equal(f.client.snapshot().status?.state, 'connected'); assert.equal(f.client.snapshot().status?.inferenceEnabled, false);
    f.client.dispose();
});
test('catalog/quotas stay unloaded until explicit request and only bounded DTO fields survive', async () => {
    const f = fixture(); f.set(browserStatus('connected')); await f.client.run('status');
    assert.equal(f.client.snapshot().models, null); assert.equal(f.client.snapshot().limits, null);
    f.set({ status: browserStatus('connected'), models: [{ id: 'synthetic', model: 'synthetic', isDefault: true, email: 'discard@example.invalid' }] });
    await f.client.run('models'); assert.equal(JSON.stringify(f.client.snapshot()).includes('@'), false);
    f.set({ status: browserStatus('connected'), primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: null }, secondary: null });
    await f.client.run('rate-limits'); assert.equal(f.client.snapshot().limits?.primary?.usedPercent, 95);
    assert.equal(f.client.snapshot().limits?.secondary, null); f.client.dispose();
});
test('cancel immediately clears URL and ignores late login response even when fetch ignores abort', async () => {
    const response = deferred<Response>(); const reached = deferred<void>();
    const client = createAccountBrowser((async (input) => {
        if (String(input).endsWith('login/start')) { reached.resolve(); return response.promise; }
        return Response.json(browserStatus('disconnected', 'canceled'));
    }) as typeof fetch);
    client.setActive(true); const first = client.run('login/start'); await reached.promise;
    await client.run('login/cancel'); response.resolve(Response.json({ status: browserStatus('awaiting_login'), authUrl: url })); await first;
    assert.equal(client.snapshot().status?.notice, 'canceled'); assert.equal(client.snapshot().authUrl, null); client.dispose();
});
test('lock and unmount reject late responses after body parsing, and clear prior URL/catalog', async () => {
    const body = deferred<unknown>(); const parsing = deferred<void>();
    const client = createAccountBrowser((async () => ({ ok: true, status: 200, json: () => { parsing.resolve(); return body.promise; } })) as unknown as typeof fetch);
    client.setActive(true); const pending = client.run('login/start'); await parsing.promise;
    client.setActive(false); body.resolve({ status: browserStatus('awaiting_login'), authUrl: url }); await pending;
    assert.equal(client.snapshot().kind, 'locked'); assert.equal(client.snapshot().authUrl, null); client.dispose();
});
test('logout preempts a late model reply and clears disclosures immediately', async () => {
    const models = deferred<Response>(); const reached = deferred<void>();
    const client = createAccountBrowser((async (input) => {
        if (String(input).endsWith('/models')) { reached.resolve(); return models.promise; }
        return Response.json(browserStatus(String(input).endsWith('/logout') ? 'disconnected' : 'connected'));
    }) as typeof fetch);
    client.setActive(true); await client.run('status'); const pending = client.run('models'); await reached.promise;
    await client.run('logout'); models.resolve(Response.json({ status: browserStatus('connected'), models: [] })); await pending;
    assert.equal(client.snapshot().status?.state, 'disconnected'); assert.equal(client.snapshot().models, null); client.dispose();
});
test('401 locks locally, network/contract errors are sanitized and erase OAuth URL', async () => {
    for (const code of [401, 503, 409]) {
        const client = createAccountBrowser(async () => new Response('private error', { status: code })); client.setActive(true); await client.run('status');
        assert.equal(client.snapshot().kind, code === 401 ? 'locked' : 'error');
        assert.equal(JSON.stringify(client.snapshot()).includes('private error'), false); client.dispose();
    }
    const f = fixture(); f.set({ status: browserStatus('awaiting_login'), authUrl: 'https://synthetic.invalid/?state=x' }); await f.client.run('login/start');
    assert.equal(f.client.snapshot().authUrl, null); assert.notEqual(f.client.snapshot().error, null); f.client.dispose();
});
test('client rejects an execution claim or malformed state and never persists arbitrary server fields', () => {
    assert.throws(() => parseAccountBrowserStatus({ ...browserStatus('connected'), inferenceEnabled: true }));
    assert.throws(() => parseAccountBrowserStatus({ ...browserStatus('connected'), state: 'executable' }));
    const value = parseAccountBrowserStatus({ ...browserStatus('connected'), email: 'discard@example.invalid' });
    assert.equal('email' in value, false);
});
test('locked client never fetches; active status error can be reread without reusing stale URL', async () => {
    const f = fixture(); f.client.setActive(false); await f.client.run('login/start'); assert.equal(f.calls.length, 0);
    f.client.setActive(true); f.set({ ...browserStatus('error', 'login_expired') }); await f.client.run('status');
    assert.equal(f.client.snapshot().status?.notice, 'login_expired'); assert.equal(f.client.snapshot().authUrl, null); f.client.dispose();
});
