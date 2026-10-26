import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutionQuotaMonitor, readExecutionQuota } from './execution-quota';

const bucket = (extra = {}) => ({ limitId: 'codex', primary: { usedPercent: 100 }, secondary: null,
    credits: { hasCredits: true, unlimited: false, balance: '12345.6789' }, spendControlReached: false, rateLimitReachedType: 'rate_limit_reached', ...extra });
const full = (extra = {}) => ({ accountId: 'synthetic-account', rateLimitsByLimitId: { codex: bucket(extra) } });
const notice = (patch: unknown) => ({ rateLimits: patch });
const code = (name: string) => (error: unknown) => (error as { code?: string })?.code === name;
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('full snapshots distinguish included quota from finite and unlimited credits without exposing a balance', () => {
    for (const credits of [{ hasCredits: true, unlimited: false, balance: '12345.6789' }, { hasCredits: false, unlimited: true, balance: null }]) {
        const view = readExecutionQuota(full({ credits }));
        assert.deepEqual(view, { primaryUsedPercent: 100, secondaryUsedPercent: null, includedUsage: 'exhausted', creditAvailability: 'available' });
        assert.doesNotMatch(JSON.stringify(view), /12345|balance|account/);
    }
    assert.equal(readExecutionQuota(full({ primary: { usedPercent: 2 }, rateLimitReachedType: null, credits: null })).includedUsage, 'available');
});

test('every hard limit, depletion, unknown state and malformed value stays denied despite credits', () => {
    for (const type of ['workspace_owner_credits_depleted', 'workspace_member_credits_depleted', 'workspace_owner_usage_limit_reached', 'workspace_member_usage_limit_reached']) assert.throws(() => readExecutionQuota(full({ rateLimitReachedType: type })), code('quota_exhausted'));
    assert.throws(() => readExecutionQuota(full({ spendControlReached: true })), code('quota_exhausted'));
    assert.throws(() => readExecutionQuota(full({ credits: { hasCredits: false, unlimited: false, balance: '-1' } })), code('quota_exhausted'));
    for (const patch of [ { rateLimitReachedType: 'unknown' }, { primary: null }, { primary: { usedPercent: Infinity } }, { primary: { usedPercent: -1 } },
        { credits: { hasCredits: 'true', unlimited: false } }, { credits: { hasCredits: true } }, { credits: { hasCredits: true, unlimited: false, balance: 10 } },
        { spendControlReached: 'false' }, { spendControlReached: null } ]) assert.throws(() => readExecutionQuota(full(patch)), code('limits_unavailable'));
    assert.throws(() => readExecutionQuota({ rateLimitsByLimitId: {}, rateLimits: bucket() }), code('limits_unavailable'));
});

test('sparse null metadata preserves verified credits, window and generic reached state; another bucket has no effect', async () => {
    const monitor = createExecutionQuotaMonitor(); await monitor.read(async () => full()); const before = monitor.snapshot();
    monitor.notice(notice({ primary: null, secondary: null, credits: null, spendControlReached: null, rateLimitReachedType: null }));
    monitor.notice(notice({ limitId: 'another', primary: { usedPercent: 'invalid' } }));
    assert.deepEqual(monitor.snapshot(), before);
    monitor.notice(notice({ primary: { usedPercent: 101 } })); assert.equal(monitor.snapshot()?.includedUsage, 'exhausted');
});

test('credit depletion and hard notices latch terminal denial and late snapshots cannot restore authority', async () => {
    for (const patch of [{ credits: { hasCredits: false, unlimited: false } }, { spendControlReached: true }, { rateLimitReachedType: 'workspace_member_usage_limit_reached' }]) {
        const monitor = createExecutionQuotaMonitor(); await monitor.read(async () => full());
        const pending = deferred(); const reading = monitor.read(() => pending.promise); const rejected = assert.rejects(reading, code('quota_exhausted'));
        assert.throws(() => monitor.notice(notice(patch)), code('quota_exhausted')); pending.resolve(full()); await rejected;
        assert.equal(monitor.snapshot(), null); assert.throws(() => monitor.notice(notice({ credits: { hasCredits: true, unlimited: true } })), code('quota_exhausted'));
        await assert.rejects(monitor.read(async () => full()), code('quota_exhausted'));
    }
});

test('startup notices wait for the first known window and preserve newer metadata racing the full response', async () => {
    const monitor = createExecutionQuotaMonitor(); monitor.notice(notice({ primary: { usedPercent: 100 }, rateLimitReachedType: 'rate_limit_reached' }));
    assert.equal(monitor.snapshot(), null);
    const pending = deferred(); const reading = monitor.read(() => pending.promise);
    monitor.notice(notice({ credits: { hasCredits: true, unlimited: false }, spendControlReached: false }));
    pending.resolve(full());
    assert.equal((await reading).creditAvailability, 'available');
});

test('startup hard denial and account reset cannot be overwritten by a late full read', async () => {
    const monitor = createExecutionQuotaMonitor(); const pending = deferred(); const reading = monitor.read(() => pending.promise);
    const rejected = assert.rejects(reading, code('quota_exhausted'));
    assert.throws(() => monitor.notice(notice({ spendControlReached: true })), code('quota_exhausted'));
    pending.resolve(full()); await rejected;
    const changed = createExecutionQuotaMonitor(); const late = deferred(); const old = changed.read(() => late.promise); const stale = assert.rejects(old, code('revoked'));
    changed.discardAccountSnapshot(); late.resolve(full()); await stale;
    await assert.rejects(changed.read(async () => full()), code('revoked'));
});

test('an account identifier change and malformed notice retire rather than borrow previous credit metadata', async () => {
    const monitor = createExecutionQuotaMonitor(); await monitor.read(async () => full());
    await assert.rejects(monitor.read(async () => ({ ...full(), accountId: 'different-account' })), code('revoked'));
    const malformed = createExecutionQuotaMonitor(); await malformed.read(async () => full());
    assert.throws(() => malformed.notice(notice({ credits: { hasCredits: true, unlimited: 'yes' } })), code('limits_unavailable'));
    await assert.rejects(malformed.read(async () => full()), code('limits_unavailable'));
});

test('positive startup notices cannot override a negative full snapshot or fill an absent full window', async () => {
    for (const input of [full({ credits: { hasCredits: false, unlimited: false } }), full({ spendControlReached: true }), full({ primary: null })]) {
        const monitor = createExecutionQuotaMonitor(); const pending = deferred(); const reading = monitor.read(() => pending.promise);
        const rejected = assert.rejects(reading);
        monitor.notice(notice({ primary: { usedPercent: 100 }, credits: { hasCredits: true, unlimited: false }, spendControlReached: false }));
        pending.resolve(input); await rejected;
        assert.equal(monitor.snapshot(), null);
    }
});

test('a full read denial is recorded as local preflight, never as a backend RPC error', async () => {
    const monitor = createExecutionQuotaMonitor();
    await assert.rejects(monitor.read(async () => full({ credits: { hasCredits: false, unlimited: false } })), (error: unknown) => {
        assert.deepEqual((error as { denial: unknown }).denial, { source: 'limits_snapshot', method: 'account/rateLimits/read', rpcCode: null, backendCode: null }); return true;
    });
});
