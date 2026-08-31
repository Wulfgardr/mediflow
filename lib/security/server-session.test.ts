/* @Codex */
import assert from 'node:assert/strict';
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
    registerActiveWebSessionPrivateResource,
    registerServerSessionResource,
    releaseActiveWebSessionResourcePort,
    retireExpiredServerSession,
    retireActiveWebServerSession,
    retireServerSessionForApplicationLock,
    retireServerSessionForLogout,
    retireServerSessionsForUser,
    retireWebP3SessionsForUser,
    resolveActiveWebServerSession,
    stageWebServerSession,
    tombstoneArmedWebServerSession,
    unregisterActiveWebSessionPrivateResource,
    type WebServerSessionRetirementCleanupReceipt,
} from './server-session';
import {
    allowedGenericLoaderExpressions,
    inventoryModuleImports,
    repositoryTypeScriptSources,
} from './module-import-inventory.test-support.ts';

const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;
const TARGET_USERNAME = ['synthetic', 'target'].join('-');
const OTHER_USERNAME = ['synthetic', 'other'].join('-');
const AUTH_CONTROL_MODULE_PATH = './web-auth-control-record.ts';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HISTORICAL_WEB_RUNTIME_IMPORTS = new Map<string, ReadonlySet<string>>([
    ['lib/security/web-auth-control-owner.ts', new Set([
        'activateArmedWebServerSession', 'getArmedWebServerSessionId', 'tombstoneArmedWebServerSession',
    ])],
    ['lib/security/web-auth-session-issuer.ts', new Set([
        'abortPreparedWebServerSession', 'abortStagedWebServerSession', 'armPreparedWebServerSession',
        'getPreparedWebServerSessionId', 'prepareStagedWebServerSession', 'stageWebServerSession',
        'tombstoneArmedWebServerSession',
    ])],
]);
const HISTORICAL_WEB_RUNTIME_SYMBOLS = new Set([
    'abortActiveWebSessionResourceUse', 'abortPreparedWebServerSession', 'abortStagedWebServerSession',
    'activateArmedWebServerSession', 'activateStagedWebServerSession', 'armPreparedWebServerSession',
    'beginActiveWebSessionResourceUse', 'cleanupRetiredWebServerSession', 'commitActiveWebSessionResourceUse',
    'commitPreparedWebServerSession', 'dispatchActiveWebServerSessionRetirement', 'getArmedWebServerSessionId',
    'getPreparedWebServerSessionId', 'mintActiveWebSessionResourcePort', 'prepareStagedWebServerSession',
    'registerActiveWebSessionPrivateResource', 'releaseActiveWebSessionResourcePort', 'resolveActiveWebServerSession',
    'retireActiveWebServerSession', 'retireWebP3SessionsForUser', 'stageWebServerSession',
    'tombstoneArmedWebServerSession', 'unregisterActiveWebSessionPrivateResource',
]);
const NATIVE_CAPABILITY_IMPORTS = new Map<string, ReadonlySet<string>>([
    ['app/api/auth/reset/route.ts', new Set([
        'abortNativeSystemAdminReset', 'commitNativeSystemAdminReset', 'prepareNativeSystemAdminReset',
    ])],
    ['lib/security/pin-change-service.ts', new Set([
        'abortNativeLegacyUserRetirement', 'commitNativeLegacyUserRetirement', 'prepareNativeLegacyUserRetirement',
    ])],
]);
const NATIVE_CAPABILITY_SYMBOLS = new Set([...NATIVE_CAPABILITY_IMPORTS.values()].flatMap((symbols) => [...symbols]));
const DORMANT_WEB_OWNER_MODULE_IMPORTS = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>([
    ['lib/security/web-auth-control-owner', new Map([
        ['lib/security/web-auth-session-issuer.ts', new Set([
            'activatePreparedWebAuthSession', 'beginWebAuth', 'cancelWebAuth', 'prepareWebAuthActivation',
        ])],
    ])],
    ['lib/security/web-auth-session-issuer', new Map()],
]);

const isTestSource = (file: string) => /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file);
const inventory = (sources: Readonly<Record<string, string>>, target: string) => Object.entries(sources)
    .flatMap(([file, source]) => inventoryModuleImports({
        file, source, target, repositoryRoot: REPOSITORY_ROOT,
        allowUnresolvedExpressions: allowedGenericLoaderExpressions,
    }));
const exactRuntimeSymbols = (
    uses: ReturnType<typeof inventory>, file: string, symbols: ReadonlySet<string>,
) => {
    const actual = uses.filter((use) => use.file === file && !use.typeOnly && symbols.has(use.symbol));
    return actual.length === symbols.size && actual.every((use) => use.form === 'named')
        && [...symbols].every((symbol) => actual.some((use) => use.symbol === symbol));
};

/* @Codex */
const validateO1CSessionImports = (sources: Readonly<Record<string, string>>) => {
    const errors: string[] = [];
    const sessionUses = inventory(sources, 'lib/security/server-session');
    for (const use of sessionUses) {
        if (use.typeOnly || isTestSource(use.file)) continue;
        if (use.form !== 'named') errors.push(`${use.file}:session-loader`);
        if (HISTORICAL_WEB_RUNTIME_SYMBOLS.has(use.symbol)
            && !HISTORICAL_WEB_RUNTIME_IMPORTS.get(use.file)?.has(use.symbol)) {
            errors.push(`${use.file}:historical-web-authority`);
        }
        if (NATIVE_CAPABILITY_SYMBOLS.has(use.symbol)
            && !NATIVE_CAPABILITY_IMPORTS.get(use.file)?.has(use.symbol)) {
            errors.push(`${use.file}:native-capability-owner`);
        }
    }
    for (const [file, symbols] of HISTORICAL_WEB_RUNTIME_IMPORTS) {
        if (file in sources && !exactRuntimeSymbols(sessionUses, file, symbols)) errors.push(`${file}:historical-shape`);
    }
    for (const [file, symbols] of NATIVE_CAPABILITY_IMPORTS) {
        if (file in sources && !exactRuntimeSymbols(sessionUses, file, symbols)) errors.push(`${file}:native-capability-shape`);
    }
    for (const [target, expectedByFile] of DORMANT_WEB_OWNER_MODULE_IMPORTS) {
        const uses = inventory(sources, target);
        for (const use of uses) {
            if (use.typeOnly || isTestSource(use.file)) continue;
            if (use.form !== 'named' || !expectedByFile.get(use.file)?.has(use.symbol)) {
                errors.push(`${use.file}:historical-owner-reachable`);
            }
        }
        for (const [file, symbols] of expectedByFile) {
            if (file in sources && !exactRuntimeSymbols(uses, file, symbols)) errors.push(`${file}:historical-owner-shape`);
        }
    }
    return errors;
};
const typescriptSources = () => repositoryTypeScriptSources(REPOSITORY_ROOT);

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

test('O1-C historical P2 prepare commit and abort bridges cannot activate or retire Web authority', () => {
    const activation = armedControlActivation('cutover-denied');
    assert.equal(activateArmedWebServerSession(activation.port, activation.ticket), false);
    assert.equal(resolveActiveWebServerSession(activation.sessionId), null);
    assert.equal(getSession(activation.sessionId), null);
    assert.equal(retireActiveWebServerSession(activation.sessionId, 'delete'), false);
    assert.equal(dispatchActiveWebServerSessionRetirement(activation.sessionId, 'delete').outcome, 'denied');
    assert.deepEqual(activation.control.snapshot(), {
        fence: 'f0', generation: BigInt(0), pending: true, active: false,
    });

    const source = readFileSync(fileURLToPath(new URL('./server-session.ts', import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\/web-auth-control-record['"]/u);
    assert.match(source, /function prepareAuthControlActivation[\s\S]*?return null;/u);
    assert.match(source, /function commitPreparedAuthControlActivation[\s\S]*?return 0;/u);
    assert.match(source, /function abortPreparedAuthControlActivation[\s\S]*?return false;/u);
    assert.match(source, /function prepareAuthControlRetirement[\s\S]*?return null;/u);
    assert.match(source, /function commitPreparedAuthControlRetirement[\s\S]*?return 0;/u);
    assert.match(source, /function abortPreparedAuthControlRetirement[\s\S]*?return false;/u);
});

test('O1-C inventories historical Web authority as a dormant fail-closed island', () => {
    const sources = typescriptSources();
    assert.deepEqual(validateO1CSessionImports(sources), []);

    const unauthorized = validateO1CSessionImports({
        'lib/security/unauthorized.ts': "import { activateArmedWebServerSession } from './server-session';",
    });
    assert.ok(unauthorized.includes('lib/security/unauthorized.ts:historical-web-authority'));

    const reachableIssuer = validateO1CSessionImports({
        'lib/security/unauthorized.ts': "import { issue } from './web-auth-session-issuer';",
    });
    assert.ok(reachableIssuer.includes('lib/security/unauthorized.ts:historical-owner-reachable'));

    const hiddenLoader = validateO1CSessionImports({
        'lib/security/unauthorized.ts': "const session = await import('./server-session');",
    });
    assert.ok(hiddenLoader.includes('lib/security/unauthorized.ts:session-loader'));
});

test('O1-C binds native-system capabilities to reset and PIN change only', () => {
    const sources = typescriptSources();
    const reset = sources['app/api/auth/reset/route.ts']; assert.ok(reset);
    const pin = sources['lib/security/pin-change-service.ts']; assert.ok(pin);
    assert.deepEqual(validateO1CSessionImports({
        'app/api/auth/reset/route.ts': reset,
        'lib/security/pin-change-service.ts': pin,
    }), []);

    const stolen = validateO1CSessionImports({
        'lib/security/unauthorized.ts':
            "import { prepareNativeSystemAdminReset } from './server-session';",
    });
    assert.ok(stolen.includes('lib/security/unauthorized.ts:native-capability-owner'));

    const partialReset = validateO1CSessionImports({
        'app/api/auth/reset/route.ts':
            "import { prepareNativeSystemAdminReset, commitNativeSystemAdminReset } from '@/lib/security/server-session';",
    });
    assert.ok(partialReset.includes('app/api/auth/reset/route.ts:native-capability-shape'));
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

test('user retirement turn fences same-user issuance while preserving system and cross-user authority', async (t) => {
    const userId = 'retirement-turn-user';
    const victim = createSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' });
    const staged = stageWebServerSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }); assert.ok(staged);
    const prepared = prepareStagedWebServerSession(stageWebServerSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' })); assert.ok(prepared);
    const armed = armedControlActivation(userId); assert.ok(armed.port);
    let nestedOutcome: WebServerSessionRetirementCleanupReceipt['outcome'] | null = null;
    let webDenied = false; let nativeDenied = false; let stagedDenied = false; let preparedDenied = false; let armedDenied = false;
    let otherSessionId: string | null = null; let systemSessionId: string | null = null;
    let hostileReads = 0; let hostileDenied = false; let hostileStageDenied = false;
    const hostileUser = Object.create(null);
    Object.defineProperty(hostileUser, 'id', { enumerable: true, get() { hostileReads += 1; return userId; } });
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    registerServerSessionResource(victim.id, () => {
        hostileStageDenied = stageWebServerSession(hostileUser as { id: string; username: string; role: string }) === null;
        try { createSession(hostileUser as { id: string; username: string; role: string }); } catch { hostileDenied = true; }
        try { createSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }); } catch { webDenied = true; }
        try { createNativeServerSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }, { clientId: 'turn-client', clientPlatform: 'ios' }); } catch { nativeDenied = true; }
        nestedOutcome = retireServerSessionsForUser(userId).outcome;
        stagedDenied = stageWebServerSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }) === null;
        preparedDenied = prepareStagedWebServerSession(staged) === null && commitPreparedWebServerSession(prepared) === false;
        armedDenied = activateArmedWebServerSession(armed.port, armed.ticket) === false;
        otherSessionId = createSession({ id: 'retirement-turn-other', username: SYNTHETIC_USERNAME, role: 'clinician' }).id;
        systemSessionId = createSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'system' }, 'system').id;
    });

    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get() { throw new Error('ambient then'); } });
    try {
        const receipt = retireServerSessionsForUser(userId);
        assert.equal(receipt.outcome, 'denied');
        assert.equal(nestedOutcome, 'denied'); assert.equal(webDenied, true); assert.equal(nativeDenied, true);
        assert.equal(hostileDenied, true); assert.equal(hostileStageDenied, true); assert.equal(hostileReads, 0);
        assert.equal(stagedDenied, true); assert.equal(preparedDenied, true); assert.equal(armedDenied, true);
        assert.equal(getSession(victim.id), null);
        assert.ok(otherSessionId);
        assert.equal(getSession(otherSessionId)?.userId, 'retirement-turn-other');
        assert.ok(systemSessionId); assert.equal(getSession(systemSessionId)?.authChannel, 'system');
        const retry = createSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' });
        assert.equal(getSession(retry.id), retry); deleteSession(retry.id);
        const throwing = createSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }); let throwingDenied = false;
        registerServerSessionResource(throwing.id, () => {
            try { createSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }); } catch { throwingDenied = true; }
            throw new Error('synthetic apply-then-throw');
        });
        assert.equal(retireServerSessionsForUser(userId).outcome, 'failed'); assert.equal(throwingDenied, true); assert.equal(getSession(throwing.id), null);
        const retryAfterThrow = createSession({ id: userId, username: SYNTHETIC_USERNAME, role: 'clinician' }); deleteSession(retryAfterThrow.id);
    } finally {
        if (originalThen) Object.defineProperty(Object.prototype, 'then', originalThen);
        else delete (Object.prototype as { then?: unknown }).then;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
});

test('publication rollback removes apply-then-throw authority and poisons the enclosing user turn', async (t) => {
    const nodeRequire = createRequire(import.meta.url); const modulePath = nodeRequire.resolve('./server-session.ts');
    const cached = nodeRequire.cache[modulePath];
    const originals = {
        mapGet: Map.prototype.get, mapSet: Map.prototype.set,
        weakSet: WeakMap.prototype.set, setAdd: Set.prototype.add,
    };
    let failMapSet = false; let failWeakSet = false; let failSetAdd = false;
    let failMapGetKey: string | null = null; let capturedCapsule: object | null = null;
    let capturedMapSession: { id: string } | null = null; let capturedNativeSession: { id: string } | null = null;
    const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled); t.after(() => process.off('unhandledRejection', onUnhandled));
    Map.prototype.get = function (key: unknown) {
        const result = Reflect.apply(originals.mapGet, this, [key]);
        if (key === failMapGetKey) { failMapGetKey = null; throw new Error('synthetic post-map-get failure'); }
        return result;
    };
    Map.prototype.set = function (key: unknown, value: unknown) {
        const result = Reflect.apply(originals.mapSet, this, [key, value]);
        if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
            && typeof (value as { id?: unknown }).id === 'string') capturedMapSession = value as { id: string };
        if (failMapSet) { failMapSet = false; throw new Error('synthetic post-map-set failure'); }
        return result;
    };
    WeakMap.prototype.set = function (key: object, value: unknown) {
        const result = Reflect.apply(originals.weakSet, this, [key, value]);
        if (Object.getPrototypeOf(key) === null && Reflect.ownKeys(key).length === 0) capturedCapsule = key;
        if (Object.getPrototypeOf(key) === Object.prototype && typeof (key as { id?: unknown }).id === 'string') {
            capturedNativeSession = key as { id: string };
        }
        if (failWeakSet) { failWeakSet = false; throw new Error('synthetic post-weak-set failure'); }
        return result;
    };
    Set.prototype.add = function (value: unknown) {
        const result = Reflect.apply(originals.setAdd, this, [value]);
        if (failSetAdd) { failSetAdd = false; throw new Error('synthetic post-set-add failure'); }
        return result;
    };
    let isolated: typeof import('./server-session');
    try { delete nodeRequire.cache[modulePath]; isolated = nodeRequire(modulePath) as typeof import('./server-session'); }
    finally {
        Map.prototype.get = originals.mapGet; Map.prototype.set = originals.mapSet;
        WeakMap.prototype.set = originals.weakSet; Set.prototype.add = originals.setAdd;
    }

    try {
        failMapSet = true;
        assert.throws(() => isolated.createSession({ id: 'rollback-web', username: SYNTHETIC_USERNAME, role: 'clinician' }));
        const failedWebSession = capturedMapSession as { id: string } | null;
        assert.equal(failMapSet, false); assert.ok(failedWebSession);
        assert.equal(isolated.getSession(failedWebSession.id), null);

        failWeakSet = true; capturedNativeSession = null;
        assert.throws(() => isolated.createNativeServerSession(
            { id: 'rollback-native', username: SYNTHETIC_USERNAME, role: 'clinician' },
            { clientId: 'rollback-client', clientPlatform: 'ios' },
        ));
        const failedNativeSession = capturedNativeSession as { id: string } | null;
        assert.equal(failWeakSet, false); assert.ok(failedNativeSession);
        assert.equal(isolated.getSession(failedNativeSession.id), null);
        assert.equal(isolated.isPairedNativeServerSession(failedNativeSession, { clientId: 'rollback-client', clientPlatform: 'ios' }), false);

        const prepared = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({
            id: 'rollback-prepared', username: SYNTHETIC_USERNAME, role: 'clinician',
        }));
        assert.ok(prepared); const preparedId = isolated.getPreparedWebServerSessionId(prepared); assert.ok(preparedId);
        failMapSet = true;
        assert.equal(isolated.commitPreparedWebServerSession(prepared), false);
        assert.equal(isolated.getSession(preparedId), null); assert.equal(isolated.commitPreparedWebServerSession(prepared), false);

        failWeakSet = true; capturedCapsule = null;
        assert.equal(isolated.stageWebServerSession({ id: 'rollback-stage-weak', username: SYNTHETIC_USERNAME, role: 'clinician' }), null);
        assert.ok(capturedCapsule); assert.equal(isolated.prepareStagedWebServerSession(capturedCapsule), null);

        failSetAdd = true; capturedCapsule = null;
        assert.equal(isolated.stageWebServerSession({ id: 'rollback-stage-set', username: SYNTHETIC_USERNAME, role: 'clinician' }), null);
        assert.ok(capturedCapsule); assert.equal(isolated.prepareStagedWebServerSession(capturedCapsule), null);

        const turnUser = 'rollback-turn';
        const victim = isolated.createSession({ id: turnUser, username: SYNTHETIC_USERNAME, role: 'clinician' });
        const turnStaged = isolated.stageWebServerSession({ id: turnUser, username: SYNTHETIC_USERNAME, role: 'clinician' }); assert.ok(turnStaged);
        const turnPrepared = isolated.prepareStagedWebServerSession(isolated.stageWebServerSession({
            id: turnUser, username: SYNTHETIC_USERNAME, role: 'clinician',
        })); assert.ok(turnPrepared);
        let nestedDenied = false; let nativeDenied = false; let stagedDenied = false;
        isolated.registerServerSessionResource(victim.id, () => {
            failMapGetKey = turnUser;
            failMapSet = true;
            try { isolated.createSession({ id: turnUser, username: SYNTHETIC_USERNAME, role: 'clinician' }); }
            catch { nestedDenied = true; }
            assert.equal(failMapSet, true, 'same-user Web issuance must deny before its captured Map.set');
            failMapSet = false; failWeakSet = true;
            try {
                isolated.createNativeServerSession(
                    { id: turnUser, username: SYNTHETIC_USERNAME, role: 'clinician' },
                    { clientId: 'turn-client', clientPlatform: 'ios' },
                );
            } catch { nativeDenied = true; }
            assert.equal(failWeakSet, true, 'same-user native issuance must deny before its captured WeakMap.set');
            failWeakSet = false; failSetAdd = true;
            stagedDenied = isolated.stageWebServerSession({ id: turnUser, username: SYNTHETIC_USERNAME, role: 'clinician' }) === null;
            assert.equal(failSetAdd, true, 'same-user staging must deny before its captured Set.add');
            failSetAdd = false;
            assert.equal(isolated.commitPreparedWebServerSession(turnPrepared), false);
        });
        assert.equal(isolated.retireServerSessionsForUser(turnUser).outcome, 'denied');
        assert.equal(nestedDenied, true); assert.equal(nativeDenied, true); assert.equal(stagedDenied, true);
        assert.equal(failMapGetKey, turnUser);
        assert.equal(isolated.prepareStagedWebServerSession(turnStaged), null);
        assert.equal(isolated.commitPreparedWebServerSession(turnPrepared), false);
        assert.equal(isolated.getSession(victim.id), null);

        const other = isolated.createSession({ id: 'rollback-other', username: SYNTHETIC_USERNAME, role: 'clinician' });
        const system = isolated.createSession({ id: turnUser, username: SYNTHETIC_USERNAME, role: 'system' }, 'system');
        assert.strictEqual(isolated.getSession(other.id), other); assert.strictEqual(isolated.getSession(system.id), system);
        const retry = isolated.createSession({ id: turnUser, username: SYNTHETIC_USERNAME, role: 'clinician' });
        assert.strictEqual(isolated.getSession(retry.id), retry);
        await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(unhandled, []);
    } finally {
        failMapGetKey = null; isolated.clearAllSessions();
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
