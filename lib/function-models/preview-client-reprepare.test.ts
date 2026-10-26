import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelPreviewClient } from './preview-client';
import { ORDINARY_FLOW_SCHEMA, type OrdinaryFunction } from '../chatgpt-product/ordinary-wire';

const functions = ['patient_insight', 'smart_import', 'document_synthesis'] as const;
async function until(check: () => boolean) {
    for (let index = 0; index < 100; index++) { if (check()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
    assert.ok(check(), 'expected bounded synthetic transition');
}
function harness(id: OrdinaryFunction) {
    const loginURL = new URL('http://localhost/device'); loginURL.protocol = 'https:'; loginURL.hostname = 'auth.openai.com';
    const calls: { operation: string; body: Record<string, unknown> | null }[] = [];
    let enabled = true, epoch = 0, phase = 'needs_consent', live = false, cleanup = true;
    let error: string | null = null, expires = 120_000;
    let deferStatus = false, statusRelease: (() => void) | undefined, deferGenerate = false, generateRelease: (() => void) | undefined;
    const settings = () => ({ schema: 'mediflow.chatgpt-ordinary-settings.v1', revision: `sha256_${String(epoch % 10).repeat(64)}`,
        enabled, retention: 'chatgpt_service_terms_apply',
        preferences: Object.fromEntries([...functions, 'treatment_reasoning'].map(key => [key, { use: 'local', model: null, effort: null }])),
        lanes: Object.fromEntries([...functions, 'treatment_reasoning'].map(key => [key, 'enabled'])) });
    const state = () => ({ schema: ORDINARY_FLOW_SCHEMA, attemptId: `attempt-${epoch}`, functionId: id, phase, expiresAt: Date.now() + expires });
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input), operation = path.includes('/ordinary/') ? path.split('/ordinary/')[1] : 'preview';
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
        calls.push({ operation, body });
        if (operation === 'settings') return Response.json(settings());
        if (operation === 'cancel') { live = false; return Response.json({ schema: ORDINARY_FLOW_SCHEMA, phase: 'closed', cleanupConfirmed: cleanup }); }
        if (operation === 'status') {
            if (deferStatus) await new Promise<void>(resolve => { statusRelease = resolve; });
            return Response.json({ schema: ORDINARY_FLOW_SCHEMA, phase: 'closed', attemptId: null, cleanupConfirmed: cleanup && !live });
        }
        if (operation === 'preview') {
            epoch++; live = true; phase = 'needs_consent';
            return Response.json({ ...state(), disclosure: { schema: 'mediflow.chatgpt-ordinary-disclosure.v1', revision: `disclosure-${epoch}`,
                operation: id, profileVersion: 'mediflow.ordinary-redacted-profile.v1', contextRevision: `context-${epoch}`,
                attemptRevision: `attempt-revision-${epoch}`, qualificationRevision: 'qualification', sourceSha256: `sha256_${'a'.repeat(64)}`,
                payloadSha256: 'b'.repeat(64), payloadBytes: 100, egress: ['auth.openai.com:443', 'chatgpt.com:443'], proposalOnly: true, clinicalWrites: 0 } }, { status: 202 });
        }
        assert.equal(body?.attemptId, `attempt-${epoch}`);
        if (operation === 'consent') { assert.equal(body?.expectedDisclosureRevision, `disclosure-${epoch}`); phase = 'consented'; }
        if (operation === 'login/start') { phase = 'awaiting_login'; return Response.json({ ...state(), challenge: { verificationUrl: loginURL.href, userCode: `SYNTHETIC-${epoch}` } }); }
        if (operation === 'login/complete') phase = 'connected';
        if (operation === 'models') { phase = 'ready'; return Response.json({ ...state(), catalog: { revision: `catalog-${epoch}`, choices: [{ optionId: `option-${epoch}`, model: 'synthetic', effort: 'medium' }] } }); }
        if (operation === 'generate') {
            if (deferGenerate) await new Promise<void>(resolve => { generateRelease = resolve; });
            if (error) return Response.json({ code: error }, { status: 409 });
            assert.equal(body?.modelOptionId, `option-${epoch}`); assert.equal(body?.expectedCatalogRevision, `catalog-${epoch}`);
            live = false; return Response.json({ syntheticResult: epoch });
        }
        return Response.json(state());
    }) as typeof fetch;
    const client = createModelPreviewClient(id, transport); client.reset(true);
    const start = async () => {
        const token = await client.begin();
        const final = client.fetch(`/api/ai/${id.replaceAll('_', '-')}/preview`, { method: 'POST', body: '{}' });
        void final.catch(() => {}); await until(() => client.remote.getSnapshot().state?.phase === 'needs_consent');
        return { token, final };
    };
    const ready = async () => { for (const action of ['consent', 'login/start', 'login/complete', 'models'] as const) await client.remote.action(action); client.remote.choose(`option-${epoch}`); };
    const complete = async () => { const run = await start(); await ready(); await client.remote.action('generate'); await (await run.final).json(); return run; };
    return { client, calls, start, ready, complete, epoch: () => epoch,
        select: async () => { client.chooseRemote(); await until(() => !client.remote.getSnapshot().loading); },
        setEnabled: (value: boolean) => { enabled = value; }, setCleanup: (value: boolean) => { cleanup = value; },
        fail: (value: string) => { error = value; }, expireAfter: (value: number) => { expires = value; },
        holdStatus: () => { deferStatus = true; }, statusHeld: () => !!statusRelease, releaseStatus: () => statusRelease?.(),
        holdGenerate: () => { deferGenerate = true; }, generateHeld: () => !!generateRelease, releaseGenerate: () => generateRelease?.(),
    };
}

for (const id of functions) test(`${id}: completed result needs an explicit fresh preparation, policy, consent, login and catalog`, async t => {
    const h = harness(id); t.after(() => h.client.reset(false)); await h.select(); const first = await h.complete();
    assert.equal(h.client.getSnapshot().consumed, true); assert.equal(h.client.remote.getSnapshot().completed, true);
    await assert.rejects(h.client.begin());
    const before = h.calls.length;
    await h.client.reprepareRemote();
    assert.equal(h.client.isCurrent(first.token), false);
    const view = h.client.getSnapshot(); const remote = h.client.remote.getSnapshot();
    assert.equal(view.preparationRevision, 1);
    assert.equal(view.consumed, false); assert.equal(view.blocked, false); assert.equal(view.choice, null);
    assert.equal(remote.completed, false); assert.equal(remote.state, null); assert.equal(remote.disclosure, null);
    assert.equal(remote.challenge, null); assert.equal(remote.catalog, null); assert.equal(remote.choice, '');
    assert.deepEqual(h.calls.slice(before).map(call => call.operation), ['status', 'settings']);
    const second = await h.start(); assert.notEqual(second.token, first.token);
    assert.equal(h.client.remote.getSnapshot().state?.attemptId, 'attempt-2');
    assert.equal(h.client.remote.getSnapshot().catalog, null); assert.equal(h.client.remote.getSnapshot().challenge, null);
    assert.equal(h.calls.filter(call => call.operation === 'generate').length, 1);
    await h.ready(); await h.client.remote.action('generate');
    assert.deepEqual(await (await second.final).json(), { syntheticResult: 2 });
    assert.deepEqual(h.calls.filter(call => call.operation === 'generate').map(call => call.body?.expectedCatalogRevision), ['catalog-1', 'catalog-2']);
    assert.equal(h.calls.filter(call => call.operation === 'consent').length, 2);
    assert.equal(h.calls.filter(call => call.operation === 'login/start').length, 2);
});

for (const reason of ['quota_exhausted', 'model_unavailable', 'catalog_stale', 'revoked']) test(`${reason}: explicit reprepare retires failed state without automatic generation`, async t => {
    const h = harness('patient_insight'); t.after(() => h.client.reset(false)); await h.select(); const run = await h.start();
    await h.ready(); h.fail(reason); await h.client.remote.action('generate'); await assert.rejects(run.final);
    assert.equal(h.client.getSnapshot().consumed, true);
    await h.client.reprepareRemote();
    assert.equal(h.client.getSnapshot().consumed, false); assert.equal(h.client.remote.getSnapshot().state, null);
    assert.equal(h.calls.filter(call => call.operation === 'generate').length, 1);
});

test('expiry retires the owned attempt; reprepare cannot reuse disclosure or catalog', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const h = harness('smart_import'); t.after(() => h.client.reset(false)); await h.select(); h.expireAfter(100); const run = await h.start();
    t.mock.timers.tick(101); await assert.rejects(run.final);
    await h.client.reprepareRemote();
    assert.equal(h.client.remote.getSnapshot().disclosure, null); assert.equal(h.client.getSnapshot().consumed, false);
    assert.equal(h.calls.filter(call => call.operation === 'preview').length, 1);
    assert.equal(h.calls.filter(call => call.operation === 'cancel').length, 1);
});

for (const active of [false, true]) test(`${active ? 'patient change' : 'lock'} during policy recovery retires its late response`, async t => {
    const h = harness('document_synthesis'); t.after(() => h.client.reset(false)); await h.select(); await h.complete();
    h.holdStatus(); const recovery = h.client.reprepareRemote(); await until(h.statusHeld);
    h.client.reset(active); h.releaseStatus(); await recovery;
    assert.equal(h.client.getSnapshot().remote, undefined); assert.equal(h.client.getSnapshot().dto, null);
    assert.equal(h.calls.filter(call => call.operation === 'preview').length, 1);
});

test('new policy denial and unconfirmed cleanup stay blocked without preparing or logging in', async t => {
    for (const reason of ['policy', 'cleanup']) {
        const h = harness('patient_insight'); t.after(() => h.client.reset(false)); await h.select(); await h.complete();
        if (reason === 'policy') h.setEnabled(false); else h.setCleanup(false);
        await h.client.reprepareRemote(); await assert.rejects(h.client.begin());
        assert.equal(h.calls.filter(call => call.operation === 'preview').length, 1);
        assert.equal(h.calls.filter(call => call.operation === 'login/start').length, 1);
        if (reason === 'cleanup') assert.equal(h.client.getSnapshot().blocked, true);
    }
});

test('cancelled generation that ignores abort cannot publish into the fresh preparation', async t => {
    const h = harness('document_synthesis'); t.after(() => h.client.reset(false)); await h.select(); const first = await h.start(); await h.ready();
    h.holdGenerate(); const generating = h.client.remote.action('generate'); await until(h.generateHeld);
    h.client.cancel(); await assert.rejects(first.final); await h.client.reprepareRemote();
    h.releaseGenerate(); await generating;
    assert.equal(h.client.remote.getSnapshot().completed, false); assert.equal(h.client.getSnapshot().consumed, false);
    assert.equal(h.client.remote.getSnapshot().state, null);
});

test('the new recovery cannot activate Treatment Reasoning remote or an inactive client', async t => {
    const h = harness('treatment_reasoning'); t.after(() => h.client.reset(false)); await h.select(); await h.complete();
    const before = h.calls.length; await h.client.reprepareRemote(); assert.equal(h.calls.length, before);
    h.client.reset(false); await h.client.reprepareRemote(); assert.equal(h.calls.length, before);
});
