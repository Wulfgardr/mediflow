export const PROFILE_REVIEW_POLICY = 'patient-profile.notes.review-only.v1' as const;
export const PROFILE_REVIEW_TTL_MS = 30_000;
export const PROFILE_REVIEW_MAX_NOTES_BYTES = 24 * 1024;

export type ProfileReviewInput =
    | Readonly<{ kind: 'prepare'; expectedSelectionEpoch: number; expectedRevision: number; notes: string | null }>
    | Readonly<{ kind: 'confirm'; reference: string; digest: string; candidatePin: string }>
    | Readonly<{ kind: 'cancel'; reference: string }>;

export type ProfileReviewView = Readonly<{
    kind: 'prepared'; policy: typeof PROFILE_REVIEW_POLICY;
    reference: string; digest: string; notes: string | null;
    expectedRevision: number; selectionEpoch: number; expiresAt: number;
}>;
export type ProfileReviewReceipt = Readonly<{
    kind: 'reviewed'; policy: typeof PROFILE_REVIEW_POLICY; writesPerformed: 0;
}>;

export function isProfileReviewView(value: unknown): value is ProfileReviewView {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).length === 8 && record.kind === 'prepared' && record.policy === PROFILE_REVIEW_POLICY
        && typeof record.reference === 'string' && /^ppr_[0-9a-f]{64}$/u.test(record.reference)
        && typeof record.digest === 'string' && /^[0-9a-f]{64}$/u.test(record.digest)
        && Number.isSafeInteger(record.expectedRevision) && (record.expectedRevision as number) >= 1
        && Number.isSafeInteger(record.selectionEpoch) && (record.selectionEpoch as number) >= 0
        && Number.isSafeInteger(record.expiresAt)
        && (record.notes === null || (typeof record.notes === 'string' && /^ENC:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/u.test(record.notes)));
}

export function parseProfileReviewInput(value: Record<string, unknown>): ProfileReviewInput | null {
    const exact = (keys: readonly string[]) => Object.keys(value).length === keys.length
        && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
    const integer = (candidate: unknown, minimum: number): candidate is number =>
        Number.isSafeInteger(candidate) && (candidate as number) >= minimum;
    const reference = typeof value.reference === 'string' && /^ppr_[0-9a-f]{64}$/u.test(value.reference);
    if (value.kind === 'prepare' && exact(['kind', 'expectedSelectionEpoch', 'expectedRevision', 'notes'])
        && integer(value.expectedSelectionEpoch, 0) && integer(value.expectedRevision, 1)
        && (value.notes === null || (typeof value.notes === 'string' && /^ENC:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/u.test(value.notes)))) {
        return { kind: 'prepare', expectedSelectionEpoch: value.expectedSelectionEpoch,
            expectedRevision: value.expectedRevision, notes: value.notes };
    }
    if (value.kind === 'confirm' && exact(['kind', 'reference', 'digest', 'candidatePin']) && reference
        && typeof value.digest === 'string' && /^[0-9a-f]{64}$/u.test(value.digest)
        && typeof value.candidatePin === 'string') {
        return { kind: 'confirm', reference: value.reference as string, digest: value.digest, candidatePin: value.candidatePin };
    }
    return value.kind === 'cancel' && exact(['kind', 'reference']) && reference
        ? { kind: 'cancel', reference: value.reference as string } : null;
}
