/* @Codex */
import { createHash } from 'node:crypto';
import type { AiLane, AuthorityPlane } from './provider';
export interface CapabilityAttestationClaims {
    readonly schemaVersion: 'mediflow.ai.capability-attestation.v1';
    readonly lane: AiLane;
    readonly modelDigest: string;
    readonly authorityPlane: AuthorityPlane;
    readonly issuer: string;
    readonly evidenceRef: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
}
export interface CapabilityAttestation extends CapabilityAttestationClaims {
    readonly integrityHash: string;
    /** Reserved and excluded from the A1 integrity hash; no trust root exists. */
    readonly signature?: string;
}
export type CapabilityAttestationFailure =
    | 'attestation_absent' | 'invalid_claims' | 'invalid_time_window'
    | 'not_yet_valid' | 'expired' | 'evidence_unverified' | 'lane_mismatch'
    | 'authority_plane_mismatch' | 'model_digest_mismatch' | 'integrity_mismatch';
export type CapabilityAttestationVerification =
    | Readonly<{ valid: true }>
    | Readonly<{ valid: false; reason: CapabilityAttestationFailure }>;
export interface ExpectedCapabilityBinding {
    readonly lane: AiLane;
    readonly modelDigest: string;
    readonly authorityPlane: AuthorityPlane;
}
const AI_LANES: readonly string[] = ['patient_insight', 'smart_import', 'document_synthesis', 'ocr', 'treatment_reasoning'];
const AUTHORITY_PLANES: readonly string[] = ['clinical_application', 'engineering_operator'];
const CLAIM_KEYS = [
    'schemaVersion', 'lane', 'modelDigest', 'authorityPlane', 'issuer', 'evidenceRef', 'issuedAt', 'expiresAt',
] as const;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
function snapshotContract(value: unknown, envelope: boolean): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object') return null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
    const hasSignature = envelope && Object.prototype.hasOwnProperty.call(descriptors, 'signature');
    const extras = envelope
        ? ['integrityHash', ...(hasSignature ? ['signature'] : [])]
        : [];
    const allowed: readonly string[] = [...CLAIM_KEYS, ...extras];
    const actual = Reflect.ownKeys(descriptors);
    if (actual.length !== allowed.length
        || actual.some((key) => typeof key !== 'string' || !allowed.includes(key))) return null;
    const snapshot: Record<string, unknown> = {};
    for (const key of allowed) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return null;
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}
function hasValidClaimValues(value: Record<string, unknown>): boolean {
    return value.schemaVersion === 'mediflow.ai.capability-attestation.v1'
        && typeof value.lane === 'string' && AI_LANES.includes(value.lane)
        && typeof value.authorityPlane === 'string' && AUTHORITY_PLANES.includes(value.authorityPlane)
        && typeof value.modelDigest === 'string' && SHA256_PATTERN.test(value.modelDigest)
        && typeof value.issuer === 'string' && value.issuer.trim().length > 0
        && typeof value.evidenceRef === 'string' && value.evidenceRef.trim().length > 0
        && typeof value.issuedAt === 'string'
        && typeof value.expiresAt === 'string';
}
function canonicalClaims(claims: CapabilityAttestationClaims): string {
    return JSON.stringify({
        authorityPlane: claims.authorityPlane,
        evidenceRef: claims.evidenceRef,
        expiresAt: claims.expiresAt,
        issuedAt: claims.issuedAt,
        issuer: claims.issuer,
        lane: claims.lane,
        modelDigest: claims.modelDigest,
        schemaVersion: claims.schemaVersion,
    });
}
function hashClaims(claims: CapabilityAttestationClaims): string {
    return `sha256:${createHash('sha256').update(canonicalClaims(claims), 'utf8').digest('hex')}`;
}
function parseCanonicalTimestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}
export function issueCapabilityAttestation(
    claims: CapabilityAttestationClaims,
    signature?: string,
): CapabilityAttestation {
    const snapshot = snapshotContract(claims, false);
    if (!snapshot || !hasValidClaimValues(snapshot)
        || (signature !== undefined && typeof signature !== 'string')) {
        throw new TypeError('Invalid capability attestation claims');
    }
    const validClaims = snapshot as unknown as CapabilityAttestationClaims;
    return Object.freeze({
        ...validClaims,
        integrityHash: hashClaims(validClaims),
        ...(signature === undefined ? {} : { signature }),
    });
}
export function verifyCapabilityAttestation(
    attestation: unknown,
    expected: ExpectedCapabilityBinding,
    now = new Date(),
    locallyVerifiedEvidenceRefs?: ReadonlySet<string>,
): CapabilityAttestationVerification {
    if (attestation == null) return { valid: false, reason: 'attestation_absent' };
    const snapshot = snapshotContract(attestation, true);
    if (!snapshot || !hasValidClaimValues(snapshot)
        || typeof snapshot.integrityHash !== 'string' || !SHA256_PATTERN.test(snapshot.integrityHash)
        || ('signature' in snapshot && typeof snapshot.signature !== 'string')) {
        return { valid: false, reason: 'invalid_claims' };
    }
    const verified = snapshot as unknown as CapabilityAttestation;
    const nowMs = now.getTime();
    const issuedAt = parseCanonicalTimestamp(verified.issuedAt);
    const expiresAt = parseCanonicalTimestamp(verified.expiresAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAt)
        || !Number.isFinite(expiresAt) || issuedAt >= expiresAt) {
        return { valid: false, reason: 'invalid_time_window' };
    }
    if (nowMs < issuedAt) return { valid: false, reason: 'not_yet_valid' };
    if (nowMs >= expiresAt) return { valid: false, reason: 'expired' };
    if (verified.lane !== expected.lane) return { valid: false, reason: 'lane_mismatch' };
    if (verified.authorityPlane !== expected.authorityPlane) {
        return { valid: false, reason: 'authority_plane_mismatch' };
    }
    if (verified.modelDigest !== expected.modelDigest) {
        return { valid: false, reason: 'model_digest_mismatch' };
    }
    if (hashClaims(verified) !== verified.integrityHash) {
        return { valid: false, reason: 'integrity_mismatch' };
    }
    if (!locallyVerifiedEvidenceRefs?.has(verified.evidenceRef)) {
        return { valid: false, reason: 'evidence_unverified' };
    }
    return { valid: true };
}
