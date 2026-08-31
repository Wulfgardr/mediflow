/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import test, { describe } from 'node:test';

type AuthContext = Readonly<{ session: object; owner: object }>;
type SessionReader = () => Promise<Record<string, unknown> | null>;
type Hook = (() => void) | undefined;
type State = {
    projection: Record<string, unknown>;
    resolution: unknown;
    bearerCookie: unknown;
    controlCookie: unknown;
    cookieResult: unknown;
    user: Record<string, unknown>;
    userResult: unknown;
    owner: Record<string, unknown>;
    ownerResult: unknown;
    tokenError: unknown;
    cookiesCalls: number;
    cookieGetNames: unknown[];
    resolveArgs: unknown[][];
    retireArgs: unknown[];
    getCalls: number;
    acquireArgs: unknown[];
    onCookies: Hook;
    onCookieGet: Hook;
    onResolve: Hook;
    onEq: Hook;
    onSelect: Hook;
    onFrom: Hook;
    onWhere: Hook;
    onGet: Hook;
    onRetire: Hook;
    onAcquire: Hook;
};

const SESSION_ID = 'a'.repeat(64);
const CONTROL_ID = 'c'.repeat(64);

function sealed<Value extends Record<string, unknown>>(values: Value): Readonly<Value> {
    return Object.freeze(Object.assign(Object.create(null), values)) as Readonly<Value>;
}

const projection = sealed({
    id: SESSION_ID,
    userId: 'synthetic-auth-user',
    username: 'synthetic-auth-operator',
    role: 'doctor',
    authChannel: 'web',
    createdAt: 1,
    expiresAt: 9_999_999_999_999,
});
const owner = {
    snapshotSelectionEpoch() { return 1; },
    snapshotReviewContextEpoch() { return 1; },
    acquireProjectionIngest() { return null; },
    resolveProjectionService() { return null; },
    issueSelection() { return null; },
    dereferenceSelection() { return null; },
    withLeaseCriticalSection() { return null; },
    dispose() { return undefined; },
} as Record<string, unknown>;
const state = {
    projection,
    resolution: sealed({ status: 'active', projection }),
    bearerCookie: { name: 'mediflow_session', value: SESSION_ID },
    controlCookie: { name: 'mediflow_auth_control', value: CONTROL_ID },
    cookieResult: undefined,
    user: { id: projection.userId, username: projection.username, role: projection.role },
    userResult: undefined,
    owner,
    ownerResult: owner,
    tokenError: null,
    cookiesCalls: 0,
    cookieGetNames: [],
    resolveArgs: [],
    retireArgs: [],
    getCalls: 0,
    acquireArgs: [],
    onCookies: undefined,
    onCookieGet: undefined,
    onResolve: undefined,
    onEq: undefined,
    onSelect: undefined,
    onFrom: undefined,
    onWhere: undefined,
    onGet: undefined,
    onRetire: undefined,
    onAcquire: undefined,
} as State;

const cookieStore = {
    get(name: unknown) {
        state.cookieGetNames.push(name);
        state.onCookieGet?.();
        if (name === 'mediflow_session') return state.bearerCookie;
        if (name === 'mediflow_auth_control') return state.controlCookie;
        return undefined;
    },
};

const moduleApi = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = moduleApi._load;
let acquire: () => Promise<AuthContext | null>;
let requireSession: SessionReader;
let readAuthenticatedWebSession: SessionReader;
let requireSessionOrLocalToken: (request: Request) => Promise<Record<string, unknown> | null>;
let requireLocalApiActorSession: (request: Request) => Promise<Record<string, unknown> | null>;
moduleApi._load = function (request, parent, isMain) {
    if (request === 'server-only') return {};
    if (request === 'next/headers') return {
        cookies: () => { state.cookiesCalls += 1; state.onCookies?.(); return state.cookieResult; },
    };
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
    if (request === '@/lib/schema') return { users: { id: 'id', username: 'username', role: 'role' } };
    if (request === '@/lib/security/web-auth-lifecycle-owner-adapter') return {
        resolve: (sessionId: unknown, controlId: unknown) => {
            state.resolveArgs.push([sessionId, controlId]);
            state.onResolve?.();
            return state.resolution;
        },
        retireForUser: (presented: unknown) => {
            state.retireArgs.push(presented);
            state.onRetire?.();
            return sealed({ outcome: 'completed' });
        },
    };
    if (request === '@/lib/security/server-session-projection-owner-production') return {
        serverSessionProjectionOwnerRegistry: {
            acquire: (presented: unknown) => {
                state.acquireArgs.push(presented);
                state.onAcquire?.();
                return state.ownerResult;
            },
        },
    };
    if (request === '@/lib/security/local-api-auth') return { requireLocalApiToken: () => state.tokenError };
    return originalLoad.call(this, request, parent, isMain);
};
try {
    const loaded = createRequire(import.meta.url)('./server-auth.ts') as {
        acquireAuthenticatedWebSessionProjectionOwnerContext: () => Promise<AuthContext | null>;
        requireSession: SessionReader;
        readAuthenticatedWebSession: SessionReader;
        requireSessionOrLocalToken: (request: Request) => Promise<Record<string, unknown> | null>;
        requireLocalApiActorSession: (request: Request) => Promise<Record<string, unknown> | null>;
    };
    acquire = loaded.acquireAuthenticatedWebSessionProjectionOwnerContext;
    requireSession = loaded.requireSession;
    readAuthenticatedWebSession = loaded.readAuthenticatedWebSession;
    requireSessionOrLocalToken = loaded.requireSessionOrLocalToken;
    requireLocalApiActorSession = loaded.requireLocalApiActorSession;
} finally {
    moduleApi._load = originalLoad;
}

function reset(): void {
    state.resolution = sealed({ status: 'active', projection });
    state.bearerCookie = { name: 'mediflow_session', value: SESSION_ID };
    state.controlCookie = { name: 'mediflow_auth_control', value: CONTROL_ID };
    state.cookieResult = Promise.resolve(cookieStore);
    state.userResult = state.user;
    state.ownerResult = owner;
    state.tokenError = null;
    state.cookiesCalls = 0;
    state.cookieGetNames = [];
    state.resolveArgs = [];
    state.retireArgs = [];
    state.getCalls = 0;
    state.acquireArgs = [];
    state.onCookies = undefined;
    state.onCookieGet = undefined;
    state.onResolve = undefined;
    state.onEq = undefined;
    state.onSelect = undefined;
    state.onFrom = undefined;
    state.onWhere = undefined;
    state.onGet = undefined;
    state.onRetire = undefined;
    state.onAcquire = undefined;
}

const initialThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
function restoreThen(): void {
    if (initialThen) Object.defineProperty(Object.prototype, 'then', initialThen);
    else Reflect.deleteProperty(Object.prototype, 'then');
}

async function noUnhandled(action: () => Promise<unknown>): Promise<{ value: unknown; unhandled: unknown[] }> {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', listener);
    let value: unknown;
    try {
        value = await action();
        await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
        process.off('unhandledRejection', listener);
    }
    return { value, unhandled };
}

function assertContext(value: unknown): asserts value is AuthContext {
    assert.ok(value);
    assert.equal(Object.getPrototypeOf(value), null);
    assert.equal(Object.isFrozen(value), true);
    assert.deepEqual(Reflect.ownKeys(value), ['session', 'owner']);
    const context = value as AuthContext;
    assert.equal(context.session, projection);
    assert.equal(context.owner, owner);
}

describe('external Web owner server-auth boundary', { concurrency: 1 }, () => {
    test('all Web readers require both cookies and return the exact active projection', async () => {
        for (const reader of [requireSession, readAuthenticatedWebSession]) {
            reset();
            assert.equal(await reader(), projection);
            assert.deepEqual(state.cookieGetNames, ['mediflow_session', 'mediflow_auth_control']);
            assert.deepEqual(state.resolveArgs, [[SESSION_ID, CONTROL_ID]]);
            assert.equal(state.getCalls, 1);
            assert.deepEqual(state.retireArgs, []);
        }
    });

    test('accepts framework-normalized root-path cookies at the public Web session gates', async () => {
        for (const reader of [requireSession, readAuthenticatedWebSession]) {
            reset();
            state.bearerCookie = { name: 'mediflow_session', value: SESSION_ID, path: '/' };
            state.controlCookie = { name: 'mediflow_auth_control', value: CONTROL_ID, path: '/' };
            assert.equal(await reader(), projection);
            assert.deepEqual(state.resolveArgs, [[SESSION_ID, CONTROL_ID]]);
            assert.equal(state.getCalls, 1);
        }
        reset();
        state.bearerCookie = { name: 'mediflow_session', value: SESSION_ID, path: '/' };
        state.controlCookie = { name: 'mediflow_auth_control', value: CONTROL_ID, path: '/' };
        assertContext(await acquire());
    });

    test('tri-state denial and either missing cookie stop before the database', async () => {
        for (const resolution of [sealed({ status: 'absent' }), sealed({ status: 'owned_denied' })]) {
            reset(); state.resolution = resolution;
            assert.equal(await requireSession(), null);
            assert.equal(state.getCalls, 0);
        }
        reset(); state.bearerCookie = undefined;
        assert.equal(await readAuthenticatedWebSession(), null);
        assert.deepEqual(state.resolveArgs, []);
        reset(); state.controlCookie = undefined;
        assert.equal(await requireSession(), null);
        assert.deepEqual(state.resolveArgs, []);
    });

    test('database disagreement retires by the exact authentic projection', async () => {
        for (const user of [
            undefined,
            { ...state.user, username: 'different-synthetic-user' },
            { ...state.user, role: 'admin' },
            { ...state.user, id: 'different-synthetic-id' },
        ]) {
            reset(); state.userResult = user;
            assert.equal(await requireSession(), null);
            assert.deepEqual(state.retireArgs, [projection]);
            assert.deepEqual(state.acquireArgs, []);
        }
        reset(); state.userResult = { ...state.user, role: null };
        assert.equal(await requireSession(), projection);
        assert.deepEqual(state.retireArgs, []);
        reset(); state.userResult = undefined; state.onRetire = () => { throw new Error('synthetic cleanup failure'); };
        const observed = await noUnhandled(requireSession);
        assert.equal(observed.value, null);
        assert.deepEqual(observed.unhandled, []);
        assert.deepEqual(state.retireArgs, [projection]);
    });

    test('private acquisition publishes only the exact projection and registry owner', async () => {
        reset();
        const context = await acquire();
        assertContext(context);
        assert.deepEqual(state.resolveArgs, [[SESSION_ID, CONTROL_ID]]);
        assert.deepEqual(state.acquireArgs, [projection]);
        assert.equal(state.cookieGetNames.length, 2);
    });

    test('hostile cookies and malformed active resolutions deny without publication', async () => {
        let traps = 0;
        let reads = 0;
        const proxy = new Proxy({ name: 'mediflow_session', value: SESSION_ID }, {
            get() { traps += 1; throw new Error('trap'); },
            ownKeys() { traps += 1; throw new Error('trap'); },
        });
        const accessor = { name: 'mediflow_session', value: SESSION_ID };
        Object.defineProperty(accessor, 'value', { enumerable: true, get() { reads += 1; return SESSION_ID; } });
        const pathAccessor = { name: 'mediflow_session', value: SESSION_ID };
        Object.defineProperty(pathAccessor, 'path', { enumerable: true, get() { reads += 1; return '/'; } });
        for (const cookie of [
            proxy,
            accessor,
            pathAccessor,
            { name: 'mediflow_session', value: SESSION_ID, extra: true },
            { name: 'mediflow_session', value: SESSION_ID, path: '/restricted' },
            { name: 'mediflow_session', value: SESSION_ID, path: '/', extra: true },
        ]) {
            reset(); state.bearerCookie = cookie;
            assert.equal(await acquire(), null);
            assert.deepEqual(state.resolveArgs, []);
        }
        assert.deepEqual([traps, reads], [0, 0]);
        for (const resolution of [
            { status: 'active', projection },
            sealed({ status: 'active', projection: { ...projection } }),
            sealed({ status: 'active', projection: sealed({ ...projection, authChannel: 'native' }) }),
            sealed({ status: 'active', projection: sealed({ ...projection, expiresAt: 0 }) }),
        ]) {
            reset(); state.resolution = resolution;
            assert.equal(await acquire(), null);
            assert.deepEqual(state.acquireArgs, []);
        }
    });

    test('H1a rejects ambient poison and consumes a native cookie rejection', async () => {
        reset();
        const preEntry = await noUnhandled(async () => {
            Object.defineProperty(Object.prototype, 'then', { configurable: true, value: () => undefined, writable: true });
            try { return await acquire(); } finally { restoreThen(); }
        });
        assert.equal(preEntry.value, null);
        assert.deepEqual(preEntry.unhandled, []);
        assert.equal(state.cookiesCalls, 0);

        reset(); state.cookieResult = Promise.reject(new Error('synthetic cookie failure'));
        const rejected = await noUnhandled(acquire);
        assert.equal(rejected.value, null);
        assert.deepEqual(rejected.unhandled, []);
        assert.deepEqual(state.resolveArgs, []);

        reset(); state.onResolve = () => {
            Object.defineProperty(Object.prototype, 'then', { configurable: true, value: () => undefined, writable: true });
        };
        const reentered = await noUnhandled(async () => {
            try { return await acquire(); } finally { restoreThen(); }
        });
        assert.equal(reentered.value, null);
        assert.deepEqual(reentered.unhandled, []);
        assert.deepEqual(state.acquireArgs, []);
    });

    test('local-token and native actor paths retain their separate fallback', async () => {
        const request = new Request('http://127.0.0.1/api/v1/synthetic');
        reset(); state.bearerCookie = undefined; state.controlCookie = undefined;
        const system = await requireSessionOrLocalToken(request);
        assert.equal(system?.authChannel, 'system');
        assert.equal(system?.id, 'local-api');
        reset(); state.bearerCookie = undefined; state.controlCookie = undefined; state.tokenError = new Response(null, { status: 401 });
        assert.equal(await requireSessionOrLocalToken(request), null);
        reset();
        const native = await requireLocalApiActorSession(request);
        assert.equal(native?.authChannel, 'native');
        assert.equal(native?.id, `native:${projection.userId}`);
        assert.equal(native?.userId, projection.userId);
    });

    test('source imports only the external Web owner for Web lifecycle authority', () => {
        const source = readFileSync(new URL('./server-auth.ts', import.meta.url), 'utf8');
        assert.match(source, /from '@\/lib\/security\/web-auth-lifecycle-owner-adapter'/u);
        assert.match(source, /resolveWebSession\(sessionId, controlId\)/u);
        assert.match(source, /retireWebSessionsForProjectionUser\(projection\)/u);
        assert.doesNotMatch(source, /from '@\/lib\/security\/server-session'/u);
        assert.doesNotMatch(source, /\b(?:resolveActiveWebServerSession|retireWebP3SessionsForUser|getSession|peekSession|deleteSession)\b/u);
    });
});
