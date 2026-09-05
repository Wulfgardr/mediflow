/* @Codex */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
    AuthenticatedReviewPrincipalError,
    createAuthenticatedReviewPrincipalResolver,
} from './authenticated-review-principal.ts';
import type { ServerSession } from './server-session.ts';
import {
    issueSyntheticWebSession,
    retireSyntheticWebSession,
} from './web-auth-lifecycle-owner-test-fixture.ts';

const USER = Object.freeze({
    id: ['synthetic', 'review', 'user'].join('-'),
    username: ['synthetic', 'review', 'clinician'].join('-'),
    role: 'user',
});
const MISMATCHED_USERNAME = ['synthetic', 'other', 'principal'].join('-');
const sessions: ServerSession[] = [];
let sequence = 0;

afterEach(() => {
    while (sessions.length > 0) retireSyntheticWebSession(sessions.pop()!);
});

function currentWebSession(): ServerSession {
    const session = issueSyntheticWebSession(USER, `review-principal-${sequence += 1}`);
    sessions.push(session);
    return session;
}

function resolver(
    session: ServerSession | null,
    lookup: (userId: string) => Promise<readonly { id: string; username: string }[]>,
) {
    return createAuthenticatedReviewPrincipalResolver({
        readCurrentSession: async () => session,
        lookupUsersById: lookup,
    });
}

test('resolves only the opaque actor and current session binding from the canonical principal', async () => {
    const session = currentWebSession();
    const principal = await resolver(session, async (userId) => [{ id: userId, username: USER.username }]).resolve();

    assert.deepEqual(principal, { actorRef: USER.id, sessionRef: session.id });
    assert.deepEqual(Object.keys(principal).sort(), ['actorRef', 'sessionRef']);
});

test('resolving the canonical review principal does not slide session expiry', async () => {
    const session = currentWebSession();
    const expiry = session.expiresAt;

    await resolver(session, async (userId) => [{ id: userId, username: USER.username }]).resolve();

    assert.equal(session.expiresAt, expiry);
});

test('denies a missing canonical user and a username-discontinuous principal', async () => {
    const session = currentWebSession();
    await assert.rejects(
        resolver(session, async () => []).resolve(),
        (error) => error instanceof AuthenticatedReviewPrincipalError && error.code === 'principal_missing',
    );
    await assert.rejects(
        resolver(session, async (userId) => [{ id: userId, username: MISMATCHED_USERNAME }]).resolve(),
        (error) => error instanceof AuthenticatedReviewPrincipalError && error.code === 'principal_mismatch',
    );
});

test('denies when the owner retires the projection during canonical lookup', async () => {
    const session = currentWebSession();
    await assert.rejects(
        resolver(session, async (userId) => {
            retireSyntheticWebSession(session);
            return [{ id: userId, username: USER.username }];
        }).resolve(),
        (error) => error instanceof AuthenticatedReviewPrincipalError && error.code === 'session_ineligible',
    );
});

test('denies duplicate lookup results, storage failures, and system sessions', async () => {
    const session = currentWebSession();
    const same = { id: USER.id, username: USER.username };
    await assert.rejects(
        resolver(session, async () => [same, same]).resolve(),
        (error) => error instanceof AuthenticatedReviewPrincipalError && error.code === 'principal_ambiguous',
    );
    await assert.rejects(
        resolver(session, async () => { throw new Error('synthetic storage detail'); }).resolve(),
        (error) => error instanceof AuthenticatedReviewPrincipalError && error.code === 'storage_unavailable'
            && !/synthetic storage/u.test(error.message),
    );

    const systemSession: ServerSession = { ...session, id: 'system.synthetic.review-principal', authChannel: 'system' };
    await assert.rejects(
        resolver(systemSession, async () => [same]).resolve(),
        (error) => error instanceof AuthenticatedReviewPrincipalError && error.code === 'session_ineligible',
    );
});

test('exposes no caller-supplied identity parameter at the public resolver seam', () => {
    const seam = resolver(null, async () => []);
    assert.equal(seam.resolve.length, 0);

    if (false) {
        // @ts-expect-error The public seam accepts no actor, role, review, capability, or credential input.
        seam.resolve({ actorRef: 'forged', role: 'admin', reviewId: 'forged', capability: 'forged' });
    }
});
