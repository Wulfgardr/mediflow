/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountService } from '../../lib/chatgpt-account/account-service';
import { AccountError, loginResponse, accountResponse, rateLimitsResponse, modelPage } from '../../lib/chatgpt-account/account-protocol';
import { SyntheticAccountTransport, deferred, syntheticAccount, syntheticLogin } from './account-test-fixture';

function setup(extra = {}) {
    const transport = new SyntheticAccountTransport();
    const service = createAccountService({ configured: true, createTransport: async () => transport, ...extra });
    return { transport, service };
}
async function connected() {
    const fixture = setup();
    await fixture.service.execute('login/start'); fixture.transport.complete();
    await fixture.service.execute('login/complete');
    return fixture;
}
test('default OFF: status causes no transport creation or RPC', async () => {
    let created = 0;
    const service = createAccountService({ configured: false, createTransport: async () => { created++; return new SyntheticAccountTransport(); } });
    assert.equal(service.status().state, 'unavailable');
    assert.deepEqual(service.status().actions, ['configure_host']);
    await assert.rejects(service.execute('login/start'), /host_unavailable/);
    assert.equal(created, 0);
});
test('login completion requires matching server notification and fresh account read; DTO minimization', async () => {
    const { service, transport } = setup();
    try {
        const started = await service.execute('login/start');
        assert.equal('authUrl' in started, true);
        assert.equal(transport.initializedCount, 1);
        await assert.rejects(service.execute('login/complete'), /invalid_state/);
        transport.complete('foreign-login');
        assert.equal(service.status().state, 'awaiting_login');
        transport.complete();
        assert.equal(service.status().state, 'verifying');
        assert.equal((await service.execute('login/complete') as { state: string }).state, 'connected');
        const catalog = await service.execute('models');
        const limits = await service.execute('rate-limits');
        const output = JSON.stringify([service.status(), catalog, limits]);
        for (const forbidden of ['email', 'fixture@example', 'private-synthetic-account', 'authUrl', 'loginId', 'discard me']) assert.equal(output.includes(forbidden), false);
        assert.equal(service.status().inferenceEnabled, false);
        assert.equal(service.status().executionBlock, 'data_boundary_unqualified');
        assert.deepEqual(transport.calls.map((call) => call.method), ['initialize', 'account/login/start', 'account/read', 'model/list', 'account/rateLimits/read']);
    } finally { await service.dispose(); }
});
test('cancel uses host-held loginId, cleans process, and ignores late completion', async () => {
    const { service, transport } = setup();
    await service.execute('login/start');
    await service.execute('login/cancel'); transport.complete();
    assert.equal(service.status().state, 'disconnected');
    assert.equal(service.status().notice, 'canceled');
    assert.equal(transport.closed, 1);
    assert.deepEqual(transport.calls.at(-1), { method: 'account/login/cancel', params: { loginId: syntheticLogin.loginId } });
});
test('cancel while login/start response is pending closes transport and denies late URL', async () => {
    const { service, transport } = setup();
    const response = deferred<unknown>(); const reached = deferred<void>();
    transport.handler = async (method) => { if (method === 'initialize') return { userAgent: 'synthetic' }; reached.resolve(); return response.promise; };
    const starting = service.execute('login/start');
    await reached.promise;
    await service.execute('login/cancel');
    response.resolve(syntheticLogin);
    await assert.rejects(starting, /session_expired/);
    assert.equal(service.status().state, 'disconnected'); assert.equal(transport.closed, 1);
});
test('early matching completion is retained but still requires account/read', async () => {
    const { service, transport } = setup();
    transport.handler = async (method) => {
        if (method === 'initialize') return { userAgent: 'synthetic' };
        if (method === 'account/login/start') { transport.complete(); return syntheticLogin; }
        return syntheticAccount;
    };
    await service.execute('login/start');
    assert.equal(service.status().state, 'verifying');
    await service.execute('login/complete'); assert.equal(service.status().state, 'connected');
    await service.dispose();
});
test('failed and malformed login events close the process without leaking upstream details', async () => {
    for (const malformed of [false, true]) {
        const { service, transport } = setup(); await service.execute('login/start');
        if (malformed) transport.notification('account/login/completed', { success: 'yes', loginId: syntheticLogin.loginId });
        else transport.complete(syntheticLogin.loginId, false);
        assert.equal(service.status().state, 'error'); assert.equal(transport.closed, 1);
        assert.equal(JSON.stringify(service.status()).includes('private'), false);
    }
});
test('expired login cannot be completed; expiry timer is also proactive', async () => {
    let now = 100;
    const { service, transport } = setup({ now: () => now, loginTimeoutMs: 20 });
    await service.execute('login/start'); now = 121; transport.complete();
    assert.equal(service.status().notice, 'login_expired'); assert.equal(transport.closed, 1);
    await assert.rejects(service.execute('login/complete'), /invalid_state/);
    const timerFixture = setup({ loginTimeoutMs: 10 });
    await timerFixture.service.execute('login/start');
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(timerFixture.transport.closed, 1);
    assert.equal(timerFixture.service.status().notice, 'login_expired');
});
test('logout confirms account/read null, drops prior results, and destroys local state', async () => {
    const { service, transport } = await connected();
    const previous = await service.execute('models');
    const result = await service.execute('logout');
    assert.equal((result as { state: string }).state, 'disconnected');
    assert.equal(service.isCurrent(previous), false);
    assert.equal(service.status().notice, null); assert.equal(transport.closed, 1);
    assert.deepEqual(transport.calls.slice(-2).map((item) => item.method), ['account/logout', 'account/read']);
});
test('failed or unconfirmed remote logout still disconnects locally and reports uncertainty', async () => {
    for (const timeout of [true, false]) {
        const { service, transport } = await connected();
        transport.handler = async (method) => {
            if (timeout) throw new AccountError('timeout');
            return method === 'account/logout' ? {} : syntheticAccount;
        };
        await service.execute('logout');
        assert.equal(service.status().state, 'disconnected');
        assert.equal(service.status().notice, 'logout_unconfirmed'); assert.equal(transport.closed, 1);
    }
});
test('logout during model read prevents publishing the late catalog', async () => {
    const { service, transport } = await connected(); const response = deferred<unknown>(); const reached = deferred<void>();
    transport.handler = async (method) => {
        if (method === 'model/list') { reached.resolve(); return response.promise; }
        return method === 'account/logout' ? {} : { account: null, requiresOpenaiAuth: true };
    };
    const reading = service.execute('models'); await reached.promise;
    await service.execute('logout'); response.resolve({ data: [], nextCursor: null });
    await assert.rejects(reading, /session_expired/);
});
test('timeout and unexpected exit are terminal; explicit restart creates a fresh transport', async () => {
    const first = new SyntheticAccountTransport(); const second = new SyntheticAccountTransport(); let creates = 0;
    const service = createAccountService({ configured: true, createTransport: async () => ++creates === 1 ? first : second });
    await service.execute('login/start'); first.failure('timeout');
    assert.equal(service.status().notice, 'timeout'); assert.equal(first.closed, 1);
    await service.execute('login/start'); first.complete();
    assert.equal(service.status().state, 'awaiting_login'); assert.equal(creates, 2);
    second.failure('process_exited'); assert.equal(service.status().notice, 'process_exited');
    await service.dispose();
});
test('session dispose while creating a process closes the late process and rejects result', async () => {
    const created = deferred<SyntheticAccountTransport>(); const reached = deferred<void>(); const transport = new SyntheticAccountTransport();
    const service = createAccountService({ configured: true, createTransport: () => { reached.resolve(); return created.promise; } });
    const starting = service.execute('login/start'); await reached.promise; await service.dispose(); created.resolve(transport);
    await assert.rejects(starting, /session_expired/); assert.equal(transport.closed, 1);
});
test('catalog pagination is bounded and rejects cycles; malformed account fails closed', async () => {
    const { service, transport } = await connected();
    transport.handler = async () => ({ data: [], nextCursor: 'same-cursor' });
    await assert.rejects(service.execute('models'), /protocol_error/);
    assert.equal(transport.closed, 1); assert.equal(service.status().state, 'error');
    assert.throws(() => accountResponse({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }), /protocol_error/);
    assert.throws(() => accountResponse({ account: null }), /protocol_error/);
});
test('strict projections reject unsafe OAuth URLs, invalid models and malformed quota; null stays unknown', () => {
    for (const authUrl of ['http://auth.openai.com/oauth/authorize?state=x', 'https://auth.openai.com.evil.invalid/oauth/authorize?state=x', 'https://auth.openai.com/oauth/authorize', 'https://user@auth.openai.com/oauth/authorize?state=x', 'https://auth.openai.com/other?state=x']) {
        assert.throws(() => loginResponse({ ...syntheticLogin, authUrl }), /protocol_error/);
    }
    assert.throws(() => modelPage({ data: [{ id: 'fixture@example.invalid', model: 'test', isDefault: true, hidden: false }], nextCursor: null }), /protocol_error/);
    assert.throws(() => rateLimitsResponse({ rateLimits: { primary: { usedPercent: NaN, windowDurationMins: null, resetsAt: null }, secondary: null } }), /protocol_error/);
    assert.deepEqual(rateLimitsResponse({ rateLimits: { primary: null, secondary: null } }), { primary: null, secondary: null });
});
test('account revocation notification invalidates prior results and disconnects without inference', async () => {
    const { service, transport } = await connected();
    const result = await service.execute('models');
    transport.notification('account/updated', { authMode: null, planType: null });
    assert.equal(service.status().state, 'disconnected'); assert.equal(service.isCurrent(result), false);
    assert.equal(transport.closed, 1);
});
test('busy operations cannot queue or replace an active login', async () => {
    const { service, transport } = setup(); const response = deferred<unknown>(); const reached = deferred<void>();
    transport.handler = async (method) => {
        if (method === 'initialize') return { userAgent: 'synthetic' };
        reached.resolve(); return response.promise;
    };
    const first = service.execute('login/start'); await reached.promise;
    await assert.rejects(service.execute('login/start'), /busy/);
    response.resolve(syntheticLogin); await first;
    assert.equal(transport.calls.filter((call) => call.method === 'account/login/start').length, 1);
    await service.dispose();
});
test('cancel notFound and cancel timeout both remove local authentication state', async () => {
    for (const timesOut of [false, true]) {
        const { service, transport } = setup(); await service.execute('login/start');
        transport.handler = async () => { if (timesOut) throw new AccountError('timeout'); return { status: 'notFound' }; };
        await service.execute('login/cancel');
        assert.equal(service.status().state, 'disconnected'); assert.equal(service.status().plan, null);
        assert.equal(transport.closed, 1);
    }
});
test('logout during disconnected account/read cleanup also denies the older response', async () => {
    const { service, transport } = await connected();
    const closing = deferred<boolean>(); const reached = deferred<void>();
    transport.handler = async () => ({ account: null, requiresOpenaiAuth: true });
    transport.close = () => { reached.resolve(); return closing.promise; };
    const reading = service.execute('read'); await reached.promise;
    await service.execute('logout'); closing.resolve(true);
    await assert.rejects(reading, /session_expired/);
});
