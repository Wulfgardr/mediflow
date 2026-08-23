/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import bcrypt from 'bcryptjs';

import { createFreshReviewPinUniquenessVerifier, FreshReviewPinError } from './fresh-review-pin-uniqueness.ts';

const ACTOR = Object.freeze({ actorRef: 'synthetic-actor', sessionRef: 'synthetic-session' });
const PIN = '2468';

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

test('exposes a verifier seam with only the raw PIN as caller input', () => {
    const verifier = createFreshReviewPinUniquenessVerifier({ resolvePrincipal: async () => ACTOR });
    assert.equal(verifier.verify.length, 1);

    if (false) {
        // @ts-expect-error The verifier receives no actor, session, role, review, capability, or caller session reference.
        verifier.verify(PIN, { actorRef: 'forged', sessionRef: 'forged', role: 'admin', reviewId: 'forged' });
    }
});
