/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test, { describe } from 'node:test';

type AuthContext = Readonly<{ session: object; owner: object }>;
type SessionReader = () => Promise<object | null>;
type Hook = (() => void) | undefined;
type State = {
    session: Record<string, unknown>; sessionResult: unknown; cookieResult: unknown; cookieRecord: unknown;
    user: Record<string, unknown>; userResult: unknown; owner: Record<string, unknown>; ownerResult: unknown;
    cookiesCalls: number; cookieGetCalls: number; resolveCalls: number; getCalls: number;
    retireCalls: number; retiredUserIds: unknown[]; acquireCalls: number; onCookies: Hook; onCookieGet: Hook; onResolve: Hook;
    onEq: Hook; onSelect: Hook; onFrom: Hook; onWhere: Hook; onGet: Hook; onRetire: Hook; onAcquire: Hook;
};

const session = Object.freeze({ id: 'session.synthetic.auth', userId: 'user.synthetic.auth', username: ['synthetic', '-user'].join(''), role: 'doctor', authChannel: 'web', createdAt: 1, expiresAt: 9_999_999_999_999 });
const owner = {
    snapshotSelectionEpoch() { return 1; }, snapshotReviewContextEpoch() { return 1; }, acquireProjectionIngest() { return null; },
    resolveProjectionService() { return null; }, issueSelection() { return null; }, dereferenceSelection() { return null; },
    withLeaseCriticalSection() { return null; }, dispose() { return undefined; },
} as Record<string, unknown>;
const state = {
    session, sessionResult: session as unknown, cookieResult: undefined, cookieRecord: { name: 'mediflow_session', value: session.id },
    user: { id: session.userId, username: session.username, role: session.role }, userResult: undefined, owner, ownerResult: owner,
    cookiesCalls: 0, cookieGetCalls: 0, resolveCalls: 0, getCalls: 0, retireCalls: 0, retiredUserIds: [], acquireCalls: 0,
    onCookies: undefined, onCookieGet: undefined, onResolve: undefined, onEq: undefined, onSelect: undefined, onFrom: undefined,
    onWhere: undefined, onGet: undefined, onRetire: undefined, onAcquire: undefined,
} as State;
const cookieStore = { get: () => { state.cookieGetCalls += 1; state.onCookieGet?.(); return state.cookieRecord; } };

const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = moduleApi._load;
let acquire: () => Promise<AuthContext | null>;
let requireSession: SessionReader;
let readAuthenticatedWebSession: SessionReader;
moduleApi._load = function (request, parent, isMain) {
    if (request === 'server-only') return {};
    if (request === 'next/headers') return { cookies: () => { state.cookiesCalls += 1; state.onCookies?.(); return state.cookieResult; } };
    if (request === 'next/server') return { NextResponse: { json: () => null } };
    if (request === 'drizzle-orm') return { eq: () => { state.onEq?.(); return {}; } };
    if (request === '@/lib/db-server') {
        return {
            dbServer: {
                select() {
                    state.onSelect?.();
                    return {
                        from() {
                            state.onFrom?.();
                            return {
                                where() {
                                    state.onWhere?.();
                                    return { get() { state.getCalls += 1; state.onGet?.(); return state.userResult; } };
                                },
                            };
                        },
                    };
                },
            },
        };
    }
    if (request === '@/lib/schema') return { users: { id: 'id', username: ['user', 'name'].join(''), role: 'role' } };
    if (request === '@/lib/security/server-session') return {
        SESSION_COOKIE_NAME: 'mediflow_session',
        resolveActiveWebServerSession: () => { state.resolveCalls += 1; state.onResolve?.(); return state.sessionResult; },
        retireWebP3SessionsForUser: (userId: unknown) => { state.retireCalls += 1; state.retiredUserIds.push(userId); state.onRetire?.(); return { outcome: 'completed' }; },
    };
    if (request === '@/lib/security/server-session-projection-owner-production') return { serverSessionProjectionOwnerRegistry: { acquire: () => { state.acquireCalls += 1; state.onAcquire?.(); return state.ownerResult; } } };
    if (request === '@/lib/security/local-api-auth') return { requireLocalApiToken: () => null };
    return originalLoad.call(this, request, parent, isMain);
};
try {
    const loaded = createRequire(import.meta.url)('./server-auth.ts') as {
        acquireAuthenticatedWebSessionProjectionOwnerContext: () => Promise<AuthContext | null>;
        requireSession: SessionReader;
        readAuthenticatedWebSession: SessionReader;
    };
    acquire = loaded.acquireAuthenticatedWebSessionProjectionOwnerContext;
    requireSession = loaded.requireSession;
    readAuthenticatedWebSession = loaded.readAuthenticatedWebSession;
}
finally { moduleApi._load = originalLoad; }

function reset(): void {
    state.sessionResult = session; state.cookieResult = Promise.resolve(cookieStore); state.cookieRecord = { name: 'mediflow_session', value: session.id };
    state.userResult = state.user; state.ownerResult = owner;
    state.cookiesCalls = 0; state.cookieGetCalls = 0; state.resolveCalls = 0; state.getCalls = 0; state.retireCalls = 0; state.retiredUserIds = []; state.acquireCalls = 0;
    state.onCookies = undefined; state.onCookieGet = undefined; state.onResolve = undefined; state.onEq = undefined; state.onSelect = undefined;
    state.onFrom = undefined; state.onWhere = undefined; state.onGet = undefined; state.onRetire = undefined; state.onAcquire = undefined;
}

const initialThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
function restoreThen(): void { if (initialThen) Object.defineProperty(Object.prototype, 'then', initialThen); else Reflect.deleteProperty(Object.prototype, 'then'); }
async function noUnhandled(action: () => Promise<unknown>): Promise<{ value: unknown; unhandled: unknown[] }> {
    const unhandled: unknown[] = []; const listener = (reason: unknown) => { unhandled.push(reason); }; process.on('unhandledRejection', listener);
    let value: unknown;
    try { value = await action(); await new Promise<void>((resolve) => setImmediate(resolve)); }
    finally { process.off('unhandledRejection', listener); }
    return { value, unhandled };
}
function assertContext(value: unknown): asserts value is AuthContext {
    assert.ok(value); assert.equal(Object.getPrototypeOf(value), null); assert.equal(Object.isFrozen(value), true); assert.deepEqual(Reflect.ownKeys(value), ['session', 'owner']);
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, 'session'), { value: session, writable: false, enumerable: true, configurable: false });
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, 'owner'), { value: owner, writable: false, enumerable: true, configurable: false });
}

const serialActions: Array<{ name: string; action: () => Promise<void> }> = [];
function serialTest(name: string, options: { concurrency?: boolean }, action: () => Promise<void>): void {
    void options;
    serialActions.push({ name, action });
}

describe('H1b auth-context adversarial matrix', { concurrency: 1 }, () => {
serialTest('fenced private acquisition preserves ordinary identities with synchronous DB', { concurrency: false }, async () => {
    reset(); const result = await acquire(); assertContext(result); assert.equal(result.session, session); assert.equal(result.owner, owner);
    assert.deepEqual([state.cookiesCalls, state.cookieGetCalls, state.resolveCalls, state.getCalls, state.acquireCalls], [1, 1, 1, 1, 1]);
});

serialTest('all Web consumers return only the frozen exact ACTIVE session', { concurrency: false }, async () => {
    const descriptors = Reflect.ownKeys(session).map((key) => [key, Object.getOwnPropertyDescriptor(session, key)] as const);
    for (const reader of [requireSession, readAuthenticatedWebSession]) {
        reset(); const result = await reader(); assert.equal(result, session); assert.equal(state.resolveCalls, 1); assert.equal(state.retireCalls, 0);
        assert.deepEqual(Reflect.ownKeys(session).map((key) => [key, Object.getOwnPropertyDescriptor(session, key)] as const), descriptors);
    }
    reset(); const context = await acquire(); assertContext(context); assert.equal(state.resolveCalls, 1); assert.equal(state.retireCalls, 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(Reflect.ownKeys(session).map((key) => [key, Object.getOwnPropertyDescriptor(session, key)] as const), descriptors);
});

serialTest('unsafe pre-entry Object.prototype.then denies before cookies without reads or unhandled rejection', { concurrency: false }, async () => {
    const descriptors: PropertyDescriptor[] = [
        { configurable: true, get: () => { throw new Error('ambient then'); } },
        { configurable: true, value: () => 'ambient', writable: true },
        { configurable: true, get: () => Promise.reject(new Error('ambient rejection')) },
    ];
    for (const descriptor of descriptors) {
        reset(); const result = await noUnhandled(async () => { Object.defineProperty(Object.prototype, 'then', descriptor); try { return await acquire(); } finally { restoreThen(); } });
        assert.equal(result.value, null); assert.deepEqual(result.unhandled, []); assert.equal(state.cookiesCalls, 0); assert.equal(state.cookieGetCalls, 0);
    }
});

serialTest('requires a same-realm native cookie Promise and consumes native rejection', { concurrency: false }, async () => {
    class CookiePromise<T> extends Promise<T> {}
    const invalid: unknown[] = [new CookiePromise((resolve) => resolve(cookieStore)), new Proxy(Promise.resolve(cookieStore), {}), Object.create(Promise.prototype), { get then() { throw new Error('thenable read'); } }];
    for (const value of invalid) {
        reset(); state.cookieResult = value; const result = await noUnhandled(acquire); assert.equal(result.value, null); assert.deepEqual(result.unhandled, []); assert.equal(state.cookieGetCalls, 0);
    }
    reset(); state.cookieResult = Promise.reject(new Error('synthetic cookie failure')); const rejected = await noUnhandled(acquire);
    assert.equal(rejected.value, null); assert.deepEqual(rejected.unhandled, []); assert.equal(state.cookieGetCalls, 0);
});

serialTest('fails closed for missing, expired, user-missing and database failure states', { concurrency: false }, async () => {
    reset(); state.cookieRecord = undefined; assert.equal(await acquire(), null); assert.equal(state.resolveCalls, 0);
    reset(); state.sessionResult = { ...session, expiresAt: 0 }; assert.equal(await acquire(), null); assert.equal(state.getCalls, 0);
    reset(); state.userResult = undefined; assert.equal(await acquire(), null); assert.equal(state.retireCalls, 1);
    reset(); state.onGet = () => { throw new Error('synthetic DB failure'); }; assert.equal(await acquire(), null); assert.equal(state.acquireCalls, 0);
    reset(); state.ownerResult = null; assert.equal(await acquire(), null); assert.equal(state.acquireCalls, 1);
});

serialTest('rejects legacy, armed, retired, expired, wrong-cookie, native and system resolver results', { concurrency: false }, async () => {
    const denied = [
        null,
        { ...session, authChannel: 'native' },
        { ...session, authChannel: 'system' },
        { ...session, expiresAt: 0 },
    ];
    for (const value of denied) {
        for (const reader of [requireSession, readAuthenticatedWebSession]) {
            reset(); state.sessionResult = value; assert.equal(await reader(), null); assert.equal(state.getCalls, 0); assert.equal(state.retireCalls, 0);
        }
        reset(); state.sessionResult = value; assert.equal(await acquire(), null); assert.equal(state.getCalls, 0); assert.equal(state.acquireCalls, 0);
    }
    reset(); state.cookieRecord = { name: 'mediflow_session', value: 'legacy-map-collision' };
    assert.equal(await requireSession(), null); assert.equal(state.resolveCalls, 1); assert.equal(state.getCalls, 0);
    reset(); state.cookieRecord = { name: 'mediflow_session', value: session.id }; state.sessionResult = null;
    assert.equal(await readAuthenticatedWebSession(), null); assert.equal(state.resolveCalls, 1); assert.equal(state.getCalls, 0);
});

serialTest('missing or drifting canonical user identity retires only same-user P3 authority', { concurrency: false }, async () => {
    const mismatches: unknown[] = [
        undefined,
        { ...state.user, username: ['different', 'synthetic', 'user'].join('.') },
        { ...state.user, role: 'admin' },
        { ...state.user, id: 'different.synthetic.id' },
    ];
    for (const user of mismatches) {
        for (const reader of [requireSession, readAuthenticatedWebSession]) {
            reset(); state.userResult = user; assert.equal(await reader(), null); assert.equal(state.retireCalls, 1); assert.equal(state.acquireCalls, 0);
        }
        reset(); state.userResult = user; assert.equal(await acquire(), null); assert.equal(state.retireCalls, 1); assert.equal(state.acquireCalls, 0);
        assert.deepEqual(state.retiredUserIds, [session.userId]);
    }
    reset(); state.userResult = { ...state.user, role: null }; assert.equal(await requireSession(), session); assert.equal(state.retireCalls, 0);
    reset(); state.onRetire = () => { throw new Error('synthetic P3 retirement failure'); }; state.userResult = undefined;
    const observed = await noUnhandled(requireSession); assert.equal(observed.value, null); assert.deepEqual(observed.unhandled, []); assert.equal(state.retireCalls, 1);
    assert.deepEqual(state.retiredUserIds, [session.userId]);

    let proxyReads = 0; let accessorReads = 0;
    const proxy = new Proxy({ ...state.user }, { get() { proxyReads += 1; throw new Error('proxy row'); } });
    const accessor = { ...state.user };
    Object.defineProperty(accessor, 'username', { configurable: true, enumerable: true, get() { accessorReads += 1; return session.username; } });
    const thenable = { ...state.user, then() { throw new Error('row thenable'); } };
    for (const hostile of [proxy, accessor, thenable]) {
        reset(); state.userResult = hostile; const result = await noUnhandled(acquire);
        assert.equal(result.value, null); assert.deepEqual(result.unhandled, []); assert.equal(state.retireCalls, 1); assert.equal(state.acquireCalls, 0);
    }
    assert.equal(proxyReads, 0); assert.equal(accessorReads, 0);

    const source = readFileSync(new URL('./server-auth.ts', import.meta.url), 'utf8');
    assert.match(source, /resolveActiveWebServerSession/u); assert.match(source, /retireWebP3SessionsForUser/u);
    assert.doesNotMatch(source, /\b(?:getSession|peekSession|deleteSession)\b/u);
    reset(); state.onResolve = () => { Object.defineProperty(Object.prototype, 'then', { configurable: true, value: () => undefined, writable: true }); };
    const reentered = await noUnhandled(async () => { try { return await acquire(); } finally { restoreThen(); } });
    assert.equal(reentered.value, null); assert.deepEqual(reentered.unhandled, []); assert.equal(state.acquireCalls, 0);
});

serialTest('rejects hostile database rows without mutating or publishing the active session', { concurrency: false }, async () => {
    let proxyReads = 0; let accessorReads = 0;
    const proxy = new Proxy({ ...state.user }, { get() { proxyReads += 1; throw new Error('proxy row'); } });
    const accessor = { ...state.user };
    Object.defineProperty(accessor, 'username', { configurable: true, enumerable: true, get() { accessorReads += 1; return session.username; } });
    const thenable = { ...state.user, then() { throw new Error('row thenable'); } };
    for (const user of [proxy, accessor, thenable]) {
        reset(); state.userResult = user; const observed = await noUnhandled(acquire);
        assert.equal(observed.value, null); assert.deepEqual(observed.unhandled, []); assert.equal(state.retireCalls, 1); assert.equal(state.acquireCalls, 0);
    }
    assert.equal(proxyReads, 0); assert.equal(accessorReads, 0);
});

serialTest('uses captured construction intrinsics and keeps public requireSession separate', { concurrency: false }, async () => {
    reset(); const originals = { create: Object.create, define: Object.defineProperty, freeze: Object.freeze }; let result: AuthContext | null = null;
    try {
        Object.create = (() => { throw new Error('poisoned create'); }) as typeof Object.create;
        Object.defineProperty = (() => { throw new Error('poisoned define'); }) as typeof Object.defineProperty;
        Object.freeze = (() => { throw new Error('poisoned freeze'); }) as typeof Object.freeze;
        result = await acquire();
    } finally { Object.create = originals.create; Object.defineProperty = originals.define; Object.freeze = originals.freeze; restoreThen(); }
    assertContext(result);
    const source = readFileSync(new URL('./server-auth.ts', import.meta.url), 'utf8'); const start = source.indexOf('export async function acquireAuthenticatedWebSessionProjectionOwnerContext'); const end = source.indexOf('export async function acquireAuthenticatedWebSessionProjectionOwner()', start);
    assert.ok(start >= 0 && end > start); assert.doesNotMatch(source.slice(start, end), /requireSession/u); assert.match(source, /export async function requireSession\(\): Promise<ServerSession \| null>/u);
    assert.match(source, /resolveActiveWebServerSession/u); assert.match(source, /retireWebP3SessionsForUser/u);
    assert.doesNotMatch(source, /\b(?:getSession|peekSession|deleteSession)\b/u);
    const poisonAmbientThen = (): void => {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, value: () => undefined, writable: true });
    };
    const stages = ['onCookies', 'onCookieGet', 'onResolve', 'onEq', 'onSelect', 'onFrom', 'onWhere', 'onGet', 'onRetire', 'onAcquire'] as const;
    for (const stage of stages) {
        reset();
        if (stage === 'onRetire') state.userResult = undefined;
        state[stage] = poisonAmbientThen;
        const observed = await noUnhandled(async () => { try { return await acquire(); } finally { restoreThen(); } });
        assert.equal(observed.value, null); assert.deepEqual(observed.unhandled, []);
        if (stage !== 'onAcquire') assert.equal(state.acquireCalls, 0);
        if (stage !== 'onCookies') assert.equal(state.cookiesCalls, 1);
        if (stage === 'onCookieGet') assert.equal(state.cookieGetCalls, 1);
        if (stage === 'onResolve') assert.equal(state.resolveCalls, 1);
        if (stage === 'onRetire') assert.equal(state.retireCalls, 1);
        if (stage === 'onAcquire') assert.equal(state.acquireCalls, 1);
    }

    reset();
    const settledCookieStore = { then: undefined, get: cookieStore.get };
    state.cookieResult = new Promise((resolve) => queueMicrotask(() => { poisonAmbientThen(); resolve(settledCookieStore); }));
    const observed = await noUnhandled(async () => { try { return await acquire(); } finally { restoreThen(); } });
    assert.equal(observed.value, null); assert.deepEqual(observed.unhandled, []);
    assert.equal(state.cookiesCalls, 1); assert.equal(state.cookieGetCalls, 0); assert.equal(state.resolveCalls, 0); assert.equal(state.acquireCalls, 0);

    class CookiePromise<T> extends Promise<T> {}
    let thenReads = 0;
    const factories: Array<() => unknown> = [
        () => runInNewContext('Promise.resolve({})'),
        () => runInNewContext('Promise.reject(new Error("synthetic rejection"))'),
        () => new CookiePromise((resolve) => resolve(cookieStore)),
        () => new CookiePromise((_, reject) => reject(new Error('synthetic subclass rejection'))),
        () => new Proxy(Promise.resolve(cookieStore), {}),
        () => new Proxy(Promise.resolve(cookieStore), { get() { throw new Error('proxy read'); } }),
        () => Object.create(Promise.prototype),
        () => ({ get then() { thenReads += 1; throw new Error('thenable read'); } }),
    ];
    for (const factory of factories) {
        reset();
        const observed = await noUnhandled(() => { state.cookieResult = factory(); return acquire(); });
        assert.equal(observed.value, null); assert.deepEqual(observed.unhandled, []);
        assert.equal(state.cookieGetCalls, 0); assert.equal(state.resolveCalls, 0); assert.equal(state.acquireCalls, 0);
    }
    assert.equal(thenReads, 0);

    let proxyTraps = 0; let accessorReads = 0;
    const proxy = new Proxy({ name: 'mediflow_session', value: session.id }, {
        get() { proxyTraps += 1; throw new Error('proxy read'); }, ownKeys() { proxyTraps += 1; return []; },
    });
    const accessor = { name: 'mediflow_session', value: session.id };
    Object.defineProperty(accessor, 'value', { configurable: true, enumerable: true, get() { accessorReads += 1; return session.id; } });
    const nonEnumerable = { name: 'mediflow_session', value: session.id };
    Object.defineProperty(nonEnumerable, 'value', { configurable: true, enumerable: false, writable: true, value: session.id });
    const customPrototype = Object.assign(Object.create({ inherited: true }), { name: 'mediflow_session', value: session.id });
    const extra = { name: 'mediflow_session', value: session.id, extra: true };
    const symbolic = { name: 'mediflow_session', value: session.id, [Symbol('synthetic')]: true };
    for (const record of [proxy, accessor, nonEnumerable, customPrototype, extra, symbolic]) {
        reset(); state.cookieRecord = record;
        const observed = await noUnhandled(acquire);
        assert.equal(observed.value, null); assert.deepEqual(observed.unhandled, []); assert.equal(state.resolveCalls, 0); assert.equal(state.acquireCalls, 0);
    }
    assert.equal(proxyTraps, 0); assert.equal(accessorReads, 0);

    reset();
    const intrinsicOriginals = {
        own: Object.getOwnPropertyDescriptor, proto: Object.getPrototypeOf, apply: Reflect.apply, keys: Reflect.ownKeys,
        now: Date.now, finite: Number.isFinite,
    };
    let intrinsicResult: AuthContext | null = null;
    try {
        Object.getOwnPropertyDescriptor = (() => { throw new Error('poisoned descriptor'); }) as typeof Object.getOwnPropertyDescriptor;
        Object.getPrototypeOf = (() => { throw new Error('poisoned prototype'); }) as typeof Object.getPrototypeOf;
        Reflect.apply = (() => { throw new Error('poisoned apply'); }) as typeof Reflect.apply;
        Reflect.ownKeys = (() => { throw new Error('poisoned keys'); }) as typeof Reflect.ownKeys;
        Date.now = (() => { throw new Error('poisoned clock'); }) as typeof Date.now;
        Number.isFinite = (() => { throw new Error('poisoned finite'); }) as typeof Number.isFinite;
        intrinsicResult = await acquire();
    } finally {
        Object.getOwnPropertyDescriptor = intrinsicOriginals.own; Object.getPrototypeOf = intrinsicOriginals.proto; Reflect.apply = intrinsicOriginals.apply; Reflect.ownKeys = intrinsicOriginals.keys;
        Date.now = intrinsicOriginals.now; Number.isFinite = intrinsicOriginals.finite; restoreThen();
    }
    assertContext(intrinsicResult); const snapshot = intrinsicResult; await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(intrinsicResult, snapshot); assertContext(intrinsicResult);
});
test('runs the H1b auth-context adversarial matrix serially', { concurrency: false }, async () => {
    for (const entry of serialActions) await entry.action();
});
});
