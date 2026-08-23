/* @Codex */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createPhysicianReviewAttestationEnrollmentService,
    PhysicianReviewAttestationEnrollmentError,
} from './physician-review-attestation-enrollment.ts';

const PIN = '2468';
const PROOF = Object.freeze({ actorRef: 'synthetic-attestation-actor', sessionRef: 'synthetic-review-session' });
const ACTIVE = Object.freeze({
    schemaVersion: 'mediflow.physician-review-attestation.v1' as const,
    actorRef: PROOF.actorRef,
    capability: 'physician_terminal_review' as const,
    status: 'active' as const,
    attestationVersion: 1 as const,
    policyVersion: 'physician_terminal_review.v1' as const,
    revokedAt: null,
    createdAt: new Date(1_000),
    updatedAt: new Date(1_000),
});

test('enrolls from only a fresh raw PIN and returns a frozen non-authority projection', async () => {
    const seenActors: string[] = [];
    const service = createPhysicianReviewAttestationEnrollmentService({
        verifyFreshPin: async (pin) => {
            assert.equal(pin, PIN);
            return PROOF;
        },
        activateAttestation: (actorRef) => {
            seenActors.push(actorRef);
            return ACTIVE;
        },
    });

    const projection = await service.enroll(PIN);
    assert.deepEqual(projection, {
        schemaVersion: 'mediflow.physician-review-attestation-enrollment.v1',
        status: 'active',
        attestationVersion: 1,
    });
    assert.deepEqual(seenActors, [PROOF.actorRef]);
    assert.equal(Object.isFrozen(projection), true);
    assert.equal(JSON.stringify(projection).includes(PIN), false);
    assert.equal(JSON.stringify(projection).includes(PROOF.actorRef), false);
    assert.equal(JSON.stringify(projection).includes(PROOF.sessionRef), false);
});

test('fails closed without returning a raw PIN, proof, actor, session, or lifecycle detail', async () => {
    const errors = [
        new Error(PIN),
        Object.assign(new Error('synthetic active detail'), { code: 'attestation_not_inactive' }),
        Object.assign(new Error('synthetic missing detail'), { code: 'attestation_missing' }),
        Object.assign(new Error('synthetic schema detail'), { code: 'schema_incompatible' }),
    ];

    for (const failure of errors) {
        const service = createPhysicianReviewAttestationEnrollmentService({
            verifyFreshPin: async () => {
                if (failure.message === PIN) throw failure;
                return PROOF;
            },
            activateAttestation: () => { throw failure; },
        });
        await assert.rejects(
            service.enroll(PIN),
            (error) => error instanceof PhysicianReviewAttestationEnrollmentError
                && ['enrollment_denied', 'storage_unavailable'].includes(error.code)
                && !error.message.includes(PIN)
                && !error.message.includes(PROOF.actorRef)
                && !error.message.includes(PROOF.sessionRef),
        );
    }
});

test('exposes no caller-supplied actor, session, role, capability, status, or version', () => {
    const service = createPhysicianReviewAttestationEnrollmentService({
        verifyFreshPin: async () => PROOF,
        activateAttestation: () => ACTIVE,
    });
    assert.equal(service.enroll.length, 1);

    if (false) {
        // @ts-expect-error Enrollment accepts only the raw PIN.
        service.enroll(PIN, { actorRef: 'forged', sessionRef: 'forged', role: 'admin', status: 'active', version: 99 });
    }
});
