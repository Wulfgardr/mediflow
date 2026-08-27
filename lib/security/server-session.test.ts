/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';

import {
    abortStagedWebServerSession,
    activateStagedWebServerSession,
    clearAllSessions,
    createSession,
    deleteSession,
    getSession,
    invalidateSessionsForUser,
    peekSession,
    registerServerSessionResource,
    stageWebServerSession,
} from './server-session';

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

test('a staged Web session has no observable authority before its one-use activation', () => {
    const capsule = stageWebServerSession({ id: 'staged-user', username: SYNTHETIC_USERNAME, role: 'clinician' });

    assert.ok(capsule);
    assert.deepEqual([Object.getPrototypeOf(capsule), Object.isFrozen(capsule), Object.getOwnPropertyNames(capsule), Object.getOwnPropertySymbols(capsule)], [null, true, [], []]);

    const session = activateStagedWebServerSession(capsule);
    assert.ok(session);
    assert.equal(session.authChannel, 'web');
    assert.equal(session.userId, 'staged-user');
    assert.equal(getSession(session.id), session);
    assert.equal(activateStagedWebServerSession(capsule), null);
});

test('staged Web sessions deny abort, user invalidation, clear, restart, and hostile capsules', () => {
    const aborted = stageWebServerSession({ id: 'abort-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    const invalidated = stageWebServerSession({ id: 'invalidate-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    const cleared = stageWebServerSession({ id: 'clear-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    assert.ok(aborted && invalidated && cleared);

    assert.equal(abortStagedWebServerSession(aborted), true);
    assert.equal(abortStagedWebServerSession(aborted), false);
    assert.equal(activateStagedWebServerSession(aborted), null);
    invalidateSessionsForUser('invalidate-user');
    assert.equal(activateStagedWebServerSession(invalidated), null);
    clearAllSessions();
    assert.equal(activateStagedWebServerSession(cleared), null);

    const copied = Object.assign(Object.create(null), cleared);
    const proxied = new Proxy(cleared, {});
    const forged = Object.freeze(Object.create(null));
    assert.equal(activateStagedWebServerSession(copied), null);
    assert.equal(activateStagedWebServerSession(proxied), null);
    assert.equal(activateStagedWebServerSession(forged), null);

    const nodeRequire = createRequire(import.meta.url);
    const modulePath = nodeRequire.resolve('./server-session.ts');
    const originalModule = nodeRequire.cache[modulePath];
    try {
        const restartCapsule = stageWebServerSession({ id: 'restart-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
        assert.ok(restartCapsule);
        delete nodeRequire.cache[modulePath];
        const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.activateStagedWebServerSession(restartCapsule), null);
        restarted.clearAllSessions();
    } finally {
        if (originalModule) nodeRequire.cache[modulePath] = originalModule;
        else delete nodeRequire.cache[modulePath];
    }
});

test('staging accepts only exact data values and never reads hostile accessors or thenables', () => {
    let accessorReads = 0;
    const accessorUser = Object.create(Object.prototype, {
        id: { enumerable: true, get: () => { accessorReads += 1; return 'hostile'; } },
        username: { enumerable: true, value: SYNTHETIC_USERNAME },
        role: { enumerable: true, value: 'clinician' },
    });
    const thenable = Object.create(null, {
        then: { enumerable: true, get: () => { accessorReads += 1; throw new Error('must not assimilate'); } },
    });

    assert.equal(stageWebServerSession(accessorUser), null);
    assert.equal(stageWebServerSession(thenable), null);
    assert.equal(accessorReads, 0);
    assert.equal(stageWebServerSession({ id: 'extra-user', username: SYNTHETIC_USERNAME, role: 'clinician', authChannel: 'native' }), null);
});

test('an expired staged Web session is denied before publication', () => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath]; const ttl = process.env.MEDIFLOW_SESSION_TTL_MS;
    let isolated: typeof import('./server-session') | undefined;
    try { process.env.MEDIFLOW_SESSION_TTL_MS = '0'; delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session'); const capsule = isolated.stageWebServerSession({ id: 'expired-user', username: SYNTHETIC_USERNAME, role: 'clinician' }); assert.ok(capsule); assert.equal(isolated.activateStagedWebServerSession(capsule), null); }
    finally { isolated?.clearAllSessions(); if (ttl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = ttl; if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
});

test('an entropy collision burns the capsule without replacing the live session', () => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath]; const cryptoModule = nodeRequire('node:crypto'); const randomBytes = cryptoModule.randomBytes;
    let isolated: typeof import('./server-session') | undefined;
    try { cryptoModule.randomBytes = () => Buffer.alloc(32, 7); delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session'); const live = isolated.createSession({ id: 'live-user', username: SYNTHETIC_USERNAME, role: 'clinician' }); const capsule = isolated.stageWebServerSession({ id: 'staged-user', username: SYNTHETIC_USERNAME, role: 'clinician' }); assert.ok(capsule); assert.equal(isolated.activateStagedWebServerSession(capsule), null); assert.equal(isolated.getSession(live.id), live); assert.equal(isolated.activateStagedWebServerSession(capsule), null); }
    finally { cryptoModule.randomBytes = randomBytes; isolated?.clearAllSessions(); if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
});

test('staging and activation use captured intrinsics after ambient poisoning', () => {
    const weakMapPrototype = WeakMap.prototype;
    const bufferPrototype = Buffer.prototype;
    const originals = {
        weakMapGet: weakMapPrototype.get,
        weakMapSet: weakMapPrototype.set,
        objectCreate: Object.create,
        objectFreeze: Object.freeze,
        objectGetOwnPropertyNames: Object.getOwnPropertyNames,
        objectGetOwnPropertySymbols: Object.getOwnPropertySymbols,
        bufferToString: bufferPrototype.toString,
    };
    const user = { id: 'intrinsics-user', username: SYNTHETIC_USERNAME, role: 'clinician' };
    let poisonedCalls = 0;
    let session: ReturnType<typeof activateStagedWebServerSession>;
    const poison = () => { poisonedCalls += 1; throw new Error('synthetic ambient intrinsic'); };

    try {
        weakMapPrototype.get = poison as typeof weakMapPrototype.get;
        weakMapPrototype.set = poison as typeof weakMapPrototype.set;
        Object.create = poison as typeof Object.create;
        Object.freeze = poison as typeof Object.freeze;
        Object.getOwnPropertyNames = poison as typeof Object.getOwnPropertyNames;
        Object.getOwnPropertySymbols = poison as typeof Object.getOwnPropertySymbols;
        bufferPrototype.toString = poison as typeof bufferPrototype.toString;

        const capsule = stageWebServerSession(user);
        session = activateStagedWebServerSession(capsule);
    } finally {
        weakMapPrototype.get = originals.weakMapGet;
        weakMapPrototype.set = originals.weakMapSet;
        Object.create = originals.objectCreate;
        Object.freeze = originals.objectFreeze;
        Object.getOwnPropertyNames = originals.objectGetOwnPropertyNames;
        Object.getOwnPropertySymbols = originals.objectGetOwnPropertySymbols;
        bufferPrototype.toString = originals.bufferToString;
    }

    assert.ok(session);
    assert.equal(getSession(session.id), session);
    assert.equal(poisonedCalls, 0);
});

test('does not trust global registry pointers across module wrappers', () => {
    const sessionGlobals = globalThis as typeof globalThis & {
        __mediflowSessions?: Map<string, unknown>;
        __mediflowSessionResources?: Map<string, unknown>;
    };
    const sessionsDescriptor = Object.getOwnPropertyDescriptor(sessionGlobals, '__mediflowSessions');
    const resourcesDescriptor = Object.getOwnPropertyDescriptor(sessionGlobals, '__mediflowSessionResources');
    const forgedSessions = new Map<string, unknown>();
    const forgedResources = new Map<string, unknown>();
    const nodeRequire = createRequire(import.meta.url);
    const modulePath = nodeRequire.resolve('./server-session.ts');
    const originalModule = nodeRequire.cache[modulePath];
    let secondary: typeof import('./server-session') | undefined;

    try {
        forgedSessions.set('forged-session', Object.freeze({ id: 'forged-session' }));
        sessionGlobals.__mediflowSessions = forgedSessions;
        sessionGlobals.__mediflowSessionResources = forgedResources;

        const primary = syntheticSession();
        assert.equal(forgedSessions.has(primary.id), false);
        assert.equal(getSession('forged-session'), null);
        deleteSession(primary.id);
        assert.equal(getSession(primary.id), null);

        delete nodeRequire.cache[modulePath];
        secondary = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(secondary.getSession(primary.id), null);
        const secondSession = secondary.createSession({ id: 'user-secondary', username: SYNTHETIC_USERNAME, role: 'clinician' });
        assert.equal(getSession(secondSession.id), null);
        secondary.clearAllSessions();
    } finally {
        if (sessionsDescriptor) Object.defineProperty(sessionGlobals, '__mediflowSessions', sessionsDescriptor);
        else delete sessionGlobals.__mediflowSessions;
        if (resourcesDescriptor) Object.defineProperty(sessionGlobals, '__mediflowSessionResources', resourcesDescriptor);
        else delete sessionGlobals.__mediflowSessionResources;
        secondary?.clearAllSessions();
        if (originalModule) nodeRequire.cache[modulePath] = originalModule;
        else delete nodeRequire.cache[modulePath];
    }
});

test('keeps session state isolated from post-load ambient intrinsics', () => {
    const mapPrototype = Map.prototype;
    const setPrototype = Set.prototype;
    const arrayPrototype = Array.prototype;
    const mapIteratorPrototype = Object.getPrototypeOf(new Map().keys());
    const setIteratorPrototype = Object.getPrototypeOf(new Set().values());
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
        mapIteratorNext: mapIteratorPrototype.next,
        setAdd: setPrototype.add,
        setDelete: setPrototype.delete,
        setValues: setPrototype.values,
        setIteratorNext: setIteratorPrototype.next,
        setSize: Object.getOwnPropertyDescriptor(setPrototype, 'size')!,
        dateNow: originalDateNow,
        functionCall: Function.prototype.call,
        functionApply: Function.prototype.apply,
        functionBind: Function.prototype.bind,
        reflectApply: Reflect.apply,
        objectGetPrototypeOf: Object.getPrototypeOf,
        objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
        arrayPush: arrayPrototype.push,
        arrayIterator: arrayPrototype[Symbol.iterator],
    };
    const now = originalDateNow();
    const distantFuture = now + 1000 * 60 * 60 * 24 * 365;
    let poisonedCalls = 0;
    let live: ReturnType<typeof createSession> | undefined;
    let expiryAfterZero = 0; let expiryAfterInfinity = 0; let expiryAfterFuture = 0;
    let deleted = false; let invalidated = false; let cleared = false; let expiredRemainsClosed = false;
    let disposerCalls = 0; let disposerReason: string | undefined;
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
        mapIteratorPrototype.next = poison as typeof mapIteratorPrototype.next;
        setPrototype.add = poison as typeof setPrototype.add;
        setPrototype.delete = poison as typeof setPrototype.delete;
        setPrototype.values = poison as typeof setPrototype.values;
        setIteratorPrototype.next = poison as typeof setIteratorPrototype.next;
        Object.defineProperty(setPrototype, 'size', { ...originals.setSize, get: poison });
        Date.now = () => 0;
        Function.prototype.call = poison as typeof Function.prototype.call;
        Function.prototype.apply = poison as typeof Function.prototype.apply;
        Function.prototype.bind = poison as typeof Function.prototype.bind;
        Reflect.apply = poison as typeof Reflect.apply;
        Object.getPrototypeOf = poison as typeof Object.getPrototypeOf;
        Object.getOwnPropertyDescriptor = poison as typeof Object.getOwnPropertyDescriptor;
        arrayPrototype.push = poison as typeof arrayPrototype.push;
        arrayPrototype[Symbol.iterator] = poison as typeof arrayPrototype[typeof Symbol.iterator];

        live = syntheticSession();
        assert.equal(getSession(live.id), live);
        assert.equal(peekSession(live.id), live);
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

        const expiredSession = syntheticSession();
        expiredSession.expiresAt = 0;
        assert.equal(getSession(expiredSession.id), null);
        expiredRemainsClosed = peekSession(expiredSession.id) === null;

        const invalidatedSession = createSession({ id: 'user-synthetic-invalidate', username: SYNTHETIC_USERNAME, role: 'clinician' });
        invalidateSessionsForUser('user-synthetic-invalidate');
        invalidated = getSession(invalidatedSession.id) === null;

        const clearedSession = syntheticSession();
        const unregister = registerServerSessionResource(clearedSession.id, () => { disposerCalls += 1; disposerReason = 'unregistered'; });
        unregister?.();
        registerServerSessionResource(clearedSession.id, (reason) => { disposerCalls += 1; disposerReason = reason; });
        clearAllSessions();
        cleared = getSession(clearedSession.id) === null;

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
        mapIteratorPrototype.next = originals.mapIteratorNext;
        setPrototype.add = originals.setAdd;
        setPrototype.delete = originals.setDelete;
        setPrototype.values = originals.setValues;
        setIteratorPrototype.next = originals.setIteratorNext;
        Object.defineProperty(setPrototype, 'size', originals.setSize);
        Date.now = originals.dateNow;
        Function.prototype.call = originals.functionCall;
        Function.prototype.apply = originals.functionApply;
        Function.prototype.bind = originals.functionBind;
        Reflect.apply = originals.reflectApply;
        Object.getPrototypeOf = originals.objectGetPrototypeOf;
        Object.getOwnPropertyDescriptor = originals.objectGetOwnPropertyDescriptor;
        arrayPrototype.push = originals.arrayPush;
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
    assert.equal(expiredRemainsClosed, true);
    assert.deepEqual({ disposerCalls, disposerReason }, { disposerCalls: 1, disposerReason: 'sessions_cleared' });
    assert.equal(poisonedCalls, 0);
});
