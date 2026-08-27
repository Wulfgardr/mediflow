/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import test from 'node:test';

type AuthContext = Readonly<{ session: object; owner: object }>;
type Hook = (() => void) | undefined;
type State = {
    session: Record<string, unknown>; sessionResult: unknown; cookieResult: unknown; cookieRecord: unknown;
    user: Record<string, unknown>; userResult: unknown; owner: Record<string, unknown>; ownerResult: unknown;
    cookiesCalls: number; cookieGetCalls: number; getSessionCalls: number; getCalls: number;
    deleteSessionCalls: number; acquireCalls: number; onCookies: Hook; onCookieGet: Hook; onGetSession: Hook;
    onGet: Hook; onDeleteSession: Hook; onAcquire: Hook;
};

const session = { id: 'session.synthetic.auth', userId: 'user.synthetic.auth', username: ['synthetic', '-user'].join(''), role: 'doctor', authChannel: 'web', createdAt: 1, expiresAt: 9_999_999_999_999 };
const owner = {
    snapshotSelectionEpoch() { return 1; }, snapshotReviewContextEpoch() { return 1; }, acquireProjectionIngest() { return null; },
    resolveProjectionService() { return null; }, issueSelection() { return null; }, dereferenceSelection() { return null; },
    withLeaseCriticalSection() { return null; }, dispose() { return undefined; },
} as Record<string, unknown>;
const state = {
    session, sessionResult: session as unknown, cookieResult: undefined, cookieRecord: { name: 'mediflow_session', value: session.id },
    user: { id: session.userId, username: session.username, role: session.role }, userResult: undefined, owner, ownerResult: owner,
    cookiesCalls: 0, cookieGetCalls: 0, getSessionCalls: 0, getCalls: 0, deleteSessionCalls: 0, acquireCalls: 0,
    onCookies: undefined, onCookieGet: undefined, onGetSession: undefined, onGet: undefined, onDeleteSession: undefined, onAcquire: undefined,
} as State;
const cookieStore = { get: () => { state.cookieGetCalls += 1; state.onCookieGet?.(); return state.cookieRecord; } };

const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = moduleApi._load;
let acquire: () => Promise<AuthContext | null>;
moduleApi._load = function (request, parent, isMain) {
    if (request === 'server-only') return {};
    if (request === 'next/headers') return { cookies: () => { state.cookiesCalls += 1; state.onCookies?.(); return state.cookieResult; } };
    if (request === 'next/server') return { NextResponse: { json: () => null } };
    if (request === 'drizzle-orm') return { eq: () => ({}) };
    if (request === '@/lib/db-server') return { dbServer: { select: () => ({ from: () => ({ where: () => ({ get: () => { state.getCalls += 1; state.onGet?.(); return state.userResult; } }) }) }) } };
    if (request === '@/lib/schema') return { users: { id: 'id', username: ['user', 'name'].join(''), role: 'role' } };
    if (request === '@/lib/security/server-session') return {
        SESSION_COOKIE_NAME: 'mediflow_session', getSession: () => { state.getSessionCalls += 1; state.onGetSession?.(); return state.sessionResult; },
        peekSession: () => state.sessionResult, deleteSession: () => { state.deleteSessionCalls += 1; state.onDeleteSession?.(); },
    };
    if (request === '@/lib/security/server-session-projection-owner-production') return { serverSessionProjectionOwnerRegistry: { acquire: () => { state.acquireCalls += 1; state.onAcquire?.(); return state.ownerResult; } } };
    if (request === '@/lib/security/local-api-auth') return { requireLocalApiToken: () => null };
    return originalLoad.call(this, request, parent, isMain);
};
try { acquire = (createRequire(import.meta.url)('./server-auth') as { acquireAuthenticatedWebSessionProjectionOwnerContext: typeof acquire }).acquireAuthenticatedWebSessionProjectionOwnerContext; }
finally { moduleApi._load = originalLoad; }

function reset(): void {
    state.sessionResult = session; state.cookieResult = Promise.resolve(cookieStore); state.cookieRecord = { name: 'mediflow_session', value: session.id };
    state.userResult = state.user; state.ownerResult = owner;
    state.cookiesCalls = 0; state.cookieGetCalls = 0; state.getSessionCalls = 0; state.getCalls = 0; state.deleteSessionCalls = 0; state.acquireCalls = 0;
    state.onCookies = undefined; state.onCookieGet = undefined; state.onGetSession = undefined; state.onGet = undefined; state.onDeleteSession = undefined; state.onAcquire = undefined;
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

test('fenced private acquisition preserves ordinary identities with synchronous DB', { concurrency: false }, async () => {
    reset(); const result = await acquire(); assertContext(result); assert.equal(result.session, session); assert.equal(result.owner, owner);
    assert.deepEqual([state.cookiesCalls, state.cookieGetCalls, state.getSessionCalls, state.getCalls, state.acquireCalls], [1, 1, 1, 1, 1]);
});

test('unsafe pre-entry Object.prototype.then denies before cookies without reads or unhandled rejection', { concurrency: false }, async () => {
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

test('requires a same-realm native cookie Promise and consumes native rejection', { concurrency: false }, async () => {
    class CookiePromise<T> extends Promise<T> {}
    const invalid: unknown[] = [new CookiePromise((resolve) => resolve(cookieStore)), new Proxy(Promise.resolve(cookieStore), {}), Object.create(Promise.prototype), { get then() { throw new Error('thenable read'); } }];
    for (const value of invalid) {
        reset(); state.cookieResult = value; const result = await noUnhandled(acquire); assert.equal(result.value, null); assert.deepEqual(result.unhandled, []); assert.equal(state.cookieGetCalls, 0);
    }
    reset(); state.cookieResult = Promise.reject(new Error('synthetic cookie failure')); const rejected = await noUnhandled(acquire);
    assert.equal(rejected.value, null); assert.deepEqual(rejected.unhandled, []); assert.equal(state.cookieGetCalls, 0);
});

test('fails closed for missing, expired, user-missing and database failure states', { concurrency: false }, async () => {
    reset(); state.cookieRecord = undefined; assert.equal(await acquire(), null); assert.equal(state.getSessionCalls, 0);
    reset(); state.sessionResult = { ...session, expiresAt: 0 }; assert.equal(await acquire(), null); assert.equal(state.getCalls, 0);
    reset(); state.userResult = undefined; assert.equal(await acquire(), null); assert.equal(state.deleteSessionCalls, 1);
    reset(); state.onGet = () => { throw new Error('synthetic DB failure'); }; assert.equal(await acquire(), null); assert.equal(state.acquireCalls, 0);
    reset(); state.ownerResult = null; assert.equal(await acquire(), null); assert.equal(state.acquireCalls, 1);
});

test('uses captured construction intrinsics and keeps public requireSession separate', { concurrency: false }, async () => {
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
});
