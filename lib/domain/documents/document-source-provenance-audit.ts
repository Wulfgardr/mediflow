/* @Codex */
export const DOCUMENT_SOURCE_PROVENANCE_AUDIT_SCHEMA_VERSION = 'mediflow.document_source_provenance_audit.v1';

/* @Codex */
export type DocumentSourceProvenanceCategory =
    | 'stored_binary'
    | 'summary_only'
    | 'archive_match_candidate'
    | 'ambiguous'
    | 'unrecoverable';

/* @Codex */
export type DocumentSourceProvenanceArchiveMatchKind =
    | 'hash'
    | 'filename'
    | 'metadata'
    | 'byte_size';

/* @Codex */
export interface DocumentSourceProvenanceArchiveCandidate {
    matchKind: DocumentSourceProvenanceArchiveMatchKind;
    patientScoped: boolean;
    collisionCount?: number | null;
    bytes?: number | null;
}

/* @Codex */
export interface DocumentSourceProvenanceAttachmentInput {
    id: string;
    patientId: string;
    fileName: string;
    mimeType?: string | null;
    storedBinaryBytes?: number | null;
    hasStoredBinary?: boolean | null;
    summarySnapshotChars?: number | null;
    hasSummarySnapshot?: boolean | null;
    archiveCandidates?: DocumentSourceProvenanceArchiveCandidate[] | null;
}

/* @Codex */
export interface DocumentSourceProvenanceAuditOptions {
    minSummaryChars?: number;
}

/* @Codex */
export interface DocumentSourceProvenanceAuditItem {
    attachmentId: string;
    patientId: string;
    fileName: string;
    fileKind: string;
    category: DocumentSourceProvenanceCategory;
    reason: string;
    evidence: {
        storedBinaryPresent: boolean;
        storedBinaryBytes: number;
        summarySnapshotUsable: boolean;
        summarySnapshotChars: number;
        archiveCandidateCount: number;
        patientScopedArchiveCandidateCount: number;
        ambiguousArchiveCandidateCount: number;
        safeArchiveCandidateCount: number;
    };
    nextStep:
        | 'use_existing_stored_binary_for_reviewable_planner'
        | 'summary_only_reviewable_backfill_candidate'
        | 'review_archive_match_then_reuse_wul_202_gate'
        | 'exclude_until_provenance_is_disambiguated'
        | 'mark_unrecoverable_without_new_source';
}

/* @Codex */
export interface DocumentSourceProvenanceAuditReport {
    schemaVersion: typeof DOCUMENT_SOURCE_PROVENANCE_AUDIT_SCHEMA_VERSION;
    generatedAt: string;
    options: Required<DocumentSourceProvenanceAuditOptions>;
    safety: {
        readOnly: true;
        writesAttempted: 0;
        rawTextIncluded: false;
        candidateArtifactsIncluded: false;
        futureApplyRequiresWul202Gate: true;
    };
    totals: {
        attachments: number;
        storedBinary: number;
        summaryOnly: number;
        archiveMatchCandidate: number;
        ambiguous: number;
        unrecoverable: number;
    };
    items: DocumentSourceProvenanceAuditItem[];
}

const DEFAULT_MIN_SUMMARY_CHARS = 24;

function numericBytes(value: number | null | undefined): number {
    return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 0;
}

function fileKind(fileName: string, mimeType: string | null | undefined): string {
    const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
    if (extension && /^[a-z0-9]+$/.test(extension)) return `.${extension}`;
    if (mimeType?.includes('/')) return mimeType.toLowerCase();
    return 'unknown';
}

function isStrongArchiveMatch(candidate: DocumentSourceProvenanceArchiveCandidate): boolean {
    return candidate.matchKind === 'hash'
        || candidate.matchKind === 'filename'
        || candidate.matchKind === 'metadata';
}

function archiveEvidence(candidates: DocumentSourceProvenanceArchiveCandidate[]): {
    patientScoped: DocumentSourceProvenanceArchiveCandidate[];
    ambiguousCount: number;
    safe: DocumentSourceProvenanceArchiveCandidate[];
} {
    const patientScoped = candidates.filter((candidate) => candidate.patientScoped);
    const ambiguousCount = candidates.filter((candidate) => (
        !candidate.patientScoped
        || (candidate.collisionCount ?? 1) !== 1
    )).length;
    const safe = patientScoped.filter((candidate) => (
        (candidate.collisionCount ?? 1) === 1
        && isStrongArchiveMatch(candidate)
    ));

    return { patientScoped, ambiguousCount, safe };
}

function classifyAttachment(
    input: DocumentSourceProvenanceAttachmentInput,
    options: Required<DocumentSourceProvenanceAuditOptions>,
): DocumentSourceProvenanceAuditItem {
    const archiveCandidates = input.archiveCandidates ?? [];
    const storedBinaryBytes = numericBytes(input.storedBinaryBytes);
    const storedBinaryPresent = Boolean(input.hasStoredBinary) || storedBinaryBytes > 0;
    const summarySnapshotChars = Math.max(0, Math.floor(input.summarySnapshotChars ?? 0));
    const summarySnapshotUsable = summarySnapshotChars >= options.minSummaryChars;
    const archive = archiveEvidence(archiveCandidates);
    const evidence = {
        storedBinaryPresent,
        storedBinaryBytes,
        summarySnapshotUsable,
        summarySnapshotChars,
        archiveCandidateCount: archiveCandidates.length,
        patientScopedArchiveCandidateCount: archive.patientScoped.length,
        ambiguousArchiveCandidateCount: archive.ambiguousCount,
        safeArchiveCandidateCount: archive.safe.length,
    };
    const base = {
        attachmentId: input.id,
        patientId: input.patientId,
        fileName: input.fileName,
        fileKind: fileKind(input.fileName, input.mimeType),
        evidence,
    };

    if (storedBinaryPresent) {
        return {
            ...base,
            category: 'stored_binary',
            reason: 'Attachment has a stored binary payload available for the existing reviewable planner.',
            nextStep: 'use_existing_stored_binary_for_reviewable_planner',
        };
    }

    if (summarySnapshotUsable) {
        return {
            ...base,
            category: 'summary_only',
            reason: 'No stored binary is available, but a summary-sized source exists for reviewable artifact planning.',
            nextStep: 'summary_only_reviewable_backfill_candidate',
        };
    }

    if (archive.safe.length === 1 && archive.ambiguousCount === 0) {
        return {
            ...base,
            category: 'archive_match_candidate',
            reason: 'Exactly one patient-scoped archive candidate has strong provenance metadata.',
            nextStep: 'review_archive_match_then_reuse_wul_202_gate',
        };
    }

    if (archiveCandidates.length > 0) {
        return {
            ...base,
            category: 'ambiguous',
            reason: 'Archive candidates exist, but provenance is ambiguous, weak, or outside patient scope.',
            nextStep: 'exclude_until_provenance_is_disambiguated',
        };
    }

    return {
        ...base,
        category: 'unrecoverable',
        reason: 'No stored binary, usable summary, or safe archive provenance candidate is available.',
        nextStep: 'mark_unrecoverable_without_new_source',
    };
}

/* @Codex */
export function buildDocumentSourceProvenanceAuditReport(
    attachments: DocumentSourceProvenanceAttachmentInput[],
    options: DocumentSourceProvenanceAuditOptions = {},
): DocumentSourceProvenanceAuditReport {
    const resolvedOptions = {
        minSummaryChars: Math.max(1, Math.floor(options.minSummaryChars ?? DEFAULT_MIN_SUMMARY_CHARS)),
    };
    const items = attachments.map((attachment) => classifyAttachment(attachment, resolvedOptions));

    return {
        schemaVersion: DOCUMENT_SOURCE_PROVENANCE_AUDIT_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        options: resolvedOptions,
        safety: {
            readOnly: true,
            writesAttempted: 0,
            rawTextIncluded: false,
            candidateArtifactsIncluded: false,
            futureApplyRequiresWul202Gate: true,
        },
        totals: {
            attachments: items.length,
            storedBinary: items.filter((item) => item.category === 'stored_binary').length,
            summaryOnly: items.filter((item) => item.category === 'summary_only').length,
            archiveMatchCandidate: items.filter((item) => item.category === 'archive_match_candidate').length,
            ambiguous: items.filter((item) => item.category === 'ambiguous').length,
            unrecoverable: items.filter((item) => item.category === 'unrecoverable').length,
        },
        items,
    };
}
