import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductFixture } from './product-production.test.ts';
const creditQuota = () => ({ accountId: 'synthetic-product-account', rateLimitsByLimitId: { codex: { primary: { usedPercent: 100 }, secondary: null,
    credits: { hasCredits: true, unlimited: false, balance: '999999.123' }, spendControlReached: false, rateLimitReachedType: 'rate_limit_reached' } } });

test('actual product owner and browser admit only the explicit credit-backed synthetic attempt and expose no balance', async t => {
    const f = createProductFixture(t); f.transport.quotas = creditQuota(); f.browser.setActive(true);
    await f.browser.run('status'); await f.browser.run('consent'); await f.browser.run('login/start'); f.transport.login();
    await f.browser.run('login/complete'); await f.browser.run('models');
    const snapshot = f.browser.snapshot().snapshot!;
    assert.equal(snapshot.state, 'ready'); assert.equal(snapshot.limits?.includedUsage, 'exhausted');
    assert.equal(snapshot.limits?.creditAvailability, 'available'); assert.doesNotMatch(JSON.stringify(snapshot), /999999|balance|synthetic-product-account/);
    assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
    await f.browser.select(snapshot.catalog!.choices[0].optionId); await f.browser.run('generate');
    assert.equal(f.browser.snapshot().snapshot?.state, 'completed'); assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 1);
    await f.browser.run('generate'); assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 1);
});

for (const phase of ['startup', 'ready'] as const) test(`credit depletion during ${phase} retires product state and records the notice without restoring it`, async t => {
    const f = createProductFixture(t); f.transport.quotas = creditQuota();
    if (phase === 'ready') await f.ready();
    else { await f.consent(); await f.request('login/start'); }
    f.transport.emit('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 100 }, spendControlReached: false, credits: { hasCredits: false, unlimited: false } } });
    f.transport.emit('account/rateLimits/updated', { rateLimits: { primary: null, credits: { hasCredits: true, unlimited: true } } });
    const snapshot = (await f.request('status')).snapshot;
    assert.equal(snapshot.state, 'error'); assert.equal(snapshot.catalog, null); assert.equal(snapshot.limits, null);
    assert.equal(snapshot.receipt.localAuthorityWithdrawn, true);
    assert.deepEqual(snapshot.receipt.denial, { source: 'limits_notice', method: 'account/rateLimits/updated', rpcCode: null, backendCode: null });
    assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
});

test('account switch cannot borrow an earlier product credit snapshot', async t => {
    const f = createProductFixture(t); f.transport.quotas = creditQuota(); await f.ready();
    f.transport.identity = 'different@example.invalid'; f.transport.emit('account/updated', { authMode: 'chatgpt', planType: 'plus' });
    f.transport.emit('account/rateLimits/updated', { rateLimits: { credits: { hasCredits: true, unlimited: true } } });
    const state = (await f.request('status')).snapshot;
    assert.equal(state.notice, 'revoked'); assert.equal(state.limits, null); assert.equal(state.catalog, null);
    assert.equal(f.transport.calls.filter(x => x.method === 'turn/start').length, 0);
});
