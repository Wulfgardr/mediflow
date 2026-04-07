#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import OpenAI from 'openai';
import {
    buildPatientInsightExtractionPrompt,
    buildSmartImportExtractionPrompt,
    parsePatientInsightExtractionResponse,
    parseSmartImportExtractionResponse,
    type PatientInsightExtractionData,
    type SmartImportDiagnosisExtraction,
    type SmartImportTherapyExtraction,
} from '../lib/ai-task-contracts.ts';
import {
    hasCloudComparatorApproval,
    parseCloudComparatorCasePack,
    type CloudComparatorCasePack,
    type CloudComparatorExpectedDiagnosis,
    type CloudComparatorExpectedTherapy,
    type CloudComparatorPatientInsightCase,
    type CloudComparatorSmartImportCase,
    type ExpectedTokenMatcher,
} from '../lib/cloud-comparator-case-pack.ts';
import { normalizeOllamaBaseUrl } from './ollama-base-url.ts';

type ComparatorUsage = {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
};

type ComparatorPromptArtifacts = {
    patientInsightPromptPath?: string;
    smartImportPromptPath?: string;
};

type ComparatorSystemRun = {
    label: string;
    rawText: string;
    rawPath?: string;
    responseId?: string;
    latencyMs?: number;
    usage?: ComparatorUsage;
};

type PatientInsightMetrics = {
    currentStateRecall: number;
    alertsRecall: number;
    nextStepsRecall: number;
    gapsRecall: number;
    currentStateSemanticRecall: number;
    alertsSemanticRecall: number;
    nextStepsSemanticRecall: number;
    gapsSemanticRecall: number;
    focusRecall: number;
    focusSemanticRecall: number;
    sectionPlacementRate: number;
    alertsPlacementRate: number;
    citationCoverageRate: number;
    supportedClaimRate: number;
    preferredSourceCoverage: number;
    incompleteClaimRate: number;
    forbiddenLeakCount: number;
    forbiddenSourceLeakCount: number;
    moralizingLeakCount: number;
    incompleteClaimCount: number;
    incompleteBudgetExceeded: boolean;
};

type PatientInsightDetails = {
    citedSourceIds: string[];
    findings: string[];
    missingCurrentState: string[];
    missingAlerts: string[];
    missingNextSteps: string[];
    missingGaps: string[];
    missingPreferredSources: string[];
};

type PatientInsightEvaluation = {
    validJson: boolean;
    validTask: boolean;
    output: PatientInsightExtractionData;
    metrics: PatientInsightMetrics;
    details: PatientInsightDetails;
};

type SmartImportMetrics = {
    diagnosisRecall: number;
    diagnosisQueryRecall: number;
    therapyRecall: number;
    dosageRecall: number;
    therapyStateRecall: number;
    sourceIdRate: number;
    reviewUsefulnessRate: number;
    forbiddenLeakCount: number;
    alreadyPresentLeakCount: number;
};

type SmartImportDetails = {
    findings: string[];
    missingDiagnoses: string[];
    missingTherapies: string[];
    therapyStateMisses: string[];
};

type SmartImportEvaluation = {
    validJson: boolean;
    validTask: boolean;
    metrics: SmartImportMetrics;
    details: SmartImportDetails;
};

type ComparedLaneResult<TEvaluation, TDelta> = {
    local?: ComparatorSystemRun & { evaluation: TEvaluation };
    cloud?: ComparatorSystemRun & { evaluation: TEvaluation };
    delta?: TDelta;
};

type PatientInsightDelta = {
    focusRecallDelta: number;
    citationCoverageDelta: number;
    preferredSourceCoverageDelta: number;
    forbiddenLeakDelta: number;
    cloudOnlyStrengths: string[];
    localOnlyStrengths: string[];
};

type SmartImportDelta = {
    diagnosisRecallDelta: number;
    diagnosisQueryRecallDelta: number;
    therapyRecallDelta: number;
    therapyStateRecallDelta: number;
    reviewUsefulnessDelta: number;
    cloudOnlyStrengths: string[];
    localOnlyStrengths: string[];
};

const DISTILLATION_CATEGORIES = [
    'reasoning-pattern',
    'missing-local-heuristic',
    'retrieval-source-hierarchy',
    'contract-rendering',
    'review-safety',
    'synthetic-benchmark-gap',
] as const;

const EVOLUTION_LAYERS = [
    'prompt-builder',
    'retrieval-ranking',
    'post-processing',
    'contract-renderer',
    'benchmark-corpus',
    'guardrails',
] as const;

type DistillationCategory = typeof DISTILLATION_CATEGORIES[number];
type DistillationPriority = 'high' | 'medium' | 'low';
type DistillationLane = 'patient_insight' | 'smart_import' | 'cross-lane';
type EvolutionLayer = typeof EVOLUTION_LAYERS[number];
type TaskRiskLevel = 'low' | 'medium' | 'high';
type TaskDiffSize = 'small' | 'medium';
type MultiAgentExecutionMode = 'parallel-safe' | 'serialized';

type DistillationInsight = {
    lane: DistillationLane;
    category: DistillationCategory;
    priority: DistillationPriority;
    title: string;
    evidence: string[];
    recommendedActions: string[];
    syntheticTargets: string[];
};

type LocalEvolutionTask = {
    id: string;
    workstreamSlug: string;
    lane: DistillationLane;
    category: DistillationCategory;
    priority: DistillationPriority;
    title: string;
    primaryLayer: EvolutionLayer;
    supportingLayers: EvolutionLayer[];
    scopeSummary: string;
    rationale: string;
    actions: string[];
    validation: string[];
    benchmarkTargets: string[];
    repoTouchpoints: string[];
    suggestedBranch: string;
    estimatedDiffSize: TaskDiffSize;
    riskLevel: TaskRiskLevel;
    suggestedCommands: string[];
    definitionOfDone: string[];
    nonGoals: string[];
    coordination: {
        anchorIssueId: string;
        branchTemplate: string;
        conversationRule: string;
        executionMode: MultiAgentExecutionMode;
        parallelizableWith: string[];
        serializedWith: string[];
    };
};

type RecommendedNextSlice = {
    taskId: string;
    workstreamSlug: string;
    suggestedBranch: string;
    reason: string;
};

type DocumentIntelligenceReviewRecommendation = {
    slug: string;
    title: string;
    why: string;
    repoTouchpoints: string[];
};

type DocumentIntelligenceReview = {
    currentState: string[];
    extractedLessons: string[];
    architectureGaps: string[];
    proposedPrinciples: string[];
    recommendedThinSlices: DocumentIntelligenceReviewRecommendation[];
    artifactPath?: string;
};

export type CloudComparatorReport = {
    generatedAt: string;
    casePackPath: string;
    casePackId: string;
    title: string;
    promptArtifacts?: ComparatorPromptArtifacts;
    cloudRun?: {
        model: string;
        reasoningEffort: string;
        verbosity: string;
        store: false;
    };
    patientInsight?: ComparedLaneResult<PatientInsightEvaluation, PatientInsightDelta>;
    smartImport?: ComparedLaneResult<SmartImportEvaluation, SmartImportDelta>;
    distillation: {
        learningObjectives: string[];
        hypothesisTags: string[];
        failurePatterns: string[];
        insights: DistillationInsight[];
        categoryCounts: Record<DistillationCategory, number>;
        layerCounts: Record<EvolutionLayer, number>;
        localEvolutionAgenda: LocalEvolutionTask[];
        recommendedNextSlice?: RecommendedNextSlice;
        briefArtifactPaths?: string[];
        briefIndexPath?: string;
        nextSliceBriefPath?: string;
        documentIntelligenceReview: DocumentIntelligenceReview;
        recommendedWorkstreams: string[];
        nextSyntheticTargets: string[];
        followupQuestions: string[];
    };
};

type ExecuteOptions = {
    casePackPath: string;
    emitPromptsDir?: string | null;
    rawOutDir?: string | null;
    briefsOutDir?: string | null;
    localPatientInsightPath?: string | null;
    cloudPatientInsightPath?: string | null;
    localSmartImportPath?: string | null;
    cloudSmartImportPath?: string | null;
    runLocal: boolean;
    runCloud: boolean;
    localModel: string;
    cloudModel: string;
    ollamaBaseUrl: string;
    cloudReasoningEffort: string;
    cloudVerbosity: string;
};

const DEFAULT_LOCAL_MODEL = 'qwen3.5:35b-a3b';
const DEFAULT_CLOUD_MODEL = 'gpt-5.4';
const DISTILLATION_ANCHOR_ISSUE_ID = 'WUL-151';
const MORALIZING_TOKEN_GROUPS = [
    ['dovrebbe', 'smettere'],
    ['deve', 'impegnarsi'],
    ['scarsa', 'aderenza'],
    ['non', 'collabora'],
];

function parseArgs(argv: string[]) {
    const args = {
        casePack: null as string | null,
        emitPromptsDir: null as string | null,
        rawOutDir: null as string | null,
        briefsOutDir: null as string | null,
        localPatientInsight: null as string | null,
        cloudPatientInsight: null as string | null,
        localSmartImport: null as string | null,
        cloudSmartImport: null as string | null,
        runLocal: false,
        runCloud: false,
        localModel: DEFAULT_LOCAL_MODEL,
        cloudModel: DEFAULT_CLOUD_MODEL,
        ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        cloudReasoningEffort: 'high',
        cloudVerbosity: 'low',
        out: null as string | null,
        markdownOut: null as string | null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--case-pack' && argv[index + 1]) {
            args.casePack = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--emit-prompts-dir' && argv[index + 1]) {
            args.emitPromptsDir = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--raw-out-dir' && argv[index + 1]) {
            args.rawOutDir = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--briefs-out-dir' && argv[index + 1]) {
            args.briefsOutDir = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--local-patient-insight' && argv[index + 1]) {
            args.localPatientInsight = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--cloud-patient-insight' && argv[index + 1]) {
            args.cloudPatientInsight = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--local-smart-import' && argv[index + 1]) {
            args.localSmartImport = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--cloud-smart-import' && argv[index + 1]) {
            args.cloudSmartImport = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--run-local') {
            args.runLocal = true;
        } else if (value === '--run-cloud') {
            args.runCloud = true;
        } else if (value === '--local-model' && argv[index + 1]) {
            args.localModel = argv[index + 1].trim() || args.localModel;
            index += 1;
        } else if (value === '--cloud-model' && argv[index + 1]) {
            args.cloudModel = argv[index + 1].trim() || args.cloudModel;
            index += 1;
        } else if (value === '--ollama-base-url' && argv[index + 1]) {
            args.ollamaBaseUrl = argv[index + 1];
            index += 1;
        } else if (value === '--cloud-reasoning-effort' && argv[index + 1]) {
            args.cloudReasoningEffort = argv[index + 1].trim() || args.cloudReasoningEffort;
            index += 1;
        } else if (value === '--cloud-verbosity' && argv[index + 1]) {
            args.cloudVerbosity = argv[index + 1].trim() || args.cloudVerbosity;
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--markdown-out' && argv[index + 1]) {
            args.markdownOut = path.resolve(argv[index + 1]);
            index += 1;
        }
    }

    return args;
}

function ensureParentDirectory(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath: string, content: string) {
    ensureParentDirectory(filePath);
    fs.writeFileSync(filePath, content, 'utf8');
}

function readTextFile(filePath: string) {
    return fs.readFileSync(filePath, 'utf8');
}

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function stripMarkers(value: string): string {
    return value.replace(/\[[^\]]+\]/g, ' ');
}

function includesAllTokens(text: string, tokens: string[] | undefined): boolean {
    if (!tokens || tokens.length === 0) return true;
    const haystack = normalizeText(text);
    return tokens.every((token) => haystack.includes(normalizeText(token)));
}

function normalizeExpectedMatchers(matchers: ExpectedTokenMatcher[] | undefined): string[][][] {
    if (!matchers || matchers.length === 0) return [];
    const normalized: string[][][] = [];

    for (const matcher of matchers) {
        if (!Array.isArray(matcher) || matcher.length === 0) continue;
        if (Array.isArray(matcher[0])) {
            normalized.push((matcher as string[][]).filter((tokens) => Array.isArray(tokens) && tokens.length > 0));
            continue;
        }

        normalized.push([matcher as string[]]);
    }

    return normalized;
}

function matcherSatisfied(text: string, matcher: string[][]): boolean {
    return matcher.some((tokens) => includesAllTokens(text, tokens));
}

function formatMatcher(matcher: string[][]): string {
    return matcher.map((tokens) => tokens.join(' + ')).join(' | ');
}

function toRate(numerator: number, denominator: number): number {
    if (denominator === 0) return 1;
    return Number((numerator / denominator).toFixed(3));
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function extractSourceIds(text: string): string[] {
    return Array.from(new Set(Array.from(text.matchAll(/\bS\d+\b/g), (match) => match[0])));
}

function hasSourceCitation(text: string): boolean {
    return /\bS\d+\b/.test(text);
}

function hasCitationOrGapMarker(text: string): boolean {
    return hasSourceCitation(text) || text.includes('[DATI-INCOMPLETI]');
}

function scoreExpectedGroups(claims: string[], expectedGroups: ExpectedTokenMatcher[] | undefined): number {
    const matchers = normalizeExpectedMatchers(expectedGroups);
    if (matchers.length === 0) return 1;
    const strippedClaims = claims.map((claim) => stripMarkers(claim));
    const hits = matchers.filter((matcher) => strippedClaims.some((claim) => matcherSatisfied(claim, matcher))).length;
    return toRate(hits, matchers.length);
}

function countExpectedGroupHits(claims: string[], expectedGroups: ExpectedTokenMatcher[] | undefined): number {
    const matchers = normalizeExpectedMatchers(expectedGroups);
    if (matchers.length === 0) return 0;
    const strippedClaims = claims.map((claim) => stripMarkers(claim));
    return matchers.filter((matcher) => strippedClaims.some((claim) => matcherSatisfied(claim, matcher))).length;
}

function findMissingExpectedGroups(claims: string[], expectedGroups: ExpectedTokenMatcher[] | undefined): string[] {
    const matchers = normalizeExpectedMatchers(expectedGroups);
    if (matchers.length === 0) return [];
    const strippedClaims = claims.map((claim) => stripMarkers(claim));
    return matchers
        .filter((matcher) => !strippedClaims.some((claim) => matcherSatisfied(claim, matcher)))
        .map((matcher) => formatMatcher(matcher));
}

function describeSectionGap(label: string, groups: string[]) {
    if (groups.length === 0) return null;
    return `missing ${label}: ${groups.join(', ')}`;
}

function describeSectionDrift(label: string, strictMissing: string[], semanticMissing: string[]) {
    const driftGroups = strictMissing.filter((group) => !semanticMissing.includes(group));
    if (driftGroups.length === 0) return null;
    return `section drift in ${label}: ${driftGroups.join(', ')}`;
}

function scorePatientInsightCase(entry: CloudComparatorPatientInsightCase, output: PatientInsightExtractionData): PatientInsightEvaluation {
    const claims = [
        ...output.currentState,
        ...output.alerts,
        ...output.nextSteps,
        ...output.gaps,
    ];
    const citedSourceIds = Array.from(new Set(claims.flatMap((claim) => extractSourceIds(claim))));
    const preferredSourceIds = new Set(entry.expected.preferredSourceIds || []);
    const forbiddenSourceIds = new Set(entry.expected.forbiddenSourceIds || []);
    const preferredSourceHits = citedSourceIds.filter((sourceId) => preferredSourceIds.has(sourceId)).length;
    const forbiddenSourceHits = citedSourceIds.filter((sourceId) => forbiddenSourceIds.has(sourceId)).length;
    const forbiddenLeakCount = (entry.expected.forbiddenTokens || []).filter((tokens) => (
        claims.some((claim) => includesAllTokens(stripMarkers(claim), tokens))
    )).length;
    const moralizingLeakCount = MORALIZING_TOKEN_GROUPS.filter((tokens) => (
        claims.some((claim) => includesAllTokens(stripMarkers(claim), tokens))
    )).length;
    const incompleteClaimCount = claims.filter((claim) => claim.includes('[DATI-INCOMPLETI]')).length;

    const currentStateRecall = scoreExpectedGroups(output.currentState, entry.expected.currentStateAny);
    const alertsRecall = scoreExpectedGroups(output.alerts, entry.expected.alertsAny);
    const nextStepsRecall = scoreExpectedGroups(output.nextSteps, entry.expected.nextStepsAny);
    const gapsRecall = scoreExpectedGroups(output.gaps, entry.expected.gapsAny);
    const currentStateSemanticRecall = scoreExpectedGroups(claims, entry.expected.currentStateAny);
    const alertsSemanticRecall = scoreExpectedGroups(claims, entry.expected.alertsAny);
    const nextStepsSemanticRecall = scoreExpectedGroups(claims, entry.expected.nextStepsAny);
    const gapsSemanticRecall = scoreExpectedGroups(claims, entry.expected.gapsAny);

    const currentStateMissing = findMissingExpectedGroups(output.currentState, entry.expected.currentStateAny);
    const alertsMissing = findMissingExpectedGroups(output.alerts, entry.expected.alertsAny);
    const nextStepsMissing = findMissingExpectedGroups(output.nextSteps, entry.expected.nextStepsAny);
    const gapsMissing = findMissingExpectedGroups(output.gaps, entry.expected.gapsAny);
    const currentStateSemanticMissing = findMissingExpectedGroups(claims, entry.expected.currentStateAny);
    const alertsSemanticMissing = findMissingExpectedGroups(claims, entry.expected.alertsAny);
    const nextStepsSemanticMissing = findMissingExpectedGroups(claims, entry.expected.nextStepsAny);
    const gapsSemanticMissing = findMissingExpectedGroups(claims, entry.expected.gapsAny);
    const preferredSourceMisses = Array.from(preferredSourceIds).filter((sourceId) => !citedSourceIds.includes(sourceId));
    const uncitedClaimCount = claims.filter((claim) => !hasCitationOrGapMarker(claim)).length;
    const currentStateStrictHits = countExpectedGroupHits(output.currentState, entry.expected.currentStateAny);
    const alertsStrictHits = countExpectedGroupHits(output.alerts, entry.expected.alertsAny);
    const nextStepsStrictHits = countExpectedGroupHits(output.nextSteps, entry.expected.nextStepsAny);
    const gapsStrictHits = countExpectedGroupHits(output.gaps, entry.expected.gapsAny);
    const currentStateSemanticHits = countExpectedGroupHits(claims, entry.expected.currentStateAny);
    const alertsSemanticHits = countExpectedGroupHits(claims, entry.expected.alertsAny);
    const nextStepsSemanticHits = countExpectedGroupHits(claims, entry.expected.nextStepsAny);
    const gapsSemanticHits = countExpectedGroupHits(claims, entry.expected.gapsAny);
    const placementRates = [
        currentStateSemanticHits === 0 ? 1 : toRate(currentStateStrictHits, currentStateSemanticHits),
        alertsSemanticHits === 0 ? 1 : toRate(alertsStrictHits, alertsSemanticHits),
        nextStepsSemanticHits === 0 ? 1 : toRate(nextStepsStrictHits, nextStepsSemanticHits),
        gapsSemanticHits === 0 ? 1 : toRate(gapsStrictHits, gapsSemanticHits),
    ];

    const findings = [
        describeSectionDrift('currentState', currentStateMissing, currentStateSemanticMissing),
        describeSectionGap('current state anchors', currentStateMissing),
        describeSectionDrift('alerts', alertsMissing, alertsSemanticMissing),
        describeSectionGap('alerts anchors', alertsMissing),
        describeSectionDrift('nextSteps', nextStepsMissing, nextStepsSemanticMissing),
        describeSectionGap('next-step anchors', nextStepsMissing),
        describeSectionDrift('gaps', gapsMissing, gapsSemanticMissing),
        describeSectionGap('gap anchors', gapsMissing),
        preferredSourceMisses.length > 0 ? `missing preferred recent sources: ${preferredSourceMisses.join(', ')}` : null,
        uncitedClaimCount > 0 ? `claims without citation or [DATI-INCOMPLETI]: ${uncitedClaimCount}` : null,
        forbiddenLeakCount > 0 ? `forbidden topic leakage count: ${forbiddenLeakCount}` : null,
        forbiddenSourceHits > 0 ? `forbidden sources cited: ${citedSourceIds.filter((sourceId) => forbiddenSourceIds.has(sourceId)).join(', ')}` : null,
        moralizingLeakCount > 0 ? `moralizing phrasing count: ${moralizingLeakCount}` : null,
        incompleteClaimCount > 0 ? `claims marked [DATI-INCOMPLETI]: ${incompleteClaimCount}` : null,
        incompleteClaimCount > (entry.expected.maxIncompleteClaims ?? Number.MAX_SAFE_INTEGER)
            ? `incomplete-claim budget exceeded: ${incompleteClaimCount}/${entry.expected.maxIncompleteClaims}`
            : null,
    ].filter((value): value is string => Boolean(value));

    return {
        validJson: true,
        validTask: true,
        output,
        metrics: {
            currentStateRecall,
            alertsRecall,
            nextStepsRecall,
            gapsRecall,
            currentStateSemanticRecall,
            alertsSemanticRecall,
            nextStepsSemanticRecall,
            gapsSemanticRecall,
            focusRecall: average([currentStateRecall, nextStepsRecall]),
            focusSemanticRecall: average([currentStateSemanticRecall, nextStepsSemanticRecall]),
            sectionPlacementRate: average(placementRates),
            alertsPlacementRate: alertsSemanticHits === 0 ? 1 : toRate(alertsStrictHits, alertsSemanticHits),
            citationCoverageRate: toRate(claims.filter((claim) => hasCitationOrGapMarker(claim)).length, claims.length),
            supportedClaimRate: toRate(claims.filter((claim) => hasSourceCitation(claim)).length, claims.length),
            preferredSourceCoverage: toRate(preferredSourceHits, preferredSourceIds.size),
            incompleteClaimRate: toRate(incompleteClaimCount, claims.length),
            forbiddenLeakCount,
            forbiddenSourceLeakCount: forbiddenSourceHits,
            moralizingLeakCount,
            incompleteClaimCount,
            incompleteBudgetExceeded: incompleteClaimCount > (entry.expected.maxIncompleteClaims ?? Number.MAX_SAFE_INTEGER),
        },
        details: {
            citedSourceIds,
            findings,
            missingCurrentState: currentStateMissing,
            missingAlerts: alertsMissing,
            missingNextSteps: nextStepsMissing,
            missingGaps: gapsMissing,
            missingPreferredSources: preferredSourceMisses,
        },
    };
}

function buildProbeTokens(...values: Array<string | undefined>): string[] {
    return Array.from(new Set(
        values
            .flatMap((value) => normalizeText(value || '').split(/\s+/))
            .map((token) => token.trim())
            .filter((token) => token.length >= 3 || /^[0-9]+$/.test(token))
    ));
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function getRecordArray(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
    const value = payload[key];
    if (!Array.isArray(value)) return [];

    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
}

function matchesExistingText(existingTexts: string[], tokens: string[]): boolean {
    if (tokens.length === 0) return false;
    return existingTexts.some((text) => includesAllTokens(text, tokens));
}

function collectCurrentDiagnosisTexts(payload: Record<string, unknown>): string[] {
    return getRecordArray(payload, 'currentDiagnoses')
        .map((diagnosis) => [
            stringValue(diagnosis.system),
            stringValue(diagnosis.code),
            stringValue(diagnosis.description),
        ].filter(Boolean).join(' '))
        .filter(Boolean);
}

function collectCurrentTherapies(payload: Record<string, unknown>) {
    return getRecordArray(payload, 'currentActiveTherapies')
        .map((therapy) => ({
            label: [
                stringValue(therapy.drugName),
                stringValue(therapy.activePrinciple),
                stringValue(therapy.aic),
                stringValue(therapy.atc),
            ].filter(Boolean).join(' '),
            dosage: stringValue(therapy.dosage),
        }))
        .filter((therapy) => therapy.label.length > 0);
}

function hasValidSourceId(
    suggestion: SmartImportDiagnosisExtraction | SmartImportTherapyExtraction,
    allowedSourceIds: Set<string>,
) {
    const sourceId = 'sourceId' in suggestion ? suggestion.sourceId : undefined;
    return typeof sourceId === 'string' && allowedSourceIds.has(sourceId);
}

function findDiagnosisMatch(
    diagnoses: SmartImportDiagnosisExtraction[],
    expected: CloudComparatorExpectedDiagnosis,
) {
    return diagnoses.find((diagnosis) => includesAllTokens(diagnosis.label, expected.labelTokens));
}

function findTherapyMatch(
    therapies: SmartImportTherapyExtraction[],
    expected: CloudComparatorExpectedTherapy,
) {
    return therapies.find((therapy) => {
        const probe = [therapy.drugMention, therapy.activePrinciple, therapy.drugQuery].filter(Boolean).join(' ');
        return includesAllTokens(probe, expected.drugTokens);
    });
}

function matchCurrentTherapy(
    therapy: Pick<SmartImportTherapyExtraction, 'drugMention' | 'activePrinciple' | 'drugQuery' | 'dosage'>,
    currentTherapies: Array<{ label: string; dosage: string }>,
) {
    const therapyTokens = buildProbeTokens(therapy.activePrinciple, therapy.drugMention, therapy.drugQuery);
    if (therapyTokens.length === 0) {
        return { related: false, exact: false };
    }

    const relatedMatches = currentTherapies.filter((existing) => includesAllTokens(existing.label, therapyTokens));
    if (relatedMatches.length === 0) {
        return { related: false, exact: false };
    }

    const dosageTokens = buildProbeTokens(therapy.dosage);
    const exact = dosageTokens.length === 0
        ? true
        : relatedMatches.some((existing) => includesAllTokens(existing.dosage, dosageTokens));

    return {
        related: true,
        exact,
    };
}

function isDiagnosisAlreadyPresent(diagnosis: SmartImportDiagnosisExtraction, currentDiagnosisTexts: string[]) {
    return matchesExistingText(currentDiagnosisTexts, buildProbeTokens(diagnosis.label, diagnosis.icdQuery));
}

function scoreSmartImportCase(entry: CloudComparatorSmartImportCase, diagnoses: SmartImportDiagnosisExtraction[], therapies: SmartImportTherapyExtraction[]): SmartImportEvaluation {
    const allowedSourceIds = new Set(
        Array.isArray(entry.payload.sources)
            ? entry.payload.sources
                .map((source) => (source && typeof source === 'object' ? (source as { id?: unknown }).id : undefined))
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
            : [],
    );
    const currentDiagnosisTexts = collectCurrentDiagnosisTexts(entry.payload);
    const currentTherapies = collectCurrentTherapies(entry.payload);
    const expectedDiagnoses = entry.expected.diagnoses || [];
    const expectedTherapies = entry.expected.therapies || [];

    const diagnosisHits = expectedDiagnoses.filter((expected) => findDiagnosisMatch(diagnoses, expected)).length;
    const diagnosisQueryHits = expectedDiagnoses.filter((expected) => {
        const match = findDiagnosisMatch(diagnoses, expected);
        return Boolean(match && includesAllTokens(match.icdQuery, expected.icdQueryTokens));
    }).length;
    const therapyHits = expectedTherapies.filter((expected) => findTherapyMatch(therapies, expected)).length;
    const dosageTargets = expectedTherapies.filter((expected) => expected.dosageTokens && expected.dosageTokens.length > 0);
    const dosageHits = dosageTargets.filter((expected) => {
        const match = findTherapyMatch(therapies, expected);
        return Boolean(match && includesAllTokens(match.dosage || '', expected.dosageTokens));
    }).length;
    const therapyStateTargets = expectedTherapies.filter((expected) => expected.therapyState);
    const therapyStateHits = therapyStateTargets.filter((expected) => {
        const match = findTherapyMatch(therapies, expected);
        return Boolean(match && match.therapyState === expected.therapyState);
    }).length;

    const suggestions = [...diagnoses, ...therapies];
    const validSourceIdCount = suggestions.filter((suggestion) => hasValidSourceId(suggestion, allowedSourceIds)).length;
    const usefulDiagnosisTargets = expectedDiagnoses.filter((expected) => !matchesExistingText(currentDiagnosisTexts, expected.labelTokens));
    const usefulDiagnosisHits = usefulDiagnosisTargets.filter((expected) => {
        const match = findDiagnosisMatch(diagnoses, expected);
        return Boolean(match && hasValidSourceId(match, allowedSourceIds));
    }).length;
    const usefulTherapyTargets = expectedTherapies.filter((expected) => {
        if (expected.therapyState && expected.therapyState !== 'active') {
            return true;
        }

        return !matchCurrentTherapy({
            drugMention: expected.drugTokens.join(' '),
            activePrinciple: expected.drugTokens.join(' '),
            drugQuery: expected.drugTokens.join(' '),
            dosage: expected.dosageTokens?.join(' '),
        }, currentTherapies).exact;
    });
    const usefulTherapyHits = usefulTherapyTargets.filter((expected) => {
        const match = findTherapyMatch(therapies, expected);
        if (!match || !hasValidSourceId(match, allowedSourceIds)) return false;
        if (expected.dosageTokens?.length && !includesAllTokens(match.dosage || '', expected.dosageTokens)) return false;
        if (expected.therapyState && match.therapyState !== expected.therapyState) return false;
        return true;
    }).length;

    const forbiddenDiagnosisHits = (entry.expected.forbiddenDiagnosisTokens || []).filter((tokens) => (
        diagnoses.some((diagnosis) => includesAllTokens([diagnosis.label, diagnosis.icdQuery].join(' '), tokens))
    )).length;
    const forbiddenTherapyHits = (entry.expected.forbiddenTherapyTokens || []).filter((tokens) => (
        therapies.some((therapy) => includesAllTokens([therapy.drugMention, therapy.activePrinciple, therapy.drugQuery].join(' '), tokens))
    )).length;
    const alreadyPresentDiagnosisLeaks = diagnoses.filter((diagnosis) => isDiagnosisAlreadyPresent(diagnosis, currentDiagnosisTexts)).length;
    const alreadyPresentTherapyLeaks = therapies.filter((therapy) => (
        (therapy.therapyState || 'active') === 'active'
        && matchCurrentTherapy(therapy, currentTherapies).exact
    )).length;

    const missingDiagnoses = expectedDiagnoses
        .filter((expected) => !findDiagnosisMatch(diagnoses, expected))
        .map((expected) => expected.labelTokens.join(' + '));
    const missingTherapies = expectedTherapies
        .filter((expected) => !findTherapyMatch(therapies, expected))
        .map((expected) => expected.drugTokens.join(' + '));
    const therapyStateMisses = therapyStateTargets
        .filter((expected) => {
            const match = findTherapyMatch(therapies, expected);
            return !match || match.therapyState !== expected.therapyState;
        })
        .map((expected) => `${expected.drugTokens.join(' + ')} => ${expected.therapyState}`);

    const findings = [
        missingDiagnoses.length > 0 ? `missing diagnoses: ${missingDiagnoses.join(', ')}` : null,
        missingTherapies.length > 0 ? `missing therapies: ${missingTherapies.join(', ')}` : null,
        therapyStateMisses.length > 0 ? `therapy-state misses: ${therapyStateMisses.join(', ')}` : null,
        forbiddenDiagnosisHits + forbiddenTherapyHits > 0 ? `forbidden leakage count: ${forbiddenDiagnosisHits + forbiddenTherapyHits}` : null,
        alreadyPresentDiagnosisLeaks + alreadyPresentTherapyLeaks > 0 ? `already-present leakage count: ${alreadyPresentDiagnosisLeaks + alreadyPresentTherapyLeaks}` : null,
    ].filter((value): value is string => Boolean(value));

    return {
        validJson: true,
        validTask: true,
        metrics: {
            diagnosisRecall: toRate(diagnosisHits, expectedDiagnoses.length),
            diagnosisQueryRecall: toRate(diagnosisQueryHits, expectedDiagnoses.length),
            therapyRecall: toRate(therapyHits, expectedTherapies.length),
            dosageRecall: toRate(dosageHits, dosageTargets.length),
            therapyStateRecall: toRate(therapyStateHits, therapyStateTargets.length),
            sourceIdRate: toRate(validSourceIdCount, suggestions.length),
            reviewUsefulnessRate: toRate(
                usefulDiagnosisHits + usefulTherapyHits,
                usefulDiagnosisTargets.length + usefulTherapyTargets.length,
            ),
            forbiddenLeakCount: forbiddenDiagnosisHits + forbiddenTherapyHits,
            alreadyPresentLeakCount: alreadyPresentDiagnosisLeaks + alreadyPresentTherapyLeaks,
        },
        details: {
            findings,
            missingDiagnoses,
            missingTherapies,
            therapyStateMisses,
        },
    };
}

function toComparatorUsage(value: unknown): ComparatorUsage | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const usage = value as {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_tokens?: unknown;
        output_tokens_details?: { reasoning_tokens?: unknown };
    };

    return {
        inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
        totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
        reasoningTokens: typeof usage.output_tokens_details?.reasoning_tokens === 'number'
            ? usage.output_tokens_details.reasoning_tokens
            : undefined,
    };
}

async function generateLocalCompletion(baseUrl: string, model: string, prompt: string, maxTokens: number): Promise<ComparatorSystemRun> {
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const start = performance.now();
    const response = await fetch(`${normalizedBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            think: false,
            options: {
                temperature: 0.2,
                num_predict: maxTokens,
            },
        }),
    });

    const latencyMs = Number((performance.now() - start).toFixed(1));
    if (!response.ok) {
        throw new Error(`Local comparator HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as {
        message?: { content?: string };
        choices?: Array<{ message?: { content?: string } }>;
    };

    return {
        label: model,
        rawText: payload.message?.content || payload.choices?.[0]?.message?.content || '',
        latencyMs,
    };
}

async function generateCloudCompletion(model: string, prompt: string, maxTokens: number, reasoningEffort: string, verbosity: string): Promise<ComparatorSystemRun> {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required for --run-cloud.');
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const start = performance.now();
    const response = await client.responses.create({
        model,
        input: prompt,
        max_output_tokens: maxTokens,
        reasoning: { effort: reasoningEffort as 'none' | 'low' | 'medium' | 'high' | 'xhigh' },
        text: { verbosity: verbosity as 'low' | 'medium' | 'high' },
        store: false,
    });
    const latencyMs = Number((performance.now() - start).toFixed(1));

    return {
        label: model,
        rawText: response.output_text || '',
        responseId: response.id,
        latencyMs,
        usage: toComparatorUsage(response.usage),
    };
}

function emitPrompts(casePack: CloudComparatorCasePack, outputDir: string): ComparatorPromptArtifacts {
    fs.mkdirSync(outputDir, { recursive: true });
    const artifacts: ComparatorPromptArtifacts = {};

    if (casePack.patientInsight) {
        const promptPath = path.join(outputDir, `${casePack.id}.patient-insight.prompt.txt`);
        writeTextFile(promptPath, buildPatientInsightExtractionPrompt(casePack.patientInsight.context));
        artifacts.patientInsightPromptPath = promptPath;
    }

    if (casePack.smartImport) {
        const promptPath = path.join(outputDir, `${casePack.id}.smart-import.prompt.txt`);
        writeTextFile(promptPath, buildSmartImportExtractionPrompt(casePack.smartImport.payload));
        artifacts.smartImportPromptPath = promptPath;
    }

    return artifacts;
}

function ensurePathOutsideRepo(filePath: string | null | undefined, repoRoot: string, label: string) {
    if (!filePath) return;
    const resolved = path.resolve(filePath);
    const relative = path.relative(repoRoot, resolved);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        throw new Error(`${label} must be stored outside the repository: ${resolved}`);
    }
}

function evaluatePatientInsightRun(run: ComparatorSystemRun, entry: CloudComparatorPatientInsightCase) {
    const parsed = parsePatientInsightExtractionResponse(run.rawText);
    const evaluated = scorePatientInsightCase(entry, parsed.value.data);

    return {
        ...run,
        evaluation: {
            ...evaluated,
            validJson: parsed.validJson,
            validTask: parsed.validTask,
        },
    };
}

function evaluateSmartImportRun(run: ComparatorSystemRun, entry: CloudComparatorSmartImportCase) {
    const parsed = parseSmartImportExtractionResponse(run.rawText);
    const evaluated = scoreSmartImportCase(entry, parsed.value.data.diagnoses, parsed.value.data.therapies);

    return {
        ...run,
        evaluation: {
            ...evaluated,
            validJson: parsed.validJson,
            validTask: parsed.validTask,
        },
    };
}

function comparePatientInsight(
    local: ReturnType<typeof evaluatePatientInsightRun> | undefined,
    cloud: ReturnType<typeof evaluatePatientInsightRun> | undefined,
): ComparedLaneResult<PatientInsightEvaluation, PatientInsightDelta> | undefined {
    if (!local && !cloud) return undefined;
    if (!local || !cloud) return { local, cloud };

    const cloudOnlyStrengths: string[] = [];
    const localOnlyStrengths: string[] = [];

    if (cloud.evaluation.metrics.focusRecall > local.evaluation.metrics.focusRecall) {
        cloudOnlyStrengths.push(`better focus recall (${local.evaluation.metrics.focusRecall} -> ${cloud.evaluation.metrics.focusRecall})`);
    }
    if (cloud.evaluation.metrics.citationCoverageRate > local.evaluation.metrics.citationCoverageRate) {
        cloudOnlyStrengths.push(`stronger citation discipline (${local.evaluation.metrics.citationCoverageRate} -> ${cloud.evaluation.metrics.citationCoverageRate})`);
    }
    if (cloud.evaluation.metrics.preferredSourceCoverage > local.evaluation.metrics.preferredSourceCoverage) {
        cloudOnlyStrengths.push(`better preferred-source coverage (${local.evaluation.metrics.preferredSourceCoverage} -> ${cloud.evaluation.metrics.preferredSourceCoverage})`);
    }
    if (local.evaluation.metrics.focusRecall > cloud.evaluation.metrics.focusRecall) {
        localOnlyStrengths.push(`better focus recall (${cloud.evaluation.metrics.focusRecall} -> ${local.evaluation.metrics.focusRecall})`);
    }
    if (local.evaluation.metrics.citationCoverageRate > cloud.evaluation.metrics.citationCoverageRate) {
        localOnlyStrengths.push(`stronger citation discipline (${cloud.evaluation.metrics.citationCoverageRate} -> ${local.evaluation.metrics.citationCoverageRate})`);
    }

    return {
        local,
        cloud,
        delta: {
            focusRecallDelta: Number((cloud.evaluation.metrics.focusRecall - local.evaluation.metrics.focusRecall).toFixed(3)),
            citationCoverageDelta: Number((cloud.evaluation.metrics.citationCoverageRate - local.evaluation.metrics.citationCoverageRate).toFixed(3)),
            preferredSourceCoverageDelta: Number((cloud.evaluation.metrics.preferredSourceCoverage - local.evaluation.metrics.preferredSourceCoverage).toFixed(3)),
            forbiddenLeakDelta: cloud.evaluation.metrics.forbiddenLeakCount - local.evaluation.metrics.forbiddenLeakCount,
            cloudOnlyStrengths,
            localOnlyStrengths,
        },
    };
}

function compareSmartImport(
    local: ReturnType<typeof evaluateSmartImportRun> | undefined,
    cloud: ReturnType<typeof evaluateSmartImportRun> | undefined,
): ComparedLaneResult<SmartImportEvaluation, SmartImportDelta> | undefined {
    if (!local && !cloud) return undefined;
    if (!local || !cloud) return { local, cloud };

    const cloudOnlyStrengths: string[] = [];
    const localOnlyStrengths: string[] = [];

    if (cloud.evaluation.metrics.diagnosisRecall > local.evaluation.metrics.diagnosisRecall) {
        cloudOnlyStrengths.push(`better diagnosis recall (${local.evaluation.metrics.diagnosisRecall} -> ${cloud.evaluation.metrics.diagnosisRecall})`);
    }
    if (cloud.evaluation.metrics.therapyStateRecall > local.evaluation.metrics.therapyStateRecall) {
        cloudOnlyStrengths.push(`better therapy-state recall (${local.evaluation.metrics.therapyStateRecall} -> ${cloud.evaluation.metrics.therapyStateRecall})`);
    }
    if (cloud.evaluation.metrics.reviewUsefulnessRate > local.evaluation.metrics.reviewUsefulnessRate) {
        cloudOnlyStrengths.push(`higher review usefulness (${local.evaluation.metrics.reviewUsefulnessRate} -> ${cloud.evaluation.metrics.reviewUsefulnessRate})`);
    }
    if (local.evaluation.metrics.diagnosisRecall > cloud.evaluation.metrics.diagnosisRecall) {
        localOnlyStrengths.push(`better diagnosis recall (${cloud.evaluation.metrics.diagnosisRecall} -> ${local.evaluation.metrics.diagnosisRecall})`);
    }
    if (local.evaluation.metrics.reviewUsefulnessRate > cloud.evaluation.metrics.reviewUsefulnessRate) {
        localOnlyStrengths.push(`higher review usefulness (${cloud.evaluation.metrics.reviewUsefulnessRate} -> ${local.evaluation.metrics.reviewUsefulnessRate})`);
    }

    return {
        local,
        cloud,
        delta: {
            diagnosisRecallDelta: Number((cloud.evaluation.metrics.diagnosisRecall - local.evaluation.metrics.diagnosisRecall).toFixed(3)),
            diagnosisQueryRecallDelta: Number((cloud.evaluation.metrics.diagnosisQueryRecall - local.evaluation.metrics.diagnosisQueryRecall).toFixed(3)),
            therapyRecallDelta: Number((cloud.evaluation.metrics.therapyRecall - local.evaluation.metrics.therapyRecall).toFixed(3)),
            therapyStateRecallDelta: Number((cloud.evaluation.metrics.therapyStateRecall - local.evaluation.metrics.therapyStateRecall).toFixed(3)),
            reviewUsefulnessDelta: Number((cloud.evaluation.metrics.reviewUsefulnessRate - local.evaluation.metrics.reviewUsefulnessRate).toFixed(3)),
            cloudOnlyStrengths,
            localOnlyStrengths,
        },
    };
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
    return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function createCategoryCounts(): Record<DistillationCategory, number> {
    return DISTILLATION_CATEGORIES.reduce((counts, category) => {
        counts[category] = 0;
        return counts;
    }, {} as Record<DistillationCategory, number>);
}

function createLayerCounts(): Record<EvolutionLayer, number> {
    return EVOLUTION_LAYERS.reduce((counts, layer) => {
        counts[layer] = 0;
        return counts;
    }, {} as Record<EvolutionLayer, number>);
}

function pushInsight(
    insights: DistillationInsight[],
    insight: DistillationInsight | null,
) {
    if (!insight) return;
    insights.push({
        ...insight,
        evidence: uniqueStrings(insight.evidence),
        recommendedActions: uniqueStrings(insight.recommendedActions),
        syntheticTargets: uniqueStrings(insight.syntheticTargets),
    });
}

function getInsightLayers(category: DistillationCategory): { primary: EvolutionLayer; supporting: EvolutionLayer[] } {
    switch (category) {
        case 'reasoning-pattern':
            return { primary: 'prompt-builder', supporting: ['retrieval-ranking', 'benchmark-corpus'] };
        case 'missing-local-heuristic':
            return { primary: 'post-processing', supporting: ['prompt-builder', 'benchmark-corpus'] };
        case 'retrieval-source-hierarchy':
            return { primary: 'retrieval-ranking', supporting: ['benchmark-corpus', 'post-processing'] };
        case 'contract-rendering':
            return { primary: 'contract-renderer', supporting: ['post-processing', 'benchmark-corpus'] };
        case 'review-safety':
            return { primary: 'guardrails', supporting: ['post-processing', 'benchmark-corpus'] };
        case 'synthetic-benchmark-gap':
            return { primary: 'benchmark-corpus', supporting: ['prompt-builder', 'retrieval-ranking'] };
        default:
            return { primary: 'benchmark-corpus', supporting: [] };
    }
}

function getLaneValidation(lane: DistillationLane): string[] {
    if (lane === 'patient_insight') {
        return [
            'npm run test:cloud-comparator',
            'npm run typecheck',
            'Aggiornare il corpus sintetico o il benchmark di Patient Insight e rieseguire il comparator',
        ];
    }
    if (lane === 'smart_import') {
        return [
            'npm run test:cloud-comparator',
            'npm run typecheck',
            'Aggiornare il corpus sintetico o il benchmark di Smart Import e rieseguire il comparator',
        ];
    }

    return [
        'npm run test:cloud-comparator',
        'npm run typecheck',
        'Verificare entrambe le lane con un nuovo case pack e nuovi benchmark sintetici correlati',
    ];
}

function slugify(value: string): string {
    return normalizeText(value).replace(/\s+/g, '-');
}

function getScopeSummary(lane: DistillationLane, category: DistillationCategory, primaryLayer: EvolutionLayer): string {
    const laneLabel = lane === 'patient_insight'
        ? 'Patient Insight'
        : lane === 'smart_import'
            ? 'Smart Import'
            : 'cross-lane AI stack';

    switch (category) {
        case 'reasoning-pattern':
            return `Thin slice su ${laneLabel} per imitare localmente un pattern di ragionamento osservato nel comparatore, con intervento principale su ${primaryLayer}.`;
        case 'missing-local-heuristic':
            return `Thin slice su ${laneLabel} per introdurre una nuova euristica locale reviewable, con intervento principale su ${primaryLayer}.`;
        case 'retrieval-source-hierarchy':
            return `Thin slice su ${laneLabel} per riallineare ranking, recency e source hierarchy, con intervento principale su ${primaryLayer}.`;
        case 'contract-rendering':
            return `Thin slice su ${laneLabel} per correggere contract/render locale senza cambiare il posizionamento della lane.`;
        case 'review-safety':
            return `Thin slice su ${laneLabel} per rafforzare guardrail e review safety locale prima del render finale.`;
        case 'synthetic-benchmark-gap':
            return `Thin slice su ${laneLabel} per trasformare il delta osservato in benchmark sintetici e regression gate.`;
        default:
            return `Thin slice su ${laneLabel} guidata dal comparator cloud, con intervento principale su ${primaryLayer}.`;
    }
}

function getRepoTouchpoints(lane: DistillationLane, primaryLayer: EvolutionLayer): string[] {
    const touchpoints = new Set<string>();

    if (lane === 'patient_insight' || lane === 'cross-lane') {
        if (primaryLayer === 'prompt-builder') {
            touchpoints.add('lib/ai-task-contracts.ts');
            touchpoints.add('lib/ai-context.ts');
            touchpoints.add('lib/ai-summary-service.ts');
        }
        if (primaryLayer === 'retrieval-ranking') {
            touchpoints.add('lib/ai-context.ts');
            touchpoints.add('lib/document-evidence-pack.ts');
            touchpoints.add('lib/document-excerpt.ts');
        }
        if (primaryLayer === 'post-processing') {
            touchpoints.add('lib/ai-summary-service.ts');
            touchpoints.add('lib/ai-task-contracts.ts');
        }
        if (primaryLayer === 'contract-renderer') {
            touchpoints.add('lib/ai-task-contracts.ts');
            touchpoints.add('lib/ai-summary-service.ts');
        }
        if (primaryLayer === 'guardrails') {
            touchpoints.add('lib/patient-data-guardrails.ts');
            touchpoints.add('lib/ai-summary-service.ts');
        }
        if (primaryLayer === 'benchmark-corpus') {
            touchpoints.add('scripts/benchmark-patient-insight.ts');
            touchpoints.add('scripts/fixtures/patient-insight-benchmark-corpus.json');
            touchpoints.add('docs/patient-insight-benchmark.md');
        }
    }

    if (lane === 'smart_import' || lane === 'cross-lane') {
        if (primaryLayer === 'prompt-builder') {
            touchpoints.add('lib/ai-task-contracts.ts');
            touchpoints.add('lib/patient-smart-import-service.ts');
        }
        if (primaryLayer === 'retrieval-ranking') {
            touchpoints.add('lib/patient-smart-import-service.ts');
            touchpoints.add('lib/patient-smart-import-matching.ts');
        }
        if (primaryLayer === 'post-processing') {
            touchpoints.add('lib/patient-smart-import-service.ts');
            touchpoints.add('lib/patient-smart-import-matching.ts');
        }
        if (primaryLayer === 'contract-renderer') {
            touchpoints.add('lib/ai-task-contracts.ts');
            touchpoints.add('lib/patient-smart-import-service.ts');
        }
        if (primaryLayer === 'guardrails') {
            touchpoints.add('lib/patient-smart-import-service.ts');
            touchpoints.add('components/patient-smart-import-panel.tsx');
        }
        if (primaryLayer === 'benchmark-corpus') {
            touchpoints.add('scripts/benchmark-smart-import.ts');
            touchpoints.add('scripts/fixtures/smart-import-benchmark-corpus.json');
        }
    }

    touchpoints.add('scripts/cloud-comparator-shadow-eval.ts');
    return Array.from(touchpoints);
}

function getTaskRiskLevel(category: DistillationCategory, primaryLayer: EvolutionLayer): TaskRiskLevel {
    if (category === 'review-safety') return 'high';
    if (category === 'retrieval-source-hierarchy') return 'medium';
    if (category === 'reasoning-pattern') return primaryLayer === 'prompt-builder' ? 'medium' : 'low';
    return primaryLayer === 'benchmark-corpus' ? 'low' : 'medium';
}

function getTaskDiffSize(primaryLayer: EvolutionLayer): TaskDiffSize {
    if (primaryLayer === 'benchmark-corpus' || primaryLayer === 'guardrails') return 'small';
    return 'medium';
}

function getSuggestedCommands(
    lane: DistillationLane,
    branch: string,
): string[] {
    const commands = [`git switch -c ${branch}`];

    if (lane === 'patient_insight') {
        commands.push('npm run test:patient-insight');
        commands.push('npm run benchmark:patient-insight');
    } else if (lane === 'smart_import') {
        commands.push('npm run test:patient-smart-import');
        commands.push('npm run benchmark:smart-import');
    } else {
        commands.push('npm run benchmark:patient-insight');
        commands.push('npm run benchmark:smart-import');
    }

    commands.push('npm run test:cloud-comparator');
    commands.push('npm run typecheck');
    return commands;
}

function getSuggestedUmbrellaBranch(workstreamSlug: string): string {
    return `codex/${DISTILLATION_ANCHOR_ISSUE_ID.toLowerCase()}-${workstreamSlug}`;
}

function getSuggestedBranchTemplate(workstreamSlug: string): string {
    return `codex/<linear-issue-id>-${workstreamSlug}`;
}

function intersectStrings(left: string[], right: string[]): string[] {
    const rightSet = new Set(right);
    return left.filter((value, index) => rightSet.has(value) && left.indexOf(value) === index);
}

function getDefinitionOfDone(task: Pick<LocalEvolutionTask, 'lane' | 'primaryLayer' | 'benchmarkTargets' | 'validation' | 'title'>): string[] {
    const laneLabel = task.lane === 'patient_insight'
        ? 'Patient Insight'
        : task.lane === 'smart_import'
            ? 'Smart Import'
            : 'cross-lane';
    const done = [
        `${laneLabel}: il cambiamento su ${task.primaryLayer} produce un comportamento locale piu allineato al pattern osservato nel comparator`,
        `Eseguiti i check minimi: ${task.validation.join('; ')}`,
    ];

    if (task.benchmarkTargets.length > 0) {
        done.push(`Aggiornati benchmark/casi sintetici correlati: ${task.benchmarkTargets.join(', ')}`);
    }

    return done;
}

function getNonGoals(category: DistillationCategory): string[] {
    const defaults = [
        'Non promuovere GPT o altri modelli cloud nel runtime MediFlow',
        'Non introdurre auto-write o bypass della review umana',
    ];

    switch (category) {
        case 'synthetic-benchmark-gap':
            return [
                ...defaults,
                'Non trasformare il case pack privato in corpus canonico',
            ];
        case 'contract-rendering':
            return [
                ...defaults,
                'Non cambiare il task contract condiviso senza una ragione architetturale esplicita',
            ];
        case 'retrieval-source-hierarchy':
            return [
                ...defaults,
                'Non allargare la superficie dati o l egress per migliorare il ranking',
            ];
        case 'review-safety':
            return [
                ...defaults,
                'Non sacrificare guardrail reviewable per inseguire recall grezzo',
            ];
        default:
            return defaults;
    }
}

function enrichTaskCoordination(tasks: LocalEvolutionTask[]): LocalEvolutionTask[] {
    return tasks.map((task) => {
        const serializedWith: string[] = [];
        const parallelizableWith: string[] = [];

        for (const candidate of tasks) {
            if (candidate.id === task.id) continue;

            const sharedTouchpoints = intersectStrings(task.repoTouchpoints, candidate.repoTouchpoints);
            const sharedBenchmarks = intersectStrings(task.benchmarkTargets, candidate.benchmarkTargets);
            const sameLaneAndLayer = task.lane === candidate.lane && task.primaryLayer === candidate.primaryLayer;
            const mustSerialize = sharedTouchpoints.length > 0 || sharedBenchmarks.length > 0 || sameLaneAndLayer;

            if (mustSerialize) {
                serializedWith.push(candidate.id);
            } else {
                parallelizableWith.push(candidate.id);
            }
        }

        const branchTemplate = getSuggestedBranchTemplate(task.workstreamSlug);
        const conversationRule = serializedWith.length > 0
            ? `Se questa thin slice diventa una issue autonoma, apri una nuova conversazione Codex e usa il branch template ${branchTemplate}; evita esecuzione parallela con ${serializedWith.join(', ')} perche condividono superfici o benchmark.`
            : `Se questa thin slice diventa una issue autonoma, apri una nuova conversazione Codex e usa il branch template ${branchTemplate}; puo viaggiare in parallelo con ${parallelizableWith.join(', ') || 'nessun altro task disponibile'} solo su branch dedicati.`;

        return {
            ...task,
            coordination: {
                anchorIssueId: DISTILLATION_ANCHOR_ISSUE_ID,
                branchTemplate,
                conversationRule,
                executionMode: serializedWith.length > 0 ? 'serialized' : 'parallel-safe',
                parallelizableWith,
                serializedWith,
            },
        };
    });
}

function buildLocalEvolutionAgenda(insights: DistillationInsight[]): LocalEvolutionTask[] {
    const ordered = [...insights].sort((left, right) => {
        const priorityRank = { high: 0, medium: 1, low: 2 };
        const laneRank = { patient_insight: 0, smart_import: 1, 'cross-lane': 2 };

        return priorityRank[left.priority] - priorityRank[right.priority]
            || laneRank[left.lane] - laneRank[right.lane]
            || left.title.localeCompare(right.title);
    });

    const tasks: LocalEvolutionTask[] = ordered.map((insight, index) => {
        const layers = getInsightLayers(insight.category);
        const workstreamSlug = insight.syntheticTargets[0] || slugify(`${insight.lane}-${insight.category}-${insight.title}`);
        const suggestedBranch = getSuggestedUmbrellaBranch(workstreamSlug);
        return {
            id: `wul-151-distill-${String(index + 1).padStart(2, '0')}`,
            workstreamSlug,
            lane: insight.lane,
            category: insight.category,
            priority: insight.priority,
            title: insight.title,
            primaryLayer: layers.primary,
            supportingLayers: layers.supporting,
            scopeSummary: getScopeSummary(insight.lane, insight.category, layers.primary),
            rationale: insight.evidence.join('; '),
            actions: insight.recommendedActions,
            validation: getLaneValidation(insight.lane),
            benchmarkTargets: insight.syntheticTargets,
            repoTouchpoints: getRepoTouchpoints(insight.lane, layers.primary),
            suggestedBranch,
            estimatedDiffSize: getTaskDiffSize(layers.primary),
            riskLevel: getTaskRiskLevel(insight.category, layers.primary),
            suggestedCommands: getSuggestedCommands(insight.lane, suggestedBranch),
            definitionOfDone: getDefinitionOfDone({
                lane: insight.lane,
                primaryLayer: layers.primary,
                benchmarkTargets: insight.syntheticTargets,
                validation: getLaneValidation(insight.lane),
                title: insight.title,
            }),
            nonGoals: getNonGoals(insight.category),
            coordination: {
                anchorIssueId: DISTILLATION_ANCHOR_ISSUE_ID,
                branchTemplate: getSuggestedBranchTemplate(workstreamSlug),
                conversationRule: '',
                executionMode: 'parallel-safe',
                parallelizableWith: [],
                serializedWith: [],
            },
        };
    });

    return enrichTaskCoordination(tasks);
}

function selectRecommendedNextSlice(tasks: LocalEvolutionTask[]): RecommendedNextSlice | undefined {
    if (tasks.length === 0) return undefined;

    const scored = [...tasks].sort((left, right) => {
        const priorityRank = { high: 0, medium: 10, low: 20 };
        const diffRank = { small: 0, medium: 5 };
        const riskRank = { low: 0, medium: 3, high: 6 };
        const laneRank = { patient_insight: 0, smart_import: 1, 'cross-lane': 2 };
        const categoryPenalty = (task: LocalEvolutionTask) => task.category === 'synthetic-benchmark-gap' ? 15 : 0;

        const leftScore = priorityRank[left.priority] + diffRank[left.estimatedDiffSize] + riskRank[left.riskLevel] + laneRank[left.lane] + categoryPenalty(left);
        const rightScore = priorityRank[right.priority] + diffRank[right.estimatedDiffSize] + riskRank[right.riskLevel] + laneRank[right.lane] + categoryPenalty(right);

        return leftScore - rightScore || left.id.localeCompare(right.id);
    });

    const task = scored[0];
    return {
        taskId: task.id,
        workstreamSlug: task.workstreamSlug,
        suggestedBranch: task.suggestedBranch,
        reason: `${task.priority} priority, ${task.estimatedDiffSize} diff, ${task.riskLevel} risk, primary layer ${task.primaryLayer}`,
    };
}

function buildDocumentIntelligenceReview(
    tasks: LocalEvolutionTask[],
    patientInsight: ComparedLaneResult<PatientInsightEvaluation, PatientInsightDelta> | undefined,
    smartImport: ComparedLaneResult<SmartImportEvaluation, SmartImportDelta> | undefined,
): DocumentIntelligenceReview {
    const currentState = [
        'Il runtime documentale attuale persiste document insights compatti e usa mediflow.document_evidence_pack.v2 come pack reviewable cross-surface.',
        'Patient Insight e Smart Import consumano proiezioni locali di questo pack, con envelope generativo condiviso ma senza un ledger documentale first-class.',
        'Il corpus documentale canonico v1 ha gia gold facts e negative assertions, ma queste regole sono piu esplicite nei benchmark che nel runtime persistito.',
    ];

    const extractedLessons = uniqueStrings([
        patientInsight?.delta && patientInsight.delta.focusRecallDelta > 0
            ? 'Il recente e l attivo non stanno emergendo abbastanza nel layer documentale locale.'
            : undefined,
        patientInsight?.delta && patientInsight.delta.preferredSourceCoverageDelta > 0
            ? 'La source hierarchy documentale deve diventare un artifact esplicito, non solo una regola implicita di ranking.'
            : undefined,
        smartImport?.delta && smartImport.delta.reviewUsefulnessDelta > 0
            ? 'La reviewability dei fatti documentali deve essere first-class e non solo un effetto del render finale.'
            : undefined,
        smartImport?.delta && smartImport.delta.diagnosisQueryRecallDelta > 0
            ? 'Recognition clinico e normalizzazione query/resolver vanno separati meglio nel dato documentale.'
            : undefined,
    ]);

    const architectureGaps = uniqueStrings([
        'Manca un evidence ledger documentale esplicito con source priority, freshness e provenance governata.',
        'Negative assertions, esclusioni e fatti out-of-focus non sono ancora first-class nel runtime documentale.',
        'Recognition, ranking, decisione reviewable e render finale sono ancora troppo vicini.',
        patientInsight?.delta && patientInsight.delta.preferredSourceCoverageDelta > 0
            ? 'Le fonti recenti preferite non hanno ancora un peso persistito e spiegabile nel dato documentale.'
            : undefined,
        smartImport?.delta && smartImport.delta.reviewUsefulnessDelta > 0
            ? 'La promozione da evidence documentale a suggerimento reviewable e ancora troppo opaca.'
            : undefined,
    ]);

    const proposedPrinciples = [
        'Trattare il documento come evidence ledger e non come blob da riassumere.',
        'Separare recognition, source governance, decision layer e render/projection.',
        'Rendere first-class temporality, status, source priority, reviewability e negative assertions.',
        'Lasciare che le lane consumino proiezioni del ledger, non logica documentale duplicata.',
    ];

    const recommendedThinSlices = tasks
        .filter((task) => task.category !== 'synthetic-benchmark-gap')
        .slice(0, 4)
        .map((task) => ({
            slug: task.workstreamSlug,
            title: task.title,
            why: task.scopeSummary,
            repoTouchpoints: task.repoTouchpoints,
        }));

    return {
        currentState,
        extractedLessons,
        architectureGaps,
        proposedPrinciples,
        recommendedThinSlices,
    };
}

function buildDistillationSummary(
    casePack: CloudComparatorCasePack,
    patientInsight: ComparedLaneResult<PatientInsightEvaluation, PatientInsightDelta> | undefined,
    smartImport: ComparedLaneResult<SmartImportEvaluation, SmartImportDelta> | undefined,
) {
    const failurePatterns: string[] = [];
    const derivedQuestions: string[] = [];
    const insights: DistillationInsight[] = [];
    const derivedSyntheticTargets: string[] = [];

    if (patientInsight?.local && patientInsight.cloud) {
        const localMissing = [
            ...patientInsight.local.evaluation.details.missingCurrentState,
            ...patientInsight.local.evaluation.details.missingAlerts,
            ...patientInsight.local.evaluation.details.missingNextSteps,
            ...patientInsight.local.evaluation.details.missingGaps,
        ];
        const cloudMissing = new Set([
            ...patientInsight.cloud.evaluation.details.missingCurrentState,
            ...patientInsight.cloud.evaluation.details.missingAlerts,
            ...patientInsight.cloud.evaluation.details.missingNextSteps,
            ...patientInsight.cloud.evaluation.details.missingGaps,
        ]);
        const cloudWins = localMissing.filter((item) => !cloudMissing.has(item));
        if (cloudWins.length > 0) {
            failurePatterns.push(`Patient Insight: il cloud recupera anchor che il locale perde (${cloudWins.join(', ')}).`);
            pushInsight(insights, {
                lane: 'patient_insight',
                category: 'missing-local-heuristic',
                priority: 'high',
                title: 'Il locale perde anchor clinici attivi che il comparatore recupera',
                evidence: [
                    `Anchor persi dal locale: ${cloudWins.join(', ')}`,
                    `Delta focusRecall: ${patientInsight.delta?.focusRecallDelta ?? 0}`,
                ],
                recommendedActions: [
                    'Aggiungere euristiche locali che promuovano problemi e follow-up attivi in currentState e nextSteps',
                    'Rivedere il prompt builder di Patient Insight sui casi con sintomi recenti e follow-up pendenti',
                ],
                syntheticTargets: ['patient-insight-focus-recency'],
            });
            derivedQuestions.push('Quale euristica locale manca per promuovere anchor clinici attivi e follow-up recenti in Patient Insight?');
            derivedSyntheticTargets.push('patient-insight-focus-recency');
        }
        if (patientInsight.local.evaluation.details.missingPreferredSources.length > patientInsight.cloud.evaluation.details.missingPreferredSources.length) {
            failurePatterns.push(`Patient Insight: il locale sottoutilizza fonti recenti preferite (${patientInsight.local.evaluation.details.missingPreferredSources.join(', ')}).`);
            pushInsight(insights, {
                lane: 'patient_insight',
                category: 'retrieval-source-hierarchy',
                priority: 'high',
                title: 'La source hierarchy locale non privilegia abbastanza le fonti recenti e preferite',
                evidence: [
                    `Fonti preferite perse dal locale: ${patientInsight.local.evaluation.details.missingPreferredSources.join(', ')}`,
                    `Delta preferredSourceCoverage: ${patientInsight.delta?.preferredSourceCoverageDelta ?? 0}`,
                ],
                recommendedActions: [
                    'Riallineare source hierarchy e ranking locale privilegiando fonti recenti, follow-up e discharge letter',
                    'Aggiungere benchmark sintetico su recency e preferred sources in Patient Insight',
                ],
                syntheticTargets: ['patient-insight-source-hierarchy-recency'],
            });
            derivedQuestions.push('Quale regola di source hierarchy deve cambiare per fare emergere le fonti recenti preferite in Patient Insight?');
            derivedSyntheticTargets.push('patient-insight-source-hierarchy-recency');
        }
        if (
            patientInsight.cloud.evaluation.metrics.citationCoverageRate > patientInsight.local.evaluation.metrics.citationCoverageRate
            || patientInsight.cloud.evaluation.metrics.sectionPlacementRate > patientInsight.local.evaluation.metrics.sectionPlacementRate
        ) {
            pushInsight(insights, {
                lane: 'patient_insight',
                category: 'contract-rendering',
                priority: 'medium',
                title: 'Il locale perde disciplina citazionale o placement di sezione rispetto al comparatore',
                evidence: [
                    `Local citationCoverageRate: ${patientInsight.local.evaluation.metrics.citationCoverageRate}`,
                    `Cloud citationCoverageRate: ${patientInsight.cloud.evaluation.metrics.citationCoverageRate}`,
                    `Local sectionPlacementRate: ${patientInsight.local.evaluation.metrics.sectionPlacementRate}`,
                    `Cloud sectionPlacementRate: ${patientInsight.cloud.evaluation.metrics.sectionPlacementRate}`,
                    ...patientInsight.local.evaluation.details.findings.filter((finding) => (
                        finding.includes('section drift') || finding.includes('claims without citation')
                    )),
                ],
                recommendedActions: [
                    'Rivedere il render locale per separare meglio recall semantico e placement corretto delle sezioni',
                    'Migliorare la normalizzazione dei claim per preservare sempre citazione o marcatore [DATI-INCOMPLETI]',
                ],
                syntheticTargets: ['patient-insight-section-placement', 'patient-insight-citation-discipline'],
            });
            derivedQuestions.push('Il gap di Patient Insight nasce dal prompt, dal contract o dal render locale delle sezioni e delle citazioni?');
            derivedSyntheticTargets.push('patient-insight-section-placement', 'patient-insight-citation-discipline');
        }
        if (
            patientInsight.local.evaluation.metrics.forbiddenLeakCount > patientInsight.cloud.evaluation.metrics.forbiddenLeakCount
            || patientInsight.local.evaluation.metrics.forbiddenSourceLeakCount > patientInsight.cloud.evaluation.metrics.forbiddenSourceLeakCount
            || patientInsight.local.evaluation.metrics.moralizingLeakCount > patientInsight.cloud.evaluation.metrics.moralizingLeakCount
        ) {
            pushInsight(insights, {
                lane: 'patient_insight',
                category: 'review-safety',
                priority: 'high',
                title: 'Il locale ha guardrail reviewable piu deboli su leakage o phrasing moralizzante',
                evidence: [
                    `Local forbiddenLeakCount: ${patientInsight.local.evaluation.metrics.forbiddenLeakCount}`,
                    `Cloud forbiddenLeakCount: ${patientInsight.cloud.evaluation.metrics.forbiddenLeakCount}`,
                    `Local forbiddenSourceLeakCount: ${patientInsight.local.evaluation.metrics.forbiddenSourceLeakCount}`,
                    `Cloud forbiddenSourceLeakCount: ${patientInsight.cloud.evaluation.metrics.forbiddenSourceLeakCount}`,
                    `Local moralizingLeakCount: ${patientInsight.local.evaluation.metrics.moralizingLeakCount}`,
                    `Cloud moralizingLeakCount: ${patientInsight.cloud.evaluation.metrics.moralizingLeakCount}`,
                ],
                recommendedActions: [
                    'Rafforzare il post-processing locale anti-leakage e anti-moralizing prima del render finale',
                    'Aggiungere stop-rule sintetiche dedicate per leakage e phrasing non clinico',
                ],
                syntheticTargets: ['patient-insight-leakage-guardrail'],
            });
            derivedQuestions.push('Quale stop-rule locale deve bloccare leakage e phrasing moralizzante in Patient Insight?');
            derivedSyntheticTargets.push('patient-insight-leakage-guardrail');
        }
    }

    if (smartImport?.local && smartImport.cloud) {
        const localMissingDiagnoses = smartImport.local.evaluation.details.missingDiagnoses;
        const cloudMissingDiagnoses = new Set(smartImport.cloud.evaluation.details.missingDiagnoses);
        const cloudDiagnosisWins = localMissingDiagnoses.filter((item) => !cloudMissingDiagnoses.has(item));
        if (cloudDiagnosisWins.length > 0) {
            failurePatterns.push(`Smart Import: il cloud recupera diagnosi che il locale non precompila (${cloudDiagnosisWins.join(', ')}).`);
            pushInsight(insights, {
                lane: 'smart_import',
                category: 'missing-local-heuristic',
                priority: 'high',
                title: 'Il locale perde diagnosi reviewable che il comparatore riesce a precompilare',
                evidence: [
                    `Diagnosi perse dal locale: ${cloudDiagnosisWins.join(', ')}`,
                    `Delta diagnosisRecall: ${smartImport.delta?.diagnosisRecallDelta ?? 0}`,
                ],
                recommendedActions: [
                    'Rafforzare le euristiche locali di Smart Import per diagnosi implicite ma supportate da evidenza reviewable',
                    'Aggiungere benchmark sintetico che separi diagnosi gia esplicite, implicite e gia presenti',
                ],
                syntheticTargets: ['smart-import-diagnosis-recall'],
            });
            derivedQuestions.push('Quale euristica locale manca per far emergere diagnosi reviewable in Smart Import?');
            derivedSyntheticTargets.push('smart-import-diagnosis-recall');
        }

        const localTherapyStateMisses = smartImport.local.evaluation.details.therapyStateMisses;
        const cloudTherapyStateMisses = new Set(smartImport.cloud.evaluation.details.therapyStateMisses);
        const cloudTherapyWins = localTherapyStateMisses.filter((item) => !cloudTherapyStateMisses.has(item));
        if (cloudTherapyWins.length > 0) {
            failurePatterns.push(`Smart Import: il cloud gestisce meglio therapy-state reviewable (${cloudTherapyWins.join(', ')}).`);
            pushInsight(insights, {
                lane: 'smart_import',
                category: 'missing-local-heuristic',
                priority: 'high',
                title: 'Il locale fatica a classificare therapy-state reviewable',
                evidence: [
                    `Therapy-state misses del locale recuperati dal cloud: ${cloudTherapyWins.join(', ')}`,
                    `Delta therapyStateRecall: ${smartImport.delta?.therapyStateRecallDelta ?? 0}`,
                ],
                recommendedActions: [
                    'Rafforzare l estrazione locale di therapyState su casi active, transition, uncertain e inactive',
                    'Creare un corpus sintetico dedicato a switch terapeutici e stati reviewable',
                ],
                syntheticTargets: ['smart-import-therapy-state-reviewable'],
            });
            derivedQuestions.push('Come deve evolvere l euristica locale per therapy-state e switch terapeutici reviewable?');
            derivedSyntheticTargets.push('smart-import-therapy-state-reviewable');
        }
        if (
            smartImport.cloud.evaluation.metrics.diagnosisQueryRecall > smartImport.local.evaluation.metrics.diagnosisQueryRecall
            && smartImport.cloud.evaluation.metrics.diagnosisRecall >= smartImport.local.evaluation.metrics.diagnosisRecall
        ) {
            pushInsight(insights, {
                lane: 'smart_import',
                category: 'contract-rendering',
                priority: 'medium',
                title: 'Il locale riconosce il problema ma non normalizza bene la query per il resolver',
                evidence: [
                    `Local diagnosisQueryRecall: ${smartImport.local.evaluation.metrics.diagnosisQueryRecall}`,
                    `Cloud diagnosisQueryRecall: ${smartImport.cloud.evaluation.metrics.diagnosisQueryRecall}`,
                    `Local diagnosisRecall: ${smartImport.local.evaluation.metrics.diagnosisRecall}`,
                    `Cloud diagnosisRecall: ${smartImport.cloud.evaluation.metrics.diagnosisRecall}`,
                ],
                recommendedActions: [
                    'Separare meglio recognition clinico e normalizzazione query ICD nel post-processing locale',
                    'Aggiungere benchmark sintetico che distingua label recall e icdQuery recall',
                ],
                syntheticTargets: ['smart-import-icd-query-normalization'],
            });
            derivedQuestions.push('Il gap di Smart Import e nella recognition clinica o nella normalizzazione delle query ICD?');
            derivedSyntheticTargets.push('smart-import-icd-query-normalization');
        }
        if (
            smartImport.cloud.evaluation.metrics.sourceIdRate > smartImport.local.evaluation.metrics.sourceIdRate
            || smartImport.cloud.evaluation.metrics.reviewUsefulnessRate > smartImport.local.evaluation.metrics.reviewUsefulnessRate
        ) {
            pushInsight(insights, {
                lane: 'smart_import',
                category: 'retrieval-source-hierarchy',
                priority: 'medium',
                title: 'Il locale attribuisce peggio le evidenze reviewable o le gerarchie di fonte',
                evidence: [
                    `Local sourceIdRate: ${smartImport.local.evaluation.metrics.sourceIdRate}`,
                    `Cloud sourceIdRate: ${smartImport.cloud.evaluation.metrics.sourceIdRate}`,
                    `Local reviewUsefulnessRate: ${smartImport.local.evaluation.metrics.reviewUsefulnessRate}`,
                    `Cloud reviewUsefulnessRate: ${smartImport.cloud.evaluation.metrics.reviewUsefulnessRate}`,
                ],
                recommendedActions: [
                    'Rivedere la source hierarchy locale per privilegiare evidenze con sourceId valido e alto valore reviewable',
                    'Aggiungere benchmark sintetico su source attribution e review usefulness',
                ],
                syntheticTargets: ['smart-import-source-attribution'],
            });
            derivedQuestions.push('Quale gerarchia delle fonti rende Smart Import piu reviewable senza aumentare leakage o rumore?');
            derivedSyntheticTargets.push('smart-import-source-attribution');
        }
        if (
            smartImport.local.evaluation.metrics.forbiddenLeakCount > smartImport.cloud.evaluation.metrics.forbiddenLeakCount
            || smartImport.local.evaluation.metrics.alreadyPresentLeakCount > smartImport.cloud.evaluation.metrics.alreadyPresentLeakCount
        ) {
            pushInsight(insights, {
                lane: 'smart_import',
                category: 'review-safety',
                priority: 'high',
                title: 'Il locale lascia passare piu suggerimenti vietati o gia presenti',
                evidence: [
                    `Local forbiddenLeakCount: ${smartImport.local.evaluation.metrics.forbiddenLeakCount}`,
                    `Cloud forbiddenLeakCount: ${smartImport.cloud.evaluation.metrics.forbiddenLeakCount}`,
                    `Local alreadyPresentLeakCount: ${smartImport.local.evaluation.metrics.alreadyPresentLeakCount}`,
                    `Cloud alreadyPresentLeakCount: ${smartImport.cloud.evaluation.metrics.alreadyPresentLeakCount}`,
                ],
                recommendedActions: [
                    'Rafforzare le guardrail locali che bloccano suggerimenti gia presenti o esplicitamente vietati',
                    'Aggiungere benchmark sintetico dedicato a already-present leakage e forbidden suggestions',
                ],
                syntheticTargets: ['smart-import-already-present-guardrail'],
            });
            derivedQuestions.push('Quale stop-rule locale deve bloccare suggerimenti gia presenti o vietati in Smart Import?');
            derivedSyntheticTargets.push('smart-import-already-present-guardrail');
        }
    }

    if (
        patientInsight?.delta
        && smartImport?.delta
        && patientInsight.delta.focusRecallDelta > 0
        && smartImport.delta.reviewUsefulnessDelta > 0
    ) {
        pushInsight(insights, {
            lane: 'cross-lane',
            category: 'reasoning-pattern',
            priority: 'high',
            title: 'Il comparatore mantiene meglio il focus sul materiale attivo, recente e reviewable in entrambe le lane',
            evidence: [
                `Patient Insight focusRecall delta: ${patientInsight.delta.focusRecallDelta}`,
                `Smart Import reviewUsefulness delta: ${smartImport.delta.reviewUsefulnessDelta}`,
            ],
            recommendedActions: [
                'Distillare una policy locale condivisa che privilegi evidenze attive, recenti e reviewable prima del render',
                'Valutare un ranking comune delle evidenze tra Patient Insight e Smart Import',
            ],
            syntheticTargets: ['cross-lane-active-recent-reviewable'],
        });
        derivedQuestions.push('Quale policy condivisa tra lane puo imitare il pattern del comparatore senza introdurre dipendenze cloud?');
        derivedSyntheticTargets.push('cross-lane-active-recent-reviewable');
    }

    const nextSyntheticTargets = uniqueStrings([
        ...(casePack.distillation?.syntheticArchetypeHints || []),
        ...derivedSyntheticTargets,
        ...insights.flatMap((insight) => insight.syntheticTargets),
    ]);

    if (insights.length > 0) {
        pushInsight(insights, {
            lane: 'cross-lane',
            category: 'synthetic-benchmark-gap',
            priority: nextSyntheticTargets.length > 0 ? 'medium' : 'low',
            title: 'Il delta osservato va tradotto in benchmark sintetici e thin slice locali',
            evidence: [
                `Failure patterns emersi: ${failurePatterns.length}`,
                `Insight distillati: ${insights.length}`,
                ...((casePack.distillation?.learningObjectives || []).map((objective) => `Learning objective: ${objective}`)),
            ],
            recommendedActions: [
                'Trasformare ogni insight utile in un caso sintetico canonico o in un estensione di corpus lane-specific',
                'Aprire thin slice locali separate per euristiche, retrieval, contract/render e guardrail emersi dal confronto',
            ],
            syntheticTargets: nextSyntheticTargets,
        });
    }

    const categoryCounts = createCategoryCounts();
    for (const insight of insights) {
        categoryCounts[insight.category] += 1;
    }

    const localEvolutionAgenda = buildLocalEvolutionAgenda(insights);
    const recommendedNextSlice = selectRecommendedNextSlice(localEvolutionAgenda);
    const documentIntelligenceReview = buildDocumentIntelligenceReview(localEvolutionAgenda, patientInsight, smartImport);
    const layerCounts = createLayerCounts();
    for (const task of localEvolutionAgenda) {
        layerCounts[task.primaryLayer] += 1;
    }

    return {
        learningObjectives: casePack.distillation?.learningObjectives || [],
        hypothesisTags: casePack.distillation?.hypothesisTags || [],
        failurePatterns: uniqueStrings(failurePatterns),
        insights,
        categoryCounts,
        layerCounts,
        localEvolutionAgenda,
        recommendedNextSlice,
        documentIntelligenceReview,
        recommendedWorkstreams: uniqueStrings(insights.flatMap((insight) => insight.recommendedActions)),
        nextSyntheticTargets,
        followupQuestions: uniqueStrings([
            ...(casePack.distillation?.followupQuestions || []),
            ...derivedQuestions,
        ]),
    };
}

function renderMarkdown(report: CloudComparatorReport): string {
    const lines = [
        '# Cloud Comparator Shadow Eval',
        '',
        `Generated at: ${report.generatedAt}`,
        `Case pack: ${report.casePackId}`,
        `Title: ${report.title}`,
        '',
    ];

    if (report.patientInsight) {
        lines.push('## Patient Insight');
        if (report.patientInsight.local) {
            lines.push(`- Local focusRecall: ${report.patientInsight.local.evaluation.metrics.focusRecall}`);
            lines.push(`- Local citationCoverageRate: ${report.patientInsight.local.evaluation.metrics.citationCoverageRate}`);
            if (report.patientInsight.local.evaluation.details.findings.length > 0) {
                lines.push(`- Local findings: ${report.patientInsight.local.evaluation.details.findings.join('; ')}`);
            }
        }
        if (report.patientInsight.cloud) {
            lines.push(`- Cloud focusRecall: ${report.patientInsight.cloud.evaluation.metrics.focusRecall}`);
            lines.push(`- Cloud citationCoverageRate: ${report.patientInsight.cloud.evaluation.metrics.citationCoverageRate}`);
            if (report.patientInsight.cloud.evaluation.details.findings.length > 0) {
                lines.push(`- Cloud findings: ${report.patientInsight.cloud.evaluation.details.findings.join('; ')}`);
            }
        }
        if (report.patientInsight.delta) {
            lines.push(`- Delta focusRecall (cloud-local): ${report.patientInsight.delta.focusRecallDelta}`);
            lines.push(`- Delta preferredSourceCoverage (cloud-local): ${report.patientInsight.delta.preferredSourceCoverageDelta}`);
        }
        lines.push('');
    }

    if (report.smartImport) {
        lines.push('## Smart Import');
        if (report.smartImport.local) {
            lines.push(`- Local diagnosisRecall: ${report.smartImport.local.evaluation.metrics.diagnosisRecall}`);
            lines.push(`- Local therapyStateRecall: ${report.smartImport.local.evaluation.metrics.therapyStateRecall}`);
            if (report.smartImport.local.evaluation.details.findings.length > 0) {
                lines.push(`- Local findings: ${report.smartImport.local.evaluation.details.findings.join('; ')}`);
            }
        }
        if (report.smartImport.cloud) {
            lines.push(`- Cloud diagnosisRecall: ${report.smartImport.cloud.evaluation.metrics.diagnosisRecall}`);
            lines.push(`- Cloud therapyStateRecall: ${report.smartImport.cloud.evaluation.metrics.therapyStateRecall}`);
            if (report.smartImport.cloud.evaluation.details.findings.length > 0) {
                lines.push(`- Cloud findings: ${report.smartImport.cloud.evaluation.details.findings.join('; ')}`);
            }
        }
        if (report.smartImport.delta) {
            lines.push(`- Delta diagnosisRecall (cloud-local): ${report.smartImport.delta.diagnosisRecallDelta}`);
            lines.push(`- Delta reviewUsefulness (cloud-local): ${report.smartImport.delta.reviewUsefulnessDelta}`);
        }
        lines.push('');
    }

    lines.push('## Distillation');
    if (report.distillation.learningObjectives.length > 0) {
        lines.push(`- Learning objectives: ${report.distillation.learningObjectives.join('; ')}`);
    }
    if (report.distillation.hypothesisTags.length > 0) {
        lines.push(`- Hypothesis tags: ${report.distillation.hypothesisTags.join(', ')}`);
    }
    for (const pattern of report.distillation.failurePatterns) {
        lines.push(`- ${pattern}`);
    }
    if (report.distillation.insights.length > 0) {
        for (const insight of report.distillation.insights) {
            lines.push(`- Insight [${insight.priority}] ${insight.lane} / ${insight.category}: ${insight.title}`);
            if (insight.evidence.length > 0) {
                lines.push(`  Evidence: ${insight.evidence.join('; ')}`);
            }
            if (insight.recommendedActions.length > 0) {
                lines.push(`  Actions: ${insight.recommendedActions.join('; ')}`);
            }
            if (insight.syntheticTargets.length > 0) {
                lines.push(`  Synthetic targets: ${insight.syntheticTargets.join(', ')}`);
            }
        }
    }
    if (report.distillation.recommendedWorkstreams.length > 0) {
        lines.push(`- Recommended workstreams: ${report.distillation.recommendedWorkstreams.join('; ')}`);
    }
    if (report.distillation.nextSyntheticTargets.length > 0) {
        lines.push(`- Next synthetic targets: ${report.distillation.nextSyntheticTargets.join(', ')}`);
    }
    if (report.distillation.recommendedNextSlice) {
        lines.push(`- Recommended next slice: ${report.distillation.recommendedNextSlice.taskId} (${report.distillation.recommendedNextSlice.suggestedBranch})`);
        lines.push(`  Reason: ${report.distillation.recommendedNextSlice.reason}`);
    }
    if (report.distillation.nextSliceBriefPath) {
        lines.push(`- Next slice brief: ${report.distillation.nextSliceBriefPath}`);
    }
    if (report.distillation.briefArtifactPaths?.length) {
        lines.push(`- Brief artifacts: ${report.distillation.briefArtifactPaths.join(', ')}`);
    }
    if (report.distillation.localEvolutionAgenda.length > 0) {
        lines.push('- Local evolution agenda:');
        for (const task of report.distillation.localEvolutionAgenda) {
            lines.push(`  - ${task.id} (${task.workstreamSlug}) [${task.priority}] ${task.lane} / ${task.primaryLayer}: ${task.title}`);
            lines.push(`    Branch: ${task.suggestedBranch}`);
            lines.push(`    Branch template: ${task.coordination.branchTemplate}`);
            lines.push(`    Risk/Diff: ${task.riskLevel} / ${task.estimatedDiffSize}`);
            lines.push(`    Coordination: ${task.coordination.executionMode}`);
            lines.push(`    Scope: ${task.scopeSummary}`);
            lines.push(`    Rationale: ${task.rationale}`);
            lines.push(`    Actions: ${task.actions.join('; ')}`);
            lines.push(`    Validation: ${task.validation.join('; ')}`);
            lines.push(`    Definition of done: ${task.definitionOfDone.join('; ')}`);
            lines.push(`    Non-goals: ${task.nonGoals.join('; ')}`);
            lines.push(`    Conversation rule: ${task.coordination.conversationRule}`);
            if (task.coordination.serializedWith.length > 0) {
                lines.push(`    Serialize with: ${task.coordination.serializedWith.join(', ')}`);
            }
            if (task.coordination.parallelizableWith.length > 0) {
                lines.push(`    Parallel-safe with: ${task.coordination.parallelizableWith.join(', ')}`);
            }
            if (task.benchmarkTargets.length > 0) {
                lines.push(`    Benchmark targets: ${task.benchmarkTargets.join(', ')}`);
            }
            if (task.repoTouchpoints.length > 0) {
                lines.push(`    Repo touchpoints: ${task.repoTouchpoints.join(', ')}`);
            }
        }
    }
    for (const question of report.distillation.followupQuestions) {
        lines.push(`- Follow-up: ${question}`);
    }

    lines.push('', '## Document Intelligence Review');
    for (const item of report.distillation.documentIntelligenceReview.currentState) {
        lines.push(`- Current state: ${item}`);
    }
    for (const item of report.distillation.documentIntelligenceReview.extractedLessons) {
        lines.push(`- Lesson: ${item}`);
    }
    for (const item of report.distillation.documentIntelligenceReview.architectureGaps) {
        lines.push(`- Architecture gap: ${item}`);
    }
    for (const item of report.distillation.documentIntelligenceReview.proposedPrinciples) {
        lines.push(`- Principle: ${item}`);
    }
    for (const slice of report.distillation.documentIntelligenceReview.recommendedThinSlices) {
        lines.push(`- Recommended document slice: ${slice.slug} — ${slice.title}`);
        lines.push(`  Why: ${slice.why}`);
        lines.push(`  Touchpoints: ${slice.repoTouchpoints.join(', ')}`);
    }
    if (report.distillation.documentIntelligenceReview.artifactPath) {
        lines.push(`- Document review artifact: ${report.distillation.documentIntelligenceReview.artifactPath}`);
    }

    return `${lines.join('\n').trim()}\n`;
}

export function renderLocalEvolutionTaskBrief(
    report: CloudComparatorReport,
    task: LocalEvolutionTask,
): string {
    const lines = [
        `# ${task.title}`,
        '',
        `Task ID: ${task.id}`,
        `Workstream slug: ${task.workstreamSlug}`,
        `Suggested branch: ${task.suggestedBranch}`,
        `Dedicated issue branch template: ${task.coordination.branchTemplate}`,
        `Anchor issue: ${task.coordination.anchorIssueId}`,
        `Case pack: ${report.casePackId}`,
        `Priority: ${task.priority}`,
        `Risk level: ${task.riskLevel}`,
        `Estimated diff size: ${task.estimatedDiffSize}`,
        `Lane: ${task.lane}`,
        `Category: ${task.category}`,
        `Primary layer: ${task.primaryLayer}`,
        `Supporting layers: ${task.supportingLayers.join(', ') || 'n/a'}`,
        '',
        '## Scope',
        task.scopeSummary,
        '',
        '## Rationale',
        task.rationale,
        '',
        '## Actions',
        ...task.actions.map((action) => `- ${action}`),
        '',
        '## Coordination',
        `- Execution mode: ${task.coordination.executionMode}`,
        `- Conversation rule: ${task.coordination.conversationRule}`,
        `- Parallel-safe with: ${task.coordination.parallelizableWith.join(', ') || 'n/a'}`,
        `- Serialize with: ${task.coordination.serializedWith.join(', ') || 'n/a'}`,
        '',
        '## Suggested Commands',
        ...task.suggestedCommands.map((command) => `- \`${command}\``),
        '',
        '## Repo Touchpoints',
        ...task.repoTouchpoints.map((touchpoint) => `- ${touchpoint}`),
        '',
        '## Validation',
        ...task.validation.map((item) => `- ${item}`),
        '',
        '## Definition Of Done',
        ...task.definitionOfDone.map((item) => `- ${item}`),
        '',
        '## Non Goals',
        ...task.nonGoals.map((item) => `- ${item}`),
    ];

    if (task.benchmarkTargets.length > 0) {
        lines.push('', '## Benchmark Targets', ...task.benchmarkTargets.map((target) => `- ${target}`));
    }

    return `${lines.join('\n').trim()}\n`;
}

export function emitLocalEvolutionBriefs(
    report: CloudComparatorReport,
    outputDir: string,
): string[] {
    fs.mkdirSync(outputDir, { recursive: true });
    const artifactPaths: string[] = [];

    for (const task of report.distillation.localEvolutionAgenda) {
        const filePath = path.join(outputDir, `${task.id}-${task.workstreamSlug}.md`);
        writeTextFile(filePath, renderLocalEvolutionTaskBrief(report, task));
        artifactPaths.push(filePath);
    }

    report.distillation.briefArtifactPaths = artifactPaths;
    return artifactPaths;
}

export function renderLocalEvolutionBriefIndex(report: CloudComparatorReport): string {
    const lines = [
        '# Local Evolution Briefs',
        '',
        `Case pack: ${report.casePackId}`,
        `Title: ${report.title}`,
    ];

    if (report.distillation.recommendedNextSlice) {
        lines.push(
            '',
            '## Recommended Next Slice',
            `- Task: ${report.distillation.recommendedNextSlice.taskId}`,
            `- Branch: ${report.distillation.recommendedNextSlice.suggestedBranch}`,
            `- Branch template: ${report.distillation.localEvolutionAgenda.find((task) => task.id === report.distillation.recommendedNextSlice?.taskId)?.coordination.branchTemplate || 'n/a'}`,
            `- Why: ${report.distillation.recommendedNextSlice.reason}`,
        );
    }

    lines.push('', '## Briefs');
    for (const task of report.distillation.localEvolutionAgenda) {
        lines.push(`- ${task.id}: ${task.title}`);
        lines.push(`  Branch: ${task.suggestedBranch}`);
        lines.push(`  Branch template: ${task.coordination.branchTemplate}`);
        lines.push(`  Coordination: ${task.coordination.executionMode}`);
        lines.push(`  Risk/Diff: ${task.riskLevel} / ${task.estimatedDiffSize}`);
        lines.push(`  Scope: ${task.scopeSummary}`);
    }

    return `${lines.join('\n').trim()}\n`;
}

export function emitLocalEvolutionBriefIndex(
    report: CloudComparatorReport,
    outputDir: string,
): string {
    fs.mkdirSync(outputDir, { recursive: true });
    const indexPath = path.join(outputDir, 'README.md');
    writeTextFile(indexPath, renderLocalEvolutionBriefIndex(report));
    report.distillation.briefIndexPath = indexPath;
    return indexPath;
}

export function renderRecommendedNextSliceBrief(
    report: CloudComparatorReport,
): string {
    const nextSlice = report.distillation.recommendedNextSlice;
    if (!nextSlice) {
        return '# Recommended Next Slice\n\nNessuna slice raccomandata disponibile.\n';
    }

    const task = report.distillation.localEvolutionAgenda.find((entry) => entry.id === nextSlice.taskId);
    if (!task) {
        return '# Recommended Next Slice\n\nSlice raccomandata non trovata nell agenda locale.\n';
    }

    const lines = [
        '# Recommended Next Slice',
        '',
        `Case pack: ${report.casePackId}`,
        `Task: ${task.id}`,
        `Title: ${task.title}`,
        `Suggested branch: ${task.suggestedBranch}`,
        `Dedicated issue branch template: ${task.coordination.branchTemplate}`,
        `Why now: ${nextSlice.reason}`,
        '',
        '## Coordination',
        `- Execution mode: ${task.coordination.executionMode}`,
        `- Conversation rule: ${task.coordination.conversationRule}`,
        `- Parallel-safe with: ${task.coordination.parallelizableWith.join(', ') || 'n/a'}`,
        `- Serialize with: ${task.coordination.serializedWith.join(', ') || 'n/a'}`,
        '',
        '## First Commands',
        ...task.suggestedCommands.map((command) => `- \`${command}\``),
        '',
        '## Repo Touchpoints',
        ...task.repoTouchpoints.map((touchpoint) => `- ${touchpoint}`),
        '',
        '## Definition Of Done',
        ...task.definitionOfDone.map((item) => `- ${item}`),
        '',
        '## Non Goals',
        ...task.nonGoals.map((item) => `- ${item}`),
    ];

    return `${lines.join('\n').trim()}\n`;
}

export function emitRecommendedNextSliceBrief(
    report: CloudComparatorReport,
    outputDir: string,
): string | undefined {
    if (!report.distillation.recommendedNextSlice) return undefined;

    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, 'NEXT_SLICE.md');
    writeTextFile(filePath, renderRecommendedNextSliceBrief(report));
    report.distillation.nextSliceBriefPath = filePath;
    return filePath;
}

export function renderDocumentIntelligenceReview(report: CloudComparatorReport): string {
    const review = report.distillation.documentIntelligenceReview;
    const lines = [
        '# Document Intelligence Review',
        '',
        `Case pack: ${report.casePackId}`,
        `Title: ${report.title}`,
        '',
        '## Current State',
        ...review.currentState.map((item) => `- ${item}`),
        '',
        '## Extracted Lessons',
        ...review.extractedLessons.map((item) => `- ${item}`),
        '',
        '## Architecture Gaps',
        ...review.architectureGaps.map((item) => `- ${item}`),
        '',
        '## Proposed Principles',
        ...review.proposedPrinciples.map((item) => `- ${item}`),
        '',
        '## Recommended Thin Slices',
    ];

    for (const slice of review.recommendedThinSlices) {
        lines.push(`- ${slice.slug}: ${slice.title}`);
        lines.push(`  Why: ${slice.why}`);
        lines.push(`  Touchpoints: ${slice.repoTouchpoints.join(', ')}`);
    }

    return `${lines.join('\n').trim()}\n`;
}

export function emitDocumentIntelligenceReview(
    report: CloudComparatorReport,
    outputDir: string,
): string {
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, 'DOCUMENT_INTELLIGENCE_REVIEW.md');
    writeTextFile(filePath, renderDocumentIntelligenceReview(report));
    report.distillation.documentIntelligenceReview.artifactPath = filePath;
    return filePath;
}

export async function executeCloudComparator(options: ExecuteOptions): Promise<CloudComparatorReport> {
    const repoRoot = process.cwd();
    const casePack = parseCloudComparatorCasePack(
        JSON.parse(fs.readFileSync(options.casePackPath, 'utf8')),
    );

    if (options.runCloud) {
        if (!hasCloudComparatorApproval(casePack)) {
            throw new Error('Cloud comparator blocked: privacy gate is not fully approved in the case pack.');
        }

        ensurePathOutsideRepo(options.casePackPath, repoRoot, 'Case pack');
        ensurePathOutsideRepo(options.emitPromptsDir, repoRoot, 'Prompt artifacts');
        ensurePathOutsideRepo(options.rawOutDir, repoRoot, 'Raw output directory');
        ensurePathOutsideRepo(options.briefsOutDir, repoRoot, 'Brief artifacts');
    }

    const promptArtifacts = options.emitPromptsDir
        ? emitPrompts(casePack, options.emitPromptsDir)
        : undefined;

    const patientInsightPrompt = casePack.patientInsight
        ? buildPatientInsightExtractionPrompt(casePack.patientInsight.context)
        : null;
    const smartImportPrompt = casePack.smartImport
        ? buildSmartImportExtractionPrompt(casePack.smartImport.payload)
        : null;

    let localPatientInsightRun: ComparatorSystemRun | undefined;
    let cloudPatientInsightRun: ComparatorSystemRun | undefined;
    let localSmartImportRun: ComparatorSystemRun | undefined;
    let cloudSmartImportRun: ComparatorSystemRun | undefined;

    if (options.localPatientInsightPath) {
        localPatientInsightRun = {
            label: options.localModel,
            rawText: readTextFile(options.localPatientInsightPath),
            rawPath: options.localPatientInsightPath,
        };
    }
    if (options.cloudPatientInsightPath) {
        cloudPatientInsightRun = {
            label: options.cloudModel,
            rawText: readTextFile(options.cloudPatientInsightPath),
            rawPath: options.cloudPatientInsightPath,
        };
    }
    if (options.localSmartImportPath) {
        localSmartImportRun = {
            label: options.localModel,
            rawText: readTextFile(options.localSmartImportPath),
            rawPath: options.localSmartImportPath,
        };
    }
    if (options.cloudSmartImportPath) {
        cloudSmartImportRun = {
            label: options.cloudModel,
            rawText: readTextFile(options.cloudSmartImportPath),
            rawPath: options.cloudSmartImportPath,
        };
    }

    if (options.runLocal && casePack.patientInsight && patientInsightPrompt) {
        localPatientInsightRun = await generateLocalCompletion(
            options.ollamaBaseUrl,
            options.localModel,
            patientInsightPrompt,
            casePack.patientInsight.maxTokens ?? 1100,
        );
    }
    if (options.runLocal && casePack.smartImport && smartImportPrompt) {
        localSmartImportRun = await generateLocalCompletion(
            options.ollamaBaseUrl,
            options.localModel,
            smartImportPrompt,
            casePack.smartImport.maxTokens ?? 1100,
        );
    }
    if (options.runCloud && casePack.patientInsight && patientInsightPrompt) {
        cloudPatientInsightRun = await generateCloudCompletion(
            options.cloudModel,
            patientInsightPrompt,
            casePack.patientInsight.maxTokens ?? 1100,
            options.cloudReasoningEffort,
            options.cloudVerbosity,
        );
    }
    if (options.runCloud && casePack.smartImport && smartImportPrompt) {
        cloudSmartImportRun = await generateCloudCompletion(
            options.cloudModel,
            smartImportPrompt,
            casePack.smartImport.maxTokens ?? 1100,
            options.cloudReasoningEffort,
            options.cloudVerbosity,
        );
    }

    if (options.rawOutDir) {
        fs.mkdirSync(options.rawOutDir, { recursive: true });
        if (localPatientInsightRun && !localPatientInsightRun.rawPath) {
            localPatientInsightRun.rawPath = path.join(options.rawOutDir, `${casePack.id}.patient-insight.local.txt`);
            writeTextFile(localPatientInsightRun.rawPath, localPatientInsightRun.rawText);
        }
        if (cloudPatientInsightRun && !cloudPatientInsightRun.rawPath) {
            cloudPatientInsightRun.rawPath = path.join(options.rawOutDir, `${casePack.id}.patient-insight.cloud.txt`);
            writeTextFile(cloudPatientInsightRun.rawPath, cloudPatientInsightRun.rawText);
        }
        if (localSmartImportRun && !localSmartImportRun.rawPath) {
            localSmartImportRun.rawPath = path.join(options.rawOutDir, `${casePack.id}.smart-import.local.txt`);
            writeTextFile(localSmartImportRun.rawPath, localSmartImportRun.rawText);
        }
        if (cloudSmartImportRun && !cloudSmartImportRun.rawPath) {
            cloudSmartImportRun.rawPath = path.join(options.rawOutDir, `${casePack.id}.smart-import.cloud.txt`);
            writeTextFile(cloudSmartImportRun.rawPath, cloudSmartImportRun.rawText);
        }
    }

    const patientInsight = casePack.patientInsight
        ? comparePatientInsight(
            localPatientInsightRun ? evaluatePatientInsightRun(localPatientInsightRun, casePack.patientInsight) : undefined,
            cloudPatientInsightRun ? evaluatePatientInsightRun(cloudPatientInsightRun, casePack.patientInsight) : undefined,
        )
        : undefined;
    const smartImport = casePack.smartImport
        ? compareSmartImport(
            localSmartImportRun ? evaluateSmartImportRun(localSmartImportRun, casePack.smartImport) : undefined,
            cloudSmartImportRun ? evaluateSmartImportRun(cloudSmartImportRun, casePack.smartImport) : undefined,
        )
        : undefined;

    return {
        generatedAt: new Date().toISOString(),
        casePackPath: options.casePackPath,
        casePackId: casePack.id,
        title: casePack.title,
        promptArtifacts,
        cloudRun: options.runCloud
            ? {
                model: options.cloudModel,
                reasoningEffort: options.cloudReasoningEffort,
                verbosity: options.cloudVerbosity,
                store: false,
            }
            : undefined,
        patientInsight,
        smartImport,
        distillation: buildDistillationSummary(casePack, patientInsight, smartImport),
    };
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.casePack) {
        throw new Error('Passa --case-pack /percorso/al/case-pack.json');
    }
    if (args.runCloud) {
        const repoRoot = process.cwd();
        ensurePathOutsideRepo(args.out, repoRoot, 'JSON report');
        ensurePathOutsideRepo(args.markdownOut, repoRoot, 'Markdown report');
        ensurePathOutsideRepo(args.briefsOutDir, repoRoot, 'Brief artifacts');
    }

    const report = await executeCloudComparator({
        casePackPath: args.casePack,
        emitPromptsDir: args.emitPromptsDir,
        rawOutDir: args.rawOutDir,
        briefsOutDir: args.briefsOutDir,
        localPatientInsightPath: args.localPatientInsight,
        cloudPatientInsightPath: args.cloudPatientInsight,
        localSmartImportPath: args.localSmartImport,
        cloudSmartImportPath: args.cloudSmartImport,
        runLocal: args.runLocal,
        runCloud: args.runCloud,
        localModel: args.localModel,
        cloudModel: args.cloudModel,
        ollamaBaseUrl: args.ollamaBaseUrl,
        cloudReasoningEffort: args.cloudReasoningEffort,
        cloudVerbosity: args.cloudVerbosity,
    });

    if (args.briefsOutDir) {
        emitLocalEvolutionBriefs(report, args.briefsOutDir);
        emitLocalEvolutionBriefIndex(report, args.briefsOutDir);
        emitRecommendedNextSliceBrief(report, args.briefsOutDir);
        emitDocumentIntelligenceReview(report, args.briefsOutDir);
    }

    const output = JSON.stringify(report, null, 2);
    if (args.out) {
        writeTextFile(args.out, output);
    }
    if (args.markdownOut) {
        writeTextFile(args.markdownOut, renderMarkdown(report));
    }

    console.log(output);
}

const isMainModule = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false;

if (isMainModule) {
    void main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
