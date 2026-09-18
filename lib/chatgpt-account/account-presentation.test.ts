/* @Codex WUL-684: synthetic presenter/controller tests; no provider or browser UI. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presentAccount, accountNotices } from './account-presentation.ts';
import { createAccountBrowser, parseAccountBrowserStatus, type AccountBrowserView } from './account-browser.ts';
import type { AccountState, AccountStatus, AccountOperation } from './account-contract.ts';

function status(state: AccountState = 'connected', plan: string | null = 'pro'): AccountStatus {
    return { state, plan, notice: null, loginExpiresAt: null,
        actions: state === 'connected' ? ['read_models', 'read_rate_limits', 'refresh_account', 'logout'] : ['connect'],
        inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
}
function view(patch: Partial<AccountBrowserView> = {}): AccountBrowserView {
    return { kind: 'ready', status: status(), busy: null, authUrl: null, models: null, limits: null,
        error: null, modelsObservedAt: null, limitsObservedAt: null, ...patch };
}
const states: AccountState[] = ['unavailable', 'disconnected', 'starting', 'awaiting_login', 'verifying', 'connected', 'error'];
for (const state of states) {
    test(`account ${state}: the informational boundary never becomes execution readiness`, () => {
        const candidate = view({ status: status(state) });
        const before = structuredClone(candidate);
        const result = presentAccount(candidate, true);
        assert.match(result.executionLabel, /account|informativ/i);
        assert.match(result.executionLabel, /non abilita/i);
        assert.doesNotMatch(result.executionLabel, /sospes|pront|autorizzat/i);
        assert.equal(result.showDetails, state === 'connected');
        assert.equal(result.planLabel, state === 'connected' ? 'Pro' : null);
        assert.equal(result.pollDelay, state === 'connected' ? 10_000 : ['starting', 'awaiting_login', 'verifying'].includes(state) ? 2000 : null);
        assert.deepEqual(candidate, before, 'presentation must not mutate the controller snapshot');
    });
}

test('plan/catalog/quota data do not change the account boundary or confer admission', () => {
    const label = presentAccount(view(), true).executionLabel;
    for (const plan of ['free', 'pro', 'enterprise', 'unknown', 'future_plan', null]) {
        for (const usedPercent of [0, 75, 125]) {
            const result = presentAccount(view({ status: status('connected', plan),
                models: [{ id: 'synthetic-model', model: 'synthetic-model', isDefault: true }],
                limits: { primary: { usedPercent, windowDurationMins: 60, resetsAt: null }, secondary: null },
                modelsObservedAt: 1, limitsObservedAt: 1 }), true);
            assert.equal(result.executionLabel, label);
            assert.equal(result.pollDelay, 10_000);
        }
    }
    assert.equal(presentAccount(view({ status: status('connected', 'future_plan') }), true).planLabel, 'Non disponibile');
});

test('locking suppresses plan/details/polling even with a retained connected observation', () => {
    for (const patch of [{ active: false, kind: 'ready' as const }, { active: true, kind: 'locked' as const }]) {
        const result = presentAccount(view({ kind: patch.kind }), patch.active);
        assert.equal(result.locked, true); assert.equal(result.showDetails, false);
        assert.equal(result.planLabel, null); assert.equal(result.pollDelay, null);
        assert.match(result.accountLabel, /bloccata/i);
    }
});

test('pending operations and read failures retain their polling stop rules', () => {
    const operations: Array<AccountOperation | 'status'> = ['status', 'login/start', 'login/cancel', 'login/complete', 'logout', 'models', 'rate-limits', 'read'];
    for (const busy of operations) {
        const result = presentAccount(view({ busy }), true);
        assert.equal(result.pollDelay, null);
        assert.equal(result.operation !== null, ['login/start', 'login/cancel', 'login/complete', 'logout'].includes(busy));
    }
    const failed = presentAccount(view({ error: 'Lettura sintetica non riuscita' }), true);
    assert.equal(failed.pollDelay, null); assert.equal(failed.planLabel, null);
    assert.match(failed.accountLabel, /rileggere/i);
});

test('initial and unavailable reads never display a connected account', () => {
    const initial = presentAccount(view({ kind: 'loading', status: null }), true);
    const failed = presentAccount(view({ kind: 'error', status: null }), true);
    assert.match(initial.accountLabel, /lettura/i); assert.match(failed.accountLabel, /non disponibile/i);
    assert.equal(initial.pollDelay, null); assert.equal(failed.showDetails, false);
    assert.equal(initial.executionLabel, failed.executionLabel);
});

test('all account notices remain explained; an unconfirmed remote logout stays unconfirmed', () => {
    assert.equal(Object.keys(accountNotices).length, 11);
    for (const value of Object.values(accountNotices)) assert.ok(value.trim().length > 15);
    assert.match(accountNotices.logout_unconfirmed, /non ha confermato/i);
    assert.match(accountNotices.session_expired, /sblocca/i);
});

test('unchanged browser parser rejects an account payload that attempts to grant inference', () => {
    assert.throws(() => parseAccountBrowserStatus({ ...status(), inferenceEnabled: true }));
    assert.throws(() => parseAccountBrowserStatus({ ...status(), executionBlock: null }));
    assert.equal(parseAccountBrowserStatus(status()).inferenceEnabled, false);
});

test('real account browser: explicit reads only, local status does not refresh quota/catalog, lock erases details', async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const fetcher: typeof fetch = async (input, init) => {
        const url = String(input); requests.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
        if (url.endsWith('/models')) return Response.json({ status: status(), models: [{ id: 'synthetic', model: 'synthetic', isDefault: true }] });
        if (url.endsWith('/rate-limits')) return Response.json({ status: status(), primary: null, secondary: null });
        return Response.json(status());
    };
    const browser = createAccountBrowser(fetcher, () => 1000);
    try {
        browser.setActive(true); assert.equal(requests.length, 0);
        await browser.run('status');
        assert.equal(presentAccount(browser.snapshot(), true).showDetails, true);
        assert.equal(browser.snapshot().models, null);
        await browser.run('models'); await browser.run('rate-limits');
        const catalog = browser.snapshot().models;
        await browser.run('status');
        assert.equal(browser.snapshot().models, catalog);
        assert.deepEqual(requests.map(row => row.url.split('/').at(-1)), ['status', 'models', 'rate-limits', 'status']);
        assert.deepEqual(requests.map(row => row.method), ['GET', 'POST', 'POST', 'GET']);
        assert.equal(requests[1].body, '{}');
        assert.ok(requests.every(row => row.url.startsWith('/api/settings/ai/chatgpt/')));
        assert.match(presentAccount(browser.snapshot(), true).executionLabel, /non abilita/i);
        browser.setActive(false); assert.equal(browser.snapshot().models, null); assert.equal(browser.snapshot().limits, null);
        await browser.run('models'); assert.equal(requests.length, 4);
    } finally { browser.dispose(); }
});

test('real account browser keeps failures explicit and requires a deliberate reread', async () => {
    let fail = false;
    const browser = createAccountBrowser(async () => fail ? new Response('{}', { status: 503 }) : Response.json(status()));
    try {
        browser.setActive(true); await browser.run('status'); fail = true; await browser.run('models');
        assert.ok(browser.snapshot().error); assert.equal(browser.snapshot().models, null);
        assert.equal(presentAccount(browser.snapshot(), true).pollDelay, null);
        fail = false; await browser.run('status'); assert.equal(browser.snapshot().error, null);
    } finally { browser.dispose(); }
});
