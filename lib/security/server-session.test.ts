/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';

import {
    clearAllSessions,
    createSession,
    deleteSession,
    getSession,
    peekSession,
    registerServerSessionResource,
} from './server-session';

const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;

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
