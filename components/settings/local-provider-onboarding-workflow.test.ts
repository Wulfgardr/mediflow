/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { buildFunctionStatus } from '../../lib/function-status';
import type { LocalProviderOnboardingStatus } from '../../lib/ai-providers/fabric/local-provider-onboarding-service';
import { createLocalProviderOnboardingWorkflow, type LocalOnboardingView } from './local-provider-onboarding-workflow';

// Presentation tests only: synthetic HTTP, no server, DB, owner or Ollama substitute.
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function deferred<T>() {
    let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function until(condition: () => boolean) {
    for (let turn = 0; turn < 100; turn++) { if (condition()) return; await nextTurn(); }
    throw new Error('Synthetic operation did not reach the expected phase');
}
function functionSnapshot() {
    return buildFunctionStatus({ platform: 'synthetic', enabled: { patient_insight: true, smart_import: false,
        document_synthesis: false, treatment_reasoning: false }, ollamaLifecycle: 'available_unqualified',
    athenaLifecycle: 'missing', clinicalBinding: { state: 'configured', model: 'synthetic-local' },
    athenaArtifact: false, who: 'disabled' }, '2026-09-08T00:00:00.000Z');
}
type Call = { url: string; init: RequestInit; body: unknown };
function fixture() {
    let status: LocalProviderOnboardingStatus = { provider: 'ollama', credentialClass: 'local_model', model: 'synthetic-local',
        state: 'missing', revision: 'a'.repeat(64), version: 0, receipt: null, canActivate: true,
        inference: 'not_run', qualification: 'not_assessed' };
    const calls: Call[] = []; const views: LocalOnboardingView[] = [];
    let handler: ((call: Call) => Response | Promise<Response> | undefined) | undefined;
    const controller = createLocalProviderOnboardingWorkflow(view => views.push(view), async (url, init = {}) => {
        const call = { url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : null };
        calls.push(call);
        const result = handler?.(call);
        if (result) return result;
        if (call.url === '/api/system/function-status') return Response.json(functionSnapshot());
        assert.equal(call.url, '/api/ai/local-provider/onboarding');
        if (init.method === 'POST') status = { ...status, state: 'available_unqualified', version: status.version + 1,
            revision: 'b'.repeat(64), receipt: 'receipt_' + 'b'.repeat(32) };
        return Response.json(status);
    });
    cleanups.push(controller.dispose);
    return { controller, calls, views, get status() { return status; }, set status(value: LocalProviderOnboardingStatus) { status = value; },
        handle(value: typeof handler) { handler = value; },
        posts: () => calls.filter(call => call.init.method === 'POST'),
        view: () => controller.getView() };
}

test('construction is inert; refresh only reads and never activates', async () => {
    const f = fixture(); assert.equal(f.calls.length, 0);
    await f.controller.activate(); assert.equal(f.calls.length, 0);
    await f.controller.refresh();
    assert.equal(f.calls.length, 1); assert.equal(f.posts().length, 0);
    assert.equal(f.view().phase, 'ready'); assert.equal(f.view().status?.state, 'missing');
    assert.equal(f.view().functions, null);
});

test('explicit verification uses only saved revision; observable phases and final recheck are ordered', async () => {
    const f = fixture(); await f.controller.refresh(); await f.controller.activate();
    assert.deepEqual(f.posts()[0].body, { intent: 'verify_and_activate', expectedRevision: 'a'.repeat(64) });
    assert.deepEqual(f.views.map(view => view.phase), ['reading_configuration', 'ready', 'verifying', 'reading_result',
        'reading_functions', 'reading_result', 'completed']);
    assert.deepEqual(f.calls.map(call => [call.init.method ?? 'GET', call.url]), [
        ['GET', '/api/ai/local-provider/onboarding'], ['POST', '/api/ai/local-provider/onboarding'],
        ['GET', '/api/ai/local-provider/onboarding'], ['GET', '/api/system/function-status'], ['GET', '/api/ai/local-provider/onboarding'],
    ]);
    for (const call of f.calls) { assert.equal(call.init.cache, 'no-store'); assert.ok(call.init.signal instanceof AbortSignal); }
    assert.equal(f.view().status?.inference, 'not_run'); assert.equal(f.view().status?.qualification, 'not_assessed');
    assert.equal(f.view().functions?.check, 'configuration_only');
    assert.equal(f.view().functions?.functions.find(row => row.id === 'patient_insight')?.state, 'unverified');
    assert.ok(Object.isFrozen(f.view()));
});

test('single flight prevents double click and concurrent refresh while POST is unresolved', async () => {
    const f = fixture(); const response = deferred<Response>();
    await f.controller.refresh(); f.handle(call => call.init.method === 'POST' ? response.promise : undefined);
    const pending = f.controller.activate(); await until(() => f.posts().length === 1);
    await f.controller.activate(); await f.controller.refresh();
    assert.equal(f.calls.length, 2); assert.equal(f.view().busy, true);
    f.controller.cancel(); await pending;
    response.resolve(Response.json(f.status));
});

for (const late of ['success', 'failure'] as const) {
    test(`cancel detaches pending POST; late ${late} cannot overwrite explicit resumed read`, async () => {
        const f = fixture(); const response = deferred<Response>();
        await f.controller.refresh(); f.handle(call => call.init.method === 'POST' ? response.promise : undefined);
        const pending = f.controller.activate(); await until(() => f.posts().length === 1);
        const signal = f.posts()[0].init.signal!;
        f.controller.cancel(); await pending;
        assert.equal(signal.aborted, true); assert.equal(f.view().phase, 'interrupted');
        assert.equal(f.view().status, null); assert.equal(f.view().functions, null);
        await f.controller.activate(); assert.equal(f.posts().length, 1);
        f.status = { ...f.status, model: 'synthetic-replacement', revision: 'c'.repeat(64) };
        await f.controller.refresh(); const resumed = f.view();
        assert.equal(resumed.status?.model, 'synthetic-replacement'); assert.equal(f.posts().length, 1);
        if (late === 'success') response.resolve(Response.json({ ...f.status, state: 'available_unqualified' }));
        else response.reject(new Error('late synthetic transport failure'));
        await nextTurn(); assert.equal(f.view(), resumed);
        f.handle(undefined); await f.controller.activate();
        assert.deepEqual(f.posts()[1].body, { intent: 'verify_and_activate', expectedRevision: 'c'.repeat(64) });
    });
}

test('cancel during initial read blocks stale response, and new refresh still only reads', async () => {
    const f = fixture(); const response = deferred<Response>(); f.handle(() => response.promise);
    const pending = f.controller.refresh(); await until(() => f.calls.length === 1);
    f.controller.cancel(); await pending;
    assert.equal(f.view().phase, 'interrupted'); assert.equal(f.view().status, null);
    f.handle(undefined); await f.controller.refresh(); const latest = f.view();
    response.resolve(Response.json({ ...f.status, state: 'revoked' })); await nextTurn();
    assert.equal(f.view(), latest); assert.equal(f.posts().length, 0);
});

test('cancellation also interrupts a stalled response body, not just fetch', async () => {
    const f = fixture(); const body = deferred<unknown>();
    const response = Response.json({}); response.json = () => body.promise;
    f.handle(() => response);
    const pending = f.controller.refresh(); await until(() => f.calls.length === 1); await nextTurn();
    f.controller.cancel(); await pending;
    assert.equal(f.view().phase, 'interrupted');
    body.resolve(f.status); await nextTurn(); assert.equal(f.view().status, null);
});

for (const phase of ['reading_result', 'reading_functions'] as const) {
    test(`cancel during ${phase} removes provisional status and requires explicit reconciliation`, async () => {
        const f = fixture(); await f.controller.refresh(); const response = deferred<Response>();
        f.handle(call => call.init.method !== 'POST' && (phase === 'reading_result'
            ? call.url === '/api/ai/local-provider/onboarding' : call.url === '/api/system/function-status') ? response.promise : undefined);
        const pending = f.controller.activate(); await until(() => f.view().phase === phase);
        f.controller.cancel(); await pending;
        assert.equal(f.view().status, null); assert.equal(f.view().functions, null); assert.equal(f.posts().length, 1);
        f.handle(undefined); await f.controller.refresh();
        assert.equal(f.view().status?.state, 'available_unqualified'); assert.equal(f.posts().length, 1);
        response.resolve(Response.json(phase === 'reading_functions' ? functionSnapshot() : f.status));
    });
}

test('cancel is not rollback: refresh can discover an already committed activation without a second POST', async () => {
    const f = fixture(); await f.controller.refresh(); const response = deferred<Response>();
    f.handle(call => {
        if (call.init.method !== 'POST') return undefined;
        f.status = { ...f.status, state: 'available_unqualified', revision: 'b'.repeat(64), version: 1, receipt: 'receipt_' + 'b'.repeat(32) };
        return response.promise;
    });
    const pending = f.controller.activate(); await until(() => f.posts().length === 1);
    f.controller.cancel(); await pending;
    assert.equal(f.view().messageCode, 'request_cancelled');
    f.handle(undefined); await f.controller.refresh();
    assert.equal(f.view().status?.version, 1); assert.equal(f.posts().length, 1);
    response.resolve(Response.json(f.status));
});

for (const code of ['configuration_changed', 'provider_busy', 'provider_unreachable', 'model_absent_or_not_local', 'verification_interrupted']) {
    test(`${code} invalidates the old revision and never retries automatically`, async () => {
        const f = fixture(); await f.controller.refresh();
        f.handle(call => call.init.method === 'POST' ? Response.json({ error: code }, { status: code === 'provider_unreachable' ? 503 : 409 }) : undefined);
        await f.controller.activate();
        assert.equal(f.view().messageCode, code); assert.equal(f.view().status, null); assert.equal(f.view().busy, false);
        await f.controller.activate(); assert.equal(f.posts().length, 1);
        f.handle(undefined); await f.controller.refresh(); assert.equal(f.posts().length, 1);
    });
}

for (const at of ['initial', 'post', 'functions', 'final'] as const) {
    test(`owner denial at ${at} clears receipt/functions and cannot be retried without reauthentication`, async () => {
        const f = fixture(); if (at !== 'initial') await f.controller.refresh();
        let statusReads = 0;
        f.handle(call => {
            if (call.url === '/api/ai/local-provider/onboarding' && call.init.method !== 'POST') statusReads++;
            const selected = at === 'initial' || at === 'post' && call.init.method === 'POST'
                || at === 'functions' && call.url === '/api/system/function-status' || at === 'final' && statusReads === 2;
            return selected ? Response.json({ error: 'redacted' }, { status: 401 }) : undefined;
        });
        if (at === 'initial') await f.controller.refresh(); else await f.controller.activate();
        assert.equal(f.view().messageCode, 'owner_locked'); assert.equal(f.view().phase, 'blocked');
        assert.equal(f.view().status, null); assert.equal(f.view().functions, null);
        const count = f.posts().length; await f.controller.activate(); assert.equal(f.posts().length, count);
    });
}

for (const state of ['revoked', 'corrupt', 'credential_mismatch', 'future_unknown_state']) {
    test(`state ${state} cannot enable activation even with inconsistent canActivate=true`, async () => {
        const f = fixture(); f.status = { ...f.status, state, canActivate: true };
        await f.controller.refresh(); await f.controller.activate();
        assert.equal(f.view().status?.canActivate, false); assert.equal(f.posts().length, 0);
    });
}

for (const state of ['revoked', 'missing'] as const) {
    test(`final reread observes concurrent ${state}, not a stale successful function response`, async () => {
        const f = fixture(); await f.controller.refresh();
        f.handle(call => {
            if (call.url === '/api/system/function-status') {
                f.status = { ...f.status, state, revision: 'c'.repeat(64) };
                return Response.json(functionSnapshot());
            }
        });
        await f.controller.activate();
        assert.equal(f.view().messageCode, state === 'revoked' ? 'revoked' : 'configuration_changed');
        assert.equal(f.view().status, null); assert.equal(f.view().functions, null); assert.equal(f.posts().length, 1);
    });
}

for (const response of [() => Response.json({ error: 'unavailable' }, { status: 503 }), () => Response.json({ functions: [] })]) {
    test('auxiliary availability or invalid function snapshot does not repeat activation or fabricate capabilities', async () => {
        const f = fixture(); await f.controller.refresh();
        f.handle(call => call.url === '/api/system/function-status' ? response() : undefined);
        await f.controller.activate();
        assert.equal(f.view().phase, 'completed'); assert.equal(f.view().messageCode, 'functions_unavailable');
        assert.equal(f.view().functions, null); assert.equal(f.view().status?.state, 'available_unqualified');
        assert.equal(f.posts().length, 1);
    });
}

test('malformed status and raw network errors fail closed without exposing transport details', async () => {
    const f = fixture(); f.handle(() => Response.json({ canActivate: true }));
    await f.controller.refresh(); assert.equal(f.view().messageCode, 'state_unavailable');
    assert.equal(f.view().status, null); await f.controller.activate(); assert.equal(f.posts().length, 0);
    f.handle(() => Promise.reject(new Error('synthetic private network details')));
    await f.controller.refresh(); assert.equal(f.view().messageCode, 'state_unavailable');
});

test('disposal prevents old StrictMode lifetime from publishing, and remount only reads', async () => {
    const first = fixture(); const response = deferred<Response>(); first.handle(() => response.promise);
    const pending = first.controller.refresh(); await until(() => first.calls.length === 1);
    const count = first.views.length; first.controller.dispose(); await pending;
    const second = fixture(); await second.controller.refresh();
    response.resolve(Response.json(first.status)); await nextTurn();
    assert.equal(first.views.length, count); assert.equal(first.calls[0].init.signal?.aborted, true);
    await first.controller.activate(); await first.controller.refresh(); assert.equal(first.calls.length, 1);
    assert.equal(second.posts().length, 0); assert.equal(second.view().phase, 'ready');
});

for (const kind of ['read', 'post'] as const) {
    test(`${kind} transport wait is bounded and does not change host budget or schedule retries`, async context => {
        context.mock.timers.enable({ apis: ['setTimeout'] });
        const f = fixture(); if (kind === 'post') await f.controller.refresh();
        f.handle(() => new Promise(() => {}));
        const pending = kind === 'post' ? f.controller.activate() : f.controller.refresh();
        await until(() => f.calls.length === (kind === 'post' ? 2 : 1));
        context.mock.timers.tick(kind === 'post' ? 40_001 : 10_001); await pending;
        assert.equal(f.view().messageCode, 'request_timed_out'); assert.equal(f.view().status, null);
        assert.equal(f.view().phase, 'interrupted'); assert.equal(f.calls.at(-1)?.init.signal?.aborted, true);
        const count = f.calls.length; context.mock.timers.tick(200_000); await nextTurn(); assert.equal(f.calls.length, count);
    });
}
