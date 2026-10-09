import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiConflictError, db, type TherapyDeleteClientContext } from './db';
import { decryptData, generateMasterKey } from './security/security';
import { buildVersionConflictPayload } from './version-concurrency';

const therapyId = 'synthetic-therapy';
const reason = 'Duplicato sintetico';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

function isUnconfirmed(error: unknown): boolean {
    assert(error instanceof Error);
    assert.equal(error instanceof ApiConflictError, false);
    assert.equal(error.message, 'Therapy delete was not confirmed.');
    assert.equal(error.cause, undefined);
    return true;
}

async function fixture(t: TestContext) {
    const key = await generateMasterKey();
    db.setKey(key);
    t.after(() => db.setKey(null));
    // Isolate key replacement from setKey's own session abort.
    const session = new AbortController();
    let current = true;
    const context: TherapyDeleteClientContext = {
        signal: session.signal,
        isCurrent: () => current,
    };
    // Observe the notification boundary while retaining its implementation.
    const notify = t.mock.method(db.therapies as unknown as { emitChange(): void }, 'emitChange');
    return {
        key, session, context, notify,
        leavePatient: () => { current = false; },
        remove: () => db.therapies.delete(therapyId, {
            version: 2, deletionReason: reason, deleteContext: context,
        }),
    };
}

for (const suppressNotify of [false, true]) {
    test(`one encrypted DELETE forwards session signal; suppressNotify=${suppressNotify}`, async t => {
        const f = await fixture(t);
        const context = { ...f.context, signal: db.getSessionReadSignal() };
        const fetch = t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
            assert.equal(url, `/api/therapies/${therapyId}`);
            assert.equal(init.method, 'DELETE');
            assert.equal(init.signal, context.signal);
            assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
            const body = JSON.parse(init.body as string) as Record<string, unknown>;
            assert.deepEqual(Object.keys(body).sort(), ['deletionReason', 'version']);
            assert.equal(body.version, 2);
            assert.equal(typeof body.deletionReason, 'string');
            assert.match(body.deletionReason as string, /^ENC:/u);
            assert.equal((init.body as string).includes(reason), false);
            const [, iv, data] = (body.deletionReason as string).split(':');
            assert.equal(await decryptData(data, iv, f.key), reason);
            return new Response(null, { status: 204 });
        });
        await db.therapies.delete(therapyId, {
            version: 2, deletionReason: reason, deleteContext: context, suppressNotify,
        });
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(f.notify.mock.callCount(), suppressNotify ? 0 : 1);
    });
}

for (const cause of ['patient change', 'session abort', 'key replacement'] as const) {
    test(`${cause} during real encryption prevents DELETE dispatch`, async t => {
        const f = await fixture(t);
        const replacement = await generateMasterKey();
        const entered = deferred();
        const gate = deferred();
        t.after(() => gate.resolve());
        const originalEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle);
        const encrypt = t.mock.method(globalThis.crypto.subtle, 'encrypt', async (...args: Parameters<SubtleCrypto['encrypt']>) => {
            const result = await originalEncrypt(...args);
            entered.resolve();
            await gate.promise;
            return result;
        });
        const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP expected'); });
        const denied = assert.rejects(f.remove(), isUnconfirmed);
        await entered.promise;
        if (cause === 'patient change') f.leavePatient();
        if (cause === 'session abort') f.session.abort();
        if (cause === 'key replacement') {
            db.setKey(replacement);
            assert.equal(f.session.signal.aborted, false);
        }
        gate.resolve();
        await denied;
        assert.equal(encrypt.mock.callCount(), 1);
        assert.equal(fetch.mock.callCount(), 0);
        assert.equal(f.notify.mock.callCount(), 0);
    });

    test(`${cause} after dispatch rejects late success without retry or notification`, async t => {
        const f = await fixture(t);
        const replacement = await generateMasterKey();
        const entered = deferred();
        const gate = deferred();
        t.after(() => gate.resolve());
        // Return a late success even if the signal is aborted.
        const fetch = t.mock.method(globalThis, 'fetch', async () => {
            entered.resolve();
            await gate.promise;
            return new Response(null, { status: 204 });
        });
        const denied = assert.rejects(f.remove(), isUnconfirmed);
        await entered.promise;
        if (cause === 'patient change') f.leavePatient();
        if (cause === 'session abort') f.session.abort();
        if (cause === 'key replacement') db.setKey(replacement);
        gate.resolve();
        await denied;
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(f.notify.mock.callCount(), 0);
    });
}

test('current 409 preserves typed conflict payload without retry or notification', async t => {
    const f = await fixture(t);
    const payload = buildVersionConflictPayload('therapy', 2, therapyId, {
        id: therapyId, patientId: 'synthetic-patient', version: 7,
        updatedAt: '2026-01-01T00:00:00Z',
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(payload, { status: 409 }));
    await assert.rejects(f.remove(), error => {
        assert(error instanceof ApiConflictError);
        assert.deepEqual(error.payload, payload);
        return true;
    });
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(f.notify.mock.callCount(), 0);
});

test('retirement during conflict JSON parsing cannot publish a stale conflict', async t => {
    const f = await fixture(t);
    const entered = deferred();
    const gate = deferred();
    t.after(() => gate.resolve());
    const response = Response.json(buildVersionConflictPayload('therapy', 2, therapyId, null), { status: 409 });
    const originalJson = response.json.bind(response);
    t.mock.method(response, 'json', async () => {
        entered.resolve();
        await gate.promise;
        return originalJson();
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => response);
    const denied = assert.rejects(f.remove(), isUnconfirmed);
    await entered.promise;
    f.leavePatient();
    gate.resolve();
    await denied;
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(f.notify.mock.callCount(), 0);
});

for (const failure of ['transport', 'http', 'invalid conflict'] as const) {
    test(`${failure} exposes only the generic unconfirmed error`, async t => {
        const f = await fixture(t);
        const sensitive = 'SYNTHETIC_SENSITIVE_ERROR';
        const fetch = t.mock.method(globalThis, 'fetch', async () => {
            if (failure === 'transport') throw new Error(sensitive);
            if (failure === 'invalid conflict') return new Response(sensitive, { status: 409 });
            return Response.json({ error: sensitive }, { status: 500, statusText: sensitive });
        });
        await assert.rejects(f.remove(), isUnconfirmed);
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(f.notify.mock.callCount(), 0);
    });
}

test('present but undefined deleteContext cannot fall back to an unfenced DELETE', async t => {
    const f = await fixture(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No HTTP expected'); });
    await assert.rejects(db.therapies.delete(therapyId, {
        version: 2, deletionReason: reason, deleteContext: undefined,
    }), isUnconfirmed);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(f.notify.mock.callCount(), 0);
});

for (const status of [401, 403]) {
    test(`strict recovery list does not report authorization failure ${status} as absence`, async t => {
        const f = await fixture(t);
        t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
            assert.equal(init.signal, f.context.signal);
            return Response.json({ error: 'Unavailable' }, { status });
        });
        await assert.rejects(db.therapies.query({ patientId: 'synthetic-patient' }).toArray({
            signal: f.context.signal, rejectAuthUnavailable: true,
        }), /Authenticated list unavailable/u);
        assert.deepEqual(await db.therapies.toArray({ signal: f.context.signal }), []);
        assert.equal(f.notify.mock.callCount(), 0);
    });
}

test('session retirement during list parsing rejects the reread', async t => {
    const f = await fixture(t);
    const entered = deferred();
    const gate = deferred();
    t.after(() => gate.resolve());
    const response = Response.json([{ id: therapyId, patientId: 'synthetic-patient', version: 2 }]);
    const originalJson = response.json.bind(response);
    t.mock.method(response, 'json', async () => { entered.resolve(); await gate.promise; return originalJson(); });
    const fetch = t.mock.method(globalThis, 'fetch', async () => response);
    const denied = assert.rejects(db.therapies.toArray({ signal: f.context.signal, rejectAuthUnavailable: true }), { name: 'AbortError' });
    await entered.promise;
    f.session.abort();
    gate.resolve();
    await denied;
    assert.equal(fetch.mock.callCount(), 1);
});
