/* @Codex */
import {
    parseDocumentParseEvidenceArtifactSnapshot,
    type DocumentParseEvidenceArtifact,
} from './document-parse-evidence-artifact';

/* @Codex */
export const MEDIFLOW_EVIDENCE_QUEUE_SCHEMA_VERSION = 'mediflow.evidence_queue.v1';

/* @Codex */
export type EvidenceQueueSourceType =
    | 'attachment_parse_evidence'
    | 'attachment_summary'
    | 'diary_entry'
    | 'structured_chart';

/* @Codex */
export type EvidenceQueueDecisionReason =
    | 'included'
    | 'suppressed_stale'
    | 'low_signal'
    | 'superseded'
    | 'needs_review';

/* @Codex */
export type EvidenceQueueFreshness = 'recent' | 'stale' | 'undated';

/* @Codex */
export interface EvidenceQueueAttachmentInput {
    id: string;
    patientId: string;
    fileName: string;
    createdAt: string | Date;
    parseEvidenceArtifactSnapshot?: string | null;
    summarySnapshot?: string | null;
    sourceVersion?: string | number | null;
}

/* @Codex */
export interface EvidenceQueueDiaryInput {
    id: string;
    patientId: string;
    date: string | Date;
    content?: string | null;
    deletedAt?: string | Date | null;
    version?: string | number | null;
}

/* @Codex */
export interface EvidenceQueueStructuredChartInput {
    id: string;
    patientId: string;
    sourceType: 'diagnosis' | 'therapy' | 'observation' | 'checkup' | 'profile';
    updatedAt?: string | Date | null;
    label?: string | null;
    version?: string | number | null;
}

/* @Codex */
export interface BuildEvidenceQueueInput {
    patientId: string;
    generatedAt?: string | Date;
    attachments?: EvidenceQueueAttachmentInput[];
    diaryEntries?: EvidenceQueueDiaryInput[];
    structuredChartItems?: EvidenceQueueStructuredChartInput[];
}

/* @Codex */
export interface EvidenceQueueCitation {
    sourceId: string;
    page?: number;
    sectionId?: string;
    sectionTitle?: string;
    offsetStart?: number;
    offsetEnd?: number;
    snippet?: string;
}

/* @Codex */
export interface EvidenceQueueRenderableClaim {
    id: string;
    kind: string;
    label: string;
    citation: EvidenceQueueCitation;
}

/* @Codex */
export interface EvidenceQueueItem {
    id: string;
    source: {
        id: string;
        type: EvidenceQueueSourceType;
        patientId: string;
        label: string;
        version: string;
    };
    provenance: {
        capturedAt: string;
        sourceCreatedAt?: string;
        artifactSchemaVersion?: string;
    };
    governance: {
        priority: number;
        freshness: EvidenceQueueFreshness;
        reason: EvidenceQueueDecisionReason;
        reasonDetail: string;
    };
    renderableClaims: EvidenceQueueRenderableClaim[];
}

/* @Codex */
export interface EvidenceQueue {
    schemaVersion: typeof MEDIFLOW_EVIDENCE_QUEUE_SCHEMA_VERSION;
    generatedAt: string;
    patientId: string;
    items: EvidenceQueueItem[];
    totals: {
        sources: number;
        included: number;
        suppressedStale: number;
        lowSignal: number;
        superseded: number;
        needsReview: number;
        renderableClaims: number;
    };
}

const MIN_SIGNAL_CHARS = 24;

function stableDate(value: string | Date | null | undefined): string | undefined {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function compactText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function versionString(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') return 'unversioned';
    return String(value);
}

function freshnessFromDate(value: string | Date | null | undefined): EvidenceQueueFreshness {
    return stableDate(value) ? 'recent' : 'undated';
}

function clampPriority(value: number | null | undefined, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(100, Math.round(value as number)));
}

function countReason(items: EvidenceQueueItem[], reason: EvidenceQueueDecisionReason): number {
    return items.filter((item) => item.governance.reason === reason).length;
}

function artifactFreshness(artifact: DocumentParseEvidenceArtifact): EvidenceQueueFreshness {
    const freshness = artifact.evidenceMemory.sourceGovernance?.freshness;
    return freshness === 'recent' || freshness === 'stale' || freshness === 'undated'
        ? freshness
        : 'undated';
}

function artifactPriority(artifact: DocumentParseEvidenceArtifact): number {
    return clampPriority(artifact.evidenceMemory.sourceGovernance?.sourcePriority, 70);
}

function artifactClaims(sourceId: string, artifact: DocumentParseEvidenceArtifact): EvidenceQueueRenderableClaim[] {
    const anchors = new Map(
        artifact.parseBundle.sectionMap?.factAnchors.map((anchor) => [anchor.factId, anchor]) ?? [],
    );

    return (artifact.evidenceMemory.facts ?? []).map((fact) => {
        const anchor = anchors.get(fact.id);
        return {
            id: fact.id,
            kind: fact.kind,
            label: fact.label,
            citation: {
                sourceId,
                page: anchor?.page,
                sectionId: anchor?.sectionId,
                sectionTitle: anchor?.sectionTitle,
                snippet: anchor?.snippet || fact.excerpt,
            },
        };
    });
}

function buildAttachmentParseEvidenceItem(
    input: EvidenceQueueAttachmentInput,
    generatedAt: string,
    artifact: DocumentParseEvidenceArtifact,
): EvidenceQueueItem {
    const sourceId = `attachment:${input.id}:parse-evidence`;
    const claims = artifactClaims(sourceId, artifact);
    const reason: EvidenceQueueDecisionReason = claims.length > 0 ? 'included' : 'low_signal';

    return {
        id: sourceId,
        source: {
            id: sourceId,
            type: 'attachment_parse_evidence',
            patientId: input.patientId,
            label: input.fileName,
            version: artifact.schemaVersion,
        },
        provenance: {
            capturedAt: generatedAt,
            sourceCreatedAt: stableDate(input.createdAt),
            artifactSchemaVersion: artifact.schemaVersion,
        },
        governance: {
            priority: artifactPriority(artifact),
            freshness: artifactFreshness(artifact),
            reason,
            reasonDetail: reason === 'included'
                ? 'Valid parse/evidence artifact with renderable facts.'
                : 'Valid parse/evidence artifact has no renderable facts.',
        },
        renderableClaims: reason === 'included' ? claims : [],
    };
}

function buildAttachmentSummaryItem(input: EvidenceQueueAttachmentInput, generatedAt: string): EvidenceQueueItem {
    const sourceId = `attachment:${input.id}:summary`;
    const summary = compactText(input.summarySnapshot);
    const reason: EvidenceQueueDecisionReason = summary.length >= MIN_SIGNAL_CHARS ? 'needs_review' : 'low_signal';

    return {
        id: sourceId,
        source: {
            id: sourceId,
            type: 'attachment_summary',
            patientId: input.patientId,
            label: input.fileName,
            version: versionString(input.sourceVersion),
        },
        provenance: {
            capturedAt: generatedAt,
            sourceCreatedAt: stableDate(input.createdAt),
        },
        governance: {
            priority: 45,
            freshness: freshnessFromDate(input.createdAt),
            reason,
            reasonDetail: reason === 'needs_review'
                ? 'Summary snapshot exists but must be reviewed before consumer promotion.'
                : 'Summary snapshot is absent or too low-signal for evidence queue inclusion.',
        },
        renderableClaims: [],
    };
}

function buildAttachmentItems(input: EvidenceQueueAttachmentInput, generatedAt: string): EvidenceQueueItem[] {
    const artifact = parseDocumentParseEvidenceArtifactSnapshot(input.parseEvidenceArtifactSnapshot ?? undefined);
    if (artifact) return [buildAttachmentParseEvidenceItem(input, generatedAt, artifact)];
    return [buildAttachmentSummaryItem(input, generatedAt)];
}

function buildDiaryItem(input: EvidenceQueueDiaryInput, generatedAt: string): EvidenceQueueItem {
    const sourceId = `diary:${input.id}`;
    const content = compactText(input.content);
    const deletedAt = stableDate(input.deletedAt);
    const reason: EvidenceQueueDecisionReason = deletedAt
        ? 'superseded'
        : content.length >= MIN_SIGNAL_CHARS
            ? 'included'
            : 'low_signal';

    return {
        id: sourceId,
        source: {
            id: sourceId,
            type: 'diary_entry',
            patientId: input.patientId,
            label: 'Diario clinico',
            version: versionString(input.version),
        },
        provenance: {
            capturedAt: generatedAt,
            sourceCreatedAt: stableDate(input.date),
        },
        governance: {
            priority: 60,
            freshness: freshnessFromDate(input.date),
            reason,
            reasonDetail: deletedAt
                ? 'Diary entry is deleted or superseded and must not render as active evidence.'
                : reason === 'included'
                    ? 'Diary entry is available as retrieval-only evidence.'
                    : 'Diary entry is absent or too low-signal for evidence queue inclusion.',
        },
        renderableClaims: reason === 'included'
            ? [{
                id: `${sourceId}:entry`,
                kind: 'diary_entry',
                label: 'Diario clinico disponibile per retrieval citabile',
                citation: {
                    sourceId,
                    offsetStart: 0,
                    offsetEnd: content.length,
                },
            }]
            : [],
    };
}

function buildStructuredChartItem(input: EvidenceQueueStructuredChartInput, generatedAt: string): EvidenceQueueItem {
    const sourceId = `structured:${input.sourceType}:${input.id}`;
    const label = compactText(input.label) || input.sourceType;

    return {
        id: sourceId,
        source: {
            id: sourceId,
            type: 'structured_chart',
            patientId: input.patientId,
            label,
            version: versionString(input.version),
        },
        provenance: {
            capturedAt: generatedAt,
            sourceCreatedAt: stableDate(input.updatedAt),
        },
        governance: {
            priority: 80,
            freshness: freshnessFromDate(input.updatedAt),
            reason: 'included',
            reasonDetail: 'Structured chart source is already reviewed clinical data.',
        },
        renderableClaims: [{
            id: `${sourceId}:chart`,
            kind: input.sourceType,
            label,
            citation: { sourceId },
        }],
    };
}

/* @Codex */
export function buildEvidenceQueue(input: BuildEvidenceQueueInput): EvidenceQueue {
    const generatedAt = stableDate(input.generatedAt) || new Date().toISOString();
    const items = [
        ...(input.attachments ?? []).flatMap((attachment) => buildAttachmentItems(attachment, generatedAt)),
        ...(input.diaryEntries ?? []).map((entry) => buildDiaryItem(entry, generatedAt)),
        ...(input.structuredChartItems ?? []).map((item) => buildStructuredChartItem(item, generatedAt)),
    ];

    return {
        schemaVersion: MEDIFLOW_EVIDENCE_QUEUE_SCHEMA_VERSION,
        generatedAt,
        patientId: input.patientId,
        items,
        totals: {
            sources: items.length,
            included: countReason(items, 'included'),
            suppressedStale: countReason(items, 'suppressed_stale'),
            lowSignal: countReason(items, 'low_signal'),
            superseded: countReason(items, 'superseded'),
            needsReview: countReason(items, 'needs_review'),
            renderableClaims: items.reduce((total, item) => total + item.renderableClaims.length, 0),
        },
    };
}

/* @Codex */
export function getIncludedEvidenceQueueItems(queue: EvidenceQueue): EvidenceQueueItem[] {
    return queue.items.filter((item) => item.governance.reason === 'included');
}
