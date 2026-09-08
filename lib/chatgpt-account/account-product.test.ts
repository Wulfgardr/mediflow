/* @Codex: invented account metadata, presentation lifetime and picker separation. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { AccountStatus } from './account-contract';

const dataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(dataDir && isAbsolute(dataDir), 'An absolute synthetic MEDIFLOW_DATA_DIR is required');
mkdirSync(dataDir, { recursive: true });
const { createAccountBrowser, ACCOUNT_DETAILS_MAX_AGE_MS } = await import('./account-browser.ts');
const { presentAccount } = await import('./account-presentation.ts');
const { parsePreferences } = await import('../function-models/browser.ts');
const connected: AccountStatus = { state: 'connected', plan: 'pro', notice: null, loginExpiresAt: null,
    actions: ['logout', 'read_models', 'read_rate_limits', 'refresh_account'], inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
const catalog = [{ id: 'synthetic-account-model', model: 'synthetic-account-model', isDefault: true }];
const limits = { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null }, secondary: null };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function setup() {
    let clock = 2_000_000_000_000;
    let status = connected;
    const calls: string[] = [];
    const browser = createAccountBrowser(async (url, init) => {
        const operation = String(url).replace('/api/settings/ai/chatgpt/', ''); calls.push(operation);
        assert.equal(init?.method, operation === 'status' ? 'GET' : 'POST');
        assert.equal(init?.body, operation === 'status' ? undefined : '{}');
        return Response.json(operation === 'models' ? { status, models: catalog }
            : operation === 'rate-limits' ? { status, ...limits } : status);
    }, () => clock);
    browser.setActive(true);
    return { browser, calls, setStatus: (next: AccountStatus) => { status = next; }, advance: (ms: number) => { clock += ms; } };
}

test('account metadata never changes the suspended function label or makes a preference', async t => {
    const f = setup(); t.after(() => f.browser.dispose());
    await f.browser.run('models'); await f.browser.run('rate-limits');
    const view = f.browser.snapshot(); const presentation = presentAccount(view, true);
    assert.equal(presentation.accountLabel, 'Account collegato'); assert.equal(presentation.planLabel, 'Pro');
    assert.equal(presentation.executionLabel, 'Uso nelle funzioni sospeso');
    assert.equal(view.status?.inferenceEnabled, false); assert.equal(view.status?.executionBlock, 'data_boundary_unqualified');
    assert.deepEqual(f.calls, ['models', 'rate-limits']);
    assert.throws(() => parsePreferences({ status: connected, models: catalog }));
});

test('a successful explicit account reread retires catalog and limits, even with the same plan', async t => {
    const f = setup(); t.after(() => f.browser.dispose());
    await f.browser.run('models'); await f.browser.run('rate-limits');
    const observedAt = f.browser.snapshot().modelsObservedAt;
    await f.browser.run('read');
    assert.equal(f.browser.snapshot().models, null); assert.equal(f.browser.snapshot().limits, null);
    assert.equal(f.browser.snapshot().modelsObservedAt, observedAt);
    await f.browser.run('status');
    assert.equal(f.browser.snapshot().models, null, 'Local GET cannot resurrect catalog');
    assert.deepEqual(f.calls, ['models', 'rate-limits', 'read', 'status']);
});

test('a changed plan in the local status invalidates both observations', async t => {
    const f = setup(); t.after(() => f.browser.dispose());
    await f.browser.run('models'); await f.browser.run('rate-limits');
    f.setStatus({ ...connected, plan: 'plus' }); await f.browser.run('status');
    assert.equal(f.browser.snapshot().models, null); assert.equal(f.browser.snapshot().limits, null);
    assert.equal(presentAccount(f.browser.snapshot(), true).planLabel, 'Plus');
});

test('catalog and limits expire independently with no provider requests and no sliding status refresh', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = setup(); t.after(() => f.browser.dispose());
    await f.browser.run('models'); const observedAt = f.browser.snapshot().modelsObservedAt;
    f.advance(30_000); t.mock.timers.tick(30_000); await f.browser.run('rate-limits');
    f.advance(29_999); t.mock.timers.tick(29_999); await f.browser.run('status');
    assert.deepEqual(f.browser.snapshot().models, catalog);
    f.advance(1); t.mock.timers.tick(1);
    assert.equal(f.browser.snapshot().models, null); assert.equal(f.browser.snapshot().modelsObservedAt, observedAt);
    assert.deepEqual(f.browser.snapshot().limits, limits);
    f.advance(30_000); t.mock.timers.tick(30_000);
    assert.equal(f.browser.snapshot().limits, null);
    assert.deepEqual(f.calls, ['models', 'rate-limits', 'status']);
    await f.browser.run('models'); assert.deepEqual(f.browser.snapshot().models, catalog);
    assert.notEqual(f.browser.snapshot().modelsObservedAt, observedAt);
});

test('a local status response arriving after expiry does not republish its old details', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = 2_000_000_000_000; const late = deferred<Response>();
    const browser = createAccountBrowser(async url => String(url).endsWith('/models') ? Response.json({ status: connected, models: catalog }) : late.promise, () => clock);
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('models');
    clock += 55_000; t.mock.timers.tick(55_000); const pending = browser.run('status');
    clock += 5000; t.mock.timers.tick(5000); late.resolve(Response.json(connected)); await pending;
    assert.equal(browser.snapshot().models, null); assert.ok(browser.snapshot().modelsObservedAt);
});

test('an explicit catalog refresh hides the old values before the new response', async t => {
    const late = deferred<Response>(); let count = 0;
    const browser = createAccountBrowser(async () => ++count === 1 ? Response.json({ status: connected, models: catalog }) : late.promise);
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('models');
    const pending = browser.run('models');
    assert.equal(browser.snapshot().models, null); assert.equal(browser.snapshot().busy, 'models');
    late.resolve(Response.json({ status: connected, models: [] })); await pending;
    assert.deepEqual(browser.snapshot().models, [], 'Empty is a successful observation, not unread or stale');
});

for (const statusCode of [409, 503]) test(`HTTP ${statusCode} erases values and stops presentation polling until explicit recovery`, async t => {
    let fail = false;
    const browser = createAccountBrowser(async () => fail ? new Response(null, { status: statusCode }) : Response.json({ status: connected, models: catalog }));
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('models'); fail = true;
    await browser.run('models'); assert.equal(browser.snapshot().models, null);
    assert.equal(presentAccount(browser.snapshot(), true).accountLabel, 'Stato da rileggere');
    assert.equal(presentAccount(browser.snapshot(), true).pollDelay, null);
    fail = false; await browser.run('status');
    assert.equal(presentAccount(browser.snapshot(), true).pollDelay, 10_000);
    assert.equal(browser.snapshot().models, null);
});

test('null quota windows are unavailable observations, not zero or permission to execute', async t => {
    const browser = createAccountBrowser(async () => Response.json({ status: connected, primary: null, secondary: null }));
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('rate-limits');
    assert.deepEqual(browser.snapshot().limits, { primary: null, secondary: null });
    assert.ok(browser.snapshot().limitsObservedAt);
    assert.equal(presentAccount(browser.snapshot(), true).executionLabel, 'Uso nelle funzioni sospeso');
});

test('lock erases observation times and late response bodies, then unlock only rereads local status', async t => {
    const body = deferred<unknown>(); let count = 0;
    const browser = createAccountBrowser(async () => {
        if (++count === 1) return Response.json({ status: connected, models: catalog });
        if (count === 3) return Response.json({ ...connected, state: 'disconnected', plan: null, actions: ['connect'] });
        const response = Response.json({}); response.json = () => body.promise; return response;
    });
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('models');
    const pending = browser.run('rate-limits'); await tick(); browser.setActive(false);
    body.resolve({ status: connected, ...limits }); await pending;
    assert.equal(browser.snapshot().modelsObservedAt, null); assert.equal(browser.snapshot().limitsObservedAt, null);
    assert.equal(presentAccount(browser.snapshot(), true).accountLabel, 'Sessione bloccata');
    browser.setActive(true); await browser.run('status');
    assert.equal(browser.snapshot().models, null); assert.equal(browser.snapshot().status?.state, 'disconnected');
});

test('logout clears observations immediately even if upstream logout is unconfirmed', async t => {
    const late = deferred<Response>(); let count = 0;
    const browser = createAccountBrowser(async () => ++count === 1 ? Response.json({ status: connected, models: catalog }) : late.promise);
    t.after(() => browser.dispose()); browser.setActive(true); await browser.run('models');
    const logout = browser.run('logout');
    assert.equal(browser.snapshot().models, null); assert.equal(browser.snapshot().modelsObservedAt, null);
    late.resolve(Response.json({ ...connected, state: 'disconnected', plan: null, notice: 'logout_unconfirmed', actions: ['connect'] }));
    await logout; assert.equal(browser.snapshot().status?.notice, 'logout_unconfirmed');
    assert.equal(presentAccount(browser.snapshot(), true).showDetails, false);
});

test('only configured local options remain acceptable to the unmodified preference parser', () => {
    const optionId = 'model_option_' + 'a'.repeat(32);
    const dto = { schemaVersion: 'mediflow.function-preferences.v1', revision: 'sha256_' + 'b'.repeat(64), catalogRevision: 'sha256_' + 'c'.repeat(64),
        check: 'configuration_only', apply: 'denied', presets: ['host_defaults', 'all_off'],
        functions: ['patient_insight', 'smart_import', 'document_synthesis', 'treatment_reasoning'].map(id => ({
            id, enabled: false, defaultModelOptionId: optionId, defaultSource: 'host_configuration', bindingState: 'current',
            options: [{ modelOptionId: optionId, label: 'Synthetic local model', provider: 'ollama', state: 'available_unqualified' }],
        })) };
    assert.equal(parsePreferences(dto).functions.length, 4);
    const notLocal = structuredClone(dto); notLocal.functions[0].options[0].provider = 'openai';
    assert.throws(() => parsePreferences(notLocal));
});

test('all account lifecycle states retain suspended function use; only waiting states poll', () => {
    const f = setup(); f.browser.dispose();
    for (const state of ['unavailable', 'disconnected', 'starting', 'awaiting_login', 'verifying', 'connected', 'error'] as const) {
        const view = { ...f.browser.snapshot(), kind: 'ready' as const, status: { ...connected, state } };
        const presentation = presentAccount(view, true);
        assert.equal(presentation.executionLabel, 'Uso nelle funzioni sospeso');
        assert.equal(presentation.pollDelay, state === 'connected' ? 10_000 : ['starting', 'awaiting_login', 'verifying'].includes(state) ? 2000 : null);
        assert.equal(presentAccount(view, false).showDetails, false);
    }
    assert.equal(ACCOUNT_DETAILS_MAX_AGE_MS, 60_000, 'Presentation policy is explicit, not server freshness');
});
