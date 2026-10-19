import { isProfileReviewView, parseProfileReviewInput, PROFILE_REVIEW_POLICY,
    type ProfileReviewInput, type ProfileReviewView } from './patient-profile-review-contract';

export const PROFILE_NOTES_COMMIT_POLICY = 'patient-profile.notes.commit.v1' as const;
export type ProfileNotesCommitInput = ProfileReviewInput
    | Readonly<{ kind: 'receipt'; reference: string; digest: string }>;
export type ProfileNotesCommitView = Omit<ProfileReviewView, 'policy'> & Readonly<{
    policy: typeof PROFILE_NOTES_COMMIT_POLICY;
    recipient: Readonly<{ id: string; firstName: string; lastName: string }>;
    action: 'replace-notes' | 'remove-notes';
}>;
export type ProfileNotesCommitReceipt = Readonly<{
    kind: 'committed'; policy: typeof PROFILE_NOTES_COMMIT_POLICY;
    reference: string; digest: string; previousRevision: number; revision: number;
    committedAt: number; receiptRef: string;
}>;
export type ProfileNotesCommitJournal = Readonly<{
    schemaVersion: 1; commandDigest: string; scopeDigest: string; receipt: ProfileNotesCommitReceipt;
}>;

export function isProfileNotesCommitReference(value: unknown): value is Readonly<{ reference: string; digest: string }> {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.reference === 'string' && /^ppr_[0-9a-f]{64}$/u.test(record.reference)
        && typeof record.digest === 'string' && /^[0-9a-f]{64}$/u.test(record.digest);
}

export function parseProfileNotesCommitInput(value: Record<string, unknown>): ProfileNotesCommitInput | null {
    if (value.kind === 'receipt' && Object.keys(value).length === 3 && isProfileNotesCommitReference(value)) {
        return { kind: 'receipt', reference: value.reference, digest: value.digest };
    }
    return parseProfileReviewInput(value);
}

export function isProfileNotesCommitView(value: unknown): value is ProfileNotesCommitView {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const { recipient, action, policy, ...review } = value as Record<string, unknown>;
    if (policy !== PROFILE_NOTES_COMMIT_POLICY || !isProfileReviewView({ ...review, policy: PROFILE_REVIEW_POLICY })
        || action !== (review.notes === null ? 'remove-notes' : 'replace-notes')
        || !recipient || typeof recipient !== 'object' || Array.isArray(recipient)) return false;
    const target = recipient as Record<string, unknown>;
    return Object.keys(target).length === 3 && typeof target.id === 'string' && target.id.length > 0 && target.id.length <= 160
        && [target.firstName, target.lastName].every(name => typeof name === 'string' && name.length > 0 && name.length <= 2048);
}

export function isProfileNotesCommitReceipt(value: unknown): value is ProfileNotesCommitReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 8
        || !isProfileNotesCommitReference(value)) return false;
    const receipt = value as unknown as Record<string, unknown>;
    return receipt.kind === 'committed' && receipt.policy === PROFILE_NOTES_COMMIT_POLICY
        && Number.isSafeInteger(receipt.previousRevision) && (receipt.previousRevision as number) >= 1
        && Number.isSafeInteger(receipt.revision) && receipt.revision === (receipt.previousRevision as number) + 1
        && Number.isSafeInteger(receipt.committedAt) && (receipt.committedAt as number) > 0
        && typeof receipt.receiptRef === 'string' && /^ppnr_[0-9a-f]{64}$/u.test(receipt.receiptRef);
}

/** Exact, bounded metadata only. No clinical field or arbitrary caller property survives. */
export function parseProfileNotesCommitJournal(value: unknown): ProfileNotesCommitJournal | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4) return null;
    const journal = value as Record<string, unknown>;
    if (journal.schemaVersion !== 1 || typeof journal.commandDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(journal.commandDigest)
        || typeof journal.scopeDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(journal.scopeDigest)
        || !isProfileNotesCommitReceipt(journal.receipt)) return null;
    return Object.freeze({ schemaVersion: 1, commandDigest: journal.commandDigest, scopeDigest: journal.scopeDigest,
        receipt: Object.freeze({ ...journal.receipt }) });
}
