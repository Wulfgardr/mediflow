/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    abortNativeLegacyUserRetirement,
    abortNativeSystemAdminReset,
    activateArmedWebServerSession,
    armPreparedWebServerSession,
    captureNativeLoginSessionFence,
    clearAllSessions,
    commitNativeLegacyUserRetirement,
    commitNativeSystemAdminReset,
    createNativeServerSession,
    createSession,
    getPreparedWebServerSessionId,
    getSession,
    isPairedNativeServerSession,
    prepareNativeLegacyUserRetirement,
    prepareNativeSystemAdminReset,
    prepareStagedWebServerSession,
    registerServerSessionResource,
    resolveActiveWebServerSession,
    stageWebServerSession,
} from './server-session.ts';

const NATIVE_BINDING = Object.freeze({ clientId: 'synthetic-macos', clientPlatform: 'macos' as const });
const OTHER_BINDING = Object.freeze({ clientId: 'synthetic-ios', clientPlatform: 'ios' as const });
const USER = Object.freeze({ id: 'synthetic-user', username: 'synthetic-user', role: 'admin' });
const OTHER_USER = Object.freeze({ id: 'synthetic-other', username: 'synthetic-other', role: 'clinician' });

test.afterEach(() => clearAllSessions());

test('native/system admin reset abort preserves authority and commit retires only native/system authority', () => {
    const native = createNativeServerSession(USER, NATIVE_BINDING);
    const system = createSession({ ...USER }, 'system');
    const inertLegacyWeb = createSession({ ...USER }, 'web');
    const disposal: string[] = [];
    registerServerSessionResource(native.id, (reason) => { disposal.push(`native:${reason}`); });
    registerServerSessionResource(system.id, (reason) => { disposal.push(`system:${reason}`); });
    registerServerSessionResource(inertLegacyWeb.id, (reason) => { disposal.push(`legacy:${reason}`); });

    const aborted = prepareNativeSystemAdminReset();
    assert.ok(aborted);
    assert.throws(() => createNativeServerSession(OTHER_USER, OTHER_BINDING), /operation_in_progress/u);
    assert.throws(() => createSession({ ...OTHER_USER }, 'system'), /operation_in_progress/u);
    assert.ok(createSession({ ...OTHER_USER }, 'web'));
    assert.equal(abortNativeSystemAdminReset(aborted), true);
    assert.equal(abortNativeSystemAdminReset(aborted), false);
    assert.equal(getSession(native.id), native);
    assert.equal(getSession(system.id), system);

    const committed = prepareNativeSystemAdminReset();
    assert.ok(committed);
    assert.equal(commitNativeSystemAdminReset(committed).outcome, 'completed');
    assert.equal(commitNativeSystemAdminReset(committed).outcome, 'denied');
    assert.equal(getSession(native.id), null);
    assert.equal(getSession(system.id), null);
    assert.equal(getSession(inertLegacyWeb.id), inertLegacyWeb);
    assert.equal(isPairedNativeServerSession(native, NATIVE_BINDING), false);
    assert.equal(isPairedNativeServerSession(inertLegacyWeb, NATIVE_BINDING), false);
    assert.deepEqual(disposal, ['native:session_deleted', 'system:session_deleted']);
});

test('per-user capability retires native authority and cleans inert legacy Web without touching system or other users', () => {
    const native = createNativeServerSession(USER, NATIVE_BINDING);
    const otherNative = createNativeServerSession(OTHER_USER, OTHER_BINDING);
    const system = createSession({ ...USER }, 'system');
    const inertLegacyWeb = createSession({ ...USER }, 'web');
    const disposal: string[] = [];
    registerServerSessionResource(native.id, (reason) => { disposal.push(`native:${reason}`); });
    registerServerSessionResource(inertLegacyWeb.id, (reason) => { disposal.push(`legacy:${reason}`); });

    const aborted = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(aborted);
    assert.throws(() => createNativeServerSession(USER, NATIVE_BINDING), /operation_in_progress/u);
    assert.ok(createNativeServerSession(OTHER_USER, OTHER_BINDING));
    assert.equal(abortNativeLegacyUserRetirement(aborted), true);
    assert.equal(getSession(native.id), native);
    assert.equal(getSession(inertLegacyWeb.id), inertLegacyWeb);

    const committed = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(committed);
    assert.equal(commitNativeLegacyUserRetirement(Object.freeze({ ...committed })).outcome, 'denied');
    assert.equal(commitNativeLegacyUserRetirement(committed).outcome, 'completed');
    assert.equal(commitNativeLegacyUserRetirement(committed).outcome, 'denied');
    assert.equal(getSession(native.id), null);
    assert.equal(getSession(inertLegacyWeb.id), null);
    assert.equal(getSession(otherNative.id), otherNative);
    assert.equal(getSession(system.id), system);
    assert.deepEqual(disposal, ['native:session_deleted', 'legacy:session_deleted']);
});

test('same-user retirement aliases are one-shot while unrelated overlap leaves the published turn valid', () => {
    const native = createNativeServerSession(USER, NATIVE_BINDING);
    const prepared = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(prepared);
    const alias = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(alias);
    assert.notEqual(alias, prepared);

    assert.equal(prepareNativeLegacyUserRetirement(OTHER_USER.id), null);
    assert.equal(prepareNativeSystemAdminReset(), null);
    assert.equal(abortNativeLegacyUserRetirement(alias), true);
    assert.equal(abortNativeLegacyUserRetirement(alias), false);
    assert.equal(commitNativeLegacyUserRetirement(prepared).outcome, 'completed');
    assert.equal(getSession(native.id), null);
    assert.equal(isPairedNativeServerSession(native, NATIVE_BINDING), false);
});

test('the winning same-user alias invalidates every peer capability and commits authority once', () => {
    const native = createNativeServerSession(USER, NATIVE_BINDING);
    const first = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(first);
    const winner = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(winner);

    assert.equal(commitNativeLegacyUserRetirement(winner).outcome, 'completed');
    assert.equal(commitNativeLegacyUserRetirement(first).outcome, 'denied');
    assert.equal(abortNativeLegacyUserRetirement(first), false);
    assert.equal(getSession(native.id), null);
    assert.equal(isPairedNativeServerSession(native, NATIVE_BINDING), false);
});

test('native login fences are commit-invalidated once and only for the retired user', () => {
    const staleForUser = captureNativeLoginSessionFence();
    const validForOtherUser = captureNativeLoginSessionFence();
    const validAfterAbort = captureNativeLoginSessionFence();
    const aborted = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(aborted);
    assert.equal(abortNativeLegacyUserRetirement(aborted), true);
    const beforeCommit = createNativeServerSession(USER, NATIVE_BINDING, validAfterAbort);

    const committed = prepareNativeLegacyUserRetirement(USER.id);
    assert.ok(committed);
    assert.equal(commitNativeLegacyUserRetirement(committed).outcome, 'completed');
    assert.equal(getSession(beforeCommit.id), null);
    assert.throws(
        () => createNativeServerSession(USER, NATIVE_BINDING, staleForUser),
        /native_login_session_fence_stale/u,
    );

    const unrelated = createNativeServerSession(OTHER_USER, OTHER_BINDING, validForOtherUser);
    assert.equal(isPairedNativeServerSession(unrelated, OTHER_BINDING), true);
    assert.throws(
        () => createNativeServerSession(OTHER_USER, OTHER_BINDING, validForOtherUser),
        /native_login_session_fence_stale/u,
    );
    const fresh = createNativeServerSession(USER, NATIVE_BINDING, captureNativeLoginSessionFence());
    assert.equal(isPairedNativeServerSession(fresh, NATIVE_BINDING), true);
});

test('native/system reset remains terminal when cleanup reenters preparation', () => {
    const native = createNativeServerSession(USER, NATIVE_BINDING);
    let nested: ReturnType<typeof prepareNativeSystemAdminReset> | undefined;
    registerServerSessionResource(native.id, () => {
        nested = prepareNativeSystemAdminReset();
    });

    const prepared = prepareNativeSystemAdminReset();
    assert.ok(prepared);
    assert.equal(commitNativeSystemAdminReset(prepared).outcome, 'failed');
    assert.equal(nested, null);
    assert.equal(getSession(native.id), null);
    assert.equal(isPairedNativeServerSession(native, NATIVE_BINDING), false);
    assert.ok(createNativeServerSession(OTHER_USER, OTHER_BINDING));
});

test('historical P3 activation is fail-closed and server-session has no P2 runtime import', () => {
    const source = readFileSync(new URL('./server-session.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\/web-auth-control-record['"]/u);
    assert.match(source, /function prepareAuthControlActivation[\s\S]*?return null;/u);
    assert.match(source, /function commitPreparedAuthControlActivation[\s\S]*?return 0;/u);
    assert.match(source, /function prepareAuthControlRetirement[\s\S]*?return null;/u);
    assert.match(source, /function commitPreparedAuthControlRetirement[\s\S]*?return 0;/u);

    const staged = stageWebServerSession({ ...USER });
    assert.ok(staged);
    const prepared = prepareStagedWebServerSession(staged);
    assert.ok(prepared);
    const sessionId = getPreparedWebServerSessionId(prepared);
    assert.ok(sessionId);
    const armed = armPreparedWebServerSession(prepared);
    assert.ok(armed);
    assert.equal(activateArmedWebServerSession(armed, Object.freeze({})), false);
    assert.equal(resolveActiveWebServerSession(sessionId), null);
    assert.equal(getSession(sessionId), null);
});
