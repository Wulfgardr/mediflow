/* @Codex */
import {
    buildDocumentParseEvidenceArtifact,
    serializeDocumentParseEvidenceArtifact,
} from './document-parse-evidence-artifact';
import {
    buildEvidenceQueue,
    getIncludedEvidenceQueueItems,
    type BuildEvidenceQueueInput,
    type EvidenceQueue,
    type EvidenceQueueItem,
    type EvidenceQueueRenderableClaim,
} from './evidence-queue-contract';

/* @Codex */
export const EVIDENCE_ABSORPTION_BENCHMARK_SCHEMA_VERSION = 'mediflow.evidence_absorption_benchmark.v2';

/* @Codex */
export interface EvidenceAbsorptionBenchmarkCase {
    id: string;
    description: string;
    generatedAt: string;
    patientId: string;
    documents?: Array<{
        id: string;
        fileName: string;
        documentDate: string;
        summary: string;
        rawMarkdown: string;
        qualityLevel?: 'green' | 'yellow' | 'red';
        lowSignalSummaryOnly?: boolean;
        sourceVersion?: string | number;
        artifactSourceVersion?: string | number;
        replacedById?: string;
    }>;
    diaryEntries?: Array<{
        id: string;
        date: string;
        content: string;
        deletedAt?: string | null;
        version?: number;
    }>;
    structuredChartItems?: BuildEvidenceQueueInput['structuredChartItems'];
    expectations: {
        includedSourceIds: string[];
        curatedSourceIds?: string[];
        forbiddenSourceIds?: string[];
        forbiddenClaimTokens?: string[];
        diarySourceIds?: string[];
        attachmentSourceIds?: string[];
        mutateFirstCitationSnippet?: string;
    };
}

/* @Codex */
export interface EvidenceAbsorptionBenchmarkCaseResult {
    id: string;
    relevantSourceRecall: number;
    curatedSourceRecall: number;
    evidenceSeekingSourceGain: number;
    evidenceSeekingRecoveredSourceIds: string[];
    citationCoverage: number;
    citationCorrectness: number;
    staleLeakageRate: number;
    negativeAssertionLeakage: number;
    diaryEvidenceCoverage: number;
    attachmentEvidenceCoverage: number;
    findings: string[];
}

/* @Codex */
export interface EvidenceAbsorptionBenchmarkReport {
    schemaVersion: typeof EVIDENCE_ABSORPTION_BENCHMARK_SCHEMA_VERSION;
    generatedAt: string;
    caseCount: number;
    aggregate: {
        relevantSourceRecall: number;
        curatedSourceRecall: number;
        evidenceSeekingSourceGain: number;
        citationCoverage: number;
        citationCorrectness: number;
        staleLeakageRate: number;
        negativeAssertionLeakage: number;
        diaryEvidenceCoverage: number;
        attachmentEvidenceCoverage: number;
    };
    cases: EvidenceAbsorptionBenchmarkCaseResult[];
}

function average(values: number[]): number {
    if (values.length === 0) return 1;
    return values.reduce((total, value) => total + value, 0) / values.length;
}

function compactComparable(value: string | null | undefined): string {
    return (value ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sourceIdForDocument(documentId: string, lowSignalSummaryOnly?: boolean): string {
    return lowSignalSummaryOnly
        ? `attachment:${documentId}:summary`
        : `attachment:${documentId}:parse-evidence`;
}

function sourceTextMapForCase(testCase: EvidenceAbsorptionBenchmarkCase): Map<string, string> {
    const sourceText = new Map<string, string>();
    for (const document of testCase.documents ?? []) {
        sourceText.set(sourceIdForDocument(document.id, document.lowSignalSummaryOnly), document.rawMarkdown);
    }
    for (const entry of testCase.diaryEntries ?? []) {
        sourceText.set(`diary:${entry.id}`, entry.content);
    }
    return sourceText;
}

function buildQueueForCase(testCase: EvidenceAbsorptionBenchmarkCase): EvidenceQueue {
    const attachments = (testCase.documents ?? []).map((document) => {
        if (document.lowSignalSummaryOnly) {
            return {
                id: document.id,
                patientId: testCase.patientId,
                fileName: document.fileName,
                createdAt: document.documentDate,
                summarySnapshot: document.summary,
                sourceVersion: document.sourceVersion,
                artifactSourceVersion: document.artifactSourceVersion,
                replacedById: document.replacedById,
            };
        }

        const artifact = buildDocumentParseEvidenceArtifact({
            documentInsightId: `benchmark:${testCase.id}:${document.id}`,
            attachmentId: document.id,
            fileName: document.fileName,
            documentDate: document.documentDate,
            summary: document.summary,
            rawMarkdown: document.rawMarkdown,
            qualityLevel: document.qualityLevel,
            diagnoses: [],
            medications: [],
        });

        return {
            id: document.id,
            patientId: testCase.patientId,
            fileName: document.fileName,
            createdAt: document.documentDate,
            parseEvidenceArtifactSnapshot: serializeDocumentParseEvidenceArtifact(artifact),
            sourceVersion: document.sourceVersion,
            artifactSourceVersion: document.artifactSourceVersion,
            replacedById: document.replacedById,
        };
    });

    return buildEvidenceQueue({
        patientId: testCase.patientId,
        generatedAt: testCase.generatedAt,
        attachments,
        diaryEntries: (testCase.diaryEntries ?? []).map((entry) => ({
            ...entry,
            patientId: testCase.patientId,
        })),
        structuredChartItems: testCase.structuredChartItems,
    });
}

function ratio(found: number, expected: number): number {
    if (expected === 0) return 1;
    return found / expected;
}

function sourceRecall(includedSourceIds: Set<string>, expectedSourceIds: string[]): number {
    return ratio(expectedSourceIds.filter((sourceId) => includedSourceIds.has(sourceId)).length, expectedSourceIds.length);
}

function allClaims(items: EvidenceQueueItem[]): EvidenceQueueRenderableClaim[] {
    return items.flatMap((item) => item.renderableClaims);
}

function citationHasCoverage(claim: EvidenceQueueRenderableClaim): boolean {
    return Boolean(
        claim.citation.sourceId
        && (
            claim.citation.snippet
            || (Number.isFinite(claim.citation.offsetStart) && Number.isFinite(claim.citation.offsetEnd))
        ),
    );
}

function citationIsCorrect(claim: EvidenceQueueRenderableClaim, sourceTexts: Map<string, string>): boolean {
    const text = sourceTexts.get(claim.citation.sourceId);
    if (!text) return false;

    if (claim.citation.snippet) {
        return compactComparable(text).includes(compactComparable(claim.citation.snippet));
    }

    if (Number.isFinite(claim.citation.offsetStart) && Number.isFinite(claim.citation.offsetEnd)) {
        const start = claim.citation.offsetStart as number;
        const end = claim.citation.offsetEnd as number;
        return start >= 0 && end > start && end <= text.length;
    }

    return false;
}

function maybeMutateFirstCitation(
    claims: EvidenceQueueRenderableClaim[],
    replacement: string | undefined,
): EvidenceQueueRenderableClaim[] {
    if (!replacement || claims.length === 0) return claims;
    return claims.map((claim, index) => index === 0
        ? { ...claim, citation: { ...claim.citation, snippet: replacement } }
        : claim);
}

function forbiddenLeakage(claims: EvidenceQueueRenderableClaim[], forbiddenTokens: string[] | undefined): number {
    if (!forbiddenTokens?.length) return 0;
    const rendered = compactComparable(claims.map((claim) => claim.label).join(' '));
    const leaked = forbiddenTokens.filter((token) => rendered.includes(compactComparable(token))).length;
    return ratio(leaked, forbiddenTokens.length);
}

function leakageRatio(found: number, possible: number): number {
    if (possible === 0) return 0;
    return found / possible;
}

/* @Codex */
export function runEvidenceAbsorptionBenchmark(
    cases: EvidenceAbsorptionBenchmarkCase[],
): EvidenceAbsorptionBenchmarkReport {
    const caseResults = cases.map((testCase): EvidenceAbsorptionBenchmarkCaseResult => {
        const queue = buildQueueForCase(testCase);
        const includedItems = getIncludedEvidenceQueueItems(queue);
        const includedSourceIds = new Set(includedItems.map((item) => item.source.id));
        const sourceTexts = sourceTextMapForCase(testCase);
        const claims = maybeMutateFirstCitation(
            allClaims(includedItems),
            testCase.expectations.mutateFirstCitationSnippet,
        );
        const citedClaims = claims.filter(citationHasCoverage);
        const correctCitations = citedClaims.filter((claim) => citationIsCorrect(claim, sourceTexts));
        const forbiddenSourceIds = testCase.expectations.forbiddenSourceIds ?? [];
        const leakedForbiddenSources = forbiddenSourceIds.filter((sourceId) => includedSourceIds.has(sourceId));
        const relevantSourceRecall = sourceRecall(includedSourceIds, testCase.expectations.includedSourceIds);
        const curatedSourceIds = new Set(testCase.expectations.curatedSourceIds ?? testCase.expectations.includedSourceIds);
        const curatedMissingSourceIds = testCase.expectations.includedSourceIds
            .filter((sourceId) => !curatedSourceIds.has(sourceId));
        const curatedSourceRecall = sourceRecall(curatedSourceIds, testCase.expectations.includedSourceIds);
        const evidenceSeekingRecoveredSourceIds = curatedMissingSourceIds
            .filter((sourceId) => includedSourceIds.has(sourceId));
        const evidenceSeekingSourceGain = relevantSourceRecall - curatedSourceRecall;
        const citationCoverage = ratio(citedClaims.length, claims.length);
        const citationCorrectness = ratio(correctCitations.length, citedClaims.length);
        const staleLeakageRate = leakageRatio(leakedForbiddenSources.length, forbiddenSourceIds.length);
        const negativeAssertionLeakage = forbiddenLeakage(claims, testCase.expectations.forbiddenClaimTokens);
        const diaryEvidenceCoverage = sourceRecall(includedSourceIds, testCase.expectations.diarySourceIds ?? []);
        const attachmentEvidenceCoverage = sourceRecall(includedSourceIds, testCase.expectations.attachmentSourceIds ?? []);
        const findings: string[] = [];

        if (relevantSourceRecall < 1) findings.push('relevant_source_recall');
        if (citationCoverage < 1) findings.push('citation_coverage');
        if (citationCorrectness < 1) findings.push('citation_correctness');
        if (staleLeakageRate > 0) findings.push('stale_leakage');
        if (negativeAssertionLeakage > 0) findings.push('negative_assertion_leakage');
        if (diaryEvidenceCoverage < 1) findings.push('diary_evidence_coverage');
        if (attachmentEvidenceCoverage < 1) findings.push('attachment_evidence_coverage');
        if (evidenceSeekingRecoveredSourceIds.length < curatedMissingSourceIds.length) {
            findings.push('evidence_seeking_recovery_gap');
        }

        return {
            id: testCase.id,
            relevantSourceRecall,
            curatedSourceRecall,
            evidenceSeekingSourceGain,
            evidenceSeekingRecoveredSourceIds,
            citationCoverage,
            citationCorrectness,
            staleLeakageRate,
            negativeAssertionLeakage,
            diaryEvidenceCoverage,
            attachmentEvidenceCoverage,
            findings,
        };
    });
    const aggregateCaseIds = new Set(
        cases
            .filter((testCase) => !testCase.expectations.mutateFirstCitationSnippet)
            .map((testCase) => testCase.id),
    );
    const aggregateCases = caseResults.filter((item) => aggregateCaseIds.has(item.id));

    return {
        schemaVersion: EVIDENCE_ABSORPTION_BENCHMARK_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        caseCount: caseResults.length,
        aggregate: {
            relevantSourceRecall: average(aggregateCases.map((item) => item.relevantSourceRecall)),
            curatedSourceRecall: average(aggregateCases.map((item) => item.curatedSourceRecall)),
            evidenceSeekingSourceGain: average(aggregateCases.map((item) => item.evidenceSeekingSourceGain)),
            citationCoverage: average(aggregateCases.map((item) => item.citationCoverage)),
            citationCorrectness: average(aggregateCases.map((item) => item.citationCorrectness)),
            staleLeakageRate: average(aggregateCases.map((item) => item.staleLeakageRate)),
            negativeAssertionLeakage: average(aggregateCases.map((item) => item.negativeAssertionLeakage)),
            diaryEvidenceCoverage: average(aggregateCases.map((item) => item.diaryEvidenceCoverage)),
            attachmentEvidenceCoverage: average(aggregateCases.map((item) => item.attachmentEvidenceCoverage)),
        },
        cases: caseResults,
    };
}
