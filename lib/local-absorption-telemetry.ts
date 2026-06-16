/* @Codex */
import {
    buildEvidenceQueue,
    type BuildEvidenceQueueInput,
    type EvidenceQueue,
    type EvidenceQueueDecisionReason,
    type EvidenceQueueSourceType,
} from './evidence-queue-contract';

/* @Codex */
export const LOCAL_ABSORPTION_TELEMETRY_SCHEMA_VERSION = 'mediflow.local_absorption_telemetry.v1';

/* @Codex */
export interface LocalAbsorptionTelemetryReport {
    schemaVersion: typeof LOCAL_ABSORPTION_TELEMETRY_SCHEMA_VERSION;
    generatedAt: string;
    queueCount: number;
    totals: {
        sources: number;
        renderableClaims: number;
        byReason: Record<EvidenceQueueDecisionReason, number>;
        bySourceType: Record<EvidenceQueueSourceType, number>;
        artifactCoverageRate: number;
        staleOrInvalidatedSources: number;
        maxArtifactAgeDays: number | null;
        averageArtifactAgeDays: number | null;
    };
    gateFailures: Array<{
        reason: EvidenceQueueDecisionReason;
        count: number;
    }>;
    phiSafety: {
        includesRawText: false;
        includesPatientIdentifiers: false;
        includesPromptsOrModelOutput: false;
    };
}

const REASONS: EvidenceQueueDecisionReason[] = [
    'included',
    'suppressed_stale',
    'low_signal',
    'superseded',
    'needs_review',
    'invalidated',
];

const SOURCE_TYPES: EvidenceQueueSourceType[] = [
    'attachment_parse_evidence',
    'attachment_summary',
    'diary_entry',
    'structured_chart',
];

function emptyReasonCounts(): Record<EvidenceQueueDecisionReason, number> {
    return Object.fromEntries(REASONS.map((reason) => [reason, 0])) as Record<EvidenceQueueDecisionReason, number>;
}

function emptySourceTypeCounts(): Record<EvidenceQueueSourceType, number> {
    return Object.fromEntries(SOURCE_TYPES.map((type) => [type, 0])) as Record<EvidenceQueueSourceType, number>;
}

function ageDays(generatedAt: string, sourceCreatedAt: string | undefined): number | null {
    if (!sourceCreatedAt) return null;
    const generated = new Date(generatedAt).getTime();
    const source = new Date(sourceCreatedAt).getTime();
    if (!Number.isFinite(generated) || !Number.isFinite(source)) return null;
    return Math.max(0, Math.floor((generated - source) / 86_400_000));
}

/* @Codex */
export function buildLocalAbsorptionTelemetryReport(queues: EvidenceQueue[]): LocalAbsorptionTelemetryReport {
    const byReason = emptyReasonCounts();
    const bySourceType = emptySourceTypeCounts();
    const artifactAges: number[] = [];
    let renderableClaims = 0;

    for (const queue of queues) {
        for (const item of queue.items) {
            byReason[item.governance.reason] += 1;
            bySourceType[item.source.type] += 1;
            renderableClaims += item.renderableClaims.length;
            const age = ageDays(queue.generatedAt, item.provenance.sourceCreatedAt);
            if (age !== null) artifactAges.push(age);
        }
    }

    const sources = Object.values(byReason).reduce((total, count) => total + count, 0);
    const attachmentSources = bySourceType.attachment_parse_evidence + bySourceType.attachment_summary;
    const artifactCoverageRate = attachmentSources === 0
        ? 1
        : bySourceType.attachment_parse_evidence / attachmentSources;
    const staleOrInvalidatedSources = byReason.suppressed_stale + byReason.superseded + byReason.invalidated;
    const gateFailures = REASONS
        .filter((reason) => reason !== 'included')
        .map((reason) => ({ reason, count: byReason[reason] }))
        .filter((item) => item.count > 0);

    return {
        schemaVersion: LOCAL_ABSORPTION_TELEMETRY_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        queueCount: queues.length,
        totals: {
            sources,
            renderableClaims,
            byReason,
            bySourceType,
            artifactCoverageRate,
            staleOrInvalidatedSources,
            maxArtifactAgeDays: artifactAges.length > 0 ? Math.max(...artifactAges) : null,
            averageArtifactAgeDays: artifactAges.length > 0
                ? artifactAges.reduce((total, value) => total + value, 0) / artifactAges.length
                : null,
        },
        gateFailures,
        phiSafety: {
            includesRawText: false,
            includesPatientIdentifiers: false,
            includesPromptsOrModelOutput: false,
        },
    };
}

/* @Codex */
export function buildLocalAbsorptionTelemetryReportFromInputs(
    inputs: BuildEvidenceQueueInput[],
): LocalAbsorptionTelemetryReport {
    return buildLocalAbsorptionTelemetryReport(inputs.map((input) => buildEvidenceQueue(input)));
}
