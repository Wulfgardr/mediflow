/* @Codex */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import { createApplicationLockResponse, evaluateApplicationLockAttempt } from './application-lock-server';
import { clearAllSessions, createSession, deleteSession, invalidateServerSessionForApplicationLock, peekSession, registerServerSessionResource } from './server-session';

afterEach(() => clearAllSessions());
const SYNTHETIC_USERNAME = `synthetic-${randomUUID()}`;
function createSyntheticSession() { return createSession({ id: 'synthetic-user', username: SYNTHETIC_USERNAME, role: 'clinician' }); }
function lock(sessionId: unknown, lookupProjectionOwner: (sessionId: string) => unknown = () => null) {
    return evaluateApplicationLockAttempt(sessionId, { invalidateSession: invalidateServerSessionForApplicationLock, lookupProjectionOwner });
}

test('confirms only after authority deletion and every disposer has run once', () => {
    const session = createSyntheticSession(); const events: string[] = [];
    registerServerSessionResource(session.id, (reason) => { assert.equal(peekSession(session.id), null); events.push(reason); });
    registerServerSessionResource(session.id, (reason) => { events.push(reason); });
    const attempt = lock(session.id);
    assert.deepEqual(attempt.receipt, { schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed' });
    assert.equal(attempt.sessionBeforeDeletion, session); assert.equal(peekSession(session.id), null);
    assert.deepEqual(events, ['application_locked', 'application_locked']);
});

test('confirms a completed valid stale-cookie retry for audit', () => {
    const session = createSyntheticSession(); deleteSession(session.id);
    const retry = lock(session.id);
    assert.equal(retry.receipt.state, 'server_invalidation_confirmed'); assert.equal(retry.sessionBeforeDeletion, null);
});

test('continues disposers and latches a disposal failure across retries', () => {
    const session = createSyntheticSession(); const events: string[] = [];
    registerServerSessionResource(session.id, () => { events.push('throwing'); throw new Error('synthetic cleanup failure'); });
    registerServerSessionResource(session.id, () => { events.push('continued'); });
    assert.equal(lock(session.id).receipt.state, 'server_invalidation_unconfirmed'); assert.equal(peekSession(session.id), null);
    assert.equal(lock(session.id).receipt.state, 'server_invalidation_unconfirmed'); assert.deepEqual(events, ['throwing', 'continued']);
});

test('records expired-session cleanup so a valid retry can confirm', () => {
    const session = createSyntheticSession(); session.expiresAt = 0; assert.equal(peekSession(session.id), null);
    assert.equal(lock(session.id).receipt.state, 'server_invalidation_confirmed');
});

test('denies a surviving production owner or surviving authority', () => {
    const session = createSyntheticSession();
    assert.equal(lock(session.id, () => Object.freeze({ synthetic: true })).receipt.state, 'server_invalidation_unconfirmed');
    const attempt = evaluateApplicationLockAttempt('c'.repeat(64), {
        invalidateSession: () => ({ sessionBeforeDeletion: null, cleanupOutcome: 'completed', authorityAbsent: false }), lookupProjectionOwner: () => null,
    });
    assert.equal(attempt.receipt.state, 'server_invalidation_unconfirmed');
});

test('rejects malformed or missing cookie values without deleting another session', () => {
    const session = createSyntheticSession(); const hostile = new Proxy({}, { get() { throw new Error('hostile input'); } });
    for (const value of [undefined, null, '', 'A'.repeat(64), 'a'.repeat(63), {}, hostile]) assert.equal(lock(value).receipt.state, 'server_invalidation_unconfirmed');
    assert.equal(peekSession(session.id), session);
});

test('a non-undefined result is unconfirmed without thenable assimilation', () => {
    const session = createSyntheticSession();
    registerServerSessionResource(session.id, (() => Promise.resolve()) as unknown as () => void);
    assert.equal(lock(session.id).receipt.state, 'server_invalidation_unconfirmed'); assert.equal(peekSession(session.id), null);
});

test('rejects callable Proxy and declared async cleanup before invocation', () => {
    const session = createSyntheticSession(); let called = false;
    const callableProxy = new Proxy(() => { called = true; }, {}); const declaredAsync = async () => { called = true; };
    assert.equal(registerServerSessionResource(session.id, callableProxy), null);
    assert.equal(registerServerSessionResource(session.id, declaredAsync), null); assert.equal(called, false);
});

test('supported callbacks ignore ambient Promise poison', () => {
    const session = createSyntheticSession(); const originalResolve = Promise.resolve; let calls = 0;
    registerServerSessionResource(session.id, () => { calls += 1; });
    try { Promise.resolve = (() => { throw new Error('ambient Promise poison'); }) as typeof Promise.resolve; assert.equal(lock(session.id).receipt.state, 'server_invalidation_confirmed'); }
    finally { Promise.resolve = originalResolve; }
    assert.equal(calls, 1);
});

test('production registrations remain declared synchronous void callbacks', () => {
    const broker = readFileSync(new URL('./server-session-projection-broker.ts', import.meta.url), 'utf8');
    const owner = readFileSync(new URL('./server-session-projection-owner.ts', import.meta.url), 'utf8');
    const capture = readFileSync(new URL('../ai-providers/fabric/document-synthesis-authenticated-attachment-capture.ts', import.meta.url), 'utf8');
    assert.match(broker, /registerServerSessionResource\(sessionId, \(\) => control\.revoke\(\)\)/u);
    assert.match(owner, /registerServerSessionResource\(session\.id, \(\) => finish\(false\)\)/u);
    assert.match(capture, /const dispose = \(\) => \{/u);
    assert.doesNotMatch(`${broker}\n${owner}\n${capture}`, /registerServerSessionResource\([^\n]*async/u);
});

test('route receives the primitive capture rather than pre-invalidation peek state', () => {
    const route = readFileSync(new URL('../../app/api/auth/lock/route.ts', import.meta.url), 'utf8');
    assert.match(route, /attempt\.sessionBeforeDeletion/u); assert.doesNotMatch(route, /peekSession/u);
});

test('HTTP responses expose only the exact receipt and expire cookie only on confirmation', async () => {
    const confirmed = createApplicationLockResponse(new Request('https://127.0.0.1/api/auth/lock'), { schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed' });
    const unconfirmed = createApplicationLockResponse(new Request('http://127.0.0.1/api/auth/lock'), { schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_unconfirmed' });
    assert.equal(confirmed.status, 200); assert.deepEqual(await confirmed.json(), { schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_confirmed' });
    assert.match(confirmed.headers.get('set-cookie') ?? '', /mediflow_session=; Path=\/; Max-Age=0; Secure; HttpOnly; SameSite=lax/u);
    assert.equal(unconfirmed.status, 409); assert.deepEqual(await unconfirmed.json(), { schemaVersion: 'mediflow.application-lock-receipt.v1', state: 'server_invalidation_unconfirmed' });
    assert.equal(unconfirmed.headers.get('set-cookie'), null);
});
