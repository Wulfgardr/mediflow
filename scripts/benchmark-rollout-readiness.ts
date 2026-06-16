#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    ensureAiRolloutReadinessArtifactDirectory,
    getAiRolloutReadinessArtifactPaths,
    type RolloutReadinessArtifactLane,
} from '../lib/ai-rollout-readiness-storage.ts';

export type RolloutLane = RolloutReadinessArtifactLane;

export type RolloutCurrentState =
    | 'benchmark-only'
    | 'hold'
    | 'shadow-ready'
    | 'shadow-active'
    | 'active-with-fallback'
    | 'rollback-required';

export type RolloutStatus = 'hold' | 'shadow-ready' | 'rollback-required';

type Blocker = {
    scope: 'report' | 'prerequisite' | 'metric';
    id: string;
    message: string;
};

type Warning = {
    id: string;
    message: string;
};

type RolloutReadinessReport = {
    generatedAt: string;
    lane: RolloutLane;
    currentState: RolloutCurrentState;
    reportPath: string;
    selectedModel: string | null;
    status: RolloutStatus;
    blockers: Blocker[];
    warnings: Warning[];
    evidence: {
        reportGeneratedAt: string | null;
        benchmarkFresh: boolean;
        benchmarkAgeDays: number | null;
        maxAgeDays: number | null;
        fallbackWritten: boolean;
        owner: string | null;
        licenseClear: boolean;
    };
};

type PatientInsightMetrics = {
    contractValidRate: number;
    focusRecall: number;
    citationCoverageRate: number;
    preferredSourceCoverage: number;
    forbiddenLeakRate: number;
    forbiddenSourceLeakRate: number;
    moralizingLeakRate: number;
    incompleteClaimRate: number;
};

type PatientInsightModelReport = {
    model: string;
    status: 'completed' | 'missing' | 'error';
    metrics?: PatientInsightMetrics;
};

type PatientInsightBenchmarkReport = {
    generatedAt?: string;
    decision?: {
        recommendedModel?: string | null;
    };
    models?: PatientInsightModelReport[];
};

type SmartImportMetrics = {
    contractValidRate: number;
    jsonValidRate: number;
    diagnosisRecall: number;
    diagnosisQueryRecall: number;
    therapyRecall: number;
    dosageRecall: number;
    therapyStateRecall: number;
    sourceIdRate: number;
    forbiddenLeakRate: number;
    alreadyPresentLeakRate?: number;
};

type SmartImportModelReport = {
    model: string;
    status: 'completed' | 'missing' | 'error';
    metrics?: SmartImportMetrics;
};

type SmartImportBenchmarkReport = {
    generatedAt?: string;
    decision?: {
        recommendedModel?: string | null;
    };
    models?: SmartImportModelReport[];
};

type ValidationArtifact = {
    generatedAt?: string;
    failures?: Array<{ id?: string; message?: string }>;
    shadowReady?: boolean;
    promotionReady?: boolean;
};

type ParliamentCandidate = {
    id: string;
    label: string;
    runtimeModel: string | null;
    verdict: string;
    contractChamber: {
        available: boolean;
        passed: boolean;
        reasons: string[];
    };
    smartImportChamber: {
        available: boolean;
        passed: boolean;
        reasons: string[];
    };
};

type ParliamentReport = {
    generatedAt?: string;
    candidates?: ParliamentCandidate[];
};

type EvaluateOptions = {
    lane: RolloutLane;
    reportPath: string;
    report: unknown;
    model?: string | null;
    currentState: RolloutCurrentState;
    fallbackWritten: boolean;
    owner?: string | null;
    licenseClear: boolean;
    maxAgeDays?: number | null;
};

type EvaluationEvidence = RolloutReadinessReport['evidence'];

const PATIENT_INSIGHT_THRESHOLDS = {
    minContractRate: 0.95,
    minFocusRecall: 0.75,
    minCitationRate: 0.95,
    minPreferredSourceCoverage: 0.6,
    maxForbiddenLeakRate: 0.1,
    maxForbiddenSourceLeakRate: 0.05,
    maxMoralizingRate: 0,
    maxIncompleteClaimRate: 0.35,
} as const;

const SMART_IMPORT_MIN_RATE = 0.95;

function parseArgs(argv: string[]) {
    const args = {
        lane: null as RolloutLane | null,
        report: null as string | null,
        model: null as string | null,
        out: null as string | null,
        markdownOut: null as string | null,
        currentState: 'hold' as RolloutCurrentState,
        fallbackWritten: false,
        owner: null as string | null,
        licenseClear: false,
        maxAgeDays: 30 as number | null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--lane' && argv[index + 1]) {
            args.lane = argv[index + 1] as RolloutLane;
            index += 1;
        } else if (value === '--report' && argv[index + 1]) {
            args.report = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--model' && argv[index + 1]) {
            args.model = argv[index + 1].trim() || null;
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--markdown-out' && argv[index + 1]) {
            args.markdownOut = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--current-state' && argv[index + 1]) {
            args.currentState = argv[index + 1] as RolloutCurrentState;
            index += 1;
        } else if (value === '--owner' && argv[index + 1]) {
            args.owner = argv[index + 1].trim() || null;
            index += 1;
        } else if (value === '--max-age-days' && argv[index + 1]) {
            const parsed = Number.parseInt(argv[index + 1], 10);
            args.maxAgeDays = Number.isFinite(parsed) ? parsed : args.maxAgeDays;
            index += 1;
        } else if (value === '--fallback-written') {
            args.fallbackWritten = true;
        } else if (value === '--license-clear') {
            args.licenseClear = true;
        }
    }

    return args;
}

function isAllowedLane(value: string | null): value is RolloutLane {
    return value === 'patient_insight'
        || value === 'smart_import'
        || value === 'redaction'
        || value === 'clinical_entities'
        || value === 'generative_challenger';
}

function isAllowedCurrentState(value: string): value is RolloutCurrentState {
    return value === 'benchmark-only'
        || value === 'hold'
        || value === 'shadow-ready'
        || value === 'shadow-active'
        || value === 'active-with-fallback'
        || value === 'rollback-required';
}

function isActiveState(state: RolloutCurrentState) {
    return state === 'shadow-active' || state === 'active-with-fallback' || state === 'rollback-required';
}

function toBenchmarkEvidence(
    reportGeneratedAt: string | null,
    fallbackWritten: boolean,
    owner: string | null,
    licenseClear: boolean,
    maxAgeDays: number | null,
): EvaluationEvidence {
    let benchmarkAgeDays: number | null = null;
    let benchmarkFresh = false;

    if (reportGeneratedAt) {
        const parsed = Date.parse(reportGeneratedAt);
        if (Number.isFinite(parsed)) {
            benchmarkAgeDays = Number((((Date.now() - parsed) / 1000 / 60 / 60 / 24)).toFixed(2));
            benchmarkFresh = maxAgeDays == null || benchmarkAgeDays <= maxAgeDays;
        }
    }

    return {
        reportGeneratedAt,
        benchmarkFresh,
        benchmarkAgeDays,
        maxAgeDays,
        fallbackWritten,
        owner,
        licenseClear,
    };
}

function chooseStatus(currentState: RolloutCurrentState, blockers: Blocker[]): RolloutStatus {
    if (blockers.length === 0) return 'shadow-ready';
    return isActiveState(currentState) ? 'rollback-required' : 'hold';
}

function toDisplayValue(value: boolean | number | string | null) {
    if (typeof value === 'boolean') {
        return value ? 'yes' : 'no';
    }
    if (value == null) {
        return 'n/a';
    }
    return String(value);
}

function toMarkdownList(lines: string[], emptyLine: string) {
    return lines.length > 0
        ? lines.map((line) => `- ${line}`).join('\n')
        : `- ${emptyLine}`;
}

function toSiblingMarkdownPath(jsonPath: string) {
    const extension = path.extname(jsonPath);
    if (!extension) {
        return `${jsonPath}.md`;
    }
    return path.join(path.dirname(jsonPath), `${path.basename(jsonPath, extension)}.md`);
}

export function resolveRolloutReadinessOutputPaths(
    lane: RolloutLane,
    out: string | null,
    markdownOut: string | null,
) {
    const defaults = getAiRolloutReadinessArtifactPaths(lane);
    return {
        defaults,
        jsonOutPath: out || defaults.jsonPath,
        markdownOutPath: markdownOut
            || (out ? toSiblingMarkdownPath(out) : defaults.markdownPath),
    };
}

function toKebabCase(value: string) {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function readFiniteMetric(metrics: Record<string, unknown>, key: string, blockers: Blocker[]) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    blockers.push({
        scope: 'metric',
        id: `${toKebabCase(key)}-invalid`,
        message: `${key} is missing or not a finite number.`,
    });
    return null;
}

function pickModel<T extends { model: string }>(
    reports: T[] | undefined,
    requestedModel: string | null | undefined,
    recommendedModel: string | null | undefined,
) {
    const candidates = reports || [];
    if (candidates.length === 0) {
        return {
            model: null as T | null,
            blockers: [{
                scope: 'report',
                id: 'missing-models',
                message: 'Benchmark report does not contain model results.',
            }] as Blocker[],
        };
    }

    if (requestedModel) {
        const explicit = candidates.find((entry) => entry.model === requestedModel) || null;
        return explicit
            ? { model: explicit, blockers: [] as Blocker[] }
            : {
                model: null as T | null,
                blockers: [{
                    scope: 'report',
                    id: 'missing-requested-model',
                    message: `Requested model \`${requestedModel}\` is not present in the benchmark report.`,
                }] as Blocker[],
            };
    }

    if (recommendedModel) {
        const recommended = candidates.find((entry) => entry.model === recommendedModel) || null;
        if (recommended) {
            return { model: recommended, blockers: [] as Blocker[] };
        }
    }

    if (candidates.length === 1) {
        return { model: candidates[0], blockers: [] as Blocker[] };
    }

    return {
        model: null as T | null,
        blockers: [{
            scope: 'report',
            id: 'model-required',
            message: 'Multiple models are present in the report; pass `--model` to evaluate a specific one.',
        }] as Blocker[],
    };
}

function evaluatePatientInsight(report: PatientInsightBenchmarkReport, requestedModel: string | null | undefined) {
    const selection = pickModel(report.models, requestedModel, report.decision?.recommendedModel || null);
    const blockers: Blocker[] = [...selection.blockers];
    const warnings: Warning[] = [];
    const selectedModel = selection.model?.model || null;

    if (!selection.model) {
        return {
            selectedModel,
            reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
            blockers,
            warnings,
        };
    }

    if (selection.model.status !== 'completed' || !selection.model.metrics) {
        blockers.push({
            scope: 'report',
            id: 'benchmark-not-completed',
            message: `Patient Insight benchmark for \`${selection.model.model}\` is not completed (${selection.model.status}).`,
        });
        return {
            selectedModel,
            reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
            blockers,
            warnings,
        };
    }

    const metrics = selection.model.metrics as unknown as Record<string, unknown>;
    const contractValidRate = readFiniteMetric(metrics, 'contractValidRate', blockers);
    const focusRecall = readFiniteMetric(metrics, 'focusRecall', blockers);
    const citationCoverageRate = readFiniteMetric(metrics, 'citationCoverageRate', blockers);
    const preferredSourceCoverage = readFiniteMetric(metrics, 'preferredSourceCoverage', blockers);
    const forbiddenLeakRate = readFiniteMetric(metrics, 'forbiddenLeakRate', blockers);
    const forbiddenSourceLeakRate = readFiniteMetric(metrics, 'forbiddenSourceLeakRate', blockers);
    const moralizingLeakRate = readFiniteMetric(metrics, 'moralizingLeakRate', blockers);
    const incompleteClaimRate = readFiniteMetric(metrics, 'incompleteClaimRate', blockers);

    if (contractValidRate !== null && contractValidRate < PATIENT_INSIGHT_THRESHOLDS.minContractRate) {
        blockers.push({
            scope: 'metric',
            id: 'contract-valid-rate',
            message: `contractValidRate=${contractValidRate} < ${PATIENT_INSIGHT_THRESHOLDS.minContractRate}`,
        });
    }
    if (focusRecall !== null && focusRecall < PATIENT_INSIGHT_THRESHOLDS.minFocusRecall) {
        blockers.push({
            scope: 'metric',
            id: 'focus-recall',
            message: `focusRecall=${focusRecall} < ${PATIENT_INSIGHT_THRESHOLDS.minFocusRecall}`,
        });
    }
    if (citationCoverageRate !== null && citationCoverageRate < PATIENT_INSIGHT_THRESHOLDS.minCitationRate) {
        blockers.push({
            scope: 'metric',
            id: 'citation-coverage-rate',
            message: `citationCoverageRate=${citationCoverageRate} < ${PATIENT_INSIGHT_THRESHOLDS.minCitationRate}`,
        });
    }
    if (preferredSourceCoverage !== null && preferredSourceCoverage < PATIENT_INSIGHT_THRESHOLDS.minPreferredSourceCoverage) {
        blockers.push({
            scope: 'metric',
            id: 'preferred-source-coverage',
            message: `preferredSourceCoverage=${preferredSourceCoverage} < ${PATIENT_INSIGHT_THRESHOLDS.minPreferredSourceCoverage}`,
        });
    }
    if (forbiddenLeakRate !== null && forbiddenLeakRate > PATIENT_INSIGHT_THRESHOLDS.maxForbiddenLeakRate) {
        blockers.push({
            scope: 'metric',
            id: 'forbidden-leak-rate',
            message: `forbiddenLeakRate=${forbiddenLeakRate} > ${PATIENT_INSIGHT_THRESHOLDS.maxForbiddenLeakRate}`,
        });
    }
    if (forbiddenSourceLeakRate !== null && forbiddenSourceLeakRate > PATIENT_INSIGHT_THRESHOLDS.maxForbiddenSourceLeakRate) {
        blockers.push({
            scope: 'metric',
            id: 'forbidden-source-leak-rate',
            message: `forbiddenSourceLeakRate=${forbiddenSourceLeakRate} > ${PATIENT_INSIGHT_THRESHOLDS.maxForbiddenSourceLeakRate}`,
        });
    }
    if (moralizingLeakRate !== null && moralizingLeakRate > PATIENT_INSIGHT_THRESHOLDS.maxMoralizingRate) {
        blockers.push({
            scope: 'metric',
            id: 'moralizing-leak-rate',
            message: `moralizingLeakRate=${moralizingLeakRate} > ${PATIENT_INSIGHT_THRESHOLDS.maxMoralizingRate}`,
        });
    }
    if (incompleteClaimRate !== null && incompleteClaimRate > PATIENT_INSIGHT_THRESHOLDS.maxIncompleteClaimRate) {
        blockers.push({
            scope: 'metric',
            id: 'incomplete-claim-rate',
            message: `incompleteClaimRate=${incompleteClaimRate} > ${PATIENT_INSIGHT_THRESHOLDS.maxIncompleteClaimRate}`,
        });
    }

    return {
        selectedModel,
        reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
        blockers,
        warnings,
    };
}

function evaluateSmartImport(report: SmartImportBenchmarkReport, requestedModel: string | null | undefined) {
    const selection = pickModel(report.models, requestedModel, report.decision?.recommendedModel || null);
    const blockers: Blocker[] = [...selection.blockers];
    const warnings: Warning[] = [];
    const selectedModel = selection.model?.model || null;

    if (!selection.model) {
        return {
            selectedModel,
            reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
            blockers,
            warnings,
        };
    }

    if (selection.model.status !== 'completed' || !selection.model.metrics) {
        blockers.push({
            scope: 'report',
            id: 'benchmark-not-completed',
            message: `Smart Import benchmark for \`${selection.model.model}\` is not completed (${selection.model.status}).`,
        });
        return {
            selectedModel,
            reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
            blockers,
            warnings,
        };
    }

    const metrics = selection.model.metrics as unknown as Record<string, unknown>;
    const contractValidRate = readFiniteMetric(metrics, 'contractValidRate', blockers);
    const jsonValidRate = readFiniteMetric(metrics, 'jsonValidRate', blockers);
    const diagnosisRecall = readFiniteMetric(metrics, 'diagnosisRecall', blockers);
    const diagnosisQueryRecall = readFiniteMetric(metrics, 'diagnosisQueryRecall', blockers);
    const therapyRecall = readFiniteMetric(metrics, 'therapyRecall', blockers);
    const dosageRecall = readFiniteMetric(metrics, 'dosageRecall', blockers);
    const therapyStateRecall = readFiniteMetric(metrics, 'therapyStateRecall', blockers);
    const sourceIdRate = readFiniteMetric(metrics, 'sourceIdRate', blockers);
    const forbiddenLeakRate = readFiniteMetric(metrics, 'forbiddenLeakRate', blockers);
    let alreadyPresentLeakRate = 0;
    if (metrics.alreadyPresentLeakRate != null) {
        if (typeof metrics.alreadyPresentLeakRate === 'number' && Number.isFinite(metrics.alreadyPresentLeakRate)) {
            alreadyPresentLeakRate = metrics.alreadyPresentLeakRate;
        } else {
            warnings.push({
                id: 'already-present-leak-rate-invalid',
                message: 'alreadyPresentLeakRate is not a finite number; ignoring optional warning metric.',
            });
        }
    }

    if (contractValidRate !== null && contractValidRate < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'contract-valid-rate',
            message: `contractValidRate=${contractValidRate} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (jsonValidRate !== null && jsonValidRate < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'json-valid-rate',
            message: `jsonValidRate=${jsonValidRate} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (diagnosisRecall !== null && diagnosisRecall < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'diagnosis-recall',
            message: `diagnosisRecall=${diagnosisRecall} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (diagnosisQueryRecall !== null && diagnosisQueryRecall < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'diagnosis-query-recall',
            message: `diagnosisQueryRecall=${diagnosisQueryRecall} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (therapyRecall !== null && therapyRecall < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'therapy-recall',
            message: `therapyRecall=${therapyRecall} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (dosageRecall !== null && dosageRecall < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'dosage-recall',
            message: `dosageRecall=${dosageRecall} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (therapyStateRecall !== null && therapyStateRecall < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'therapy-state-recall',
            message: `therapyStateRecall=${therapyStateRecall} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (sourceIdRate !== null && sourceIdRate < SMART_IMPORT_MIN_RATE) {
        blockers.push({
            scope: 'metric',
            id: 'source-id-rate',
            message: `sourceIdRate=${sourceIdRate} < ${SMART_IMPORT_MIN_RATE}`,
        });
    }
    if (forbiddenLeakRate !== null && forbiddenLeakRate > 0) {
        blockers.push({
            scope: 'metric',
            id: 'forbidden-leak-rate',
            message: `forbiddenLeakRate=${forbiddenLeakRate} > 0`,
        });
    }
    if (alreadyPresentLeakRate !== null && alreadyPresentLeakRate > 0) {
        warnings.push({
            id: 'already-present-leak-rate',
            message: `alreadyPresentLeakRate=${alreadyPresentLeakRate} > 0 (non-blocking warning in this first thin slice)`,
        });
    }

    return {
        selectedModel,
        reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
        blockers,
        warnings,
    };
}

function evaluateValidationArtifact(
    report: ValidationArtifact,
    readinessKey: 'shadowReady' | 'promotionReady',
    readinessLabel: string,
) {
    const blockers: Blocker[] = [];

    if (report[readinessKey] !== true) {
        const failures = Array.isArray(report.failures) ? report.failures : [];
        if (failures.length > 0) {
            for (const failure of failures) {
                blockers.push({
                    scope: 'metric',
                    id: failure.id || `${readinessKey}-failure`,
                    message: failure.message || `${readinessLabel} gate failed.`,
                });
            }
        } else {
            blockers.push({
                scope: 'metric',
                id: readinessKey,
                message: `${readinessLabel} gate did not pass.`,
            });
        }
    }

    return {
        selectedModel: null,
        reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
        blockers,
        warnings: [] as Warning[],
    };
}

function evaluateGenerativeChallenger(report: ParliamentReport, requestedModel: string | null | undefined) {
    const blockers: Blocker[] = [];
    const warnings: Warning[] = [];
    const candidates = report.candidates || [];
    const selectedCandidate = requestedModel
        ? candidates.find((candidate) => candidate.runtimeModel === requestedModel || candidate.id === requestedModel) || null
        : null;

    if (!requestedModel) {
        blockers.push({
            scope: 'report',
            id: 'model-required',
            message: 'Generative challenger readiness requires `--model` to identify the candidate inside the parliament report.',
        });
    } else if (!selectedCandidate) {
        blockers.push({
            scope: 'report',
            id: 'missing-requested-model',
            message: `No parliament candidate matches \`${requestedModel}\`.`,
        });
    }

    if (!selectedCandidate) {
        return {
            selectedModel: requestedModel || null,
            reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
            blockers,
            warnings,
        };
    }

    if (!selectedCandidate.contractChamber.available) {
        blockers.push({
            scope: 'report',
            id: 'contract-chamber-missing',
            message: 'Shared-contract chamber is not available for this candidate.',
        });
    }
    if (!selectedCandidate.smartImportChamber.available) {
        blockers.push({
            scope: 'report',
            id: 'smart-import-chamber-missing',
            message: 'Smart Import chamber is not available for this candidate.',
        });
    }
    if (!selectedCandidate.contractChamber.passed) {
        for (const reason of selectedCandidate.contractChamber.reasons) {
            blockers.push({
                scope: 'metric',
                id: 'contract-chamber',
                message: reason,
            });
        }
    }
    if (!selectedCandidate.smartImportChamber.passed) {
        for (const reason of selectedCandidate.smartImportChamber.reasons) {
            blockers.push({
                scope: 'metric',
                id: 'smart-import-chamber',
                message: reason,
            });
        }
    }

    if (selectedCandidate.verdict === 'missing_runtime' || selectedCandidate.verdict === 'blocked' || selectedCandidate.verdict === 'lane_pending') {
        blockers.push({
            scope: 'report',
            id: 'candidate-verdict',
            message: `Candidate verdict is \`${selectedCandidate.verdict}\`, so it is not rollout-ready.`,
        });
    } else if (selectedCandidate.verdict === 'prune_redundant') {
        warnings.push({
            id: 'redundant-candidate',
            message: 'Candidate passes chambers but is currently classified as redundant in parliament retention.',
        });
    }

    return {
        selectedModel: selectedCandidate.runtimeModel,
        reportGeneratedAt: typeof report.generatedAt === 'string' ? report.generatedAt : null,
        blockers,
        warnings,
    };
}

export function evaluateRolloutReadiness(options: EvaluateOptions): RolloutReadinessReport {
    const owner = options.owner?.trim() || null;
    const blockers: Blocker[] = [];
    let selectedModel: string | null = null;
    let reportGeneratedAt: string | null = null;
    let warnings: Warning[] = [];

    if (!options.fallbackWritten) {
        blockers.push({
            scope: 'prerequisite',
            id: 'fallback-written',
            message: 'Fallback deterministico non ancora dichiarato come scritto su disco.',
        });
    }
    if (!owner) {
        blockers.push({
            scope: 'prerequisite',
            id: 'owner-missing',
            message: 'Kill-switch owner mancante: passa `--owner`.',
        });
    }
    if (!options.licenseClear) {
        blockers.push({
            scope: 'prerequisite',
            id: 'license-clear',
            message: 'Licenza/uso operativo non marcati come chiari: passa `--license-clear` solo quando il prerequisito e davvero soddisfatto.',
        });
    }

    if (options.lane === 'patient_insight') {
        const result = evaluatePatientInsight(options.report as PatientInsightBenchmarkReport, options.model);
        selectedModel = result.selectedModel;
        reportGeneratedAt = result.reportGeneratedAt;
        blockers.push(...result.blockers);
        warnings = warnings.concat(result.warnings);
    } else if (options.lane === 'smart_import') {
        const result = evaluateSmartImport(options.report as SmartImportBenchmarkReport, options.model);
        selectedModel = result.selectedModel;
        reportGeneratedAt = result.reportGeneratedAt;
        blockers.push(...result.blockers);
        warnings = warnings.concat(result.warnings);
    } else if (options.lane === 'redaction') {
        const result = evaluateValidationArtifact(options.report as ValidationArtifact, 'shadowReady', 'Shadow-readiness');
        selectedModel = result.selectedModel;
        reportGeneratedAt = result.reportGeneratedAt;
        blockers.push(...result.blockers);
        warnings = warnings.concat(result.warnings);
    } else if (options.lane === 'clinical_entities') {
        const result = evaluateValidationArtifact(options.report as ValidationArtifact, 'promotionReady', 'Promotion-readiness');
        selectedModel = result.selectedModel;
        reportGeneratedAt = result.reportGeneratedAt;
        blockers.push(...result.blockers);
        warnings = warnings.concat(result.warnings);
    } else {
        const result = evaluateGenerativeChallenger(options.report as ParliamentReport, options.model);
        selectedModel = result.selectedModel;
        reportGeneratedAt = result.reportGeneratedAt;
        blockers.push(...result.blockers);
        warnings = warnings.concat(result.warnings);
    }

    const evidence = toBenchmarkEvidence(
        reportGeneratedAt,
        options.fallbackWritten,
        owner,
        options.licenseClear,
        options.maxAgeDays ?? null,
    );

    if (!reportGeneratedAt) {
        blockers.push({
            scope: 'report',
            id: 'generated-at-missing',
            message: 'Report privo di `generatedAt`, quindi la freshness non e verificabile.',
        });
    } else if (evidence.benchmarkAgeDays !== null && evidence.benchmarkAgeDays < 0) {
        blockers.push({
            scope: 'report',
            id: 'generated-at-future',
            message: `Report generatedAt is in the future (${evidence.benchmarkAgeDays} days).`,
        });
    } else if (!evidence.benchmarkFresh) {
        blockers.push({
            scope: 'prerequisite',
            id: 'benchmark-stale',
            message: `Benchmark troppo vecchio (${evidence.benchmarkAgeDays} giorni > ${evidence.maxAgeDays}).`,
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        lane: options.lane,
        currentState: options.currentState,
        reportPath: options.reportPath,
        selectedModel,
        status: chooseStatus(options.currentState, blockers),
        blockers,
        warnings,
        evidence,
    };
}

export function buildRolloutReadinessMarkdown(report: RolloutReadinessReport) {
    const blockers = toMarkdownList(
        report.blockers.map((blocker) => `[${blocker.scope}] ${blocker.id}: ${blocker.message}`),
        'No blocking conditions detected.',
    );
    const warnings = toMarkdownList(
        report.warnings.map((warning) => `${warning.id}: ${warning.message}`),
        'No warnings.',
    );

    return [
        '# AI Rollout Readiness',
        '',
        '## Summary',
        `- Status: \`${report.status}\``,
        `- Lane: \`${report.lane}\``,
        `- Current state: \`${report.currentState}\``,
        `- Selected model: ${report.selectedModel ? `\`${report.selectedModel}\`` : 'n/a'}`,
        `- Generated at: \`${report.generatedAt}\``,
        `- Source report: \`${report.reportPath}\``,
        '',
        '## Blockers',
        blockers,
        '',
        '## Warnings',
        warnings,
        '',
        '## Evidence',
        `- Benchmark generated at: ${report.evidence.reportGeneratedAt ? `\`${report.evidence.reportGeneratedAt}\`` : 'n/a'}`,
        `- Benchmark fresh: ${toDisplayValue(report.evidence.benchmarkFresh)}`,
        `- Benchmark age days: ${toDisplayValue(report.evidence.benchmarkAgeDays)}`,
        `- Max age days: ${toDisplayValue(report.evidence.maxAgeDays)}`,
        `- Fallback written: ${toDisplayValue(report.evidence.fallbackWritten)}`,
        `- Kill-switch owner: ${report.evidence.owner ? `\`${report.evidence.owner}\`` : 'n/a'}`,
        `- License clear: ${toDisplayValue(report.evidence.licenseClear)}`,
        '',
    ].join('\n');
}

async function main() {
    const args = parseArgs(process.argv);
    if (!isAllowedLane(args.lane)) {
        throw new Error('Passa `--lane` con uno di: patient_insight, smart_import, redaction, clinical_entities, generative_challenger.');
    }
    if (!args.report) {
        throw new Error('Passa `--report <path>` con un artifact JSON gia prodotto.');
    }
    if (!isAllowedCurrentState(args.currentState)) {
        throw new Error('`--current-state` non valido.');
    }

    const report = JSON.parse(fs.readFileSync(args.report, 'utf8')) as unknown;
    const readiness = evaluateRolloutReadiness({
        lane: args.lane,
        reportPath: args.report,
        report,
        model: args.model,
        currentState: args.currentState,
        fallbackWritten: args.fallbackWritten,
        owner: args.owner,
        licenseClear: args.licenseClear,
        maxAgeDays: args.maxAgeDays,
    });
    const outputPaths = resolveRolloutReadinessOutputPaths(args.lane, args.out, args.markdownOut);
    const output = JSON.stringify(readiness, null, 2);
    const markdown = buildRolloutReadinessMarkdown(readiness);

    ensureAiRolloutReadinessArtifactDirectory(args.lane);
    fs.mkdirSync(path.dirname(outputPaths.jsonOutPath), { recursive: true });
    fs.writeFileSync(outputPaths.jsonOutPath, output, 'utf8');
    fs.mkdirSync(path.dirname(outputPaths.markdownOutPath), { recursive: true });
    fs.writeFileSync(outputPaths.markdownOutPath, markdown, 'utf8');

    process.stdout.write(`${output}\n`);

    if (readiness.status !== 'shadow-ready') {
        process.exitCode = 1;
    }
}

const isMainModule = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false;

if (isMainModule) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
