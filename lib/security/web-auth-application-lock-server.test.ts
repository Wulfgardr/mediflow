/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';

import {
    activateArmedWebServerSession,
    armPreparedWebServerSession,
    clearAllSessions,
    dispatchActiveWebServerSessionRetirement,
    getPreparedWebServerSessionId,
    prepareStagedWebServerSession,
    resolveActiveWebServerSession,
    stageWebServerSession,
} from './server-session';
import { createWebAuthControlRecord } from './web-auth-control-record';
import {
    completeExactWebP3ApplicationLock,
    type WebAuthApplicationLockSources,
} from './web-auth-application-lock-server';

const request = new Request('http://127.0.0.1/api/auth/lock', { method: 'POST' });
const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;
const cookie = (value: unknown) => ({ name: 'mediflow_session', value });
const completed = Object.freeze(Object.assign(Object.create(null), { outcome: 'completed' as const }));
const denied = Object.freeze(Object.assign(Object.create(null), { outcome: 'denied' as const }));

function activate(userId: string) {
    const prepared = prepareStagedWebServerSession(stageWebServerSession({
        id: userId,
        username: SYNTHETIC_USERNAME,
        role: 'clinician',
    }));
    assert.ok(prepared);
    const sessionId = getPreparedWebServerSessionId(prepared);
    assert.ok(sessionId);
    const port = armPreparedWebServerSession(prepared);
    assert.ok(port);
    const control = createWebAuthControlRecord('f0');
    assert.equal(control.begin('login', 'operation', 'key', 'fingerprint', 0).ok, true);
    const ticket = control.prepareAuthControlTicket('f0', 'operation', BigInt(0), 'fingerprint', sessionId, 1);
    assert.ok(ticket);
    assert.equal(activateArmedWebServerSession(port, ticket), true);
    return { sessionId, session: resolveActiveWebServerSession(sessionId)! };
}

afterEach(() => clearAllSessions());

test('application lock retires only the exact ACTIVE Web P3 before confirming', async () => {
    const target = activate('synthetic-lock-target');
    const other = activate('synthetic-lock-other');
    const order: string[] = [];
    const sources: WebAuthApplicationLockSources = Object.freeze({
        resolve: resolveActiveWebServerSession,
        retire: (sessionId, reason) => {
            assert.equal(sessionId, target.sessionId);
            assert.equal(reason, 'lock');
            order.push('retire');
            return dispatchActiveWebServerSessionRetirement(sessionId, reason);
        },
        audit: async (session, sessionId) => {
            order.push('audit');
            assert.equal(session, target.session);
            assert.equal(sessionId, target.sessionId);
            assert.equal(resolveActiveWebServerSession(sessionId), null);
        },
    });

    const response = await completeExactWebP3ApplicationLock(cookie(target.sessionId), request, sources);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        schemaVersion: 'mediflow.application-lock-receipt.v1',
        state: 'server_invalidation_confirmed',
    });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(order, ['retire', 'audit']);
    assert.equal(resolveActiveWebServerSession(target.sessionId), null);
    assert.equal(resolveActiveWebServerSession(other.sessionId), other.session);
});

test('application lock denies hostile bearer, session and retirement receipts without authority expansion', async () => {
    const target = activate('synthetic-lock-hostile');
    let traps = 0;
    let getters = 0;
    let resolves = 0;
    let retires = 0;
    let audits = 0;
    const proxy = new Proxy(cookie(target.sessionId), {
        get() { traps += 1; throw new Error('synthetic trap'); },
        ownKeys() { traps += 1; throw new Error('synthetic trap'); },
    });
    const accessor = cookie(target.sessionId);
    Object.defineProperty(accessor, 'value', {
        enumerable: true,
        get() { getters += 1; throw new Error('synthetic getter'); },
    });
    const inertSources: WebAuthApplicationLockSources = Object.freeze({
        resolve: () => { resolves += 1; return target.session; },
        retire: () => { retires += 1; return completed; },
        audit: async () => { audits += 1; },
    });

    for (const value of [undefined, null, {}, proxy, accessor, Promise.resolve(),
        { ...cookie(target.sessionId), extra: true }, cookie('A'.repeat(64)), cookie('a'.repeat(63))]) {
        const response = await completeExactWebP3ApplicationLock(value, request, inertSources);
        assert.equal(response.status, 409);
    }
    assert.deepEqual([traps, getters, resolves, retires, audits], [0, 0, 0, 0, 0]);

    const mutableSession = { ...target.session };
    const sessionAccessor = { ...target.session };
    Object.defineProperty(sessionAccessor, 'role', {
        enumerable: true,
        get() { getters += 1; return 'clinician'; },
    });
    for (const session of [mutableSession, sessionAccessor, new Proxy(target.session, {}),
        { ...target.session, authChannel: 'native' }, { ...target.session, authChannel: 'system' }]) {
        const response = await completeExactWebP3ApplicationLock(cookie(target.sessionId), request, Object.freeze({
            resolve: () => session as never,
            retire: () => { retires += 1; return completed; },
            audit: async () => { audits += 1; },
        }));
        assert.equal(response.status, 409);
    }
    assert.equal(getters, 0);

    for (const receipt of [denied, { outcome: 'completed' }, new Proxy(completed, {})]) {
        const response = await completeExactWebP3ApplicationLock(cookie(target.sessionId), request, Object.freeze({
            resolve: () => target.session,
            retire: () => receipt as never,
            audit: async () => { audits += 1; },
        }));
        assert.equal(response.status, 409);
    }
    assert.equal(audits, 0);
});

test('application lock contains ancillary audit failure after terminal retirement', async () => {
    for (const audit of [
        () => { throw new Error('synthetic audit throw'); },
        async () => { throw new Error('synthetic audit rejection'); },
    ]) {
        const target = activate(`synthetic-lock-audit-${randomUUID()}`);
        const unhandled: unknown[] = [];
        const listener = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', listener);
        try {
            const response = await completeExactWebP3ApplicationLock(cookie(target.sessionId), request, Object.freeze({
                resolve: resolveActiveWebServerSession,
                retire: dispatchActiveWebServerSessionRetirement,
                audit,
            }));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(response.status, 200);
            assert.equal(resolveActiveWebServerSession(target.sessionId), null);
            assert.deepEqual(unhandled, []);
        } finally {
            process.off('unhandledRejection', listener);
            clearAllSessions();
        }
    }
});
