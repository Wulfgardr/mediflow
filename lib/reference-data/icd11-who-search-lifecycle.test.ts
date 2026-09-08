/* @Codex */
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import { createIcd11WhoHttpRoute } from './icd11-who-http-route.ts';
import { createIcd11WhoLocalRuntime, type WhoLocalTransport } from './icd11-who-local-runtime.ts';
import { Icd11WhoServiceError } from './icd11-who-service.ts';
import type { WhoLocalReceipt } from './icd11-who-local-contract.ts';

// Invented terminology/digests, real route/runtime/parser, no installed WHO sidecar.
const upstream = () => ({ status: 200, body: JSON.stringify({ error: false, resultChopped: false,
    destinationEntities: [{ theCode: 'AA00', title: 'Synthetic term',
        id: 'http:' + '//id.who.int/icd/release/11/2026-01/mms/1000000001' }],
}) });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture(options: { transport?: WhoLocalTransport; audit?: (receipt: WhoLocalReceipt) => void | Promise<void> } = {}) {
    const env: Record<string, string> = { MEDIFLOW_ICD_WHO_ENABLED: '1',
        MEDIFLOW_ICD_WHO_LOCAL_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
        MEDIFLOW_ICD_WHO_LOCAL_DATASET_ID: `sha256:${'b'.repeat(64)}` };
    const signals: AbortSignal[] = [], audits: WhoLocalReceipt[] = [];
    const runtime = createIcd11WhoLocalRuntime({ readEnvironment: key => env[key],
        now: () => Date.parse('2026-09-08T10:00:00Z'),
        async transport(query, signal) { signals.push(signal); return options.transport ? options.transport(query, signal) : upstream(); },
        async audit(receipt) { audits.push(receipt); await options.audit?.(receipt); },
    });
    return { runtime, signals, audits };
}
const pendingMarker = Symbol('pending');
const settled = <T>(promise: Promise<T>): Promise<T | symbol> => Promise.race([promise, nextTurn().then(() => pendingMarker as typeof pendingMarker)]);
const request = (signal?: AbortSignal) => new Request('http://localhost/api/icd/proxy?q=synthetic', { signal });
async function denied(response: Response) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
}

test('Search reauthorizes before publishing a completed result after ordinary session expiry', async () => {
    const entered = deferred<void>(), completed = deferred<ReturnType<typeof upstream>>();
    let authorized = true;
    const f = fixture({ transport: async () => { entered.resolve(); return completed.promise; } });
    const route = createIcd11WhoHttpRoute({ authorize: async () => authorized, getRuntime: () => f.runtime });
    const pending = route(request());
    try {
        await entered.promise; authorized = false; completed.resolve(upstream());
        await denied(await pending);
    } finally { completed.resolve(upstream()); await pending; f.runtime.dispose(); }
});

test('Search fails closed when authorization disappears or throws while a lookup fails', async () => {
    for (const throws of [false, true]) {
        const entered = deferred<void>(), completed = deferred<ReturnType<typeof upstream>>();
        let current = true;
        const f = fixture({ transport: async () => { entered.resolve(); return completed.promise; } });
        const route = createIcd11WhoHttpRoute({ authorize: async () => {
            if (!current && throws) throw new Error('synthetic authorization unavailable');
            return current;
        }, getRuntime: () => f.runtime });
        const pending = route(request());
        try {
            await entered.promise; current = false;
            completed.reject(new Icd11WhoServiceError('request_timeout'));
            await denied(await pending);
        } finally { completed.resolve(upstream()); await pending; f.runtime.dispose(); }
    }
});

test('already cancelled requests never resolve or call the runtime, including readiness', async () => {
    const controller = new AbortController(); controller.abort();
    let resolutions = 0;
    const f = fixture();
    const route = createIcd11WhoHttpRoute({ authorize: async () => true,
        getRuntime: () => { resolutions++; return f.runtime; } });
    try {
        for (const suffix of ['', '?q=synthetic']) {
            await denied(await route(new Request(`http://localhost/api/icd/proxy${suffix}`, { signal: controller.signal })));
        }
        assert.equal(resolutions, 0);
        assert.equal(f.signals.length, 0);
        assert.equal(f.audits.length, 0);
    } finally { f.runtime.dispose(); }
});

test('cancellation during initial authorization is checked after the await', async () => {
    const entered = deferred<void>(), auth = deferred<boolean>();
    const controller = new AbortController();
    let resolutions = 0;
    const f = fixture();
    const route = createIcd11WhoHttpRoute({ authorize: async () => { entered.resolve(); return auth.promise; },
        getRuntime: () => { resolutions++; return f.runtime; } });
    const pending = route(request(controller.signal));
    try {
        await entered.promise; controller.abort(); auth.resolve(true);
        await denied(await pending);
        assert.equal(resolutions, 0);
    } finally { auth.resolve(true); await pending; f.runtime.dispose(); }
});

test('request abort interrupts local Search and a late response cannot publish or populate cache', async () => {
    const entered = deferred<void>(), late = deferred<ReturnType<typeof upstream>>();
    const controller = new AbortController();
    let calls = 0;
    const f = fixture({ transport: async () => { if (++calls === 1) { entered.resolve(); return late.promise; } return upstream(); } });
    const route = createIcd11WhoHttpRoute({ authorize: async () => true, getRuntime: () => f.runtime });
    const pending = route(request(controller.signal));
    try {
        await entered.promise; controller.abort();
        const response = await settled(pending);
        assert.ok(typeof response !== 'symbol', 'request cancellation must settle without the old upstream result');
        await denied(response);
        assert.equal(f.signals[0].aborted, true);
        assert.equal(f.audits.length, 0);
        assert.notEqual(f.runtime.readiness().status, 'available');
        late.resolve(upstream()); await nextTurn();
        assert.equal(f.audits.length, 0);
        const fresh = await route(request());
        assert.equal(fresh.status, 200);
        const body = await fresh.json();
        assert.equal(body.schemaVersion, 'mediflow.reference-data.icd11-search-response.v2');
        assert.equal(body.receipt.source, 'live');
        assert.equal(calls, 2);
        assert.equal(f.audits.length, 1);
        const cached = await (await route(request())).json();
        assert.equal(cached.receipt.source, 'cache');
        assert.equal(cached.receipt.expiresAt, body.receipt.expiresAt);
        assert.equal(calls, 2);
    } finally { late.resolve(upstream()); await pending; f.runtime.dispose(); }
});

test('request abort during audit prevents result/cache publication without detaching the shared runtime', async () => {
    const entered = deferred<void>(), audit = deferred<void>();
    const controller = new AbortController();
    let auditCalls = 0;
    const f = fixture({ audit: async () => { if (++auditCalls === 1) { entered.resolve(); await audit.promise; } } });
    const route = createIcd11WhoHttpRoute({ authorize: async () => true, getRuntime: () => f.runtime });
    const pending = route(request(controller.signal));
    try {
        await entered.promise; controller.abort();
        const response = await settled(pending);
        assert.ok(typeof response !== 'symbol', 'abort must interrupt the audit wait');
        await denied(response);
        assert.equal(f.signals[0].aborted, true);
        audit.resolve(); await nextTurn();
        const result = await (await route(request())).json();
        assert.equal(result.receipt.source, 'live');
        assert.equal(f.signals.length, 2);
    } finally { audit.resolve(); await pending; f.runtime.dispose(); }
});

test('cancellation during final reauthorization is checked after that await', async () => {
    const controller = new AbortController();
    let authorizations = 0;
    const f = fixture();
    const route = createIcd11WhoHttpRoute({ authorize: async () => {
        if (++authorizations === 2) { await Promise.resolve(); controller.abort(); }
        return true;
    }, getRuntime: () => f.runtime });
    try { await denied(await route(request(controller.signal))); assert.equal(authorizations, 2); }
    finally { f.runtime.dispose(); }
});

test('local runtime independently rejects a cancelled signal before transport or cache audit', async () => {
    const f = fixture();
    const controller = new AbortController(); controller.abort();
    const cancelled = (error: unknown) => error instanceof Icd11WhoServiceError && error.code === 'request_cancelled';
    try {
        await assert.rejects(f.runtime.search('synthetic', controller.signal), cancelled);
        assert.equal(f.signals.length, 0); assert.equal(f.audits.length, 0);
        await f.runtime.search('synthetic');
        await assert.rejects(f.runtime.search('synthetic', controller.signal), cancelled);
        assert.equal(f.signals.length, 1); assert.equal(f.audits.length, 1);
    } finally { f.runtime.dispose(); }
});

test('cancelling one Search does not cancel another request on the same runtime', async () => {
    const first = deferred<ReturnType<typeof upstream>>(), second = deferred<ReturnType<typeof upstream>>();
    const bothStarted = deferred<void>();
    let calls = 0;
    const f = fixture({ transport: async () => { if (++calls === 1) return first.promise; bothStarted.resolve(); return second.promise; } });
    const controller = new AbortController();
    const route = createIcd11WhoHttpRoute({ authorize: async () => true, getRuntime: () => f.runtime });
    const cancelled = route(request(controller.signal));
    const surviving = route(new Request('http://localhost/api/icd/proxy?q=other-synthetic'));
    try {
        await bothStarted.promise; controller.abort();
        const result = await settled(cancelled);
        assert.ok(typeof result !== 'symbol');
        await denied(result);
        assert.equal(f.signals[0].aborted, true);
        assert.equal(f.signals[1].aborted, false);
        second.resolve(upstream());
        assert.equal((await surviving).status, 200);
        first.resolve(upstream()); await nextTurn();
        assert.equal(f.audits.length, 1);
        assert.equal(f.runtime.readiness().status, 'available');
    } finally { first.resolve(upstream()); second.resolve(upstream()); await cancelled; await surviving; f.runtime.dispose(); }
});

test('the route checks cancellation after its authorization helper settles, before readiness or result publication', async () => {
    for (const phase of [1, 2]) {
        const f = fixture();
        const controller = new AbortController();
        let authorizations = 0, resolutions = 0;
        const route = createIcd11WhoHttpRoute({ authorize: async () => {
            if (++authorizations === phase) {
                // Cancel between the helper's continuation and the route's continuation.
                queueMicrotask(() => queueMicrotask(() => controller.abort()));
            }
            return true;
        }, getRuntime: () => { resolutions++; return f.runtime; } });
        try {
            const url = `http://localhost/api/icd/proxy${phase === 1 ? '' : '?q=synthetic'}`;
            await denied(await route(new Request(url, { signal: controller.signal })));
            if (phase === 1) { assert.equal(resolutions, 0); assert.equal(f.signals.length, 0); }
        } finally { f.runtime.dispose(); }
    }
});
