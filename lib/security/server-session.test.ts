/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';

import {
    abortActiveWebSessionResourceUse,
    abortPreparedWebServerSession,
    abortStagedWebServerSession,
    activateArmedWebServerSession,
    activateStagedWebServerSession,
    clearAllSessions,
    cleanupRetiredWebServerSession,
    commitPreparedWebServerSession,
    createNativeServerSession,
    createSession,
    deleteSession,
    dispatchActiveWebServerSessionRetirement,
    getSession,
    getPreparedWebServerSessionId,
    getArmedWebServerSessionId,
    invalidateSessionsForUser,
    mintActiveWebSessionResourcePort,
    armPreparedWebServerSession,
    beginActiveWebSessionResourceUse,
    commitActiveWebSessionResourceUse,
    prepareStagedWebServerSession,
    peekSession,
    registerServerSessionResource,
    releaseActiveWebSessionResourcePort,
    retireExpiredServerSession,
    retireActiveWebServerSession,
    retireServerSessionForApplicationLock,
    retireServerSessionForLogout,
    retireServerSessionsForUser,
    resolveActiveWebServerSession,
    stageWebServerSession,
    tombstoneArmedWebServerSession,
    type WebServerSessionRetirementCleanupReceipt,
} from './server-session';

const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;
const TARGET_USERNAME = ['synthetic', 'target'].join('-');
const OTHER_USERNAME = ['synthetic', 'other'].join('-');
const AUTH_CONTROL_MODULE_PATH = ['./web-auth-control', '-record.ts'].join('');

function authControlApi() {
    const api = createRequire(import.meta.url)(AUTH_CONTROL_MODULE_PATH) as {
        createWebAuthControlRecord(fence: string): {
            begin(kind: string, operation: string, key: string, fingerprint: string, at: number): { ok: boolean };
            snapshot(): { fence: string; generation: bigint; pending: boolean; active: boolean };
            [key: string]: unknown;
        };
        prepareAuthControlActivation(ticket: unknown, sessionId: string): unknown;
        prepareAuthControlRetirement(ticket: unknown, sessionId: string, reason: string): unknown;
        [key: string]: unknown;
    };
    const create = (fence: string) => {
        const record = api.createWebAuthControlRecord(fence);
        return {
            begin: record.begin,
            snapshot: record.snapshot,
            prepareTicket: (...args: [string, string, bigint, string, string, number]) => (
                record[['prepareAuth', 'ControlTicket'].join('')] as (...values: unknown[]) => unknown
            )(...args),
            retireTicket: (ticket: unknown, reason: unknown) => (
                api[['retireAuth', 'ControlTicket'].join('')] as (value: unknown, cause: unknown) => 0 | 1 | 2
            )(ticket, reason),
        };
    };
    return {
        create,
        prepareActivation: api.prepareAuthControlActivation,
        prepareRetirement: api.prepareAuthControlRetirement,
    };
}

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

test('a prepared Web session commits without exposing authority', () => {
    const staged = stageWebServerSession({ id: 'prepared-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    assert.ok(staged);
    const prepared = prepareStagedWebServerSession(staged);

    assert.ok(prepared);
    assert.deepEqual([Object.getPrototypeOf(prepared), Object.isFrozen(prepared), Object.getOwnPropertyNames(prepared), Object.getOwnPropertySymbols(prepared)], [null, true, [], []]);
    const sessionId = getPreparedWebServerSessionId(prepared);
    assert.ok(sessionId);
    assert.equal(getSession(sessionId), null);
    const originalBoolean = globalThis.Boolean; let committed = false;
    try { globalThis.Boolean = (() => { throw new Error('ambient Boolean must not run'); }) as unknown as BooleanConstructor; committed = commitPreparedWebServerSession(prepared); }
    finally { globalThis.Boolean = originalBoolean; }
    assert.equal(committed, true);
    assert.equal(typeof committed, 'boolean');
    const session = getSession(sessionId);
    assert.ok(session);
    assert.equal(session.id, sessionId);
    assert.equal(session.authChannel, 'web');
    assert.equal(getSession(session.id), session);
    assert.equal(getPreparedWebServerSessionId(prepared), null);
    assert.equal(commitPreparedWebServerSession(prepared), false);
});

test('an armed Web session cell burns its prepared capability without exposing authority', () => {
    const prepared = prepareStagedWebServerSession(stageWebServerSession({
        id: 'armed-user', username: SYNTHETIC_USERNAME, role: 'clinician',
    }));
    assert.ok(prepared);
    const sessionId = getPreparedWebServerSessionId(prepared);
    assert.ok(sessionId);

    const port = armPreparedWebServerSession(prepared);

    assert.ok(port);
    assert.deepEqual([
        Object.getPrototypeOf(port), Object.isFrozen(port),
        Object.getOwnPropertyNames(port), Object.getOwnPropertySymbols(port),
    ], [null, true, [], []]);
    assert.equal(getPreparedWebServerSessionId(prepared), null);
    assert.equal(commitPreparedWebServerSession(prepared), false);
    assert.equal(abortPreparedWebServerSession(prepared), false);
    assert.equal(getArmedWebServerSessionId(port), sessionId);
    assert.equal(getSession(sessionId), null);
    assert.equal(peekSession(sessionId), null);
    assert.equal(armPreparedWebServerSession(prepared), null);

    const nodeRequire = createRequire(import.meta.url); const cryptoModule = nodeRequire('node:crypto'); const randomBytes = cryptoModule.randomBytes;
    try {
        cryptoModule.randomBytes = () => Buffer.from(sessionId, 'hex');
        assert.throws(() => createSession({ id: 'collision-user', username: SYNTHETIC_USERNAME, role: 'clinician' }));
    } finally { cryptoModule.randomBytes = randomBytes; }
});

function armedControlActivation(userId = 'atomic-user') {
    const staged = stageWebServerSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' });
    const prepared = prepareStagedWebServerSession(staged); assert.ok(prepared);
    const sessionId = getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
    const port = armPreparedWebServerSession(prepared); assert.ok(port);
    const control = authControlApi().create('f0'); control.begin('login', 'op', 'key', 'fp', 0);
    const ticket = control.prepareTicket('f0', 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
    return { control, port, sessionId, ticket };
}

test('atomically splices one exact control CAS into an inert Web session cell', () => {
    const { control, port, sessionId, ticket } = armedControlActivation();

    assert.equal(activateArmedWebServerSession(port, ticket), true);
    assert.deepEqual(control.snapshot(), { fence: control.snapshot().fence, generation: BigInt(1), pending: false, active: true });
    assert.equal(getArmedWebServerSessionId(port), null, 'ACTIVE is no longer an armed capability');
    assert.equal(getSession(sessionId), null, 'P3b2b does not migrate the resolver');
    assert.equal(peekSession(sessionId), null);
    assert.equal(activateArmedWebServerSession(port, ticket), false, 'lost-response replay cannot duplicate activation');

    const source = readFileSync(fileURLToPath(new URL('./server-session.ts', import.meta.url)), 'utf8');
    const body = source.slice(source.indexOf('export function activateArmedWebServerSession'), source.indexOf('/** Canonically publishes'));
    const successfulCas = body.indexOf('if (commitPreparedAuthControlActivation(preparedActivation) === 1) {');
    const activeFlip = body.indexOf("cell.state = 'ACTIVE';", successfulCas);
    assert.ok(successfulCas >= 0 && activeFlip > successfulCas);
    assert.equal(body.slice(successfulCas + 'if (commitPreparedAuthControlActivation(preparedActivation) === 1) {'.length, activeFlip).trim(), '');
    assert.doesNotMatch(body.slice(activeFlip, body.indexOf('return true;', activeFlip)), /\w+\s*\(/u);
});

test('the trusted ACTIVE resolver returns only the exact P3 cell without legacy publication or sliding expiry', () => {
    const armed = armedControlActivation();
    assert.equal(resolveActiveWebServerSession(armed.sessionId), null);
    assert.equal(activateArmedWebServerSession(armed.port, armed.ticket), true);

    const session = resolveActiveWebServerSession(armed.sessionId);
    assert.ok(session);
    const expiry = session.expiresAt;
    assert.equal(session.id, armed.sessionId);
    assert.equal(session.authChannel, 'web');
    assert.equal(resolveActiveWebServerSession(armed.sessionId), session);
    assert.equal(session.expiresAt, expiry);
    assert.equal(Object.isFrozen(session), true);
    assert.equal(Object.getPrototypeOf(session), Object.prototype);
    const mutations: ReadonlyArray<readonly [keyof typeof session, unknown]> = [
        ['id', 'other-id'], ['userId', 'other-user'], ['username', 'other-name'], ['role', 'administrator'],
        ['authChannel', 'native'], ['createdAt', 0], ['expiresAt', expiry + 1],
    ];
    for (const [key, value] of mutations) {
        const descriptor = Object.getOwnPropertyDescriptor(session, key);
        assert.deepEqual({ enumerable: descriptor?.enumerable, configurable: descriptor?.configurable, writable: descriptor && 'writable' in descriptor ? descriptor.writable : undefined },
            { enumerable: true, configurable: false, writable: false });
        assert.throws(() => { (session as unknown as Record<string, unknown>)[key] = value; }, TypeError);
        assert.throws(() => Object.defineProperty(session, key, { value }), TypeError);
        assert.throws(() => { delete (session as unknown as Record<string, unknown>)[key]; }, TypeError);
    }
    assert.throws(() => Object.setPrototypeOf(session, null), TypeError);
    assert.equal(resolveActiveWebServerSession(armed.sessionId), session);
    assert.deepEqual({ id: session.id, userId: session.userId, username: session.username, role: session.role,
        authChannel: session.authChannel, createdAt: session.createdAt, expiresAt: session.expiresAt },
    { id: armed.sessionId, userId: 'atomic-user', username: SYNTHETIC_USERNAME, role: 'clinician',
        authChannel: 'web', createdAt: session.createdAt, expiresAt: expiry });
    assert.equal(getSession(armed.sessionId), null);
    assert.equal(peekSession(armed.sessionId), null);
});

test('mints and releases only a zero-field port for the exact ACTIVE session identity', async () => {
    const active = armedControlActivation(); assert.equal(activateArmedWebServerSession(active.port, active.ticket), true);
    const session = resolveActiveWebServerSession(active.sessionId); assert.ok(session);
    const port = mintActiveWebSessionResourcePort(session); assert.ok(port);
    assert.equal(Object.getPrototypeOf(port), null); assert.equal(Object.isFrozen(port), true); assert.deepEqual(Reflect.ownKeys(port), []);

    let observed = 0; const proxy = new Proxy(Object.create(null), { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('synthetic rejected port')); rejected.catch(() => undefined);
    const legacy = syntheticSession(); const clone = structuredClone(session); const spread = { ...session };
    const custom = Object.create({ inherited: true }); const armedOnly = armedControlActivation();
    for (const value of [null, undefined, '', {}, Object.create(null), proxy, accessor, Promise.resolve(), rejected,
        legacy, clone, spread, custom, armedOnly.port]) {
        assert.equal(mintActiveWebSessionResourcePort(value), null);
        assert.equal(releaseActiveWebSessionResourcePort(value), false);
    }
    const symbol = Object.create(null); Object.defineProperty(symbol, Symbol('hostile'), { value: true });
    const hidden = Object.create(null); Object.defineProperty(hidden, 'hidden', { value: true });
    assert.equal(releaseActiveWebSessionResourcePort(symbol), false); assert.equal(releaseActiveWebSessionResourcePort(hidden), false);

    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath];
    try { delete nodeRequire.cache[modulePath]; const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.mintActiveWebSessionResourcePort(session), null); assert.equal(restarted.releaseActiveWebSessionResourcePort(port), false); restarted.clearAllSessions();
    } finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }

    assert.equal(retireActiveWebServerSession(active.sessionId, 'dispose'), true);
    assert.equal(mintActiveWebSessionResourcePort(session), null);
    assert.equal(releaseActiveWebSessionResourcePort(port), true); assert.equal(releaseActiveWebSessionResourcePort(port), false);
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(observed, 0);
});

test('ACTIVE resource mint denies expiry and lifecycle reentry without releasing an existing port', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath];
    const originalNow = Date.now; const originalTtl = process.env.MEDIFLOW_SESSION_TTL_MS; let isolated: typeof import('./server-session') | undefined;
    let now = 1_000; let trigger = false; let nested: () => unknown = () => undefined; const unhandled: unknown[] = []; const onUnhandled = (value: unknown) => unhandled.push(value);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    try {
        process.env.MEDIFLOW_SESSION_TTL_MS = '10'; Date.now = () => { if (trigger) { trigger = false; nested(); } return now; };
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const staged = isolated.stageWebServerSession({ id: 'active-resource', username: SYNTHETIC_USERNAME, role: 'clinician' });
        const prepared = isolated.prepareStagedWebServerSession(staged); assert.ok(prepared); const sessionId = isolated.getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
        const armed = isolated.armPreparedWebServerSession(prepared); assert.ok(armed); const control = authControlApi().create('resource-fence'); control.begin('login', 'op', 'key', 'fp', 0);
        const ticket = control.prepareTicket('resource-fence', 'op', BigInt(0), 'fp', sessionId, now); assert.ok(ticket); assert.equal(isolated.activateArmedWebServerSession(armed, ticket), true);
        const session = isolated.resolveActiveWebServerSession(sessionId); assert.ok(session); const retained = isolated.mintActiveWebSessionResourcePort(session); assert.ok(retained);
        for (const operation of ['mint', 'release', 'delete', 'clear'] as const) {
            nested = () => operation === 'release' ? isolated!.releaseActiveWebSessionResourcePort(retained)
                : operation === 'mint' ? isolated!.mintActiveWebSessionResourcePort(session)
                : operation === 'delete' ? isolated!.deleteSession(sessionId) : isolated!.clearAllSessions();
            trigger = true; assert.equal(isolated.mintActiveWebSessionResourcePort(session), null); assert.equal(trigger, false);
        }
        assert.equal(isolated.releaseActiveWebSessionResourcePort(retained), true);
        now = session.expiresAt; assert.equal(isolated.mintActiveWebSessionResourcePort(session), null);
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally { trigger = false; Date.now = originalNow; isolated?.clearAllSessions();
        if (originalTtl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = originalTtl;
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
});

function activeResourceFixture(userId = 'atomic-user') {
    const active = armedControlActivation(userId);
    assert.equal(activateArmedWebServerSession(active.port, active.ticket), true);
    const session = resolveActiveWebServerSession(active.sessionId); assert.ok(session);
    const port = mintActiveWebSessionResourcePort(session); assert.ok(port);
    return { ...active, session, port };
}

test('ACTIVE resource uses are opaque, one-use, and commit-last without consumer effects', async () => {
    const active = activeResourceFixture();
    const first = beginActiveWebSessionResourceUse(active.port); assert.ok(first);
    assert.equal(Object.getPrototypeOf(first), null); assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(Reflect.ownKeys(first), []);

    let observed = 0;
    const proxy = new Proxy(Object.create(null), { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('synthetic rejected use')); rejected.catch(() => undefined);
    const clone = structuredClone(first); const spread = { ...first };
    for (const value of [null, undefined, {}, proxy, accessor, Promise.resolve(), rejected, clone, spread]) {
        assert.equal(commitActiveWebSessionResourceUse(value), false);
        assert.equal(abortActiveWebSessionResourceUse(value), false);
    }
    assert.equal(observed, 0);

    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath];
    try { delete nodeRequire.cache[modulePath]; const secondary = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(secondary.commitActiveWebSessionResourceUse(first), false); assert.equal(secondary.abortActiveWebSessionResourceUse(first), false); secondary.clearAllSessions();
    } finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }

    const originals = { weakGet: WeakMap.prototype.get, setDelete: Set.prototype.delete };
    const fail = () => { throw new Error('ambient collection poison'); };
    try { WeakMap.prototype.get = fail as typeof WeakMap.prototype.get; Set.prototype.delete = fail as typeof Set.prototype.delete;
        assert.equal(commitActiveWebSessionResourceUse(first), true);
    } finally { WeakMap.prototype.get = originals.weakGet; Set.prototype.delete = originals.setDelete; }
    assert.equal(commitActiveWebSessionResourceUse(first), false);
    assert.equal(abortActiveWebSessionResourceUse(first), false);

    const second = beginActiveWebSessionResourceUse(active.port); assert.ok(second);
    assert.equal(abortActiveWebSessionResourceUse(second), true);
    assert.equal(commitActiveWebSessionResourceUse(second), false);
    assert.equal(abortActiveWebSessionResourceUse(second), false);

    const released = activeResourceFixture(); const releasedUse = beginActiveWebSessionResourceUse(released.port); assert.ok(releasedUse);
    assert.equal(releaseActiveWebSessionResourcePort(released.port), true);
    assert.equal(commitActiveWebSessionResourceUse(releasedUse), false);
    assert.equal(beginActiveWebSessionResourceUse(released.port), null);

    const retired = activeResourceFixture(); const retiredUse = beginActiveWebSessionResourceUse(retired.port); assert.ok(retiredUse);
    assert.equal(retireActiveWebServerSession(retired.sessionId, 'dispose'), true);
    assert.equal(commitActiveWebSessionResourceUse(retiredUse), false);
    assert.equal(abortActiveWebSessionResourceUse(retiredUse), false);
    assert.equal(beginActiveWebSessionResourceUse(retired.port), null);
    assert.equal(releaseActiveWebSessionResourcePort(retired.port), true);
    assert.equal(releaseActiveWebSessionResourcePort(retired.port), false);
});

test('resource cleanup and expiry burn uses and deny new use without changing resolver semantics', async (t) => {
    for (const cleanup of ['delete', 'invalidate', 'clear'] as const) {
        const active = activeResourceFixture(); const use = beginActiveWebSessionResourceUse(active.port); assert.ok(use);
        if (cleanup === 'delete') deleteSession(active.sessionId);
        else if (cleanup === 'invalidate') invalidateSessionsForUser('atomic-user');
        else clearAllSessions();
        assert.equal(commitActiveWebSessionResourceUse(use), false);
        assert.equal(abortActiveWebSessionResourceUse(use), false);
        assert.equal(beginActiveWebSessionResourceUse(active.port), null);
        assert.equal(releaseActiveWebSessionResourcePort(active.port), true);
    }

    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalNow = Date.now; const originalTtl = process.env.MEDIFLOW_SESSION_TTL_MS;
    let isolated: typeof import('./server-session') | undefined; let now = 1_000; let trigger = false; let nested = () => undefined;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    try {
        process.env.MEDIFLOW_SESSION_TTL_MS = '10'; Date.now = () => { if (trigger) { trigger = false; nested(); } return now; }; delete nodeRequire.cache[modulePath];
        isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const staged = isolated.stageWebServerSession({ id: 'use-expiry', username: SYNTHETIC_USERNAME, role: 'clinician' });
        const prepared = isolated.prepareStagedWebServerSession(staged); assert.ok(prepared);
        const id = isolated.getPreparedWebServerSessionId(prepared); assert.ok(id);
        const armed = isolated.armPreparedWebServerSession(prepared); assert.ok(armed);
        const control = authControlApi().create('use-expiry-fence'); control.begin('login', 'op', 'key', 'fp', 0);
        const ticket = control.prepareTicket('use-expiry-fence', 'op', BigInt(0), 'fp', id, now); assert.ok(ticket);
        assert.equal(isolated.activateArmedWebServerSession(armed, ticket), true);
        const session = isolated.resolveActiveWebServerSession(id); assert.ok(session);
        const port = isolated.mintActiveWebSessionResourcePort(session); assert.ok(port);
        const reentryUse = isolated.beginActiveWebSessionResourceUse(port); assert.ok(reentryUse);
        nested = () => { isolated?.commitActiveWebSessionResourceUse(reentryUse); }; trigger = true;
        assert.equal(isolated.commitActiveWebSessionResourceUse(reentryUse), false);
        const use = isolated.beginActiveWebSessionResourceUse(port); assert.ok(use); now = session.expiresAt;
        assert.equal(isolated.commitActiveWebSessionResourceUse(use), false);
        assert.equal(isolated.abortActiveWebSessionResourceUse(use), false);
        assert.equal(isolated.beginActiveWebSessionResourceUse(port), null);
        isolated.releaseActiveWebSessionResourcePort(port); isolated.clearAllSessions();
    } finally {
        Date.now = originalNow;
        if (originalTtl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = originalTtl;
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
});

test('ACTIVE resource port has no callback surface or production importer before adoption', () => {
    const source = readFileSync(fileURLToPath(new URL('./server-session.ts', import.meta.url)), 'utf8');
    const mint = source.slice(source.indexOf('export function mintActiveWebSessionResourcePort'), source.indexOf('export function releaseActiveWebSessionResourcePort'));
    const release = source.slice(source.indexOf('export function releaseActiveWebSessionResourcePort'), source.indexOf('export function getSession'));
    const use = source.slice(source.indexOf('export function beginActiveWebSessionResourceUse'), source.indexOf('export function getSession'));
    const cleanup = source.slice(source.indexOf('export function cleanupRetiredWebServerSession'));
    const dispatch = source.slice(source.indexOf('export function dispatchActiveWebServerSessionRetirement'));
    assert.match(mint, /\(session: unknown\): ActiveWebSessionResourcePort \| null/u); assert.match(release, /\(port: unknown\): boolean/u);
    assert.match(use, /export function beginActiveWebSessionResourceUse\(port: unknown\): ActiveWebSessionResourceUse \| null/u);
    assert.match(use, /export function commitActiveWebSessionResourceUse\(use: unknown\): boolean/u);
    assert.match(use, /export function abortActiveWebSessionResourceUse\(use: unknown\): boolean/u);
    assert.doesNotMatch(`${mint}\n${release}\n${use}`, /\b(?:callback|dispose|Promise|async|then|setTimeout|setImmediate|queueMicrotask|nextTick|payload|effect|method)\b/u);
    assert.doesNotMatch(cleanup, /\b(?:DateNow|Promise|async|then|setTimeout|setImmediate|queueMicrotask|nextTick)\b/u);
    assert.match(dispatch, /retireActiveWebServerSession\(sessionId, reason\);\s*return cleanupRetiredWebServerSession\(sessionId, reason\);/u);
    assert.doesNotMatch(dispatch, /\b(?:callback|ticket|owner|session:|Promise|async|then|setTimeout|setImmediate|queueMicrotask|nextTick)\b/u);
    const paths = execFileSync('rg', ['-l', 'mintActiveWebSessionResourcePort|releaseActiveWebSessionResourcePort|beginActiveWebSessionResourceUse|commitActiveWebSessionResourceUse|abortActiveWebSessionResourceUse|cleanupRetiredWebServerSession|dispatchActiveWebServerSessionRetirement', '-g', '*.ts', '.'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((value) => value.replace(/^\.\//u, ''));
    assert.deepEqual(paths.sort(), ['lib/security/server-session.test.ts', 'lib/security/server-session.ts']);
});

test('compacts one exact RETIRED Web cell into a replay-stable PHI-safe tombstone receipt', () => {
    const active = activeResourceFixture();
    const pendingUse = beginActiveWebSessionResourceUse(active.port); assert.ok(pendingUse);
    assert.equal(retireActiveWebServerSession(active.sessionId, 'dispose'), true);

    const receipt = cleanupRetiredWebServerSession(active.sessionId, 'dispose');
    assert.equal(Object.getPrototypeOf(receipt), null);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(Reflect.ownKeys(receipt), ['outcome']);
    assert.deepEqual(Object.getOwnPropertyDescriptor(receipt, 'outcome'), {
        value: 'completed', enumerable: true, configurable: false, writable: false,
    });
    assert.equal(cleanupRetiredWebServerSession(active.sessionId, 'dispose'), receipt);
    assert.equal(cleanupRetiredWebServerSession(active.sessionId, 'lock').outcome, 'denied');
    assert.equal(commitActiveWebSessionResourceUse(pendingUse), false);
    assert.equal(abortActiveWebSessionResourceUse(pendingUse), false);
    assert.equal(releaseActiveWebSessionResourcePort(active.port), false);
    assert.equal(mintActiveWebSessionResourcePort(active.session), null);
    assert.equal(resolveActiveWebServerSession(active.sessionId), null);
});

test('dispatches one reason-bound ACTIVE retirement into a stable cleanup receipt', () => {
    const active = activeResourceFixture();
    const pendingUse = beginActiveWebSessionResourceUse(active.port); assert.ok(pendingUse);

    const receipt = dispatchActiveWebServerSessionRetirement(active.sessionId, 'dispose');
    assert.equal(receipt.outcome, 'completed');
    assert.equal(dispatchActiveWebServerSessionRetirement(active.sessionId, 'dispose'), receipt);
    assert.equal(dispatchActiveWebServerSessionRetirement(active.sessionId, 'lock').outcome, 'denied');
    assert.equal(commitActiveWebSessionResourceUse(pendingUse), false);
    assert.equal(releaseActiveWebSessionResourcePort(active.port), false);
    assert.equal(resolveActiveWebServerSession(active.sessionId), null);
});

test('fixed-cause adapters retire one exact P3 session without accepting caller authority', () => {
    const logout = activeResourceFixture();
    const logoutReceipt = retireServerSessionForLogout(logout.sessionId);
    assert.equal(logoutReceipt.outcome, 'completed');
    assert.equal(retireServerSessionForLogout(logout.sessionId), logoutReceipt, 'lost response replays one receipt');
    assert.equal(retireServerSessionForApplicationLock(logout.sessionId).outcome, 'denied');

    const locked = activeResourceFixture();
    assert.equal(retireServerSessionForApplicationLock(locked.sessionId).outcome, 'completed');
    const expired = activeResourceFixture();
    assert.equal(retireExpiredServerSession(expired.sessionId).outcome, 'failed');
    assert.equal(resolveActiveWebServerSession(expired.sessionId), null, 'wrong expiry timing fails closed');
});

test('fixed-cause adapters preserve legacy Web and native cleanup while leaving system authority untouched', () => {
    const events: string[] = [];
    const logout = syntheticSession();
    registerServerSessionResource(logout.id, (reason) => { events.push(`logout:${reason}`); });
    const logoutReceipt = retireServerSessionForLogout(logout.id);
    assert.equal(logoutReceipt.outcome, 'completed'); assert.equal(getSession(logout.id), null);

    const locked = createNativeServerSession(
        { id: 'native-lock', username: SYNTHETIC_USERNAME, role: 'clinician' },
        { clientId: 'synthetic-client', clientPlatform: 'macos' },
    );
    registerServerSessionResource(locked.id, (reason) => { events.push(`lock:${reason}`); });
    assert.equal(retireServerSessionForApplicationLock(locked.id).outcome, 'completed');
    assert.equal(getSession(locked.id), null);

    const expired = syntheticSession();
    registerServerSessionResource(expired.id, (reason) => { events.push(`expired:${reason}`); });
    expired.expiresAt = 0;
    assert.equal(retireExpiredServerSession(expired.id).outcome, 'completed');
    assert.equal(getSession(expired.id), null);

    const live = syntheticSession();
    assert.equal(retireExpiredServerSession(live.id).outcome, 'denied'); assert.equal(peekSession(live.id), live);
    const system = createSession({ id: 'system', username: SYNTHETIC_USERNAME, role: 'system' }, 'system');
    assert.equal(retireServerSessionForLogout(system.id).outcome, 'denied'); assert.equal(peekSession(system.id), system);
    assert.deepEqual(events, ['logout:session_deleted', 'lock:application_locked', 'expired:session_expired']);
    assert.equal(Object.getPrototypeOf(logoutReceipt), null); assert.equal(Object.isFrozen(logoutReceipt), true);
    assert.deepEqual(Reflect.ownKeys(logoutReceipt), ['outcome']);
});

test('fixed-cause adapters deny hostile and cross-module IDs without observation or later work', async (t) => {
    const active = activeResourceFixture(); let observed = 0;
    const proxy = new Proxy(Object.create(null), {
        get: () => { observed += 1; throw new Error('get'); },
        ownKeys: () => { observed += 1; throw new Error('keys'); },
    });
    const accessor = Object.create(null);
    Object.defineProperty(accessor, 'then', { get() { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('synthetic adapter input')); rejected.catch(() => undefined);
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of [null, undefined, '', {}, proxy, accessor, Promise.resolve(), rejected, '__proto__']) {
        assert.equal(retireServerSessionForLogout(value).outcome, 'denied');
        assert.equal(retireServerSessionForApplicationLock(value).outcome, 'denied');
        assert.equal(retireExpiredServerSession(value).outcome, 'denied');
    }
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try {
        delete nodeRequire.cache[modulePath]; const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.retireServerSessionForLogout(active.sessionId).outcome, 'denied');
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { observed += 1; throw new Error('ambient then'); } });
        assert.equal(retireServerSessionForLogout(active.sessionId).outcome, 'completed');
        restarted.clearAllSessions();
    } finally {
        if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen);
        else delete (Object.prototype as { then?: unknown }).then;
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []);
    const paths = execFileSync('rg', ['-l', 'retireServerSessionForLogout|retireServerSessionForApplicationLock|retireExpiredServerSession', '-g', '*.ts', '.'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean).map((value) => value.replace(/^\.\//u, '')).sort();
    assert.deepEqual(paths, ['lib/security/server-session.test.ts', 'lib/security/server-session.ts']);
});

test('fixed-cause P3 ownership wins over a colliding legacy Map entry and CAS drift stays terminal', async (t) => {
    const drifted = activeResourceFixture();
    assert.equal(drifted.control.retireTicket(drifted.ticket, 'delete'), 1);
    const failed = retireServerSessionForLogout(drifted.sessionId);
    assert.equal(failed.outcome, 'failed'); assert.equal(retireServerSessionForLogout(drifted.sessionId), failed);

    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalGet = Map.prototype.get; const originalSet = Map.prototype.set;
    let isolated: typeof import('./server-session') | undefined; let sessionId = ''; let collide = false;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    Map.prototype.get = function (key: unknown) {
        const prior = Reflect.apply(originalGet, this, [key]);
        if (collide && key === sessionId) {
            collide = false; Reflect.apply(originalSet, this, [key, Object.freeze({ id: sessionId })]);
        }
        return prior;
    };
    try {
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const staged = isolated.stageWebServerSession({ id: 'collision', username: SYNTHETIC_USERNAME, role: 'clinician' });
        const prepared = isolated.prepareStagedWebServerSession(staged); assert.ok(prepared);
        sessionId = isolated.getPreparedWebServerSessionId(prepared) ?? ''; const port = isolated.armPreparedWebServerSession(prepared); assert.ok(port);
        const control = authControlApi().create('fixed-collision'); control.begin('login', 'op', 'key', 'fp', 0);
        const ticket = control.prepareTicket('fixed-collision', 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
        assert.equal(isolated.activateArmedWebServerSession(port, ticket), true);
        const session = isolated.resolveActiveWebServerSession(sessionId); assert.ok(session);
        collide = true; assert.equal(isolated.mintActiveWebSessionResourcePort(session), null);
        assert.equal(isolated.retireServerSessionForLogout(sessionId).outcome, 'completed');
        assert.ok(isolated.peekSession(sessionId), 'P3 dispatch never falls back to deleting the colliding Map entry');
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally {
        collide = false; Map.prototype.get = originalGet; isolated?.clearAllSessions();
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('user-scoped retirement snapshots P3 targets before mutation and preserves legacy cleanup', () => {
    const active = activeResourceFixture('bulk-user');
    const retired = activeResourceFixture('bulk-user');
    assert.equal(retireActiveWebServerSession(retired.sessionId, 'dispose'), true);
    const other = activeResourceFixture('other-user');
    const armedStaged = stageWebServerSession({ id: 'bulk-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    assert.ok(armedStaged); const armedPrepared = prepareStagedWebServerSession(armedStaged); assert.ok(armedPrepared);
    const armedSessionId = getPreparedWebServerSessionId(armedPrepared); assert.ok(armedSessionId);
    const armedPort = armPreparedWebServerSession(armedPrepared); assert.ok(armedPort);
    const armedControl = authControlApi().create('bulk-armed'); armedControl.begin('login', 'op', 'key', 'fp', 0);
    const armedTicket = armedControl.prepareTicket('bulk-armed', 'op', BigInt(0), 'fp', armedSessionId, 1); assert.ok(armedTicket);
    const staged = stageWebServerSession({ id: 'bulk-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    assert.ok(staged);
    const prepared = prepareStagedWebServerSession(stageWebServerSession({ id: 'bulk-user', username: SYNTHETIC_USERNAME, role: 'clinician' }));
    assert.ok(prepared);
    const legacy = createSession({ id: 'bulk-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    const native = createNativeServerSession(
        { id: 'bulk-user', username: SYNTHETIC_USERNAME, role: 'clinician' },
        { clientId: 'bulk-client', clientPlatform: 'macos' },
    );
    const system = createSession({ id: 'bulk-user', username: SYNTHETIC_USERNAME, role: 'system' }, 'system');
    const events: string[] = [];
    registerServerSessionResource(legacy.id, (reason) => { events.push(`web:${reason}`); });
    registerServerSessionResource(native.id, (reason) => { events.push(`native:${reason}`); });

    const receipt = retireServerSessionsForUser('bulk-user');
    assert.equal(receipt.outcome, 'completed');
    assert.strictEqual(retireServerSessionsForUser('bulk-user'), receipt, 'lost response replay is stable');
    assert.equal(resolveActiveWebServerSession(active.sessionId), null);
    assert.equal(resolveActiveWebServerSession(retired.sessionId), null);
    assert.equal(activateArmedWebServerSession(armedPort, armedTicket), false, 'retained ticket cannot resurrect armed authority');
    assert.equal(getArmedWebServerSessionId(armedPort), null);
    assert.equal(getSession(legacy.id), null); assert.equal(getSession(native.id), null);
    assert.strictEqual(peekSession(system.id), system, 'system authority is outside the Web/native bulk');
    assert.equal(abortStagedWebServerSession(staged), false);
    assert.equal(getPreparedWebServerSessionId(prepared), null);
    assert.deepEqual(events, ['web:session_deleted', 'native:session_deleted']);
    assert.ok(resolveActiveWebServerSession(other.sessionId));
    assert.equal(Object.getPrototypeOf(receipt), null); assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(Reflect.ownKeys(receipt), ['outcome']);
});

test('user-scoped retirement preserves P3 ownership over a colliding legacy Map entry', () => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalValues = Map.prototype.values; const originalSet = Map.prototype.set;
    let isolated: typeof import('./server-session') | undefined; let sessionId = ''; let collide = false; let injected = false;
    try {
        Map.prototype.values = function () {
            if (collide && !injected) {
                injected = true;
                Reflect.apply(originalSet, this, [sessionId, Object.freeze({
                    id: sessionId, userId: 'collision-user', username: SYNTHETIC_USERNAME, role: 'clinician',
                    authChannel: 'web', createdAt: 0, expiresAt: Date.now() + 60_000,
                })]);
            }
            return Reflect.apply(originalValues, this, []);
        };
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const staged = isolated.stageWebServerSession({ id: 'collision-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
        assert.ok(staged); const prepared = isolated.prepareStagedWebServerSession(staged); assert.ok(prepared);
        sessionId = isolated.getPreparedWebServerSessionId(prepared) ?? ''; const port = isolated.armPreparedWebServerSession(prepared); assert.ok(port);
        const control = authControlApi().create('bulk-collision'); control.begin('login', 'op', 'key', 'fp', 0);
        const ticket = control.prepareTicket('bulk-collision', 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
        assert.equal(isolated.activateArmedWebServerSession(port, ticket), true);
        assert.ok(isolated.resolveActiveWebServerSession(sessionId));
        collide = true;
        assert.equal(isolated.retireServerSessionsForUser('collision-user').outcome, 'completed');
        assert.equal(isolated.resolveActiveWebServerSession(sessionId), null);
        assert.ok(isolated.peekSession(sessionId), 'P3 retirement must not fall back to the colliding Map entry');
    } finally {
        collide = false; Map.prototype.values = originalValues; isolated?.clearAllSessions();
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('user-scoped retirement attempts every target and aggregates the worst outcome', () => {
    const failed = activeResourceFixture('bulk-failure');
    const healthy = activeResourceFixture('bulk-failure');
    assert.equal(failed.control.retireTicket(failed.ticket, 'delete'), 1);
    const receipt = retireServerSessionsForUser('bulk-failure');
    assert.equal(receipt.outcome, 'failed');
    assert.equal(resolveActiveWebServerSession(healthy.sessionId), null, 'later target was attempted');
    assert.equal(resolveActiveWebServerSession(failed.sessionId), null);

    const throwing = createSession({ id: 'bulk-failure', username: SYNTHETIC_USERNAME, role: 'clinician' });
    const later = createSession({ id: 'bulk-failure', username: SYNTHETIC_USERNAME, role: 'clinician' });
    registerServerSessionResource(throwing.id, () => { throw new Error('synthetic cleanup failure'); });
    const second = retireServerSessionsForUser('bulk-failure');
    assert.equal(second.outcome, 'failed');
    assert.equal(getSession(throwing.id), null); assert.equal(getSession(later.id), null);
});

test('user-scoped retirement resists hostile IDs and legacy list mutation', async (t) => {
    const active = activeResourceFixture('hostile-user'); let observed = 0;
    const proxy = new Proxy(Object.create(null), { get() { observed += 1; throw new Error('get'); }, ownKeys() { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null);
    Object.defineProperty(accessor, 'then', { get() { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('synthetic rejected bulk input')); rejected.catch(() => undefined);
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of [null, undefined, '', {}, Object.create(null), proxy, accessor, Promise.resolve(), rejected]) {
        assert.equal(retireServerSessionsForUser(value).outcome, 'denied');
    }
    assert.equal(retireServerSessionsForUser('__proto__').outcome, 'completed');
    const first = createSession({ id: 'mutation-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    const second = createSession({ id: 'mutation-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
    let nestedOutcome: WebServerSessionRetirementCleanupReceipt['outcome'] | null = null;
    registerServerSessionResource(first.id, () => { nestedOutcome = retireServerSessionsForUser('mutation-user').outcome; });
    const outer = retireServerSessionsForUser('mutation-user');
    assert.equal(outer.outcome, 'completed'); assert.equal(nestedOutcome, 'completed');
    assert.equal(getSession(first.id), null); assert.equal(getSession(second.id), null);
    assert.ok(resolveActiveWebServerSession(active.sessionId));
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { observed += 1; throw new Error('ambient then'); } });
    try { assert.equal(retireServerSessionsForUser('missing-user').outcome, 'completed'); }
    finally { delete (Object.prototype as { then?: unknown }).then; }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []);
});

test('dispatch reports failed after an uncommitted P2 retirement and scrubs B1/B2 state', () => {
    const active = activeResourceFixture();
    const pendingUse = beginActiveWebSessionResourceUse(active.port); assert.ok(pendingUse);
    assert.equal(active.control.retireTicket(active.ticket, 'dispose'), 1, 'external P2 drift precedes dispatch');

    const failed = dispatchActiveWebServerSessionRetirement(active.sessionId, 'dispose');
    assert.equal(failed.outcome, 'failed');
    assert.equal(dispatchActiveWebServerSessionRetirement(active.sessionId, 'dispose'), failed);
    assert.equal(dispatchActiveWebServerSessionRetirement(active.sessionId, 'lock').outcome, 'denied');
    assert.equal(commitActiveWebSessionResourceUse(pendingUse), false);
    assert.equal(abortActiveWebSessionResourceUse(pendingUse), false);
    assert.equal(releaseActiveWebSessionResourcePort(active.port), false);
    assert.equal(mintActiveWebSessionResourcePort(active.session), null);
    assert.equal(resolveActiveWebServerSession(active.sessionId), null);
});

test('dispatch denies hostile and cross-module inputs without observation or later work', async (t) => {
    const active = activeResourceFixture(); let observed = 0;
    const proxy = new Proxy(Object.create(null), {
        get() { observed += 1; throw new Error('get'); },
        ownKeys() { observed += 1; throw new Error('keys'); },
    });
    const accessor = Object.create(null);
    Object.defineProperty(accessor, 'then', { get() { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('synthetic dispatch input')); rejected.catch(() => undefined);
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of [null, undefined, '', {}, proxy, accessor, Promise.resolve(), rejected, '__proto__']) {
        assert.equal(dispatchActiveWebServerSessionRetirement(value, 'dispose').outcome, 'denied');
        assert.equal(dispatchActiveWebServerSessionRetirement(active.sessionId, value).outcome, 'denied');
    }
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try {
        delete nodeRequire.cache[modulePath]; const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.dispatchActiveWebServerSessionRetirement(active.sessionId, 'dispose').outcome, 'denied');
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { observed += 1; throw new Error('ambient then'); } });
        assert.equal(dispatchActiveWebServerSessionRetirement(active.sessionId, 'dispose').outcome, 'completed');
        restarted.clearAllSessions();
    } finally {
        if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen);
        else delete (Object.prototype as { then?: unknown }).then;
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []);
});

test('dispatch cleanup fails terminally on captured WeakMap apply-then-throw and reentry', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalDelete = WeakMap.prototype.delete;
    let isolated: typeof import('./server-session') | undefined; let mode: 'idle' | 'throw' | 'reenter' = 'idle';
    let currentId = ''; let nestedOutcome = ''; const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason); process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    WeakMap.prototype.delete = function (key: object) {
        const result = Reflect.apply(originalDelete, this, [key]);
        if (mode === 'throw') { mode = 'idle'; throw new Error('synthetic post-delete failure'); }
        if (mode === 'reenter') { mode = 'idle'; nestedOutcome = isolated!.dispatchActiveWebServerSessionRetirement(currentId, 'dispose').outcome; }
        return result;
    };
    const make = () => {
        const staged = isolated!.stageWebServerSession({ id: `cleanup-${currentId || 'first'}`, username: SYNTHETIC_USERNAME, role: 'clinician' });
        const prepared = isolated!.prepareStagedWebServerSession(staged); assert.ok(prepared);
        currentId = isolated!.getPreparedWebServerSessionId(prepared) ?? ''; const port = isolated!.armPreparedWebServerSession(prepared); assert.ok(port);
        const control = authControlApi().create(`cleanup-${currentId}`); control.begin('login', 'op', `key-${currentId}`, `fp-${currentId}`, 0);
        const ticket = control.prepareTicket(`cleanup-${currentId}`, 'op', BigInt(0), `fp-${currentId}`, currentId, 1); assert.ok(ticket);
        assert.equal(isolated!.activateArmedWebServerSession(port, ticket), true); const session = isolated!.resolveActiveWebServerSession(currentId); assert.ok(session);
        const resource = isolated!.mintActiveWebSessionResourcePort(session); assert.ok(resource); const use = isolated!.beginActiveWebSessionResourceUse(resource); assert.ok(use);
        return { session, resource, use };
    };
    try {
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const first = make(); mode = 'throw'; const failed = isolated.dispatchActiveWebServerSessionRetirement(currentId, 'dispose'); assert.equal(failed.outcome, 'failed');
        assert.equal(isolated.dispatchActiveWebServerSessionRetirement(currentId, 'dispose'), failed);
        assert.equal(isolated.commitActiveWebSessionResourceUse(first.use), false); assert.equal(isolated.releaseActiveWebSessionResourcePort(first.resource), false);
        assert.equal(isolated.mintActiveWebSessionResourcePort(first.session), null);
        currentId = 'second'; make(); mode = 'reenter'; assert.equal(isolated.dispatchActiveWebServerSessionRetirement(currentId, 'dispose').outcome, 'failed');
        assert.equal(nestedOutcome, 'denied'); await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally { mode = 'idle'; WeakMap.prototype.delete = originalDelete; isolated?.clearAllSessions();
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
});

test('RETIRED cleanup denies hostile and cross-module inputs without observation or later work', async (t) => {
    const active = activeResourceFixture(); let observed = 0;
    const proxy = new Proxy(Object.create(null), { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('synthetic cleanup input')); rejected.catch(() => undefined);
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of [null, undefined, '', {}, proxy, accessor, Promise.resolve(), rejected, '__proto__']) {
        assert.equal(cleanupRetiredWebServerSession(value, 'dispose').outcome, 'denied');
    }
    assert.equal(cleanupRetiredWebServerSession(active.sessionId, 'dispose').outcome, 'denied');
    assert.equal(retireActiveWebServerSession(active.sessionId, 'dispose'), true);
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then'); const originalWeakDelete = WeakMap.prototype.delete;
    try { WeakMap.prototype.delete = (() => { observed += 1; throw new Error('ambient delete'); }) as typeof WeakMap.prototype.delete;
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { observed += 1; throw new Error('ambient then'); } });
        assert.equal(cleanupRetiredWebServerSession(active.sessionId, 'dispose').outcome, 'completed'); }
    finally { WeakMap.prototype.delete = originalWeakDelete;
        if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen); else delete (Object.prototype as { then?: unknown }).then; }
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath];
    try { delete nodeRequire.cache[modulePath]; const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.cleanupRetiredWebServerSession(active.sessionId, 'dispose').outcome, 'denied'); restarted.clearAllSessions(); }
    finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(observed, 0); assert.deepEqual(unhandled, []);
});

test('retires one exact ACTIVE cell through its retained control ticket', () => {
    const active = armedControlActivation(); assert.equal(activateArmedWebServerSession(active.port, active.ticket), true);
    assert.equal(retireActiveWebServerSession(active.sessionId, 'unknown'), false);
    assert.ok(resolveActiveWebServerSession(active.sessionId));
    assert.equal(retireActiveWebServerSession(active.sessionId, 'lock'), true);
    assert.equal(resolveActiveWebServerSession(active.sessionId), null);
    assert.equal(getSession(active.sessionId), null); assert.equal(peekSession(active.sessionId), null);
    assert.equal(retireActiveWebServerSession(active.sessionId, 'lock'), false);
    assert.equal(active.control.retireTicket(active.ticket, 'lock'), 2);
    assert.equal(active.control.retireTicket(active.ticket, 'dispose'), 0);

    const source = readFileSync(fileURLToPath(new URL('./server-session.ts', import.meta.url)), 'utf8');
    const body = source.slice(source.indexOf('export function retireActiveWebServerSession'), source.indexOf('/** Canonically publishes a prepared session'));
    const finalCas = 'const retirementResult = commitPreparedAuthControlRetirement(preparedRetirement);';
    const finalCasOffset = body.indexOf(finalCas);
    const postCas = body.slice(finalCasOffset + finalCas.length);
    const retiredFlip = postCas.indexOf("cell.state = 'RETIRED';");
    assert.ok(finalCasOffset >= 0 && retiredFlip >= 0);
    assert.doesNotMatch(postCas, /\b(?:try|catch|finally)\b/u);
    assert.doesNotMatch(postCas, /\.retirement\b/u);
    assert.doesNotMatch(postCas, /\b(?:DateNow|armedWebSessionCellsById|sessions|preparedWebSessionReservations|armedWebSessionPortRecords)\b/u);
    assert.deepEqual([...postCas.matchAll(/\b(?!if\b)([A-Za-z_$][\w$]*)\s*\(/gu)].map((match) => match[1]), []);
    assert.match(postCas, /cell\.retirementCommitted = true;\s*cell\.state = 'RETIRED';\s*webSessionCellLifecyclePoisoned = false;\s*webSessionCellLifecycle = 'idle';\s*return true;/u);
    assert.equal((source.match(/cell\.retirementCommitted = true;/gu) ?? []).length, 1);
});

test('retirement denies hostile inputs, stale control, and module copies without observation', async () => {
    const active = armedControlActivation(); assert.equal(activateArmedWebServerSession(active.port, active.ticket), true);
    let observed = 0;
    const boxed = new String(active.sessionId);
    const proxy = new Proxy(boxed, { get: () => { observed += 1; throw new Error('synthetic get'); }, ownKeys: () => { observed += 1; throw new Error('synthetic keys'); } });
    const thenable = Object.create(null); Object.defineProperty(thenable, 'then', { get: () => { observed += 1; throw new Error('synthetic then'); } });
    const rejected = Promise.reject(new Error('synthetic retirement input')); rejected.catch(() => undefined);
    for (const value of [null, undefined, '', 'wrong-session', boxed, proxy, thenable, rejected, { id: active.sessionId }]) {
        assert.equal(retireActiveWebServerSession(value, 'lock'), false);
    }
    assert.ok(resolveActiveWebServerSession(active.sessionId));

    const stale = armedControlActivation(); assert.equal(activateArmedWebServerSession(stale.port, stale.ticket), true);
    assert.equal(stale.control.retireTicket(stale.ticket, 'lock'), 1);
    assert.equal(retireActiveWebServerSession(stale.sessionId, 'lock'), false);
    assert.equal(resolveActiveWebServerSession(stale.sessionId), null);

    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath];
    try {
        delete nodeRequire.cache[modulePath];
        const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.retireActiveWebServerSession(active.sessionId, 'lock'), false);
        restarted.clearAllSessions();
    } finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
    const poisoned = armedControlActivation(); assert.equal(activateArmedWebServerSession(poisoned.port, poisoned.ticket), true);
    const originals = { mapGet: Map.prototype.get, weakGet: WeakMap.prototype.get, apply: Reflect.apply, then: Object.getOwnPropertyDescriptor(Object.prototype, 'then') };
    const fail = () => { throw new Error('ambient intrinsic'); };
    try {
        Map.prototype.get = fail as typeof Map.prototype.get; WeakMap.prototype.get = fail as typeof WeakMap.prototype.get; Reflect.apply = fail;
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get: fail });
        assert.equal(retireActiveWebServerSession(poisoned.sessionId, 'lock'), true);
    } finally {
        Map.prototype.get = originals.mapGet; WeakMap.prototype.get = originals.weakGet; Reflect.apply = originals.apply;
        if (originals.then) Object.defineProperty(Object.prototype, 'then', originals.then); else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0);
});

test('retirement poisons clock and lifecycle reentry and denies expiry without drift', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalNow = Date.now; const originalTtl = process.env.MEDIFLOW_SESSION_TTL_MS;
    let isolated: typeof import('./server-session') | undefined; let now = 1_000; let trigger = false; let nestedCalls = 0; let clockReads = 0;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    process.env.MEDIFLOW_SESSION_TTL_MS = '10'; Date.now = () => { clockReads += 1; if (trigger) { trigger = false; nestedCalls += 1; nested(); } return now; };
    let nested: () => void = () => undefined;
    const make = () => {
        const staged = isolated!.stageWebServerSession({ id: `retire-${nestedCalls}-${now}`, username: ['synthetic', 'retire'].join('-'), role: 'clinician' });
        const prepared = isolated!.prepareStagedWebServerSession(staged); assert.ok(prepared);
        const sessionId = isolated!.getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
        const port = isolated!.armPreparedWebServerSession(prepared); assert.ok(port);
        const control = authControlApi().create(`retire-fence-${sessionId}`); control.begin('login', 'op', `key-${sessionId}`, `fp-${sessionId}`, 0);
        const ticket = control.prepareTicket(`retire-fence-${sessionId}`, 'op', BigInt(0), `fp-${sessionId}`, sessionId, now); assert.ok(ticket);
        assert.equal(isolated!.activateArmedWebServerSession(port, ticket), true);
        return { sessionId, port, control, ticket };
    };
    try {
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        for (const operation of ['lookup', 'retire', 'delete', 'lock', 'clear'] as const) {
            const current = make();
            nested = () => operation === 'lookup' ? isolated!.resolveActiveWebServerSession(current.sessionId)
                : operation === 'retire' ? isolated!.retireActiveWebServerSession(current.sessionId, 'lock')
                    : operation === 'delete' ? isolated!.deleteSession(current.sessionId)
                        : operation === 'lock' ? isolated!.invalidateServerSessionForApplicationLock(current.sessionId) : isolated!.clearAllSessions();
            clockReads = 0; trigger = true;
            const failed = isolated.dispatchActiveWebServerSessionRetirement(current.sessionId, 'lock');
            assert.equal(failed.outcome, 'failed');
            assert.equal(isolated.dispatchActiveWebServerSessionRetirement(current.sessionId, 'lock'), failed);
            assert.equal(clockReads, 1);
            assert.equal(isolated.resolveActiveWebServerSession(current.sessionId), null);
        }
        const boundary = make(); now += 10; clockReads = 0;
        assert.equal(isolated.retireActiveWebServerSession(boundary.sessionId, 'expired'), true);
        assert.equal(clockReads, 1); assert.equal(boundary.control.retireTicket(boundary.ticket, 'expired'), 2);
        assert.equal(isolated.retireActiveWebServerSession(boundary.sessionId, 'expired'), false);
        assert.equal(boundary.control.retireTicket(boundary.ticket, 'lock'), 0);

        const live = make(); clockReads = 0;
        assert.equal(isolated.retireActiveWebServerSession(live.sessionId, 'expired'), false);
        assert.equal(clockReads, 1); assert.equal(isolated.resolveActiveWebServerSession(live.sessionId), null);

        const expiredWrongReason = make(); now += 10; clockReads = 0;
        assert.equal(isolated.retireActiveWebServerSession(expiredWrongReason.sessionId, 'lock'), false);
        assert.equal(clockReads, 1); assert.equal(isolated.resolveActiveWebServerSession(expiredWrongReason.sessionId), null);

        const past = make(); now += 11; clockReads = 0;
        assert.equal(isolated.retireActiveWebServerSession(past.sessionId, 'expired'), true);
        assert.equal(clockReads, 1); assert.equal(past.control.retireTicket(past.ticket, 'expired'), 2);

        const expiredReentry = make(); now += 10;
        nested = () => isolated!.clearAllSessions(); clockReads = 0; trigger = true;
        assert.equal(isolated.retireActiveWebServerSession(expiredReentry.sessionId, 'expired'), false);
        assert.equal(clockReads, 1); assert.equal(isolated.resolveActiveWebServerSession(expiredReentry.sessionId), null);

        const dispatchReentry = make();
        nested = () => { isolated!.dispatchActiveWebServerSessionRetirement(dispatchReentry.sessionId, 'lock'); };
        clockReads = 0; trigger = true;
        const dispatchFailed = isolated.dispatchActiveWebServerSessionRetirement(dispatchReentry.sessionId, 'lock');
        assert.equal(dispatchFailed.outcome, 'failed'); assert.equal(clockReads, 1);
        assert.equal(isolated.dispatchActiveWebServerSessionRetirement(dispatchReentry.sessionId, 'lock'), dispatchFailed);

        const casZero = make();
        nested = () => { authControlApi().prepareRetirement(casZero.ticket, casZero.sessionId, 'lock'); };
        clockReads = 0; trigger = true;
        const casZeroFailed = isolated.dispatchActiveWebServerSessionRetirement(casZero.sessionId, 'lock');
        assert.equal(casZeroFailed.outcome, 'failed'); assert.equal(clockReads, 1);
        assert.equal(isolated.dispatchActiveWebServerSessionRetirement(casZero.sessionId, 'lock'), casZeroFailed);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(nestedCalls, 8); assert.deepEqual(unhandled, []);
    } finally {
        trigger = false; Date.now = originalNow; isolated?.clearAllSessions();
        if (originalTtl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = originalTtl;
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('the trusted ACTIVE resolver denies tombstones, wrong IDs, hostile values, and module copies without observation', async () => {
    const active = armedControlActivation(); assert.equal(activateArmedWebServerSession(active.port, active.ticket), true);
    const tombstone = armedControlActivation(); assert.equal(tombstoneArmedWebServerSession(tombstone.port), true);
    let observed = 0;
    const boxed = new String(active.sessionId);
    const proxy = new Proxy(boxed, {
        get() { observed += 1; throw new Error('synthetic get'); },
        getOwnPropertyDescriptor() { observed += 1; throw new Error('synthetic descriptor'); },
        ownKeys() { observed += 1; throw new Error('synthetic keys'); },
    });
    const thenable = Object.create(null); Object.defineProperty(thenable, 'then', {
        enumerable: true, get() { observed += 1; throw new Error('synthetic then'); },
    });
    for (const value of [null, undefined, '', 'wrong-session-id', Object.freeze({ id: active.sessionId }),
        boxed, structuredClone(boxed), proxy, thenable, { ...boxed }]) {
        assert.equal(resolveActiveWebServerSession(value), null);
    }
    assert.equal(resolveActiveWebServerSession(tombstone.sessionId), null);
    const rejected = Promise.reject(new Error('synthetic rejected input')); rejected.catch(() => undefined);
    assert.equal(resolveActiveWebServerSession(rejected), null);

    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; let restarted: typeof import('./server-session') | undefined;
    try {
        delete nodeRequire.cache[modulePath]; restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.resolveActiveWebServerSession(active.sessionId), null);
        restarted.clearAllSessions();
    } finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0);
});

test('the trusted ACTIVE resolver denies expiry and lifecycle reentry without mutating or cleaning the cell', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const ttl = process.env.MEDIFLOW_SESSION_TTL_MS; const originalNow = Date.now;
    let isolated: typeof import('./server-session') | undefined; let now = 1_000; let trigger = false; let nested = () => undefined;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    try {
        process.env.MEDIFLOW_SESSION_TTL_MS = '10';
        Date.now = () => { if (trigger) { trigger = false; nested(); } return now; };
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const activate = () => {
            const staged = isolated!.stageWebServerSession({ id: 'active-isolated', username: SYNTHETIC_USERNAME, role: 'clinician' });
            const prepared = isolated!.prepareStagedWebServerSession(staged); assert.ok(prepared);
            const sessionId = isolated!.getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
            const port = isolated!.armPreparedWebServerSession(prepared); assert.ok(port);
            const control = authControlApi().create(`f-${sessionId}`); control.begin('login', 'op', 'key', 'fp', 0);
            const ticket = control.prepareTicket(`f-${sessionId}`, 'op', BigInt(0), 'fp', sessionId, now); assert.ok(ticket);
            assert.equal(isolated!.activateArmedWebServerSession(port, ticket), true);
            return sessionId;
        };

        const expiredId = activate(); const exact = isolated.resolveActiveWebServerSession(expiredId); assert.ok(exact);
        now = exact.expiresAt;
        assert.equal(isolated.resolveActiveWebServerSession(expiredId), null);
        now = exact.createdAt;
        assert.equal(isolated.resolveActiveWebServerSession(expiredId), exact, 'expiry denial performs no direct mutation or cleanup');
        assert.equal(isolated.getSession(expiredId), null);

        for (const operation of ['delete', 'invalidate', 'clear'] as const) {
            const sessionId = activate();
            nested = () => {
                if (operation === 'delete') isolated!.deleteSession(sessionId);
                else if (operation === 'invalidate') isolated!.invalidateSessionsForUser('active-isolated');
                else isolated!.clearAllSessions();
            };
            trigger = true;
            assert.equal(isolated.resolveActiveWebServerSession(sessionId), null);
            assert.equal(trigger, false);
            assert.ok(isolated.resolveActiveWebServerSession(sessionId), 'direct lifecycle calls are denial observations, not ACTIVE cleanup');
        }
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally {
        Date.now = originalNow; isolated?.clearAllSessions();
        if (ttl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = ttl;
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('the trusted ACTIVE resolver denies lookup reentry and legacy Map collision with captured intrinsics', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalGet = Map.prototype.get; const originalSet = Map.prototype.set;
    let isolated: typeof import('./server-session') | undefined; let sessionId = ''; let mode: 'idle' | 'nested' | 'collision' = 'idle';
    let nestedResult: unknown; let poisonedCalls = 0;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    Map.prototype.get = function (key: unknown) {
        const prior = Reflect.apply(originalGet, this, [key]);
        if (key === sessionId && mode === 'nested') { mode = 'idle'; nestedResult = isolated?.resolveActiveWebServerSession(sessionId); }
        if (key === sessionId && mode === 'collision') {
            mode = 'idle'; Reflect.apply(originalSet, this, [key, Object.freeze({ id: sessionId })]);
        }
        return prior;
    };
    try {
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const staged = isolated.stageWebServerSession({ id: 'lookup-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
        const prepared = isolated.prepareStagedWebServerSession(staged); assert.ok(prepared);
        sessionId = isolated.getPreparedWebServerSessionId(prepared) ?? ''; assert.ok(sessionId);
        const port = isolated.armPreparedWebServerSession(prepared); assert.ok(port);
        const control = authControlApi().create('lookup-fence'); control.begin('login', 'op', 'key', 'fp', 0);
        const ticket = control.prepareTicket('lookup-fence', 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
        assert.equal(isolated.activateArmedWebServerSession(port, ticket), true);

        mode = 'nested'; assert.equal(isolated.resolveActiveWebServerSession(sessionId), null); assert.equal(nestedResult, null);
        const session = isolated.resolveActiveWebServerSession(sessionId); assert.ok(session);
        const resource = isolated.mintActiveWebSessionResourcePort(session); assert.ok(resource);
        mode = 'collision'; assert.equal(isolated.mintActiveWebSessionResourcePort(session), null);

        const originals = { mapGet: Map.prototype.get, dateNow: Date.now, then: Object.getOwnPropertyDescriptor(Object.prototype, 'then') };
        Map.prototype.get = (() => { poisonedCalls += 1; throw new Error('ambient map get'); }) as typeof Map.prototype.get;
        Date.now = () => { poisonedCalls += 1; throw new Error('ambient clock'); };
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { poisonedCalls += 1; throw new Error('ambient then'); } });
        try {
            assert.equal(isolated.resolveActiveWebServerSession(sessionId), null, 'the legacy collision remains fail-closed');
            assert.equal(isolated.releaseActiveWebSessionResourcePort(resource), true, 'identity release remains callback-free');
        }
        finally {
            Map.prototype.get = originals.mapGet; Date.now = originals.dateNow;
            if (originals.then) Object.defineProperty(Object.prototype, 'then', originals.then); else delete (Object.prototype as { then?: unknown }).then;
        }
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(poisonedCalls, 0); assert.deepEqual(unhandled, []);
    } finally {
        Map.prototype.get = originalGet; isolated?.clearAllSessions();
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('activation burns crossed, hostile, copied, and cross-module inputs without observation', async (t) => {
    const first = armedControlActivation(); const second = armedControlActivation(); let observed = 0;
    const proxy = new Proxy(first.port, { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));

    assert.equal(activateArmedWebServerSession(first.port, second.ticket), false);
    for (const value of [Object.assign(Object.create(null), first.port), proxy, accessor, Promise.resolve(), rejected, { then() { observed += 1; } }]) {
        assert.equal(activateArmedWebServerSession(value, first.ticket), false);
    }
    assert.equal(activateArmedWebServerSession(second.port, first.ticket), false);
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath];
    try {
        delete nodeRequire.cache[modulePath]; const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.activateArmedWebServerSession(second.port, second.ticket), false);
        restarted.clearAllSessions();
    } finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []);
});

test('activation denies clock reentry, CAS drift, and ambient collection poison without post-return drift', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const sessionPath = nodeRequire.resolve('./server-session.ts');
    const authPath = nodeRequire.resolve(AUTH_CONTROL_MODULE_PATH); const cachedSession = nodeRequire.cache[sessionPath]; const cachedAuth = nodeRequire.cache[authPath];
    const originalNow = Date.now; const ttl = process.env.MEDIFLOW_SESSION_TTL_MS; let now = 1_000;
    let armed = false; let clockCalls = 0; let nested = () => undefined;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    process.env.MEDIFLOW_SESSION_TTL_MS = '1';
    Date.now = () => { clockCalls += 1; if (armed && clockCalls === 2) nested(); return now; };
    delete nodeRequire.cache[sessionPath]; delete nodeRequire.cache[authPath];
    const isolated = nodeRequire(sessionPath) as typeof import('./server-session');
    const auth = authControlApi();
    const fixture = () => {
        clockCalls = 0; armed = false;
        const prepared = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({ id: 'clock-user', username: SYNTHETIC_USERNAME, role: 'clinician' })); assert.ok(prepared);
        const sessionId = isolated.getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
        const port = isolated.armPreparedWebServerSession(prepared); assert.ok(port);
        const control = auth.create('f0'); control.begin('login', 'op', 'key', 'fp', 0);
        const ticket = control.prepareTicket('f0', 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
        clockCalls = 0; armed = true; return { control, port, sessionId, ticket };
    };
    try {
        for (const operation of ['tombstone', 'delete', 'logout', 'clear', 'arm'] as const) {
            const current = fixture(); const nestedPrepared = operation === 'arm' ? isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({ id: 'nested', username: SYNTHETIC_USERNAME, role: 'clinician' })) : null;
            clockCalls = 0; armed = true; nested = () => {
                if (operation === 'tombstone') isolated.tombstoneArmedWebServerSession(current.port);
                else if (operation === 'delete') isolated.deleteSession(current.sessionId);
                else if (operation === 'logout') isolated.invalidateSessionsForUser('clock-user');
                else if (operation === 'clear') isolated.clearAllSessions();
                else isolated.armPreparedWebServerSession(nestedPrepared);
            };
            assert.equal(isolated.activateArmedWebServerSession(current.port, current.ticket), false);
            assert.equal(isolated.getArmedWebServerSessionId(current.port), null);
            await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(isolated.getArmedWebServerSessionId(current.port), null);
        }
        const drift = fixture();
        const other = auth.create('other'); other.begin('login', 'other-op', 'other-key', 'other-fp', 0);
        const otherTicket = other.prepareTicket('other', 'other-op', BigInt(0), 'other-fp', 'other-session', 1); assert.ok(otherTicket);
        clockCalls = 0; armed = true; nested = () => { auth.prepareActivation(otherTicket, 'other-session'); };
        assert.equal(isolated.activateArmedWebServerSession(drift.port, drift.ticket), false);
        assert.equal(isolated.getArmedWebServerSessionId(drift.port), null);
        const expired = fixture(); armed = false; now += 1;
        assert.equal(isolated.activateArmedWebServerSession(expired.port, expired.ticket), false);
        assert.equal(isolated.getArmedWebServerSessionId(expired.port), null);
        const fail = () => { throw new Error('ambient collection poison'); };
        const originals = { get: WeakMap.prototype.get, set: WeakMap.prototype.set, mapGet: Map.prototype.get, apply: Reflect.apply };
        const clean = fixture(); clockCalls = 0; armed = false;
        try { WeakMap.prototype.get = fail as typeof WeakMap.prototype.get; WeakMap.prototype.set = fail as typeof WeakMap.prototype.set; Map.prototype.get = fail as typeof Map.prototype.get; Reflect.apply = fail as typeof Reflect.apply; assert.equal(isolated.activateArmedWebServerSession(clean.port, clean.ticket), true); }
        finally { WeakMap.prototype.get = originals.get; WeakMap.prototype.set = originals.set; Map.prototype.get = originals.mapGet; Reflect.apply = originals.apply; }
        assert.equal(isolated.getSession(clean.sessionId), null);
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally {
        armed = false; Date.now = originalNow; isolated.clearAllSessions();
        if (ttl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = ttl;
        if (cachedSession) nodeRequire.cache[sessionPath] = cachedSession; else delete nodeRequire.cache[sessionPath];
        if (cachedAuth) nodeRequire.cache[authPath] = cachedAuth; else delete nodeRequire.cache[authPath];
    }
});

test('activation tombstones lookup reentry and a captured WeakMap mutate-then-throw', async () => {
    const nodeRequire = createRequire(import.meta.url); const sessionPath = nodeRequire.resolve('./server-session.ts');
    const authPath = nodeRequire.resolve(AUTH_CONTROL_MODULE_PATH); const cachedSession = nodeRequire.cache[sessionPath]; const cachedAuth = nodeRequire.cache[authPath];
    const originalGet = WeakMap.prototype.get; let trigger = false; let failAfterApply = false; let nested: () => void = () => undefined;
    WeakMap.prototype.get = function (this: WeakMap<object, unknown>, key: object) {
        if (trigger) { trigger = false; nested(); }
        const result = Reflect.apply(originalGet, this, [key]);
        if (failAfterApply) { failAfterApply = false; throw new Error('mutate-then-throw'); }
        return result;
    };
    delete nodeRequire.cache[sessionPath]; delete nodeRequire.cache[authPath];
    const isolated = nodeRequire(sessionPath) as typeof import('./server-session');
    try {
        const fixture = () => {
            const staged = isolated.stageWebServerSession({ id: 'lookup-user', username: SYNTHETIC_USERNAME, role: 'clinician' });
            const prepared = isolated.prepareStagedWebServerSession(staged); assert.ok(prepared);
            const sessionId = isolated.getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
            const port = isolated.armPreparedWebServerSession(prepared); assert.ok(port);
            const control = authControlApi().create('f0'); control.begin('login', 'op', 'key', 'fp', 0);
            const ticket = control.prepareTicket('f0', 'op', BigInt(0), 'fp', sessionId, 1); assert.ok(ticket);
            return { port, sessionId, ticket };
        };
        const reentered = fixture(); nested = () => isolated.deleteSession(reentered.sessionId); trigger = true;
        assert.equal(isolated.activateArmedWebServerSession(reentered.port, reentered.ticket), false);
        assert.equal(isolated.getArmedWebServerSessionId(reentered.port), null);
        const thrown = fixture(); failAfterApply = true;
        assert.equal(isolated.activateArmedWebServerSession(thrown.port, thrown.ticket), false);
        assert.equal(isolated.getArmedWebServerSessionId(thrown.port), null);
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(isolated.getArmedWebServerSessionId(thrown.port), null);
    } finally {
        WeakMap.prototype.get = originalGet; isolated.clearAllSessions();
        if (cachedSession) nodeRequire.cache[sessionPath] = cachedSession; else delete nodeRequire.cache[sessionPath];
        if (cachedAuth) nodeRequire.cache[authPath] = cachedAuth; else delete nodeRequire.cache[authPath];
    }
});

test('an armed Web session cell becomes a terminal tombstone on denial, logout, clear, and expiry', () => {
    const arm = (userId: string) => armPreparedWebServerSession(prepareStagedWebServerSession(
        stageWebServerSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }),
    ));
    const denied = arm('armed-denied'); const invalidated = arm('armed-invalidated'); const cleared = arm('armed-cleared');
    assert.ok(denied && invalidated && cleared);

    assert.equal(tombstoneArmedWebServerSession(denied), true);
    assert.equal(tombstoneArmedWebServerSession(denied), false);
    assert.equal(getArmedWebServerSessionId(denied), null);
    invalidateSessionsForUser('armed-invalidated');
    assert.equal(getArmedWebServerSessionId(invalidated), null);
    clearAllSessions();
    assert.equal(getArmedWebServerSessionId(cleared), null);

    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const ttl = process.env.MEDIFLOW_SESSION_TTL_MS; const originalNow = Date.now;
    let isolated: typeof import('./server-session') | undefined; let now = 1_000;
    try {
        process.env.MEDIFLOW_SESSION_TTL_MS = '1'; Date.now = () => now; delete nodeRequire.cache[modulePath];
        isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const port = isolated.armPreparedWebServerSession(isolated.prepareStagedWebServerSession(
            isolated.stageWebServerSession({ id: 'armed-expired', username: SYNTHETIC_USERNAME, role: 'clinician' }),
        ));
        assert.ok(port); now += 2;
        assert.equal(isolated.getArmedWebServerSessionId(port), null);
        assert.equal(isolated.tombstoneArmedWebServerSession(port), false);
    } finally {
        Date.now = originalNow; isolated?.clearAllSessions();
        if (ttl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = ttl;
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('armed Web session ports reject hostile shapes and module copies without observation', async (t) => {
    const prepared = prepareStagedWebServerSession(stageWebServerSession({
        id: 'armed-hostile', username: SYNTHETIC_USERNAME, role: 'clinician',
    }));
    const port = armPreparedWebServerSession(prepared); assert.ok(port);
    let observed = 0;
    const proxy = new Proxy(port, { get: () => { observed += 1; throw new Error('get'); }, ownKeys: () => { observed += 1; throw new Error('keys'); } });
    const accessor = Object.create(null); Object.defineProperty(accessor, 'then', { get: () => { observed += 1; throw new Error('then'); } });
    const rejected = Promise.reject(new Error('hostile')); rejected.catch(() => undefined);
    const hostile = [Object.assign(Object.create(null), port), proxy, accessor, Promise.resolve(), rejected, { then() { observed += 1; } }];
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    for (const value of hostile) {
        assert.equal(getArmedWebServerSessionId(value), null);
        assert.equal(tombstoneArmedWebServerSession(value), false);
    }
    const thenDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    try {
        Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => { observed += 1; throw new Error('ambient then'); } });
        assert.equal(typeof getArmedWebServerSessionId(port), 'string');
    } finally {
        if (thenDescriptor) Object.defineProperty(Object.prototype, 'then', thenDescriptor); else delete (Object.prototype as { then?: unknown }).then;
    }
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath];
    try {
        delete nodeRequire.cache[modulePath]; const restarted = nodeRequire(modulePath) as typeof import('./server-session');
        assert.equal(restarted.getArmedWebServerSessionId(port), null);
        assert.equal(restarted.tombstoneArmedWebServerSession(port), false);
        restarted.clearAllSessions();
    } finally { if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(observed, 0); assert.deepEqual(unhandled, []);
});

test('the armed-cell lifecycle guard burns reentrant and apply-then-throw preparations without later drift', async () => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath];
    const weak = { get: WeakMap.prototype.get, set: WeakMap.prototype.set }; let target = ''; let failSet = false; let nested = () => undefined;
    const wrap = (name: string, original: (...args: never[]) => unknown) => function (this: unknown, ...args: never[]) {
        if (target === name) { target = ''; nested(); }
        const result = Reflect.apply(original, this, args); if (name === 'set' && failSet) throw new Error('apply-then-throw'); return result;
    };
    WeakMap.prototype.get = wrap('get', weak.get) as typeof weak.get;
    WeakMap.prototype.set = wrap('set', weak.set) as typeof weak.set;
    let isolated: typeof import('./server-session');
    try { delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session'); }
    finally { WeakMap.prototype.get = weak.get; WeakMap.prototype.set = weak.set; }
    try {
        const first = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({ id: 'armed-first', username: SYNTHETIC_USERNAME, role: 'clinician' }));
        const second = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({ id: 'armed-second', username: SYNTHETIC_USERNAME, role: 'clinician' }));
        assert.ok(first && second);
        let nestedPort: ReturnType<typeof isolated.armPreparedWebServerSession> | undefined;
        target = 'set'; nested = () => { nestedPort = isolated.armPreparedWebServerSession(second); };
        assert.equal(isolated.armPreparedWebServerSession(first), null);
        assert.equal(nestedPort, null);
        assert.equal(isolated.commitPreparedWebServerSession(first), false);
        assert.equal(isolated.commitPreparedWebServerSession(second), false);

        const mutated = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({ id: 'armed-mutated', username: SYNTHETIC_USERNAME, role: 'clinician' }));
        assert.ok(mutated); const mutatedId = isolated.getPreparedWebServerSessionId(mutated); assert.ok(mutatedId);
        failSet = true; assert.equal(isolated.armPreparedWebServerSession(mutated), null); failSet = false;
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(isolated.commitPreparedWebServerSession(mutated), false);
        const cryptoModule = nodeRequire('node:crypto'); const randomBytes = cryptoModule.randomBytes;
        try { cryptoModule.randomBytes = () => Buffer.from(mutatedId, 'hex'); assert.throws(() => isolated.createSession({ id: 'reuse', username: SYNTHETIC_USERNAME, role: 'clinician' })); }
        finally { cryptoModule.randomBytes = randomBytes; }

        const fresh = isolated.armPreparedWebServerSession(isolated.prepareStagedWebServerSession(
            isolated.stageWebServerSession({ id: 'armed-fresh', username: SYNTHETIC_USERNAME, role: 'clinician' }),
        ));
        assert.ok(fresh);
        target = 'get'; nested = () => { isolated.tombstoneArmedWebServerSession(fresh); };
        assert.equal(isolated.getArmedWebServerSessionId(fresh), null);
        assert.equal(isolated.tombstoneArmedWebServerSession(fresh), false);
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(isolated.getArmedWebServerSessionId(fresh), null);
    } finally {
        isolated.clearAllSessions();
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('armed Web session ID lookup revalidates after hostile clock reentry', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath]; const originalNow = Date.now; let trigger = false; let nested = () => undefined;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    Date.now = () => { if (trigger) { trigger = false; nested(); } return 1_000; };
    let isolated: typeof import('./server-session');
    try { delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session'); }
    finally { Date.now = originalNow; }
    try {
        for (const operation of ['tombstone', 'delete', 'clear', 'arm'] as const) {
            const prepared = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({
                id: `clock-${operation}`, username: SYNTHETIC_USERNAME, role: 'clinician',
            }));
            const port = isolated.armPreparedWebServerSession(prepared); assert.ok(port);
            const sessionId = isolated.getArmedWebServerSessionId(port); assert.ok(sessionId);
            const nestedPrepared = operation === 'arm' ? isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({
                id: 'clock-nested-arm', username: SYNTHETIC_USERNAME, role: 'clinician',
            })) : null;
            if (operation === 'arm') assert.ok(nestedPrepared);
            let nestedResult: unknown;
            nested = () => {
                if (operation === 'tombstone') nestedResult = isolated.tombstoneArmedWebServerSession(port);
                else if (operation === 'delete') nestedResult = isolated.deleteSession(sessionId);
                else if (operation === 'clear') nestedResult = isolated.clearAllSessions();
                else nestedResult = isolated.armPreparedWebServerSession(nestedPrepared);
            };
            trigger = true;

            assert.equal(isolated.getArmedWebServerSessionId(port), null);
            assert.equal(trigger, false);
            assert.equal(operation === 'arm' ? nestedResult : isolated.getArmedWebServerSessionId(port), null);
            assert.equal(isolated.tombstoneArmedWebServerSession(port), false);
            if (nestedPrepared) assert.equal(isolated.commitPreparedWebServerSession(nestedPrepared), false);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(isolated.getArmedWebServerSessionId(port), null);
        }
        assert.deepEqual(unhandled, []);
    } finally {
        isolated.clearAllSessions();
        if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath];
    }
});

test('prepared Web session abort, deletion, user invalidation, clear, and hostile copies publish nothing', () => {
    const aborted = prepareStagedWebServerSession(stageWebServerSession({ id: 'prepared-abort', username: SYNTHETIC_USERNAME, role: 'clinician' }));
    const deleted = prepareStagedWebServerSession(stageWebServerSession({ id: 'prepared-delete', username: SYNTHETIC_USERNAME, role: 'clinician' }));
    const invalidated = prepareStagedWebServerSession(stageWebServerSession({ id: 'prepared-invalidate', username: SYNTHETIC_USERNAME, role: 'clinician' }));
    const cleared = prepareStagedWebServerSession(stageWebServerSession({ id: 'prepared-clear', username: SYNTHETIC_USERNAME, role: 'clinician' }));
    assert.ok(aborted && deleted && invalidated && cleared);

    assert.equal(abortPreparedWebServerSession(aborted), true);
    assert.equal(abortPreparedWebServerSession(aborted), false);
    const deletedId = getPreparedWebServerSessionId(deleted); assert.ok(deletedId); deleteSession(deletedId);
    invalidateSessionsForUser('prepared-invalidate');
    clearAllSessions();
    for (const prepared of [aborted, deleted, invalidated, cleared]) assert.equal(commitPreparedWebServerSession(prepared), false);
    const copied = Object.assign(Object.create(null), cleared);
    const proxied = new Proxy(cleared, {});
    assert.equal(getPreparedWebServerSessionId(copied), null);
    assert.equal(commitPreparedWebServerSession(proxied), false);
});

test('a reservation denies colliding live, native, and direct staged publication without overwriting', () => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath]; const cryptoModule = nodeRequire('node:crypto'); const randomBytes = cryptoModule.randomBytes;
    let isolated: typeof import('./server-session') | undefined;
    try {
        cryptoModule.randomBytes = () => Buffer.alloc(32, 7); delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        const prepared = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({ id: 'reserved-user', username: SYNTHETIC_USERNAME, role: 'clinician' }));
        assert.ok(prepared); const sessionId = isolated.getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
        assert.throws(() => isolated!.createSession({ id: 'live-user', username: SYNTHETIC_USERNAME, role: 'clinician' }), /unavailable/u);
        assert.throws(() => isolated!.createNativeServerSession({ id: 'native-user', username: SYNTHETIC_USERNAME, role: 'clinician' }, { clientId: 'synthetic-client', clientPlatform: 'macos' }), /unavailable/u);
        assert.equal(isolated.activateStagedWebServerSession(isolated.stageWebServerSession({ id: 'direct-user', username: SYNTHETIC_USERNAME, role: 'clinician' })), null);
        assert.equal(isolated.getSession(sessionId), null);
        assert.equal(isolated.commitPreparedWebServerSession(prepared), true); assert.equal(isolated.getSession(sessionId)?.id, sessionId);
    } finally { cryptoModule.randomBytes = randomBytes; isolated?.clearAllSessions(); if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
});

test('entropy reentry cannot resurrect or duplicate staged Web reservations', () => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath]; const cryptoModule = nodeRequire('node:crypto'); const randomBytes = cryptoModule.randomBytes;
    let isolated: typeof import('./server-session') | undefined; let first: ReturnType<typeof stageWebServerSession> = null; let second: ReturnType<typeof stageWebServerSession> = null;
    try {
        let entered = false; let same: ReturnType<typeof prepareStagedWebServerSession> | undefined; let other: ReturnType<typeof prepareStagedWebServerSession> | undefined;
        cryptoModule.randomBytes = () => { if (!entered && isolated && first && second) { entered = true; same = isolated.prepareStagedWebServerSession(first); other = isolated.prepareStagedWebServerSession(second); } return Buffer.alloc(32, 9); };
        delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session');
        first = isolated.stageWebServerSession({ id: 'reentry-first', username: SYNTHETIC_USERNAME, role: 'clinician' }); second = isolated.stageWebServerSession({ id: 'reentry-second', username: SYNTHETIC_USERNAME, role: 'clinician' }); assert.ok(first && second);
        assert.equal(isolated.prepareStagedWebServerSession(first), null);
        assert.equal(same, null); assert.equal(other, null);
        assert.equal(isolated.activateStagedWebServerSession(second), null);
        assert.equal(isolated.getSession(Buffer.alloc(32, 9).toString('hex')), null);
        const fresh = isolated.stageWebServerSession({ id: 'reentry-fresh', username: SYNTHETIC_USERNAME, role: 'clinician' }); assert.ok(fresh); assert.ok(isolated.commitPreparedWebServerSession(isolated.prepareStagedWebServerSession(fresh)));
    } finally { cryptoModule.randomBytes = randomBytes; isolated?.clearAllSessions(); if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
});

test('a prepared session survives unrelated creation and remains private across a module copy', () => {
    const prepared = prepareStagedWebServerSession(stageWebServerSession({ id: 'prepared-copy', username: SYNTHETIC_USERNAME, role: 'clinician' }));
    assert.ok(prepared); const sessionId = getPreparedWebServerSessionId(prepared); assert.ok(sessionId);
    const unrelated = syntheticSession(); assert.notEqual(unrelated.id, sessionId); assert.equal(getSession(sessionId), null);
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath]; let restarted: typeof import('./server-session') | undefined;
    try { delete nodeRequire.cache[modulePath]; restarted = nodeRequire(modulePath) as typeof import('./server-session'); assert.equal(restarted.getPreparedWebServerSessionId(prepared), null); assert.equal(restarted.commitPreparedWebServerSession(prepared), false); }
    finally { restarted?.clearAllSessions(); if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
    assert.equal(commitPreparedWebServerSession(prepared), true); assert.equal(getSession(sessionId)?.id, sessionId);
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

test('an expired prepared Web session releases its reservation before publication', () => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts'); const cached = nodeRequire.cache[modulePath]; const ttl = process.env.MEDIFLOW_SESSION_TTL_MS;
    let isolated: typeof import('./server-session') | undefined;
    const originalNow = Date.now; let now = 1_000;
    try { process.env.MEDIFLOW_SESSION_TTL_MS = '1'; Date.now = () => now; delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session'); const prepared = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({ id: 'expired-user', username: SYNTHETIC_USERNAME, role: 'clinician' })); assert.ok(prepared); const sessionId = isolated.getPreparedWebServerSessionId(prepared); assert.ok(sessionId); now += 2; assert.equal(isolated.commitPreparedWebServerSession(prepared), false); assert.equal(isolated.getPreparedWebServerSessionId(prepared), null); assert.equal(isolated.getSession(sessionId), null); }
    finally { Date.now = originalNow; isolated?.clearAllSessions(); if (ttl === undefined) delete process.env.MEDIFLOW_SESSION_TTL_MS; else process.env.MEDIFLOW_SESSION_TTL_MS = ttl; if (cached) nodeRequire.cache[modulePath] = cached; else delete nodeRequire.cache[modulePath]; }
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
    let preparedId: string | null = null; let preparedCommit: ReturnType<typeof commitPreparedWebServerSession> | undefined;
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

        const prepared = prepareStagedWebServerSession(stageWebServerSession({ id: 'poisoned-prepared', username: SYNTHETIC_USERNAME, role: 'clinician' }));
        if (prepared) { preparedId = getPreparedWebServerSessionId(prepared); preparedCommit = commitPreparedWebServerSession(prepared); }

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
    assert.ok(preparedId);
    assert.equal(preparedCommit, true);
    assert.equal(deleted, true);
    assert.equal(invalidated, true);
    assert.equal(cleared, true);
    assert.equal(expiredRemainsClosed, true);
    assert.deepEqual({ disposerCalls, disposerReason }, { disposerCalls: 1, disposerReason: 'sessions_cleared' });
    assert.equal(poisonedCalls, 0);
});
