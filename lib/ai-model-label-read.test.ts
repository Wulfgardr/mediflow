/* @Codex: synthetic transport; ordinary facade, crypto key lifecycle and label reader. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from './db';
import { getAiModelLabels } from './ai-summary-service';
import { MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT } from './api-table-response';

const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const row = (value: string) => Response.json({ value });
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

test('locked label reads never dispatch HTTP', async t => {
    db.setKey(null);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return row('unexpected'); });
    await assert.rejects(getAiModelLabels(), { name: 'AbortError' });
    assert.equal(calls, 0);
});

test('a saved clinical model needs one read and no migration or legacy request', async t => {
    db.setKey(await key());
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
        assert.equal(init.method, undefined);
        assert.equal(init.signal?.aborted, false);
        calls.push(url);
        return row('saved-clinical-model');
    });
    assert.deepEqual(await getAiModelLabels(), { clinical: 'saved-clinical-model' });
    assert.deepEqual(calls, ['/api/settings/aiModel_clinical']);
    db.setKey(null);
});

test('an absent clinical setting still resolves the ordinary legacy fallback', async t => {
    db.setKey(await key());
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        calls.push(url);
        return url.endsWith('_clinical') ? new Response(null, { status: 404 }) : row('saved-legacy-model');
    });
    assert.deepEqual(await getAiModelLabels(), { clinical: 'saved-legacy-model' });
    assert.deepEqual(calls, ['/api/settings/aiModel_clinical', '/api/settings/aiModel']);
    db.setKey(null);
});

test('lock synchronously aborts a pending read and rejects a late reply without fallback', async t => {
    db.setKey(await key());
    const reply = deferred<Response>();
    const entered = deferred<AbortSignal>();
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
        calls++;
        entered.resolve(init.signal!);
        // Deliberately ignore cancellation to also test stale completion rejection.
        return reply.promise;
    });
    const pending = getAiModelLabels();
    const signal = await entered.promise;
    db.setKey(null);
    assert.equal(signal.aborted, true);
    reply.resolve(new Response(null, { status: 404 }));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls, 1);
});

test('a new login cannot revive the old reader or cancel its replacement', async t => {
    db.setKey(await key());
    const oldSignal = db.getSessionReadSignal();
    db.setKey(null);
    db.setKey(await key());
    const freshSignal = db.getSessionReadSignal();
    assert.equal(oldSignal.aborted, true);
    assert.equal(freshSignal.aborted, false);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return row('fresh-model'); });
    await assert.rejects(getAiModelLabels(oldSignal), { name: 'AbortError' });
    assert.deepEqual(await getAiModelLabels(freshSignal), { clinical: 'fresh-model' });
    assert.equal(calls, 1);
    db.setKey(null);
});

test('retiring a component cancels its continuation without locking the session', async t => {
    db.setKey(await key());
    const component = new AbortController();
    const session = db.getSessionReadSignal();
    const signal = AbortSignal.any([component.signal, session]);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        calls++;
        component.abort();
        return new Response(null, { status: 404 });
    });
    await assert.rejects(getAiModelLabels(signal), { name: 'AbortError' });
    assert.equal(calls, 1);
    assert.equal(session.aborted, false);
    db.setKey(null);
});

test('auth-unavailable still notifies the owner and stops fallback after owner retirement', async t => {
    db.setKey(await key());
    const events = new EventTarget();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: events });
    t.after(() => {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else Reflect.deleteProperty(globalThis, 'window');
        db.setKey(null);
    });
    let retired = false;
    events.addEventListener(MEDIFLOW_API_AUTH_UNAVAILABLE_EVENT, () => { retired = true; db.setKey(null); });
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 401 }); });
    await assert.rejects(getAiModelLabels(), { name: 'AbortError' });
    assert.equal(retired, true);
    assert.equal(calls, 1);
});

test('an active read error remains an error and does not become a legacy fallback', async t => {
    db.setKey(await key());
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 500 }); });
    await assert.rejects(getAiModelLabels(), /Failed to fetch.*500/);
    assert.equal(calls, 1);
    db.setKey(null);
});
