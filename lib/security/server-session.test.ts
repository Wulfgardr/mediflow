/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';

import {
    clearAllSessions,
    createSession,
    deleteSession,
    getSession,
    invalidateSessionsForUser,
    peekSession,
    registerServerSessionResource,
} from './server-session';
import {
    createServerSessionProjectionOwnerRegistry,
    ServerSessionProjectionOwnerError,
    spendLeaseCommitTurn,
    withLeaseCommitTurn,
} from './server-session-projection-owner';

const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;
const TARGET_USERNAME = ['synthetic', 'target'].join('-');
const OTHER_USERNAME = ['synthetic', 'other'].join('-');

afterEach(() => clearAllSessions());

function syntheticSession() {
    return createSession({
        id: 'user-synthetic',
        username: SYNTHETIC_USERNAME,
        role: 'clinician',
    });
}

test('delete removes the session before disposing its resource exactly once', () => {
    const session = syntheticSession();
    const events: string[] = [];
    const unregister = registerServerSessionResource(session.id, (reason) => {
        assert.equal(getSession(session.id), null);
        events.push(reason);
    });

    assert.equal(typeof unregister, 'function');
    deleteSession(session.id);
    deleteSession(session.id);

    assert.deepEqual(events, ['session_deleted']);
});

test('user invalidation synchronously deletes every matching session and preserves other users', () => {
    const first = createSession({ id: 'synthetic-target', username: TARGET_USERNAME, role: 'clinician' });
    const second = createSession({ id: 'synthetic-target', username: TARGET_USERNAME, role: 'clinician' });
    const unaffected = createSession({ id: 'synthetic-other', username: OTHER_USERNAME, role: 'clinician' });
    const events: string[] = [];
    let invalidating = true;

    registerServerSessionResource(first.id, (reason) => {
        assert.equal(invalidating, true);
        assert.equal(getSession(first.id), null);
        events.push(`first:${reason}`);
    });
    registerServerSessionResource(second.id, (reason) => {
        assert.equal(invalidating, true);
        assert.equal(getSession(second.id), null);
        events.push(`second:${reason}`);
    });
    registerServerSessionResource(unaffected.id, (reason) => events.push(`other:${reason}`));

    invalidateSessionsForUser('synthetic-target');
    invalidating = false;

    assert.equal(getSession(first.id), null);
    assert.equal(getSession(second.id), null);
    assert.equal(getSession(unaffected.id), unaffected);
    assert.deepEqual(events, ['first:session_deleted', 'second:session_deleted']);
});

test('expired access disposes the resource before returning null', () => {
    const session = syntheticSession();
    const events: string[] = [];
    registerServerSessionResource(session.id, (reason) => events.push(reason));
    session.expiresAt = 0;

    assert.equal(getSession(session.id), null);
    assert.equal(getSession(session.id), null);
    assert.deepEqual(events, ['session_expired']);
});

test('live access preserves the resource and keeps sliding expiry', () => {
    const session = syntheticSession();
    const events: string[] = [];
    session.expiresAt = Date.now() + 1_000;
    const previousExpiry = session.expiresAt;
    const unregister = registerServerSessionResource(session.id, (reason) => events.push(reason));

    assert.equal(getSession(session.id), session);
    assert.ok(session.expiresAt > previousExpiry);
    assert.deepEqual(events, []);
    unregister?.();
});

test('peek reads a live session without sliding its expiry', () => {
    const session = syntheticSession();
    session.expiresAt = Date.now() + 1_000;
    const expiry = session.expiresAt;

    assert.equal(peekSession(session.id), session);
    assert.equal(session.expiresAt, expiry);
});

test('registration rejects missing and expired sessions without sliding expiry', () => {
    let calls = 0;
    assert.equal(registerServerSessionResource('missing-session', () => { calls += 1; }), null);

    const session = syntheticSession();
    session.expiresAt = 0;
    assert.equal(registerServerSessionResource(session.id, () => { calls += 1; }), null);
    assert.equal(getSession(session.id), null);
    assert.equal(calls, 0);
});

test('unregister is synchronous and idempotent without disposing the resource', () => {
    const session = syntheticSession();
    let calls = 0;
    const unregister = registerServerSessionResource(session.id, () => { calls += 1; });

    unregister?.();
    unregister?.();
    deleteSession(session.id);

    assert.equal(calls, 0);
});

test('each registration is disposed even when it reuses the same callback', () => {
    const session = syntheticSession();
    const reasons: string[] = [];
    const dispose = (reason: string) => reasons.push(reason);
    registerServerSessionResource(session.id, dispose);
    registerServerSessionResource(session.id, dispose);

    deleteSession(session.id);

    assert.deepEqual(reasons, ['session_deleted', 'session_deleted']);
});

test('termination attempts every detached registration despite reentrant unregister', () => {
    const session = syntheticSession();
    const events: string[] = [];
    let unregisterSecond: (() => void) | null = null;
    registerServerSessionResource(session.id, () => {
        events.push('first');
        unregisterSecond?.();
    });
    unregisterSecond = registerServerSessionResource(session.id, () => events.push('second'));

    deleteSession(session.id);

    assert.deepEqual(events, ['first', 'second']);
});

test('clear removes all sessions before opaque disposal and continues after a throw', () => {
    const first = syntheticSession();
    const second = syntheticSession();
    const events: string[] = [];
    registerServerSessionResource(first.id, (reason) => {
        events.push(`throwing:${reason}`);
        throw new Error('synthetic cleanup detail');
    });
    registerServerSessionResource(first.id, (reason) => events.push(`first:${reason}`));
    registerServerSessionResource(second.id, (reason) => {
        assert.equal(getSession(first.id), null);
        assert.equal(getSession(second.id), null);
        events.push(`second:${reason}`);
    });

    clearAllSessions();
    clearAllSessions();

    assert.deepEqual(events, [
        'throwing:sessions_cleared',
        'first:sessions_cleared',
        'second:sessions_cleared',
    ]);
});

test('disposal cannot register a new resource on the terminated session', () => {
    const session = syntheticSession();
    let nestedRegistration: (() => void) | null | undefined;
    registerServerSessionResource(session.id, () => {
        nestedRegistration = registerServerSessionResource(session.id, () => undefined);
    });

    deleteSession(session.id);

    assert.equal(nestedRegistration, null);
});

test('clear disposes an orphan registration left by host module drift', () => {
    const session = syntheticSession();
    const reasons: string[] = [];
    registerServerSessionResource(session.id, (reason) => reasons.push(reason));
    globalThis.__mediflowSessions?.delete(session.id);

    clearAllSessions();

    assert.deepEqual(reasons, ['sessions_cleared']);
});

test('keeps session state and the H1b commit turn isolated from post-load ambient intrinsics', () => {
    const mapPrototype = Map.prototype;
    const setPrototype = Set.prototype;
    const arrayPrototype = Array.prototype;
    const originalDateNow = Date.now;
    const originals = {
        map: globalThis.Map,
        set: globalThis.Set,
        mapGet: mapPrototype.get,
        mapSet: mapPrototype.set,
        mapDelete: mapPrototype.delete,
        mapClear: mapPrototype.clear,
        mapHas: mapPrototype.has,
        mapKeys: mapPrototype.keys,
        mapValues: mapPrototype.values,
        setAdd: setPrototype.add,
        setDelete: setPrototype.delete,
        setValues: setPrototype.values,
        dateNow: originalDateNow,
        functionCall: Function.prototype.call,
        functionApply: Function.prototype.apply,
        functionBind: Function.prototype.bind,
        reflectApply: Reflect.apply,
        arrayIterator: arrayPrototype[Symbol.iterator],
    };
    const prepared = Object.freeze({ synthetic: 'prepared' });
    const now = originalDateNow();
    const distantFuture = now + 1000 * 60 * 60 * 24 * 365;
    let poisonedCalls = 0;
    let live: ReturnType<typeof createSession> | undefined;
    let expiryAfterZero = 0; let expiryAfterInfinity = 0; let expiryAfterFuture = 0;
    let deleted = false; let invalidated = false; let cleared = false;
    let aborts = 0; let commits = 0;
    let firstFailure: unknown;
    const poison = () => { poisonedCalls += 1; throw new Error('synthetic ambient intrinsic'); };

    try {
        globalThis.Map = poison as unknown as typeof Map;
        globalThis.Set = poison as unknown as typeof Set;
        mapPrototype.get = poison as typeof mapPrototype.get;
        mapPrototype.set = poison as typeof mapPrototype.set;
        mapPrototype.delete = poison as typeof mapPrototype.delete;
        mapPrototype.clear = poison as typeof mapPrototype.clear;
        mapPrototype.has = poison as typeof mapPrototype.has;
        mapPrototype.keys = poison as typeof mapPrototype.keys;
        mapPrototype.values = poison as typeof mapPrototype.values;
        setPrototype.add = poison as typeof setPrototype.add;
        setPrototype.delete = poison as typeof setPrototype.delete;
        setPrototype.values = poison as typeof setPrototype.values;
        Date.now = () => 0;
        Function.prototype.call = poison as typeof Function.prototype.call;
        Function.prototype.apply = poison as typeof Function.prototype.apply;
        Function.prototype.bind = poison as typeof Function.prototype.bind;
        Reflect.apply = poison as typeof Reflect.apply;
        arrayPrototype[Symbol.iterator] = poison as typeof arrayPrototype[typeof Symbol.iterator];

        live = syntheticSession();
        assert.equal(getSession(live.id), live);
        expiryAfterZero = live.expiresAt;

        Date.now = () => Infinity;
        assert.equal(getSession(live.id), live);
        expiryAfterInfinity = live.expiresAt;

        Date.now = () => distantFuture;
        assert.equal(getSession(live.id), live);
        expiryAfterFuture = live.expiresAt;

        const deletedSession = syntheticSession();
        deleteSession(deletedSession.id);
        deleted = getSession(deletedSession.id) === null;

        const invalidatedSession = createSession({ id: 'user-synthetic-invalidate', username: SYNTHETIC_USERNAME, role: 'clinician' });
        invalidateSessionsForUser('user-synthetic-invalidate');
        invalidated = getSession(invalidatedSession.id) === null;

        const clearedSession = syntheticSession();
        registerServerSessionResource(clearedSession.id, () => undefined);
        clearAllSessions();
        cleared = getSession(clearedSession.id) === null;

        const ownerSession = syntheticSession();
        const registry = createServerSessionProjectionOwnerRegistry({ resolve: (_session, pair) => Object.freeze(pair) });
        const owner = registry.acquire(ownerSession);
        owner.issueSelection({ expectedEpoch: 0, patientId: 'patient.synthetic.01', ambulatoryId: 'ambulatory.synthetic.01' });
        try {
            withLeaseCommitTurn(owner, ownerSession, () => prepared,
                () => undefined,
                (turn) => { aborts += 1; spendLeaseCommitTurn(owner, ownerSession, turn, 'abort'); });
        } catch (error) { firstFailure = error; }
        withLeaseCommitTurn(owner, ownerSession, () => prepared,
            (_prepared, turn) => { commits += 1; spendLeaseCommitTurn(owner, ownerSession, turn, 'commit'); },
            () => assert.fail('retry must not abort'));
    } finally {
        globalThis.Map = originals.map;
        globalThis.Set = originals.set;
        mapPrototype.get = originals.mapGet;
        mapPrototype.set = originals.mapSet;
        mapPrototype.delete = originals.mapDelete;
        mapPrototype.clear = originals.mapClear;
        mapPrototype.has = originals.mapHas;
        mapPrototype.keys = originals.mapKeys;
        mapPrototype.values = originals.mapValues;
        setPrototype.add = originals.setAdd;
        setPrototype.delete = originals.setDelete;
        setPrototype.values = originals.setValues;
        Date.now = originals.dateNow;
        Function.prototype.call = originals.functionCall;
        Function.prototype.apply = originals.functionApply;
        Function.prototype.bind = originals.functionBind;
        Reflect.apply = originals.reflectApply;
        arrayPrototype[Symbol.iterator] = originals.arrayIterator;
    }

    assert.ok(live);
    assert.ok(Number.isFinite(expiryAfterZero));
    assert.ok(Number.isFinite(expiryAfterInfinity));
    assert.ok(Number.isFinite(expiryAfterFuture));
    assert.ok(expiryAfterZero > now);
    assert.ok(expiryAfterInfinity > now);
    assert.ok(expiryAfterFuture > now && expiryAfterFuture < distantFuture);
    assert.equal(deleted, true);
    assert.equal(invalidated, true);
    assert.equal(cleared, true);
    assert.equal(poisonedCalls, 0);
    assert.equal(firstFailure instanceof ServerSessionProjectionOwnerError && firstFailure.code, 'selection_unavailable');
    assert.deepEqual({ aborts, commits }, { aborts: 1, commits: 1 });
});
