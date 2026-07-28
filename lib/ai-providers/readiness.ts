/* @Codex */
import {
    verifyCapabilityAttestation,
    type CapabilityAttestation,
    type CapabilityAttestationFailure,
    type ExpectedCapabilityBinding,
} from './capability-attestation';

export type AiLaneReadiness =
    | Readonly<{ status: 'ready'; binding: ExpectedCapabilityBinding }>
    | Readonly<{
        status: 'blocked'; binding: ExpectedCapabilityBinding; reason: CapabilityAttestationFailure;
    }>;
export function assessAiLaneReadiness(input: {
    readonly binding: ExpectedCapabilityBinding;
    readonly attestation?: CapabilityAttestation | null;
    readonly now?: Date;
    readonly locallyVerifiedEvidenceRefs?: ReadonlySet<string>;
}): AiLaneReadiness {
    const binding = Object.freeze({ ...input.binding });
    const verification = verifyCapabilityAttestation(
        input.attestation,
        binding,
        input.now,
        input.locallyVerifiedEvidenceRefs,
    );
    return Object.freeze(verification.valid
        ? { status: 'ready', binding }
        : { status: 'blocked', binding, reason: verification.reason });
}
