/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import {
    createSessionPhysicianReviewAuthorityService,
    SessionPhysicianReviewAuthorityError,
    type SessionPhysicianReviewAuthorityErrorCode,
} from './session-physician-review-authority.ts';
import {
    type ServerSession,
} from './server-session.ts';
import {
    issueSyntheticWebSession,
    retireSyntheticWebSession,
    retireSyntheticWebSessionsForUser,
} from './web-auth-lifecycle-owner-test-fixture.ts';

const USER = Object.freeze({
    id: 'synthetic-review-authority-user',
    username: ['synthetic', 'review', 'authority', 'clinician'].join('-'),
    role: 'user',
});

function activeAttestation(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 'mediflow.physician-review-attestation.v1',
        actorRef: USER.id,
        capability: 'physician_terminal_review',
        status: 'active',
        attestationVersion: 1,
        policyVersion: 'physician_terminal_review.v1',
        revokedAt: null,
        createdAt: new Date(1_000),
        updatedAt: new Date(1_000),
        ...overrides,
    };
}

type FixtureOptions = Readonly<{
    attestation?: unknown;
    account?: unknown;
    principal?: Readonly<{ actorRef: string; sessionRef: string }>;
    retireDuringAttestation?: boolean;
    throwFrom?: 'account' | 'attestation';
}>;
const sessions: ServerSession[] = [];
let sequence = 0;

afterEach(() => {
    while (sessions.length > 0) retireSyntheticWebSession(sessions.pop()!);
});

function fixture(options: FixtureOptions = {}) {
    const session = issueSyntheticWebSession(USER, `review-authority-${sequence += 1}`);
    sessions.push(session);
    const state: {
        account: unknown;
        attestation: unknown;
        now: number;
        principal: Readonly<{ actorRef: string; sessionRef: string }>;
        session: ServerSession | null;
    } = {
        account: options.account === undefined ? { id: USER.id, lockedUntil: null } : options.account,
        attestation: options.attestation === undefined ? activeAttestation() : options.attestation,
        now: Date.now(),
        principal: options.principal ?? { actorRef: USER.id, sessionRef: session.id },
        session,
    };
    const service = createSessionPhysicianReviewAuthorityService({
        resolvePrincipal: async () => state.principal,
        readCurrentSession: async () => state.session,
        readAttestation: async () => {
            if (options.throwFrom === 'attestation') throw new Error('synthetic attestation storage detail');
            if (options.retireDuringAttestation) retireSyntheticWebSession(session);
            return state.attestation;
        },
        readAccount: async () => {
            if (options.throwFrom === 'account') throw new Error('synthetic account storage detail');
            return state.account;
        },
        clock: () => state.now,
    });

    return { service, session, state };
}

async function assertDenied(value: Promise<unknown>, code: SessionPhysicianReviewAuthorityErrorCode) {
    await assert.rejects(value, (error) => error instanceof SessionPhysicianReviewAuthorityError && error.code === code);
}

test('derives a frozen active P1/P2 authority only for the current non-sliding web session', async () => {
    const { service, session } = fixture();
    const expiry = session.expiresAt;

    const authority = await service.derive();

    assert.deepEqual(Object.keys(authority).sort(), [
        'actorRef', 'attestationVersion', 'authenticated', 'expiresAt',
        'revocationGeneration', 'schemaVersion', 'sessionGeneration', 'unlocked',
    ]);
    assert.equal(authority.schemaVersion, 'mediflow.session-physician-review-authority.v1');
    assert.equal(authority.actorRef, USER.id);
    assert.equal(authority.attestationVersion, 1);
    assert.equal(authority.authenticated, true);
    assert.equal(authority.unlocked, true);
    assert.equal(authority.expiresAt, expiry);
    assert.notEqual(authority.sessionGeneration, session.id);
    assert.equal(Object.isFrozen(authority), true);
    assert.equal(await service.recheck(authority), authority);
    assert.equal(session.expiresAt, expiry);
    await assertDenied(service.recheck(Object.freeze({ ...authority })), 'projection_unavailable');
});

test('denies missing, inactive, revoked, incompatible, and corrupt attestations', async () => {
    const cases: readonly [string, unknown, SessionPhysicianReviewAuthorityErrorCode][] = [
        ['missing', null, 'attestation_unavailable'],
        ['inactive', activeAttestation({ status: 'inactive' }), 'attestation_inactive'],
        ['revoked', activeAttestation({ status: 'revoked', revokedAt: new Date(2_000) }), 'attestation_revoked'],
        ['version-drift', activeAttestation({ attestationVersion: 2 }), 'attestation_version_drift'],
        ['corrupt', activeAttestation({ updatedAt: new Date(Number.NaN) }), 'attestation_unavailable'],
    ];

    for (const [name, attestation, code] of cases) {
        await assertDenied(fixture({ attestation }).service.derive(), code);
        assert.equal(name.length > 0, true);
    }
});

test('denies principal discontinuity, active account locks, and storage uncertainty', async () => {
    await assertDenied(
        fixture({ principal: { actorRef: USER.id, sessionRef: 'synthetic-wrong-session' } }).service.derive(),
        'principal_mismatch',
    );
    await assertDenied(
        fixture({ account: { id: USER.id, lockedUntil: new Date(Date.now() + 60_000) } }).service.derive(),
        'account_locked',
    );
    await assertDenied(fixture({ throwFrom: 'attestation' }).service.derive(), 'storage_unavailable');
    await assertDenied(fixture({ throwFrom: 'account' }).service.derive(), 'storage_unavailable');
    await assertDenied(fixture({ retireDuringAttestation: true }).service.derive(), 'session_unavailable');
});

test('recheck fails closed when the attestation lifecycle or version changes', async () => {
    const cases: readonly [unknown, SessionPhysicianReviewAuthorityErrorCode][] = [
        [activeAttestation({ status: 'inactive' }), 'attestation_inactive'],
        [activeAttestation({ status: 'revoked', revokedAt: new Date(2_000) }), 'attestation_revoked'],
        [activeAttestation({ attestationVersion: 2 }), 'attestation_version_drift'],
        [activeAttestation({ updatedAt: new Date(2_000) }), 'projection_stale'],
    ];

    for (const [attestation, code] of cases) {
        const current = fixture();
        const authority = await current.service.derive();
        current.state.attestation = attestation;
        await assertDenied(current.service.recheck(authority), code);
    }
});

test('invalidates prior authority for deletion, expiry, principal drift, lock drift, and restart', async () => {
    const deleted = fixture();
    const deletedAuthority = await deleted.service.derive();
    retireSyntheticWebSession(deleted.session);
    await assertDenied(deleted.service.recheck(deletedAuthority), 'projection_unavailable');

    const expired = fixture();
    const expiredAuthority = await expired.service.derive();
    expired.state.now = expired.session.expiresAt;
    await assertDenied(expired.service.recheck(expiredAuthority), 'session_unavailable');

    const changedPrincipal = fixture();
    const changedAuthority = await changedPrincipal.service.derive();
    const replacement = issueSyntheticWebSession(USER, `review-authority-replacement-${sequence += 1}`);
    sessions.push(replacement);
    changedPrincipal.state.session = replacement;
    changedPrincipal.state.principal = { actorRef: USER.id, sessionRef: replacement.id };
    await assertDenied(changedPrincipal.service.recheck(changedAuthority), 'projection_stale');

    const locked = fixture();
    const lockedAuthority = await locked.service.derive();
    locked.state.account = { id: USER.id, lockedUntil: new Date(Date.now() + 60_000) };
    await assertDenied(locked.service.recheck(lockedAuthority), 'account_locked');

    const firstProcess = fixture();
    const firstProcessAuthority = await firstProcess.service.derive();
    await assertDenied(fixture().service.recheck(firstProcessAuthority), 'projection_unavailable');
});

test('deduplicates concurrent derivation and revokes the authority through canonical user invalidation', async () => {
    const { service, session } = fixture();
    const [first, second] = await Promise.all([service.derive(), service.derive()]);

    assert.equal(first, second);
    retireSyntheticWebSessionsForUser(session);
    await assertDenied(service.recheck(first), 'projection_unavailable');
});

test('exposes no caller identity, transport grant, route, or persistence seam', () => {
    const source = readFileSync(new URL('./session-physician-review-authority.ts', import.meta.url), 'utf8');
    assert.equal(fixture().service.derive.length, 0);
    assert.doesNotMatch(source, /\b(cookies|headers|Request|URL|role|device|gesture|provider|apply)\b/u);
    assert.doesNotMatch(source, /app\/api|NextResponse|dbServer\.(?:insert|update|delete)/u);
});
