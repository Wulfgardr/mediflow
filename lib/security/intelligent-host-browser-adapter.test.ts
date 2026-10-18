
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    IntelligentHostBrowserAdapterError,
    createIntelligentHostBrowserAdapter,
} from './intelligent-host-browser-adapter.ts';

const SCOPE = Object.freeze({
    patientId: 'patient.synthetic.01',
    ambulatoryId: 'ambulatory.synthetic.01',
});
const LEASE = Object.freeze({
    sessionRef: `ssr_${'1'.repeat(32)}`,
    selectionEpoch: 1,
    patientRef: `ptr_${'2'.repeat(32)}`,
    ambulatoryRef: `abr_${'3'.repeat(32)}`,
    leaseRef: `lsr_${'4'.repeat(32)}`,
    expiresAt: 1_799_999_999_999,
});

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function rejects(code: string) {
    return (error: unknown) => error instanceof IntelligentHostBrowserAdapterError
        && error.code === code;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => { resolve = next; });
    return { promise, resolve };
}

test('initializes selection, selects the exact patient scope, and posts only its epoch once', async () => {
    const calls: Array<Readonly<{ url: string; init: RequestInit }>> = [];
    const client = createIntelligentHostBrowserAdapter({
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (init.method === 'GET') return response({ selectionEpoch: 0 });
            if (String(url).endsWith('/selection')) return response({ selection: LEASE });
            return response({ state: 'active', expiresAt: 1_800_000_000_000 });
        },
    });

    await client.initialize();
    const active = await client.activate(SCOPE, true);

    assert.deepEqual(active, { state: 'active', expiresAt: 1_800_000_000_000 });
    assert.deepEqual(Reflect.ownKeys(active), ['state', 'expiresAt']);
    assert.deepEqual(calls.map(({ url, init }) => `${init.method}:${url}`), [
        'GET:/api/ai/smart-import/selection',
        'POST:/api/ai/smart-import/selection',
        'POST:/api/patients/patient.synthetic.01/intelligent-host/activate',
    ]);
    assert.deepEqual(JSON.parse(calls[1].init.body as string), {
        expectedEpoch: 0,
        ...SCOPE,
    });
    assert.deepEqual(JSON.parse(calls[2].init.body as string), { selectionEpoch: 1 });
});

test('requires an explicit resync after 409 and never retries activation automatically', async () => {
    const calls: Array<Readonly<{ url: string; method: string | undefined }>> = [];
    const client = createIntelligentHostBrowserAdapter({
        fetch: async (url, init = {}) => {
            calls.push({ url: String(url), method: init.method });
            if (calls.length === 1) return response({ selectionEpoch: 0 });
            if (calls.length === 2) return response({}, 409);
            return response({ selectionEpoch: 1 });
        },
    });

    await client.initialize();
    await assert.rejects(() => client.activate(SCOPE, true), rejects('selection_resync_required'));
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2], { url: '/api/ai/smart-import/selection', method: 'GET' });
    await client.resync();
    assert.deepEqual(calls[3], { url: '/api/ai/smart-import/selection', method: 'GET' });
});

test('terminalizes host-side 409 and 503 without retry and fences a completion after reset', async () => {
    let calls = 0;
    for (const status of [409, 503]) {
        calls = 0;
        const unavailable = createIntelligentHostBrowserAdapter({
            fetch: async (_url, init = {}) => {
                calls += 1;
                if (init.method === 'GET') return response({ selectionEpoch: 0 });
                if (calls === 2) return response({ selection: LEASE });
                return response({}, status);
            },
        });
        await unavailable.initialize();
        await assert.rejects(() => unavailable.activate(SCOPE, true), rejects('host_unavailable'));
        assert.equal(calls, 3);
        await assert.rejects(() => unavailable.activate(SCOPE, true), rejects('operation_terminal'));
        assert.equal(calls, 3);
        unavailable.reset();
        await assert.rejects(() => unavailable.initialize(), rejects('operation_terminal'));
        assert.equal(calls, 3);
    }

    const delayed = deferred<Response>();
    const activationStarted = deferred<void>();
    calls = 0;
    const stale = createIntelligentHostBrowserAdapter({
        fetch: async (_url, init = {}) => {
            calls += 1;
            if (init.method === 'GET') return response({ selectionEpoch: 0 });
            if (calls === 2) return response({ selection: LEASE });
            activationStarted.resolve();
            return delayed.promise;
        },
    });
    await stale.initialize();
    const pending = stale.activate(SCOPE, true);
    await activationStarted.promise;
    stale.reset();
    delayed.resolve(response({ state: 'active', expiresAt: 1_800_000_000_000 }));
    await assert.rejects(() => pending, rejects('operation_superseded'));
});

test('adds an explicit exact profile grant only when the caller confirms that projection', async () => {
    for (const projection of ['profile', 'notes'] as const) {
        let body: unknown;
        const client = createIntelligentHostBrowserAdapter({ fetch: async (url, init = {}) => {
            if (init.method === 'GET') return response({ selectionEpoch: 0 });
            if (String(url).endsWith('/selection')) return response({ selection: LEASE });
            body = JSON.parse(init.body as string); return response({ state: 'active', expiresAt: 1800000000000 });
        } });
        await client.initialize(); await client.activate(SCOPE, true, { projection });
        assert.deepEqual(body, { selectionEpoch: 1, patientProfileQuery: { projection } });
    }
});
