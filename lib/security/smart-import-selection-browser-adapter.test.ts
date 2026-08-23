/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    SmartImportSelectionBrowserAdapterError,
    createSmartImportSelectionBrowserAdapter,
} from './smart-import-selection-browser-adapter.ts';

const PROPOSAL = Object.freeze({ patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' });
const LEASE = Object.freeze({ sessionRef: `ssr_${'1'.repeat(32)}`, selectionEpoch: 1,
    patientRef: `ptr_${'2'.repeat(32)}`, ambulatoryRef: `abr_${'3'.repeat(32)}`,
    leaseRef: `lsr_${'4'.repeat(32)}`, expiresAt: 123_456 });

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
    return { promise, resolve, reject };
}
function rejects(code: string) {
    return (error: unknown) => error instanceof SmartImportSelectionBrowserAdapterError && error.code === code;
}

test('initializes and reloads only the exact epoch response without a lease', async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const values = [response({ selectionEpoch: 0 }), response({ selectionEpoch: 3 })];
    const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async (url, init) => {
        calls.push([url, init]); return values.shift() as Response;
    } });

    assert.deepEqual(await adapter.initialize(), { selectionEpoch: 0, lease: null });
    assert.deepEqual(await adapter.resync(), { selectionEpoch: 3, lease: null });
    assert.deepEqual(calls, [
        ['/api/ai/smart-import/selection', { method: 'GET', cache: 'no-store' }],
        ['/api/ai/smart-import/selection', { method: 'GET', cache: 'no-store' }],
    ]);
});

test('posts once only after explicit confirmation and returns the opaque lease', async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async (url, init) => {
        calls.push([url, init]); return calls.length === 1 ? response({ selectionEpoch: 0 }) : response({ selection: LEASE });
    } });
    await adapter.initialize();

    await assert.rejects(() => adapter.select(PROPOSAL, false as never), rejects('confirmation_required'));
    assert.deepEqual(await adapter.select(PROPOSAL, true), { selectionEpoch: 1, lease: LEASE });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ['/api/ai/smart-import/selection', {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedEpoch: 0, ...PROPOSAL }),
    }]);
});

test('conflict performs one resync, removes the lease, and requires a new confirmation', async () => {
    const calls: RequestInit[] = [];
    const values = [response({ selectionEpoch: 0 }), response({ selection: LEASE }), response({ selectionEpoch: 99 }, 409), response({ selectionEpoch: 2 }), response({ selection: { ...LEASE, selectionEpoch: 3 } })];
    const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async (_url, init) => {
        calls.push(init as RequestInit); return values.shift() as Response;
    } });
    await adapter.initialize(); await adapter.select(PROPOSAL, true);

    await assert.rejects(() => adapter.select(PROPOSAL, true), rejects('selection_resync_required'));
    assert.equal(calls.length, 4); assert.equal(calls[3].method, 'GET');
    assert.deepEqual(await adapter.select(PROPOSAL, true), { selectionEpoch: 3, lease: { ...LEASE, selectionEpoch: 3 } });
    assert.equal(JSON.parse(calls[4].body as string).expectedEpoch, 2);
});

test('never retries timeout or unknown POST outcomes and keeps malformed responses fail closed', async () => {
    for (const outcome of [async () => { throw new Error('synthetic timeout'); }, async () => response({}, 500)]) {
        let calls = 0;
        const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
            calls += 1; return calls === 1 ? response({ selectionEpoch: 0 }) : outcome();
        } });
        await adapter.initialize();
        await assert.rejects(() => adapter.select(PROPOSAL, true), rejects('selection_outcome_unknown'));
        assert.equal(calls, 2);
    }

    const malformed = createSmartImportSelectionBrowserAdapter({ fetch: async () => response({ selectionEpoch: -1 }) });
    await assert.rejects(() => malformed.initialize(), rejects('response_invalid'));
    let malformedCalls = 0;
    const malformedPost = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
        malformedCalls += 1; return malformedCalls === 1 ? response({ selectionEpoch: 0 }) : response({ selection: { ...LEASE, expiresAt: -1 } });
    } });
    await malformedPost.initialize();
    await assert.rejects(() => malformedPost.select(PROPOSAL, true), rejects('response_invalid'));
});

test('fences reordered GET and delayed POST responses without restoring a superseded lease', async () => {
    const slowGet = deferred<Response>(); const slowPost = deferred<Response>(); let calls = 0;
    const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async (_url, init) => {
        calls += 1;
        if (calls === 1) return response({ selectionEpoch: 1 });
        if (calls === 2) return slowPost.promise;
        if (calls === 3) return response({ selectionEpoch: 2 });
        return slowGet.promise;
    } });
    await adapter.initialize();
    const pendingPost = adapter.select(PROPOSAL, true);
    assert.deepEqual(await adapter.resync(), { selectionEpoch: 2, lease: null });
    slowPost.resolve(response({ selection: LEASE }));
    await assert.rejects(() => pendingPost, rejects('selection_superseded'));
    const staleGet = adapter.resync(); slowGet.resolve(response({ selectionEpoch: 1 }));
    assert.deepEqual(await staleGet, { selectionEpoch: 2, lease: null });
});

test('fences a prior generation and resets state on explicit reset or session failure', async () => {
    const delayed = deferred<Response>(); let calls = 0;
    const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
        calls += 1; return calls === 1 ? delayed.promise : response({ error: 'hidden', code: 'session_unavailable' }, 401);
    } });
    const loading = adapter.initialize();
    assert.deepEqual(adapter.reset(), { selectionEpoch: null, lease: null });
    delayed.resolve(response({ selectionEpoch: 7 }));
    assert.deepEqual(await loading, { selectionEpoch: null, lease: null });
    await assert.rejects(() => adapter.resync(), rejects('session_unavailable'));
    assert.deepEqual(adapter.reset(), { selectionEpoch: null, lease: null });

    let sessionCalls = 0;
    const postSessionFailure = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
        sessionCalls += 1; return sessionCalls === 1 ? response({ selectionEpoch: 0 }) : response({}, 401);
    } });
    await postSessionFailure.initialize();
    await assert.rejects(() => postSessionFailure.select(PROPOSAL, true), rejects('session_unavailable'));
    assert.deepEqual(postSessionFailure.reset(), { selectionEpoch: null, lease: null });
});

test('does not let an old POST failure or delayed JSON failure erase a newer generation lease', async () => {
    for (const oldOutcome of ['fetch', 'json'] as const) {
        const old = deferred<Response>(); const oldJson = deferred<unknown>(); const jsonStarted = deferred<void>(); let calls = 0;
        const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
            calls += 1;
            if (calls === 1 || calls === 3 || calls === 5) return response({ selectionEpoch: calls === 5 ? 1 : 0 });
            if (calls === 2) return oldOutcome === 'fetch' ? old.promise : { ok: true, status: 200,
                json: async () => { jsonStarted.resolve(); return oldJson.promise; } } as Response;
            return response({ selection: LEASE });
        } });
        await adapter.initialize(); const pending = adapter.select(PROPOSAL, true);
        if (oldOutcome === 'json') await jsonStarted.promise;
        adapter.reset(); await adapter.initialize(); await adapter.select(PROPOSAL, true);
        if (oldOutcome === 'fetch') old.reject(new Error('synthetic old fetch failure'));
        else oldJson.reject(new Error('synthetic old json failure'));
        await assert.rejects(() => pending, rejects('selection_generation_changed'));
        assert.deepEqual(await adapter.resync(), { selectionEpoch: 1, lease: LEASE });
    }
});

test('rejects swapped opaque prefixes and a POST epoch jump without installing a lease', async () => {
    const swapped = { ...LEASE, sessionRef: LEASE.patientRef };
    let calls = 0;
    const prefix = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
        calls += 1; return calls === 1 ? response({ selectionEpoch: 0 }) : response({ selection: swapped });
    } });
    await prefix.initialize(); await assert.rejects(() => prefix.select(PROPOSAL, true), rejects('response_invalid'));

    const jumped = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
        calls += 1;
        if (calls === 3) return response({ selectionEpoch: 0 });
        if (calls === 4) return response({ selection: { ...LEASE, selectionEpoch: 1 } });
        if (calls === 5) return response({ selection: { ...LEASE, selectionEpoch: 3 } });
        return response({ selectionEpoch: 1 });
    } });
    await jumped.initialize(); await jumped.select(PROPOSAL, true);
    await assert.rejects(() => jumped.select(PROPOSAL, true), rejects('response_invalid'));
    assert.deepEqual(await jumped.resync(), { selectionEpoch: 1, lease: null });
});

test('fences an older overlapping select before failure, malformed JSON, 500, or 409 can change the newer lease', async () => {
    for (const outcome of ['fetch', 'json', 'non-ok', 'conflict'] as const) {
        const old = deferred<Response>(); const oldJson = deferred<unknown>(); const jsonStarted = deferred<void>(); let calls = 0; let gets = 0;
        const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async () => {
            calls += 1;
            if (calls === 1) return response({ selectionEpoch: 0 });
            if (calls === 2) return outcome === 'json' ? { ok: true, status: 200,
                json: async () => { jsonStarted.resolve(); return oldJson.promise; } } as Response : old.promise;
            if (calls === 3) return response({ selection: LEASE });
            gets += 1; return response({ selectionEpoch: 1 });
        } });
        await adapter.initialize(); const pending = adapter.select(PROPOSAL, true);
        if (outcome === 'json') await jsonStarted.promise;
        await adapter.select(PROPOSAL, true);
        if (outcome === 'fetch') old.reject(new Error('synthetic old failure'));
        else if (outcome === 'json') oldJson.resolve({ malformed: true });
        else old.resolve(response({}, outcome === 'conflict' ? 409 : 500));
        await assert.rejects(() => pending, rejects('selection_superseded'));
        assert.equal(gets, 0);
        assert.deepEqual(await adapter.resync(), { selectionEpoch: 1, lease: LEASE });
    }
});

test('accepts only caller proposals and remains a browser-only selection boundary', async () => {
    const adapter = createSmartImportSelectionBrowserAdapter({ fetch: async () => response({ selectionEpoch: 0 }) });
    await adapter.initialize();
    const accessor = { patientId: PROPOSAL.patientId };
    Object.defineProperty(accessor, 'ambulatoryId', { enumerable: true, get() { return PROPOSAL.ambulatoryId; } });
    for (const value of [{ ...PROPOSAL, extra: true }, accessor, Object.create(PROPOSAL)]) {
        await assert.rejects(() => adapter.select(value as never, true), rejects('input_invalid'));
    }
    const source = readFileSync(new URL('./smart-import-selection-browser-adapter.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /server-only|localStorage|sessionStorage|cookies\(|\/api\/context|patient\.ambulatoryId|setInterval|setTimeout|(?:ingest|preview|provider|apply)/u);
});
