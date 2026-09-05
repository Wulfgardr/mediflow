/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import bcrypt from 'bcryptjs';

import { AUTH_LOCKOUT_DURATION_MS, AUTH_LOCKOUT_WINDOW_MS } from './auth-lockout.ts';
import { createFreshReviewPinUniquenessVerifier, FreshReviewPinError } from './fresh-review-pin-uniqueness.ts';

const ACTOR = Object.freeze({ actorRef: 'synthetic-actor', sessionRef: 'synthetic-session' });
const PIN = '2468';
const PIN_ATTEMPT_LEDGER_CAPACITY = 64;

test('accepts only the uniquely matching current actor after comparing every canonical hash', async () => {
    const matchingHash = await bcrypt.hash(PIN, 4);
    const nonMatchingHash = await bcrypt.hash('1357', 4);
    const comparisons: string[] = [];
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => [
            { id: ACTOR.actorRef, passwordHash: matchingHash },
            { id: 'synthetic-other', passwordHash: nonMatchingHash },
        ],
        compare: async (candidate, passwordHash) => {
            comparisons.push(passwordHash);
            return bcrypt.compare(candidate, passwordHash);
        },
    });

    const proof = await verifier.verify(PIN);
    assert.deepEqual(proof, ACTOR);
    assert.deepEqual(comparisons.sort(), [matchingHash, nonMatchingHash].sort());
    assert.equal(JSON.stringify(proof).includes(PIN), false);
});

test('denies a non-string or out-of-policy PIN before loading credentials', async () => {
    let loads = 0;
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => { loads += 1; return []; },
    });

    await assert.rejects(
        verifier.verify(null as unknown as string),
        (error) => error instanceof FreshReviewPinError && error.code === 'pin_input_invalid',
    );
    await assert.rejects(
        verifier.verify('123'),
        (error) => error instanceof FreshReviewPinError && error.code === 'pin_input_invalid',
    );
    assert.equal(loads, 0);
});

test('denies zero and multiple salted-hash matches without short-circuiting comparison', async () => {
    const unmatched = await bcrypt.hash('1357', 4);
    const samePinA = await bcrypt.hash(PIN, 4);
    const samePinB = await bcrypt.hash(PIN, 4);
    const compared: string[] = [];
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => [
            { id: ACTOR.actorRef, passwordHash: samePinA },
            { id: 'synthetic-shared', passwordHash: samePinB },
            { id: 'synthetic-unmatched', passwordHash: unmatched },
        ],
        compare: async (candidate, passwordHash) => {
            compared.push(passwordHash);
            return bcrypt.compare(candidate, passwordHash);
        },
    });

    await assert.rejects(
        verifier.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'pin_ambiguous',
    );
    assert.deepEqual(compared.sort(), [samePinA, samePinB, unmatched].sort());

    const noMatch = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => [{ id: ACTOR.actorRef, passwordHash: unmatched }],
    });
    await assert.rejects(
        noMatch.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'pin_not_matched',
    );
});

test('denies a unique PIN match belonging to a different canonical actor', async () => {
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => [{ id: 'synthetic-other', passwordHash: await bcrypt.hash(PIN, 4) }],
    });

    await assert.rejects(
        verifier.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'pin_mismatch',
    );
});

test('fails closed with typed storage, comparison, and P1a session denials', async () => {
    const unavailableStore = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => { throw new Error('synthetic storage detail'); },
    });
    await assert.rejects(
        unavailableStore.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'credential_store_unavailable'
            && !/synthetic storage/u.test(error.message),
    );

    const unavailableComparison = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => [{ id: ACTOR.actorRef, passwordHash: await bcrypt.hash(PIN, 4) }],
        compare: async () => { throw new Error('synthetic comparison detail'); },
    });
    await assert.rejects(
        unavailableComparison.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'comparison_unavailable'
            && !/synthetic comparison/u.test(error.message),
    );

    const missingSession = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => { throw Object.assign(new Error('opaque'), { code: 'session_unavailable' }); },
    });
    await assert.rejects(
        missingSession.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'session_unavailable',
    );
});

test('re-resolves P1a after comparison and denies session or principal changes', async () => {
    const credentials = [{ id: ACTOR.actorRef, passwordHash: await bcrypt.hash(PIN, 4) }];
    for (const changed of [
        { actorRef: ACTOR.actorRef, sessionRef: 'synthetic-other-session' },
        { actorRef: 'synthetic-other-actor', sessionRef: ACTOR.sessionRef },
    ]) {
        let reads = 0;
        const verifier = createFreshReviewPinUniquenessVerifier({
            resolvePrincipal: async () => (++reads === 1 ? ACTOR : changed),
            loadCanonicalCredentials: async () => credentials,
        });
        await assert.rejects(
            verifier.verify(PIN),
            (error) => error instanceof FreshReviewPinError && error.code === 'principal_changed',
        );
        assert.equal(reads, 2);
    }

    let reads = 0;
    const expired = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => {
            if (++reads === 1) return ACTOR;
            throw Object.assign(new Error('opaque'), { code: 'session_unavailable' });
        },
        loadCanonicalCredentials: async () => credentials,
    });
    await assert.rejects(
        expired.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'session_unavailable',
    );
    assert.equal(reads, 2);
});

test('limits PIN comparison to five failures per exact actor and session for fifteen minutes', async () => {
    let now = 1_900_000_000_000;
    let principal: Readonly<{ actorRef: string; sessionRef: string }> = ACTOR;
    let loads = 0;
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => principal,
        loadCanonicalCredentials: async () => {
            loads += 1;
            return [{ id: ACTOR.actorRef, passwordHash: 'synthetic-hash' }];
        },
        compare: async () => false,
        now: () => now,
    });
    const rejectedWith = async (code: string) => assert.rejects(
        verifier.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === code,
    );

    for (let attempt = 1; attempt < 5; attempt += 1) await rejectedWith('pin_not_matched');
    await rejectedWith('pin_attempts_exhausted');
    await rejectedWith('pin_attempts_exhausted');
    assert.equal(loads, 5, 'a blocked retry never loads or compares canonical credentials');

    principal = Object.freeze({ actorRef: ACTOR.actorRef, sessionRef: 'synthetic-second-session' });
    await rejectedWith('pin_not_matched');
    principal = Object.freeze({ actorRef: 'synthetic-second-actor', sessionRef: ACTOR.sessionRef });
    await rejectedWith('pin_not_matched');
    assert.equal(loads, 7, 'another actor or session has an independent budget');

    principal = ACTOR;
    now += AUTH_LOCKOUT_DURATION_MS + 1;
    await rejectedWith('pin_not_matched');
    assert.equal(loads, 8, 'the exact session can retry only after the lock interval expires');
});

test('resets an incomplete failure window and clears only the successful exact-session budget', async () => {
    let now = 1_910_000_000_000;
    let matches = false;
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => [{ id: ACTOR.actorRef, passwordHash: 'synthetic-hash' }],
        compare: async () => matches,
        now: () => now,
    });
    const denied = (code: string) => assert.rejects(
        verifier.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === code,
    );

    for (let attempt = 0; attempt < 4; attempt += 1) await denied('pin_not_matched');
    now += AUTH_LOCKOUT_WINDOW_MS + 1;
    await denied('pin_not_matched');

    matches = true;
    assert.deepEqual(await verifier.verify(PIN), ACTOR);
    matches = false;
    for (let attempt = 0; attempt < 4; attempt += 1) await denied('pin_not_matched');
    await denied('pin_attempts_exhausted');
});

test('reserves the budget before asynchronous comparisons so parallel retries cannot exceed five', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let comparisons = 0;
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => [{ id: ACTOR.actorRef, passwordHash: 'synthetic-hash' }],
        compare: async () => { comparisons += 1; await barrier; return false; },
        now: () => 1_920_000_000_000,
    });
    const firstFive = Array.from({ length: 5 }, () => verifier.verify(PIN));
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
        verifier.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'pin_attempts_exhausted',
    );
    assert.equal(comparisons, 5);
    release();
    const outcomes = await Promise.allSettled(firstFive);
    const codes = outcomes.map((outcome) => outcome.status === 'rejected'
        ? (outcome.reason as FreshReviewPinError).code : 'accepted');
    assert.equal(codes.filter((code) => code === 'pin_not_matched').length, 4);
    assert.equal(codes.filter((code) => code === 'pin_attempts_exhausted').length, 1);
});

test('fails closed before credential work when the attempt clock is invalid or regresses', async () => {
    let loads = 0;
    const invalidClock = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => { loads += 1; return []; },
        now: () => Number.NaN,
    });
    await assert.rejects(
        invalidClock.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'attempt_budget_unavailable',
    );

    let now = 1_930_000_000_000;
    const regressedClock = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => ACTOR,
        loadCanonicalCredentials: async () => { loads += 1; return []; },
        compare: async () => false,
        now: () => now,
    });
    await assert.rejects(
        regressedClock.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'pin_not_matched',
    );
    now -= 1;
    await assert.rejects(
        regressedClock.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'attempt_budget_unavailable',
    );
    assert.equal(loads, 1, 'neither invalid nor regressed time reaches another credential load');
});

test('bounds retained attempt budgets and frees capacity only after their policy window expires', async () => {
    let now = 1_940_000_000_000;
    let principal: Readonly<{ actorRef: string; sessionRef: string }> = ACTOR;
    let loads = 0;
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => principal,
        loadCanonicalCredentials: async () => {
            loads += 1;
            return [{ id: principal.actorRef, passwordHash: 'synthetic-hash' }];
        },
        compare: async () => false,
        now: () => now,
    });
    const denied = (code: string) => assert.rejects(
        verifier.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === code,
    );

    for (let index = 0; index < PIN_ATTEMPT_LEDGER_CAPACITY; index += 1) {
        principal = Object.freeze({
            actorRef: `synthetic-actor-${index}`,
            sessionRef: `synthetic-session-${index}`,
        });
        await denied('pin_not_matched');
    }

    principal = Object.freeze({ actorRef: 'synthetic-overflow-actor', sessionRef: 'synthetic-overflow-session' });
    await denied('attempt_budget_unavailable');
    assert.equal(loads, PIN_ATTEMPT_LEDGER_CAPACITY, 'capacity denial happens before credential work');

    principal = Object.freeze({ actorRef: 'synthetic-actor-0', sessionRef: 'synthetic-session-0' });
    for (let attempt = 0; attempt < 3; attempt += 1) await denied('pin_not_matched');
    await denied('pin_attempts_exhausted');

    now += Math.max(AUTH_LOCKOUT_WINDOW_MS, AUTH_LOCKOUT_DURATION_MS) + 1;
    principal = Object.freeze({ actorRef: 'synthetic-overflow-actor', sessionRef: 'synthetic-overflow-session' });
    await denied('pin_not_matched');
    assert.equal(loads, PIN_ATTEMPT_LEDGER_CAPACITY + 5, 'expired records release bounded capacity');
});

test('does not evict in-flight attempt budgets after their wall-clock window passes', async () => {
    let now = 1_950_000_000_000;
    const principals = Array.from({ length: PIN_ATTEMPT_LEDGER_CAPACITY }, (_value, index) => Object.freeze({
        actorRef: `synthetic-in-flight-actor-${index}`,
        sessionRef: `synthetic-in-flight-session-${index}`,
    }));
    const overflow = Object.freeze({
        actorRef: 'synthetic-in-flight-overflow-actor',
        sessionRef: 'synthetic-in-flight-overflow-session',
    });
    let principalIndex = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let comparisons = 0;
    const verifier = createFreshReviewPinUniquenessVerifier({
        resolvePrincipal: async () => principals[principalIndex++] ?? overflow,
        loadCanonicalCredentials: async () => [{ id: ACTOR.actorRef, passwordHash: 'synthetic-hash' }],
        compare: async () => {
            comparisons += 1;
            if (comparisons <= PIN_ATTEMPT_LEDGER_CAPACITY) await barrier;
            return false;
        },
        now: () => now,
    });

    const pending = principals.map(() => verifier.verify(PIN));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(comparisons, PIN_ATTEMPT_LEDGER_CAPACITY);

    now += AUTH_LOCKOUT_WINDOW_MS + 1;
    await assert.rejects(
        verifier.verify(PIN),
        (error) => error instanceof FreshReviewPinError && error.code === 'attempt_budget_unavailable',
    );
    assert.equal(comparisons, PIN_ATTEMPT_LEDGER_CAPACITY, 'capacity denial never replaces in-flight records');

    release();
    const outcomes = await Promise.allSettled(pending);
    assert.equal(outcomes.every((outcome) => outcome.status === 'rejected'), true);
});

test('exposes a verifier seam with only the raw PIN as caller input', () => {
    const verifier = createFreshReviewPinUniquenessVerifier({ resolvePrincipal: async () => ACTOR });
    assert.equal(verifier.verify.length, 1);

    if (false) {
        // @ts-expect-error The verifier receives no actor, session, role, review, capability, or caller session reference.
        verifier.verify(PIN, { actorRef: 'forged', sessionRef: 'forged', role: 'admin', reviewId: 'forged' });
    }
});
