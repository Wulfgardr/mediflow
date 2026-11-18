import 'server-only';
import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import { visitConfirmationPurpose, visitProofSchema } from './agent-visit-confirmation-contract';
import type { AgentApplication } from './agent-visit-application-contract';

export type VisitConfirmationBinding = Readonly<{
    reference: string; actorRef: string; sessionId: string; archiveGeneration: string; agentRef: string; mandateRef: string;
    visitId: string; revision: number; patientId: string; patientVersion: number; patientState: string; expiresAt: number;
}>;

export type VisitConfirmationChallenge = Readonly<{
    binding: VisitConfirmationBinding;
    bytes: string;
    signingKey: KeyObject;
    deviceRef: string;
    applicationDigest: string;
}>;

export const confirmationDigest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function visitConfirmationPublicKey(publicKey: string): KeyObject {
    const point = Buffer.from(publicKey, 'base64');
    if (point.length !== 65 || point[0] !== 4 || point.toString('base64') !== publicKey) throw new Error('VISIT_CONFIRMATION_KEY_INVALID');
    return createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
}

export function createVisitConfirmationChallenge(binding: VisitConfirmationBinding, input: AgentApplication, presentation: string,
    signingPublicKey: string): VisitConfirmationChallenge {
    const signingKey = visitConfirmationPublicKey(signingPublicKey);
    const deviceRef = confirmationDigest(Buffer.from(signingPublicKey, 'base64'));
    const applicationDigest = confirmationDigest(JSON.stringify(input));
    const bytes = JSON.stringify({
        purpose: visitConfirmationPurpose,
        requestId: binding.reference,
        nonce: randomBytes(32).toString('base64'),
        expiresAt: binding.expiresAt,
        actorRef: binding.actorRef,
        session: confirmationDigest(binding.sessionId),
        archiveGeneration: binding.archiveGeneration,
        agentRef: binding.agentRef,
        mandateRef: binding.mandateRef,
        visitId: binding.visitId,
        revision: binding.revision,
        patientId: binding.patientId,
        patientVersion: binding.patientVersion,
        patientState: binding.patientState,
        signingPublicKey,
        deviceRef,
        applicationDigest,
        presentationDigest: confirmationDigest(Buffer.from(presentation, 'base64')),
    });
    return Object.freeze({ binding: Object.freeze({ ...binding }), bytes, signingKey, deviceRef, applicationDigest });
}

export function verifyVisitConfirmationProof(challenge: VisitConfirmationChallenge, value: unknown, input: AgentApplication, now: number) {
    const proof = visitProofSchema.safeParse(value);
    if (!proof.success || now >= challenge.binding.expiresAt || input.phase !== 'review'
        || input.visitId !== challenge.binding.visitId || input.cassetteRevision !== challenge.binding.revision
        || input.patientId !== challenge.binding.patientId || input.expectedVersion !== challenge.binding.patientVersion
        || confirmationDigest(JSON.stringify(input)) !== challenge.applicationDigest) return null;
    const signature = Buffer.from(proof.data.signature, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== proof.data.signature) return null;
    return verify('sha256', Buffer.from(challenge.bytes + '\n' + proof.data.policy),
        { key: challenge.signingKey, dsaEncoding: 'ieee-p1363' }, signature) ? proof.data.policy : null;
}
