/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';

import {
    begin,
    bootstrapControl,
    issue,
    mintResourcePort,
    releaseResourcePort,
    resolve as resolveExternalWebSession,
    retire as retireExternalWebSession,
    type WebSessionProjection,
} from './web-auth-lifecycle-owner-adapter';
import {
    issueSyntheticWebSession,
    issueSyntheticWebSessionContext,
    retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture';
import {
    completeExactWebP3ApplicationLock,
    type WebAuthApplicationLockSources,
} from './web-auth-application-lock-server';
import type { WebAuthControlMutation } from './web-auth-control-transport';

const request = new Request('http://127.0.0.1/api/auth/lock', { method: 'POST' });
const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;
const cookie = (value: unknown) => ({ name: 'mediflow_session', value });
const nextCookie = (value: unknown, path: unknown = '/') => ({ name: 'mediflow_session', value, path });
const CONTROL_ID = 'c'.repeat(64);
const REQUEST_ETAG = 'd'.repeat(64);
const RESPONSE_ETAG = 'e'.repeat(64);
const mutation = Object.freeze(Object.assign(Object.create(null), {
    controlId: CONTROL_ID,
    ifMatch: REQUEST_ETAG,
    idempotencyKey: '8a340d36-0920-4d13-b915-0cbb44f3db44',
})) as WebAuthControlMutation;
const completed = Object.freeze(Object.assign(Object.create(null), { outcome: 'completed' as const, etag: RESPONSE_ETAG }));
const denied = Object.freeze(Object.assign(Object.create(null), { outcome: 'denied' as const, etag: RESPONSE_ETAG }));
const active = (projection: unknown) => Object.freeze(Object.assign(Object.create(null), {
    status: 'active' as const,
    projection,
}));
const issuedSessions: WebSessionProjection[] = [];

function activate(userId: string) {
    const session = issueSyntheticWebSession({
        id: userId,
        username: SYNTHETIC_USERNAME,
        role: 'clinician',
    }, `application-lock-${randomUUID()}`) as WebSessionProjection;
    issuedSessions.push(session);
    return { sessionId: session.id, session };
}

afterEach(() => {
    for (const session of issuedSessions.splice(0)) retireSyntheticWebSession(session);
});

test('application lock retires only the exact ACTIVE Web P3 before confirming', async () => {
    const target = activate('synthetic-lock-target');
    const other = activate('synthetic-lock-other');
    const order: string[] = [];
    const sources: WebAuthApplicationLockSources = Object.freeze({
        resolve: (sessionId, controlId) => {
            assert.equal(sessionId, target.sessionId);
            assert.equal(controlId, CONTROL_ID);
            return active(target.session);
        },
        retire: (projection, reason, receivedMutation) => {
            assert.equal(projection, target.session);
            assert.equal(reason, 'lock');
            assert.equal(receivedMutation, mutation);
            order.push('retire');
            retireSyntheticWebSession(target.session);
            return completed;
        },
        audit: async (session, sessionId) => {
            order.push('audit');
            assert.equal(session, target.session);
            assert.equal(sessionId, target.sessionId);
            assert.equal(mintResourcePort(target.session), null);
        },
    });

    const response = await completeExactWebP3ApplicationLock(nextCookie(target.sessionId), mutation, request, sources);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        schemaVersion: 'mediflow.application-lock-receipt.v1',
        state: 'server_invalidation_confirmed',
    });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('etag'), `"${RESPONSE_ETAG}"`);
    assert.deepEqual(order, ['retire', 'audit']);
    assert.equal(mintResourcePort(target.session), null);
    const otherPort = mintResourcePort(other.session);
    assert.ok(otherPort);
    assert.equal(releaseResourcePort(otherPort), true);
});

test('application lock replays after retirement and advances a pending control without a bearer', async () => {
    const context = issueSyntheticWebSessionContext({
        id: 'synthetic-lock-replay', username: SYNTHETIC_USERNAME, role: 'clinician',
    }, `application-lock-replay-${randomUUID()}`);
    issuedSessions.push(context.session as WebSessionProjection);
    const replayMutation = Object.freeze({
        controlId: context.controlId,
        ifMatch: context.etag,
        idempotencyKey: randomUUID(),
    }) as WebAuthControlMutation;
    let audits = 0;
    const sources: WebAuthApplicationLockSources = Object.freeze({
        resolve: resolveExternalWebSession,
        retire: retireExternalWebSession,
        audit: async () => { audits += 1; },
    });
    const first = await completeExactWebP3ApplicationLock(cookie(context.session.id), replayMutation, request, sources);
    const replay = await completeExactWebP3ApplicationLock(cookie(context.session.id), replayMutation, request, sources);
    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get('etag'), first.headers.get('etag'));
    assert.equal(audits, 1);

    const pendingControl = bootstrapControl();
    assert.ok(pendingControl);
    const pendingAttempt = begin('login', {
        controlId: pendingControl.controlId,
        ifMatch: pendingControl.etag,
        idempotencyKey: randomUUID(),
    });
    assert.ok(pendingAttempt);
    const pendingMutation = Object.freeze({
        controlId: pendingControl.controlId,
        ifMatch: pendingControl.etag,
        idempotencyKey: randomUUID(),
    }) as WebAuthControlMutation;
    const pendingLock = await completeExactWebP3ApplicationLock(undefined, pendingMutation, request, sources);
    assert.equal(pendingLock.status, 200);
    assert.equal(issue(pendingAttempt, {
        id: 'synthetic-lock-late-user', username: SYNTHETIC_USERNAME, role: 'clinician',
    }), null);
});

test('application lock treats hostile bearer data as inert and rejects malformed owner receipts', async () => {
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
        resolve: () => { resolves += 1; return active(target.session); },
        retire: () => { retires += 1; return completed; },
        audit: async () => { audits += 1; },
    });

    for (const value of [undefined, null, {}, proxy, accessor, Promise.resolve(),
        { ...cookie(target.sessionId), extra: true }, nextCookie(target.sessionId, '/wrong'),
        { ...nextCookie(target.sessionId), extra: true }, cookie('A'.repeat(64)), cookie('a'.repeat(63))]) {
        const response = await completeExactWebP3ApplicationLock(value, mutation, request, inertSources);
        assert.equal(response.status, 200);
    }
    assert.deepEqual([traps, getters, resolves, retires, audits], [0, 0, 0, 11, 0]);

    const mutableSession = { ...target.session };
    const sessionAccessor = { ...target.session };
    Object.defineProperty(sessionAccessor, 'role', {
        enumerable: true,
        get() { getters += 1; return 'clinician'; },
    });
    for (const session of [mutableSession, sessionAccessor, new Proxy(target.session, {}),
        { ...target.session, authChannel: 'native' }, { ...target.session, authChannel: 'system' }]) {
        const response = await completeExactWebP3ApplicationLock(cookie(target.sessionId), mutation, request, Object.freeze({
            resolve: () => active(session),
            retire: () => { retires += 1; return completed; },
            audit: async () => { audits += 1; },
        }));
        assert.equal(response.status, 200);
    }
    assert.equal(getters, 0);
    assert.equal(retires, 16);

    for (const receipt of [{ outcome: 'completed' }, new Proxy(completed, {})]) {
        const response = await completeExactWebP3ApplicationLock(cookie(target.sessionId), mutation, request, Object.freeze({
            resolve: () => active(target.session),
            retire: () => receipt as never,
            audit: async () => { audits += 1; },
        }));
        assert.equal(response.status, 409);
    }
    assert.equal(audits, 0);

    const stale = await completeExactWebP3ApplicationLock(cookie(target.sessionId), mutation, request, Object.freeze({
        resolve: () => active(target.session),
        retire: () => denied,
        audit: async () => { audits += 1; },
    }));
    assert.equal(stale.status, 409);
    assert.equal(stale.headers.get('etag'), `"${RESPONSE_ETAG}"`);
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
            const response = await completeExactWebP3ApplicationLock(cookie(target.sessionId), mutation, request, Object.freeze({
                resolve: () => active(target.session),
                retire: (_projection, reason) => {
                    assert.equal(reason, 'lock');
                    retireSyntheticWebSession(target.session);
                    return completed;
                },
                audit,
            }));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(response.status, 200);
            assert.equal(mintResourcePort(target.session), null);
            assert.deepEqual(unhandled, []);
        } finally {
            process.off('unhandledRejection', listener);
            retireSyntheticWebSession(target.session);
        }
    }
});
