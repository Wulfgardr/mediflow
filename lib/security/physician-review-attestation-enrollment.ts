/* @Codex */
import 'server-only';

import { type FreshReviewPinProofV1, verifyFreshReviewPin } from './fresh-review-pin-uniqueness';
import {
    createPhysicianReviewAttestationStore,
    type PhysicianReviewAttestationV1,
    PhysicianReviewAttestationStoreError,
} from './physician-review-attestation-store';

type VerifyFreshPin = (candidatePin: string) => Promise<FreshReviewPinProofV1>;
type ActivateAttestation = (actorRef: string) => PhysicianReviewAttestationV1;

export type PhysicianReviewAttestationEnrollmentProjectionV1 = Readonly<{
    schemaVersion: 'mediflow.physician-review-attestation-enrollment.v1';
    status: 'active';
    attestationVersion: 1;
}>;

export type PhysicianReviewAttestationEnrollmentErrorCode = 'enrollment_denied' | 'storage_unavailable';

export class PhysicianReviewAttestationEnrollmentError extends Error {
    constructor(readonly code: PhysicianReviewAttestationEnrollmentErrorCode) {
        super(`Physician review attestation enrollment rejected: ${code}`);
        this.name = 'PhysicianReviewAttestationEnrollmentError';
    }
}

function fail(code: PhysicianReviewAttestationEnrollmentErrorCode): never {
    throw new PhysicianReviewAttestationEnrollmentError(code);
}

function mapActivationFailure(error: unknown): PhysicianReviewAttestationEnrollmentErrorCode {
    return error instanceof PhysicianReviewAttestationStoreError && error.code === 'storage_unavailable'
        ? 'storage_unavailable'
        : 'enrollment_denied';
}

export type PhysicianReviewAttestationEnrollmentSources = Readonly<{
    verifyFreshPin?: VerifyFreshPin;
    activateAttestation?: ActivateAttestation;
}>;

/**
 * Server-only one-shot enrollment. The sole caller input is a raw PIN; actor
 * and session stay inside P1a/P1b and activation enters P2a synchronously.
 */
export function createPhysicianReviewAttestationEnrollmentService(
    sources: PhysicianReviewAttestationEnrollmentSources = {},
) {
    const verify = sources.verifyFreshPin ?? verifyFreshReviewPin;
    const activate = sources.activateAttestation ?? createPhysicianReviewAttestationStore().activate;

    return Object.freeze({
        async enroll(candidatePin: string): Promise<PhysicianReviewAttestationEnrollmentProjectionV1> {
            let proof: FreshReviewPinProofV1;
            try {
                proof = await verify(candidatePin);
            } catch {
                return fail('enrollment_denied');
            }

            let activated: PhysicianReviewAttestationV1;
            try {
                // Deliberately no await: P2a immediately enters BEGIN IMMEDIATE after P1b returns.
                activated = activate(proof.actorRef);
            } catch (error) {
                return fail(mapActivationFailure(error));
            }
            if (activated.status !== 'active' || activated.revokedAt !== null || activated.attestationVersion !== 1) {
                return fail('enrollment_denied');
            }
            return Object.freeze({
                schemaVersion: 'mediflow.physician-review-attestation-enrollment.v1',
                status: 'active',
                attestationVersion: 1,
            });
        },
    });
}

export const enrollPhysicianReviewAttestation = createPhysicianReviewAttestationEnrollmentService().enroll;
