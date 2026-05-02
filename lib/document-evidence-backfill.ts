/* @Codex */
import type { DocumentQualityLevel } from './db';
/* @Codex */
import {
    buildDocumentParseEvidenceArtifact,
    parseDocumentParseEvidenceArtifactSnapshot,
    type DocumentParseEvidenceArtifact,
} from './document-parse-evidence-artifact';

/* @Codex */
export const DOCUMENT_EVIDENCE_BACKFILL_PLAN_SCHEMA_VERSION = 'mediflow.document_evidence_backfill_plan.v1';

/* @Codex */
export type DocumentEvidenceBackfillDecision =
    | 'create_from_source'
    | 'create_from_summary'
    | 'rebuild_invalid_artifact'
    | 'skip_existing_artifact'
    | 'skip_no_usable_text';

/* @Codex */
export type DocumentEvidenceBackfillTextSource = 'rawMarkdown' | 'summarySnapshot';

/* @Codex */
export interface DocumentEvidenceBackfillAttachmentInput {
    id: string;
    patientId: string;
    fileName: string;
    createdAt: string | Date;
    summarySnapshot?: string | null;
    rawMarkdown?: string | null;
    parseEvidenceArtifactSnapshot?: string | null;
    qualityStatus?: DocumentQualityLevel | null;
    qualityReason?: string | null;
}

/* @Codex */
export interface DocumentEvidenceBackfillPlanOptions {
    rebuildExisting?: boolean;
}

/* @Codex */
export interface DocumentEvidenceBackfillCandidateMetrics {
    factCount: number;
    factKinds: string[];
    sourcePriority?: number;
    freshness?: string;
    suppressedCandidateCount: number;
}

/* @Codex */
export interface DocumentEvidenceBackfillPlanItem {
    attachmentId: string;
    patientId: string;
    fileName: string;
    decision: DocumentEvidenceBackfillDecision;
    reason: string;
    textSource?: DocumentEvidenceBackfillTextSource;
    textChars: number;
    existingArtifactSnapshotPresent: boolean;
    existingArtifactValid: boolean;
    candidateArtifact?: DocumentParseEvidenceArtifact;
    candidateMetrics?: DocumentEvidenceBackfillCandidateMetrics;
}

/* @Codex */
export interface DocumentEvidenceBackfillPlan {
    schemaVersion: typeof DOCUMENT_EVIDENCE_BACKFILL_PLAN_SCHEMA_VERSION;
    generatedAt: string;
    options: Required<DocumentEvidenceBackfillPlanOptions>;
    totals: {
        attachments: number;
        candidates: number;
        skippedExisting: number;
        skippedNoText: number;
        invalidExistingArtifacts: number;
        candidateFacts: number;
        candidateSuppressed: number;
    };
    items: DocumentEvidenceBackfillPlanItem[];
}

const MIN_USABLE_TEXT_CHARS = 24;

function compactText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isGenericLowSignalText(value: string): boolean {
    const normalized = compactText(value).toLowerCase();
    if (!normalized) return true;
    if (/^ocr extraction failed:/i.test(normalized)) return true;
    if (/^(nessuna informazione rilevante|nessun dato rilevante|analisi non disponibile|documento non leggibile)\b/i.test(normalized)) {
        return true;
    }
    if (/^(errore|failed|invalid|no text extracted)\b/i.test(normalized)) return true;
    return false;
}

function pickUsableText(input: DocumentEvidenceBackfillAttachmentInput): {
    text: string;
    source?: DocumentEvidenceBackfillTextSource;
} {
    const rawMarkdown = compactText(input.rawMarkdown);
    if (rawMarkdown.length >= MIN_USABLE_TEXT_CHARS && !isGenericLowSignalText(rawMarkdown)) {
        return { text: rawMarkdown, source: 'rawMarkdown' };
    }

    const summary = compactText(input.summarySnapshot);
    if (summary.length >= MIN_USABLE_TEXT_CHARS && !isGenericLowSignalText(summary)) {
        return { text: summary, source: 'summarySnapshot' };
    }

    return { text: '' };
}

function normalizeDocumentDate(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function readExistingArtifact(value: string | null | undefined): DocumentParseEvidenceArtifact | undefined {
    const snapshot = compactText(value);
    if (!snapshot) return undefined;
    return parseDocumentParseEvidenceArtifactSnapshot(snapshot);
}

function buildCandidateMetrics(artifact: DocumentParseEvidenceArtifact): DocumentEvidenceBackfillCandidateMetrics {
    const facts = artifact.evidenceMemory.facts || [];
    const sourceGovernance = artifact.evidenceMemory.sourceGovernance;

    return {
        factCount: facts.length,
        factKinds: Array.from(new Set(facts.map((fact) => fact.kind))).sort(),
        sourcePriority: sourceGovernance?.sourcePriority,
        freshness: sourceGovernance?.freshness,
        suppressedCandidateCount: sourceGovernance?.suppressedCandidates.length || 0,
    };
}

function buildCandidateArtifact(
    input: DocumentEvidenceBackfillAttachmentInput,
    text: string,
    textSource: DocumentEvidenceBackfillTextSource,
): DocumentParseEvidenceArtifact {
    return buildDocumentParseEvidenceArtifact({
        documentInsightId: `backfill:${input.id}`,
        attachmentId: input.id,
        fileName: input.fileName,
        documentDate: normalizeDocumentDate(input.createdAt),
        qualityLevel: input.qualityStatus || undefined,
        qualityReason: input.qualityReason || undefined,
        summary: textSource === 'summarySnapshot' ? compactText(input.summarySnapshot) : '',
        rawMarkdown: text,
        diagnoses: [],
        medications: [],
    });
}

function planAttachment(
    input: DocumentEvidenceBackfillAttachmentInput,
    options: Required<DocumentEvidenceBackfillPlanOptions>,
): DocumentEvidenceBackfillPlanItem {
    const existingArtifact = readExistingArtifact(input.parseEvidenceArtifactSnapshot);
    const hasExistingSnapshot = compactText(input.parseEvidenceArtifactSnapshot).length > 0;
    const { text, source } = pickUsableText(input);

    const base = {
        attachmentId: input.id,
        patientId: input.patientId,
        fileName: input.fileName,
        textChars: text.length,
        existingArtifactSnapshotPresent: hasExistingSnapshot,
        existingArtifactValid: Boolean(existingArtifact),
    };

    if (existingArtifact && !options.rebuildExisting) {
        return {
            ...base,
            decision: 'skip_existing_artifact',
            reason: 'Existing parse/evidence artifact is valid and rebuildExisting is false.',
        };
    }

    if (!source) {
        return {
            ...base,
            decision: 'skip_no_usable_text',
            reason: hasExistingSnapshot && !existingArtifact
                ? 'Existing artifact snapshot is invalid, but no usable source text or summary is available.'
                : 'No usable source text or summary is available.',
        };
    }

    const candidateArtifact = buildCandidateArtifact(input, text, source);
    const candidateMetrics = buildCandidateMetrics(candidateArtifact);
    const decision = hasExistingSnapshot && !existingArtifact
        ? 'rebuild_invalid_artifact'
        : source === 'rawMarkdown'
            ? 'create_from_source'
            : 'create_from_summary';

    return {
        ...base,
        decision,
        reason: decision === 'rebuild_invalid_artifact'
            ? 'Existing artifact snapshot is invalid; candidate rebuild is available for review.'
            : `Candidate artifact can be built from ${source}.`,
        textSource: source,
        candidateArtifact,
        candidateMetrics,
    };
}

/* @Codex */
export function buildDocumentEvidenceBackfillPlan(
    attachments: DocumentEvidenceBackfillAttachmentInput[],
    options: DocumentEvidenceBackfillPlanOptions = {},
): DocumentEvidenceBackfillPlan {
    const resolvedOptions = {
        rebuildExisting: Boolean(options.rebuildExisting),
    };
    const items = attachments.map((attachment) => planAttachment(attachment, resolvedOptions));
    const candidateItems = items.filter((item) => item.candidateArtifact);

    return {
        schemaVersion: DOCUMENT_EVIDENCE_BACKFILL_PLAN_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        options: resolvedOptions,
        totals: {
            attachments: items.length,
            candidates: candidateItems.length,
            skippedExisting: items.filter((item) => item.decision === 'skip_existing_artifact').length,
            skippedNoText: items.filter((item) => item.decision === 'skip_no_usable_text').length,
            invalidExistingArtifacts: items.filter((item) => (
                item.existingArtifactSnapshotPresent
                && !item.existingArtifactValid
            )).length,
            candidateFacts: candidateItems.reduce((total, item) => total + (item.candidateMetrics?.factCount || 0), 0),
            candidateSuppressed: candidateItems.reduce((total, item) => total + (item.candidateMetrics?.suppressedCandidateCount || 0), 0),
        },
        items,
    };
}
