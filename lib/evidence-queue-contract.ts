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
    | 'needs_review'
    | 'invalidated';

/* @Codex */
export type EvidenceQueueFreshness = 'recent' | 'stale' | 'undated';

/* @Codex */
export type EvidenceQueueDiaryTemporalTag =
    | 'recent'
    | 'historical'
    | 'suspended_or_resolved'
    | 'follow_up'
    | 'plan'
    | 'negation';

/* @Codex */
export interface EvidenceQueueAttachmentInput {
    id: string;
    patientId: string;
    fileName: string;
    createdAt: string | Date;
    parseEvidenceArtifactSnapshot?: string | null;
    summarySnapshot?: string | null;
    sourceVersion?: string | number | null;
    artifactSourceVersion?: string | number | null;
    deletedAt?: string | Date | null;
    replacedById?: string | null;
}

/* @Codex */
export interface EvidenceQueueDiaryInput {
    id: string;
    patientId: string;
    date: string | Date;
    type?: string | null;
    title?: string | null;
    content?: string | null;
    deletedAt?: string | Date | null;
    version?: string | number | null;
    evidenceVersion?: string | number | null;
    /**
     * Deterministic caller-provided retrieval bucket. v1 must not derive this
     * through embeddings, LLM calls, training or free-text clinical promotion.
     */
    domainKey?: string | null;
    status?: string | null;
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
    /** Source ids are unique inside a patient-scoped queue; offsets use JS UTF-16 string indices. */
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
        suppressedBySourceId?: string;
        invalidatedBySourceId?: string;
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
        invalidated: number;
        renderableClaims: number;
    };
}

const MIN_SIGNAL_CHARS = 24;
const DIARY_SNIPPET_RADIUS = 90;
const DIARY_HISTORICAL_DAYS = 180;

function stableDate(value: string | Date | null | undefined): string | undefined {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function compactText(value: string | null | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim();
}

function plainText(value: string | null | undefined): string {
    return (value ?? '').replace(/\r\n/g, '\n').trim();
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

function attachmentInvalidation(input: EvidenceQueueAttachmentInput): {
    invalidated: boolean;
    detail: string;
    invalidatedBySourceId?: string;
} {
    if (stableDate(input.deletedAt)) {
        return {
            invalidated: true,
            detail: 'Attachment source was deleted and derived evidence must not render as current.',
        };
    }

    const replacedById = compactText(input.replacedById);
    if (replacedById) {
        return {
            invalidated: true,
            detail: 'Attachment source was replaced and derived evidence must not render as current.',
            invalidatedBySourceId: `attachment:${replacedById}:parse-evidence`,
        };
    }

    const currentVersion = versionString(input.sourceVersion);
    const artifactVersion = versionString(input.artifactSourceVersion);
    if (input.artifactSourceVersion !== undefined
        && input.artifactSourceVersion !== null
        && currentVersion !== artifactVersion) {
        return {
            invalidated: true,
            detail: 'Attachment derived artifact was produced from a stale source version.',
        };
    }

    return { invalidated: false, detail: '' };
}

function diaryInvalidation(input: EvidenceQueueDiaryInput): boolean {
    if (input.evidenceVersion === undefined || input.evidenceVersion === null) return false;
    return versionString(input.evidenceVersion) !== versionString(input.version);
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

function entryTypeLabel(input: EvidenceQueueDiaryInput): string {
    const type = compactText(input.type);
    const title = compactText(input.title);
    if (title) return `${type || 'diario'}: ${title}`;
    return type || 'diario';
}

function diaryTemporalTags(
    input: EvidenceQueueDiaryInput,
    content: string,
    generatedAt: string,
): EvidenceQueueDiaryTemporalTag[] {
    const haystack = `${input.type ?? ''} ${input.title ?? ''} ${input.status ?? ''} ${content}`.toLowerCase();
    const tags = new Set<EvidenceQueueDiaryTemporalTag>();
    const entryDate = stableDate(input.date);
    const entryTime = entryDate ? new Date(entryDate).getTime() : undefined;
    const generatedTime = new Date(generatedAt).getTime();

    if (!entryTime || !Number.isFinite(generatedTime)) {
        tags.add('historical');
    } else {
        const ageDays = (generatedTime - entryTime) / 86_400_000;
        tags.add(ageDays > DIARY_HISTORICAL_DAYS ? 'historical' : 'recent');
    }

    if (/\b(sospes[aoie]|sospende|interrott[aoie]|risolt[aoie]|terminat[aoie]|resolved|stopped|discontinued)\b/u.test(haystack)) {
        tags.add('suspended_or_resolved');
    }
    if (/\b(follow[- ]?up|controllo|rivalutazione|richiamo|review|recheck)\b/u.test(haystack)) {
        tags.add('follow_up');
    }
    if (/\b(piano|programma|programmato|indicazione|si propone|planned|plan)\b/u.test(haystack)) {
        tags.add('plan');
    }
    if (/\b(nega|negata|negato|non riferisce|assenza di|senza|no evidence|denies)\b/u.test(haystack)) {
        tags.add('negation');
    }

    return [...tags];
}

function sentenceBounds(content: string, index: number): { start: number; end: number } {
    let start = index;
    while (start > 0 && !/[.!?\n]/u.test(content[start - 1])) start -= 1;

    let end = index;
    while (end < content.length && !/[.!?\n]/u.test(content[end])) end += 1;
    if (end < content.length) end += 1;

    start = Math.max(0, Math.min(start, content.length));
    end = Math.max(start, Math.min(end, content.length));

    if (end - start > DIARY_SNIPPET_RADIUS * 2) {
        start = Math.max(0, index - DIARY_SNIPPET_RADIUS);
        end = Math.min(content.length, index + DIARY_SNIPPET_RADIUS);
    }

    return { start, end };
}

function diaryEvidenceClaims(
    sourceId: string,
    input: EvidenceQueueDiaryInput,
    content: string,
    generatedAt: string,
): EvidenceQueueRenderableClaim[] {
    const tags = diaryTemporalTags(input, content, generatedAt);
    const anchors: Array<{ tag: EvidenceQueueDiaryTemporalTag; index: number }> = [];
    const lower = content.toLowerCase();

    const tagNeedles: Array<[EvidenceQueueDiaryTemporalTag, RegExp]> = [
        ['suspended_or_resolved', /\b(sospes[aoie]|sospende|interrott[aoie]|risolt[aoie]|terminat[aoie]|resolved|stopped|discontinued)\b/u],
        ['follow_up', /\b(follow[- ]?up|controllo|rivalutazione|richiamo|review|recheck)\b/u],
        ['plan', /\b(piano|programma|programmato|indicazione|si propone|planned|plan)\b/u],
        ['negation', /\b(nega|negata|negato|non riferisce|assenza di|senza|no evidence|denies)\b/u],
    ];

    for (const [tag, regex] of tagNeedles) {
        if (!tags.includes(tag)) continue;
        const match = regex.exec(lower);
        if (match?.index !== undefined) anchors.push({ tag, index: match.index });
    }

    if (anchors.length === 0) anchors.push({ tag: tags.includes('historical') ? 'historical' : 'recent', index: 0 });

    const seen = new Set<string>();
    const claims: EvidenceQueueRenderableClaim[] = [];
    for (const { tag, index } of anchors) {
        const bounds = sentenceBounds(content, index);
        const key = `${bounds.start}:${bounds.end}:${tag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const snippet = content.slice(bounds.start, bounds.end).trim();

        claims.push({
            id: `${sourceId}:${tag}:${bounds.start}-${bounds.end}`,
            kind: `diary_${tag}`,
            label: `Diario clinico ${entryTypeLabel(input)} (${tag})`,
            citation: {
                sourceId,
                offsetStart: bounds.start,
                offsetEnd: bounds.end,
                snippet,
            },
        });
    }

    return claims;
}

function buildAttachmentParseEvidenceItem(
    input: EvidenceQueueAttachmentInput,
    generatedAt: string,
    artifact: DocumentParseEvidenceArtifact,
): EvidenceQueueItem {
    const sourceId = `attachment:${input.id}:parse-evidence`;
    const invalidation = attachmentInvalidation(input);
    const claims = artifactClaims(sourceId, artifact);
    const reason: EvidenceQueueDecisionReason = invalidation.invalidated
        ? 'invalidated'
        : claims.length > 0
            ? 'included'
            : 'low_signal';

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
            reasonDetail: invalidation.invalidated
                ? invalidation.detail
                : reason === 'included'
                ? 'Valid parse/evidence artifact with renderable facts.'
                : 'Valid parse/evidence artifact has no renderable facts.',
            invalidatedBySourceId: invalidation.invalidatedBySourceId,
        },
        renderableClaims: reason === 'included' ? claims : [],
    };
}

function buildAttachmentSummaryItem(input: EvidenceQueueAttachmentInput, generatedAt: string): EvidenceQueueItem {
    const sourceId = `attachment:${input.id}:summary`;
    const invalidation = attachmentInvalidation(input);
    const summary = compactText(input.summarySnapshot);
    const reason: EvidenceQueueDecisionReason = invalidation.invalidated
        ? 'invalidated'
        : summary.length >= MIN_SIGNAL_CHARS ? 'needs_review' : 'low_signal';

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
            reasonDetail: invalidation.invalidated
                ? invalidation.detail
                : reason === 'needs_review'
                ? 'Summary snapshot exists but must be reviewed before consumer promotion.'
                : 'Summary snapshot is absent or too low-signal for evidence queue inclusion.',
            invalidatedBySourceId: invalidation.invalidatedBySourceId,
        },
        renderableClaims: [],
    };
}

function buildAttachmentItems(input: EvidenceQueueAttachmentInput, generatedAt: string): EvidenceQueueItem[] {
    const artifact = parseDocumentParseEvidenceArtifactSnapshot(input.parseEvidenceArtifactSnapshot ?? undefined);
    if (artifact) return [buildAttachmentParseEvidenceItem(input, generatedAt, artifact)];
    return [buildAttachmentSummaryItem(input, generatedAt)];
}

function buildDiaryItem(
    input: EvidenceQueueDiaryInput,
    generatedAt: string,
    suppressedBySourceId: string | undefined,
): EvidenceQueueItem {
    const sourceId = `diary:${input.id}`;
    const content = plainText(input.content);
    const deletedAt = stableDate(input.deletedAt);
    const reason: EvidenceQueueDecisionReason = deletedAt
        ? 'superseded'
        : diaryInvalidation(input)
            ? 'invalidated'
        : suppressedBySourceId
            ? 'suppressed_stale'
            : compactText(content).length >= MIN_SIGNAL_CHARS
                ? 'included'
                : 'low_signal';
    const claims = reason === 'included' ? diaryEvidenceClaims(sourceId, input, content, generatedAt) : [];

    return {
        id: sourceId,
        source: {
            id: sourceId,
            type: 'diary_entry',
            patientId: input.patientId,
            label: `Diario clinico (${entryTypeLabel(input)})`,
            version: versionString(input.version),
        },
        provenance: {
            capturedAt: generatedAt,
            sourceCreatedAt: stableDate(input.date),
        },
        governance: {
            priority: 60,
            freshness: reason === 'suppressed_stale' ? 'stale' : freshnessFromDate(input.date),
            reason,
            reasonDetail: deletedAt
                ? 'Diary entry is deleted or superseded and must not render as active evidence.'
                : reason === 'invalidated'
                    ? 'Diary evidence was produced from a stale entry version and must be reabsorbed before rendering.'
                : reason === 'suppressed_stale'
                    ? 'Diary entry is older than a newer diary source in the same retrieval domain.'
                : reason === 'included'
                    ? 'Diary entry is available as retrieval-only evidence with citable offsets.'
                    : 'Diary entry is absent or too low-signal for evidence queue inclusion.',
            suppressedBySourceId,
        },
        renderableClaims: reason === 'included' ? claims : [],
    };
}

function diaryStaleSuppressorSourceId(
    input: EvidenceQueueDiaryInput,
    allDiaryEntries: EvidenceQueueDiaryInput[],
): string | undefined {
    const domainKey = compactText(input.domainKey);
    const date = stableDate(input.date);
    if (!domainKey || !date || stableDate(input.deletedAt)) return undefined;
    const time = new Date(date).getTime();

    const newer = allDiaryEntries
        .filter((entry) => {
            if (entry.id === input.id || stableDate(entry.deletedAt)) return false;
            if (compactText(entry.domainKey) !== domainKey) return false;
            const otherDate = stableDate(entry.date);
            return otherDate ? new Date(otherDate).getTime() > time : false;
        })
        .sort((left, right) => {
            const leftDate = stableDate(left.date);
            const rightDate = stableDate(right.date);
            return new Date(rightDate ?? 0).getTime() - new Date(leftDate ?? 0).getTime();
        })[0];

    return newer ? `diary:${newer.id}` : undefined;
}

function buildDiaryItems(inputs: EvidenceQueueDiaryInput[], generatedAt: string): EvidenceQueueItem[] {
    return inputs.map((entry) => buildDiaryItem(entry, generatedAt, diaryStaleSuppressorSourceId(entry, inputs)));
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
    const diaryEntries = input.diaryEntries ?? [];
    const items = [
        ...(input.attachments ?? []).flatMap((attachment) => buildAttachmentItems(attachment, generatedAt)),
        ...buildDiaryItems(diaryEntries, generatedAt),
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
            invalidated: countReason(items, 'invalidated'),
            renderableClaims: items.reduce((total, item) => total + item.renderableClaims.length, 0),
        },
    };
}

/* @Codex */
export function getIncludedEvidenceQueueItems(queue: EvidenceQueue): EvidenceQueueItem[] {
    return queue.items.filter((item) => item.governance.reason === 'included');
}
