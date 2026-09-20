/* @Codex: synthetic lifecycle tests; no host, credentials or provider requests. */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { AccountNotice } from './account-contract';
import type { AccountMethod, AccountNotification, AccountTransport } from './account-protocol';

const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
mkdirSync(dataDir, { recursive: true });
const { createAccountService } = await import('./account-service.ts');
const { AccountError } = await import('./account-protocol.ts');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const denied = (code: Exclude<AccountNotice, null>) => (error: unknown) => error instanceof AccountError && error.code === code && error.message === code;

class FakeTransport implements AccountTransport {
    calls: { method: AccountMethod; params: unknown }[] = [];
    listener: AccountNotification = () => {};
    closed = 0;
    initializedCalls = 0;
    connected = true;
    override?: (method: AccountMethod, params: unknown) => unknown;
    drain: () => Promise<boolean> = async () => true;
    initialized() { this.initializedCalls++; }
    subscribe(listener: AccountNotification) { this.listener = listener; return () => { this.listener = () => {}; }; }
    close() { this.closed++; return this.drain(); }
    async request(method: AccountMethod, params: unknown): Promise<unknown> {
        this.calls.push({ method, params });
        const custom = this.override?.(method, params);
        if (custom !== undefined) return custom;
        if (method === 'initialize') return { userAgent: 'synthetic-agent' };
        if (method === 'account/login/start') return { type: 'chatgpt', loginId: 'synthetic-login', authUrl: 'https://auth.openai.com/oauth/authorize?state=synthetic-test' };
        if (method === 'account/read') return { requiresOpenaiAuth: true, account: this.connected ? { type: 'chatgpt', planType: 'pro', email: 'synthetic-private@example.invalid' } : null };
        if (method === 'model/list') return { data: [{ id: 'synthetic-model', model: 'synthetic-model', hidden: false, isDefault: true, description: 'PRIVATE_SYNTHETIC_METADATA' }], nextCursor: null };
        if (method === 'account/rateLimits/read') return { rateLimitsByLimitId: { codex: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null } } };
        if (method === 'account/logout') { this.connected = false; return {}; }
        if (method === 'account/login/cancel') return { status: 'canceled' };
        throw new Error('Unexpected synthetic RPC');
    }
}
function setup(t: TestContext, extra: Partial<Parameters<typeof createAccountService>[0]> = {}) {
    const transport = new FakeTransport();
    const service = createAccountService({ configured: true, createTransport: async () => transport, ...extra });
    t.after(async () => { await service.dispose(); });
    return { transport, service };
}
async function connect(service: ReturnType<typeof createAccountService>, transport: FakeTransport) {
    const started = await service.execute('login/start');
    assert.ok('authUrl' in started);
    transport.listener('account/login/completed', { loginId: 'synthetic-login', success: true });
    await service.execute('login/complete');
    assert.equal(service.status().state, 'connected');
}

test('official account lifecycle projects metadata, never grants inference, and verifies logout readback', async t => {
    const { service, transport } = setup(t);
    const before = service.status();
    assert.equal(transport.calls.length, 0);
    await connect(service, transport);
    const models = await service.execute('models');
    assert.ok('models' in models);
    assert.deepEqual(models.models, [{ id: 'synthetic-model', model: 'synthetic-model', isDefault: true }]);
    const limits = await service.execute('rate-limits');
    assert.ok('primary' in limits);
    assert.equal(limits.primary?.usedPercent, 25);
    const serialized = JSON.stringify([service.status(), models, limits]);
    assert.doesNotMatch(serialized, /synthetic-private|PRIVATE_SYNTHETIC_METADATA/);
    assert.equal(service.status().inferenceEnabled, false);
    assert.equal(service.status().executionBlock, 'data_boundary_unqualified');
    const loggedOut = await service.execute('logout');
    assert.ok('state' in loggedOut);
    assert.equal(loggedOut.state, 'disconnected'); assert.equal(loggedOut.notice, null);
    assert.equal(service.isCurrent(models), false); assert.equal(service.isCurrent(before), false);
    assert.equal(transport.initializedCalls, 1); assert.equal(transport.closed, 1);
    assert.deepEqual(transport.calls.slice(-2), [{ method: 'account/logout', params: undefined }, { method: 'account/read', params: { refreshToken: false } }]);
});

for (const receipt of ['account-still-present', 'invalid-ack', 'failed-drain'] as const) test(`logout remains unconfirmed: ${receipt}`, async t => {
    const { service, transport } = setup(t); await connect(service, transport);
    if (receipt === 'account-still-present') transport.override = method => method === 'account/logout' ? {} : undefined;
    if (receipt === 'invalid-ack') transport.override = method => method === 'account/logout' ? { unexpected: true } : undefined;
    if (receipt === 'failed-drain') transport.drain = async () => false;
    const result = await service.execute('logout'); assert.ok('state' in result);
    assert.equal(result.state, 'disconnected'); assert.equal(result.notice, 'logout_unconfirmed');
    assert.equal(transport.closed, 1);
});

test('late login completion and catalog replies cannot reconnect after logout', async t => {
    const { service, transport } = setup(t); await connect(service, transport);
    const reply = deferred<unknown>();
    transport.override = method => method === 'model/list' ? reply.promise : undefined;
    const pending = service.execute('models'); const rejection = assert.rejects(pending, denied('session_expired'));
    const oldListener = transport.listener;
    await service.execute('logout');
    oldListener('account/login/completed', { loginId: 'synthetic-login', success: true });
    reply.resolve({ data: [], nextCursor: null }); await rejection;
    assert.equal(service.status().state, 'disconnected');
});

for (const action of ['login/cancel', 'logout'] as const) test(`${action} during startup fences the replacement until the old child drains`, async t => {
    const first = new FakeTransport(); const second = new FakeTransport();
    const created = deferred<AccountTransport>(); const drained = deferred<boolean>();
    first.drain = () => drained.promise;
    let starts = 0;
    t.after(() => { created.resolve(first); drained.resolve(true); });
    const { service } = setup(t, { createTransport: () => ++starts === 1 ? created.promise : Promise.resolve(second) });
    const starting = service.execute('login/start'); const retired = assert.rejects(starting, denied('session_expired'));
    await tick(); assert.equal(starts, 1);
    await service.execute(action);
    const replacement = service.execute('login/start');
    await tick();
    const beforeFactoryResolution = starts;
    created.resolve(first); await tick();
    const beforeDrain = starts;
    drained.resolve(true); await retired; await replacement;
    assert.equal(beforeFactoryResolution, 1, 'No replacement before retired factory resolution');
    assert.equal(beforeDrain, 1, 'No replacement before retired transport cleanup');
    assert.equal(starts, 2); assert.equal(first.closed, 1); assert.equal(first.calls.length, 0);
    assert.equal(second.calls[0].method, 'initialize');
});

test('dispose receipt waits for a pending startup and reports its actual failed cleanup', async t => {
    const first = new FakeTransport(); const created = deferred<AccountTransport>(); const drained = deferred<boolean>();
    first.drain = () => drained.promise;
    t.after(() => { created.resolve(first); drained.resolve(false); });
    const { service } = setup(t, { createTransport: () => created.promise });
    const pending = service.execute('login/start'); const rejected = assert.rejects(pending, denied('session_expired'));
    await tick();
    let settled = false;
    const disposing = service.dispose().then(result => { settled = true; return result; });
    await tick(); const beforeCreation = settled;
    created.resolve(first); await tick(); const beforeDrain = settled;
    drained.resolve(false);
    const receipt = await disposing; await rejected;
    assert.equal(beforeCreation, false); assert.equal(beforeDrain, false); assert.equal(receipt, false);
    assert.equal(first.calls.length, 0); assert.equal(first.closed, 1);
});

test('failed retired startup cleanup denies restart without creating another transport', async t => {
    const first = new FakeTransport(); const created = deferred<AccountTransport>();
    first.drain = async () => false;
    let starts = 0;
    t.after(() => created.resolve(first));
    const { service } = setup(t, { createTransport: () => { starts++; return created.promise; } });
    const pending = service.execute('login/start'); const retired = assert.rejects(pending, denied('session_expired'));
    await tick(); await service.execute('login/cancel'); created.resolve(first); await retired;
    await assert.rejects(service.execute('login/start'), denied('process_exited'));
    assert.equal(starts, 1);
});

test('a rejected startup factory does not leave an unresolved cleanup barrier', async t => {
    let starts = 0; const second = new FakeTransport();
    const { service } = setup(t, { createTransport: async () => { if (++starts === 1) throw new Error('synthetic-factory-failure'); return second; } });
    await assert.rejects(service.execute('login/start'), denied('protocol_error'));
    const result = await service.execute('login/start'); assert.ok('authUrl' in result); assert.equal(starts, 2);
});

test('logout readback is not dispatched after disposal retires the RPC epoch', async t => {
    const { service, transport } = setup(t); await connect(service, transport);
    const reply = deferred<unknown>();
    transport.override = method => method === 'account/logout' ? reply.promise : undefined;
    const logout = service.execute('logout'); const rejected = assert.rejects(logout, denied('session_expired'));
    const readCount = transport.calls.filter(call => call.method === 'account/read').length;
    await service.dispose(); reply.resolve({}); await rejected;
    assert.equal(transport.calls.filter(call => call.method === 'account/read').length, readCount);
    assert.equal(service.status().notice, 'session_expired');
});

test('unconfigured account status remains local and cannot start a host', async t => {
    let starts = 0;
    const { service } = setup(t, { configured: false, createTransport: async () => { starts++; throw new Error('not allowed'); } });
    assert.equal(service.status().state, 'unavailable');
    await assert.rejects(service.execute('login/start'), denied('host_unavailable'));
    assert.equal(starts, 0);
});
