#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAiModelParliamentArtifactPaths, ensureAiModelParliamentArtifactDirectory } from '../lib/ai-model-parliament-storage.ts';
import { runModelStackBenchmark } from './benchmark-model-stack.ts';
import { runSmartImportBenchmark } from './benchmark-smart-import.ts';
import {
    buildLocalChatTargetKey,
    resolveLocalChatBaseUrls,
    type LocalChatTarget,
} from './local-chat-runtime.ts';

type ParliamentVerdict =
    | 'baseline'
    | 'challenger'
    | 'protected_active'
    | 'prune_failed'
    | 'prune_redundant'
    | 'blocked'
    | 'missing_runtime'
    | 'lane_pending';

type ContractChamberAssessment = {
    available: boolean;
    passed: boolean;
    reasons: string[];
    score: number;
};

type SmartImportChamberAssessment = {
    available: boolean;
    passed: boolean;
    reasons: string[];
    score: number;
};

type CandidateLane = Awaited<ReturnType<typeof runModelStackBenchmark>>['candidates'][number]['lane'];

type CandidateCapabilityProfile = {
    summary: string;
    tasks: string[];
};

type CandidateEconomics = {
    qualityScore: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    relativeLatency: number | null;
    valueScore: number | null;
};

export type CandidateParliamentDecision = {
    id: string;
    label: string;
    lane: CandidateLane;
    origin: string;
    runtime: string;
    runtimeModel: string | null;
    executionStatus: string;
    registryStatus: string;
    notes: string;
    verdict: ParliamentVerdict;
    reasons: string[];
    blockers: string[];
    contractChamber: ContractChamberAssessment;
    smartImportChamber: SmartImportChamberAssessment;
    capabilities: CandidateCapabilityProfile;
    economics: CandidateEconomics;
};

type ParliamentLaneState =
    | 'competitive'
    | 'hold'
    | 'benchmark_only'
    | 'integration_pending'
    | 'blocked';

export type ParliamentLaneScorecard = {
    lane: CandidateLane;
    capability: string;
    tasks: string[];
    state: ParliamentLaneState;
    totalCandidates: number;
    runnableCandidates: number;
    benchmarkedCandidates: number;
    focusCandidateLabel: string | null;
    focusCandidateModel: string | null;
    bestValueModel: string | null;
    blockers: string[];
    focusNote: string | null;
};

export type ParliamentScorecard = {
    summary: {
        bestQualityModel: string | null;
        bestQualityLabel: string | null;
        bestQualityScore: number | null;
        bestValueModel: string | null;
        bestValueLabel: string | null;
        bestValueScore: number | null;
        bestValueChallengerModel: string | null;
        bestValueChallengerLabel: string | null;
        fastestModel: string | null;
        fastestLabel: string | null;
        fastestAvgLatencyMs: number | null;
        competitiveLaneCount: number;
        advisoryLaneCount: number;
    };
    lanes: ParliamentLaneScorecard[];
};

type PruneResult = {
    model: string;
    ok: boolean;
    command: string;
    message: string;
};

export type ParliamentReport = {
    generatedAt: string;
    baseUrl: string;
    mlxBaseUrl: string;
    registryPath: string;
    taskCorpusPath: string;
    smartImportCorpusPath: string;
    iterations: number;
    schemaVersion: string;
    configuredRuntime: {
        dbPath: string | null;
        configuredBaseUrl: string | null;
        activeRoleModels: {
            clinical: string | null;
            reasoning: string | null;
            ocr: string | null;
            legacy: string | null;
        };
        protectedModels: string[];
    };
    chambers: {
        generative: Awaited<ReturnType<typeof runModelStackBenchmark>>;
        smartImport: Awaited<ReturnType<typeof runSmartImportBenchmark>>;
    };
    parliament: {
        readiness: 'hold' | 'prune_ready';
        baselineModel: string | null;
        challengerModels: string[];
        rationale: string;
        protectedModels: string[];
        recommendedPruneModels: string[];
        untrackedInstalledModels: string[];
        pruneCommands: string[];
        pruneApplied: boolean;
        pruneResults: PruneResult[];
    };
    candidates: CandidateParliamentDecision[];
    scorecard: ParliamentScorecard;
};

type ConfiguredRuntime = ParliamentReport['configuredRuntime'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'fixtures', 'ai-model-stack-candidates.json');
const DEFAULT_TASK_CORPUS_PATH = path.join(__dirname, 'fixtures', 'ai-task-contract-corpus.json');
const DEFAULT_SMART_IMPORT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'smart-import-benchmark-corpus.json');
const CURRENT_BASELINE_MODEL = 'qwen3.5:35b-a3b';
const PROTECTED_SETTINGS_KEYS = ['aiModel_clinical', 'aiModel_reasoning', 'aiModel_ocr', 'aiModel', 'aiUrl', 'ollamaUrl'] as const;
const DEFAULT_KEEP_CHALLENGERS = 1;
const CONTRACT_MIN_RATE = 0.95;
const JSON_MIN_RATE = 0.95;
const TASK_MIN_RATE = 0.9;
const SMART_IMPORT_MIN_RATE = 0.95;
const PARLIAMENT_MAX_QUALITY_SCORE = 11;
const LANE_CAPABILITY_PROFILES: Record<CandidateLane, CandidateCapabilityProfile> = {
    generative: {
        summary: 'Baseline locale multi-task per patient insight, smart import e document synthesis.',
        tasks: ['patient_insight', 'smart_import', 'document_synthesis'],
    },
    pii: {
        summary: 'Lane specialistica privacy-first per redaction.v1 e de-identificazione locale.',
        tasks: ['redaction.v1', 'deidentify'],
    },
    clinical_entities: {
        summary: 'Lane evidence-first per estrazione medication/problem su corpus clinico sintetico.',
        tasks: ['clinical_entities.v1', 'problem_extraction', 'medication_extraction'],
    },
    embedding: {
        summary: 'Lane encoder per retrieval, reranking e memoria di evidenze locale.',
        tasks: ['retrieval', 'reranking', 'evidence_memory'],
    },
};

function parseArgs(argv: string[]) {
    const args = {
        registry: DEFAULT_REGISTRY_PATH,
        taskCorpus: DEFAULT_TASK_CORPUS_PATH,
        smartImportCorpus: DEFAULT_SMART_IMPORT_CORPUS_PATH,
        out: null as string | null,
        markdownOut: null as string | null,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        mlxBaseUrl: process.env.MLX_BASE_URL || 'http://127.0.0.1:8080',
        iterations: 1,
        dataDir: process.env.MEDIFLOW_DATA_DIR || null as string | null,
        dbPath: null as string | null,
        keepChallengers: DEFAULT_KEEP_CHALLENGERS,
        protectModels: [] as string[],
        models: null as string[] | null,
        mlxModels: null as string[] | null,
        applyPrune: false,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--registry' && argv[index + 1]) {
            args.registry = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--task-corpus' && argv[index + 1]) {
            args.taskCorpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--smart-import-corpus' && argv[index + 1]) {
            args.smartImportCorpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--markdown-out' && argv[index + 1]) {
            args.markdownOut = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--base-url' && argv[index + 1]) {
            args.baseUrl = argv[index + 1];
            index += 1;
        } else if (value === '--mlx-base-url' && argv[index + 1]) {
            args.mlxBaseUrl = argv[index + 1];
            index += 1;
        } else if (value === '--iterations' && argv[index + 1]) {
            args.iterations = Math.max(1, Number.parseInt(argv[index + 1], 10) || 1);
            index += 1;
        } else if (value === '--data-dir' && argv[index + 1]) {
            args.dataDir = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--db-path' && argv[index + 1]) {
            args.dbPath = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--keep-challengers' && argv[index + 1]) {
            args.keepChallengers = Math.max(0, Number.parseInt(argv[index + 1], 10) || DEFAULT_KEEP_CHALLENGERS);
            index += 1;
        } else if (value === '--protect-models' && argv[index + 1]) {
            args.protectModels = argv[index + 1]
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            index += 1;
        } else if (value === '--models' && argv[index + 1]) {
            args.models = argv[index + 1]
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            index += 1;
        } else if (value === '--mlx-models' && argv[index + 1]) {
            args.mlxModels = argv[index + 1]
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            index += 1;
        } else if (value === '--apply-prune') {
            args.applyPrune = true;
        }
    }

    return args;
}

function getDefaultDataDir() {
    return process.env.MEDIFLOW_DATA_DIR
        || (process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
            : path.join(os.homedir(), '.mediflow'));
}

function normalizeModelName(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function resolveDbPath(explicitDbPath: string | null, explicitDataDir: string | null) {
    if (explicitDbPath) return explicitDbPath;
    const dataDir = explicitDataDir || getDefaultDataDir();
    return path.join(dataDir, 'medical.db');
}

function readConfiguredRuntime(dbPath: string | null, extraProtectedModels: string[]): ConfiguredRuntime {
    const baseState: ConfiguredRuntime = {
        dbPath: dbPath && fs.existsSync(dbPath) ? dbPath : null,
        configuredBaseUrl: null,
        activeRoleModels: {
            clinical: null,
            reasoning: null,
            ocr: null,
            legacy: null,
        },
        protectedModels: [...new Set(extraProtectedModels.map((model) => model.trim()).filter(Boolean))],
    };

    if (!dbPath || !fs.existsSync(dbPath)) {
        return baseState;
    }

    let db: Database.Database | null = null;
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const placeholders = PROTECTED_SETTINGS_KEYS.map(() => '?').join(', ');
        const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
            .all(...PROTECTED_SETTINGS_KEYS) as Array<{ key: string; value: string }>;
        const values = new Map(rows.map((row) => [row.key, row.value]));
        const clinical = normalizeModelName(values.get('aiModel_clinical'));
        const reasoning = normalizeModelName(values.get('aiModel_reasoning'));
        const ocr = normalizeModelName(values.get('aiModel_ocr'));
        const legacy = normalizeModelName(values.get('aiModel'));
        const configuredBaseUrl = normalizeModelName(values.get('aiUrl') || values.get('ollamaUrl'));

        return {
            dbPath,
            configuredBaseUrl,
            activeRoleModels: {
                clinical,
                reasoning,
                ocr,
                legacy,
            },
            protectedModels: [
                ...new Set(
                    [
                        ...baseState.protectedModels,
                        clinical,
                        reasoning,
                        ocr,
                        legacy,
                    ].filter((value): value is string => Boolean(value)),
                ),
            ],
        };
    } catch {
        return baseState;
    } finally {
        db?.close();
    }
}

function average(values: number[]) {
    if (values.length === 0) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function averageNullable(values: Array<number | null | undefined>) {
    const filtered = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (filtered.length === 0) return null;
    return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(1));
}

function assessContractChamber(candidate: Awaited<ReturnType<typeof runModelStackBenchmark>>['candidates'][number]): ContractChamberAssessment {
    const benchmark = candidate.benchmark;
    if (!benchmark || benchmark.status !== 'completed' || !benchmark.metrics || !benchmark.tasks) {
        return {
            available: false,
            passed: false,
            reasons: ['No completed shared-contract benchmark available.'],
            score: 0,
        };
    }

    const reasons: string[] = [];
    if (benchmark.metrics.contractValidRate < CONTRACT_MIN_RATE) {
        reasons.push(`contractValidRate ${benchmark.metrics.contractValidRate} < ${CONTRACT_MIN_RATE}`);
    }
    if (benchmark.metrics.jsonValidRate < JSON_MIN_RATE) {
        reasons.push(`jsonValidRate ${benchmark.metrics.jsonValidRate} < ${JSON_MIN_RATE}`);
    }

    for (const [task, metrics] of Object.entries(benchmark.tasks)) {
        if (metrics.contractValidRate < TASK_MIN_RATE) {
            reasons.push(`${task} contractValidRate ${metrics.contractValidRate} < ${TASK_MIN_RATE}`);
        }
        if (metrics.jsonValidRate < TASK_MIN_RATE) {
            reasons.push(`${task} jsonValidRate ${metrics.jsonValidRate} < ${TASK_MIN_RATE}`);
        }
    }

    const taskScores = Object.values(benchmark.tasks).flatMap((metrics) => [
        metrics.contractValidRate,
        metrics.jsonValidRate,
    ]);

    return {
        available: true,
        passed: reasons.length === 0,
        reasons: reasons.length > 0 ? reasons : ['Shared extraction contract thresholds passed.'],
        score: Number((benchmark.metrics.contractValidRate + benchmark.metrics.jsonValidRate + average(taskScores)).toFixed(4)),
    };
}

function assessSmartImportChamber(
    target: LocalChatTarget | null,
    smartImportByModel: Map<string, Awaited<ReturnType<typeof runSmartImportBenchmark>>['models'][number]>,
): SmartImportChamberAssessment {
    if (!target) {
        return {
            available: false,
            passed: false,
            reasons: ['No runnable model id available for smart import benchmark.'],
            score: 0,
        };
    }

    const benchmark = smartImportByModel.get(buildLocalChatTargetKey(target));
    if (!benchmark || benchmark.status !== 'completed' || !benchmark.metrics) {
        return {
            available: false,
            passed: false,
            reasons: ['No completed smart import benchmark available.'],
            score: 0,
        };
    }

    const reasons: string[] = [];
    if (benchmark.metrics.contractValidRate < SMART_IMPORT_MIN_RATE) {
        reasons.push(`contractValidRate ${benchmark.metrics.contractValidRate} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.jsonValidRate < SMART_IMPORT_MIN_RATE) {
        reasons.push(`jsonValidRate ${benchmark.metrics.jsonValidRate} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.diagnosisRecall < SMART_IMPORT_MIN_RATE) {
        reasons.push(`diagnosisRecall ${benchmark.metrics.diagnosisRecall} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.diagnosisQueryRecall < SMART_IMPORT_MIN_RATE) {
        reasons.push(`diagnosisQueryRecall ${benchmark.metrics.diagnosisQueryRecall} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.therapyRecall < SMART_IMPORT_MIN_RATE) {
        reasons.push(`therapyRecall ${benchmark.metrics.therapyRecall} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.dosageRecall < SMART_IMPORT_MIN_RATE) {
        reasons.push(`dosageRecall ${benchmark.metrics.dosageRecall} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.therapyStateRecall < SMART_IMPORT_MIN_RATE) {
        reasons.push(`therapyStateRecall ${benchmark.metrics.therapyStateRecall} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.sourceIdRate < SMART_IMPORT_MIN_RATE) {
        reasons.push(`sourceIdRate ${benchmark.metrics.sourceIdRate} < ${SMART_IMPORT_MIN_RATE}`);
    }
    if (benchmark.metrics.forbiddenLeakRate > 0) {
        reasons.push(`forbiddenLeakRate ${benchmark.metrics.forbiddenLeakRate} > 0`);
    }

    return {
        available: true,
        passed: reasons.length === 0,
        reasons: reasons.length > 0 ? reasons : ['Smart import thresholds passed.'],
        score: Number((
            benchmark.metrics.contractValidRate
            + benchmark.metrics.jsonValidRate
            + benchmark.metrics.diagnosisRecall
            + benchmark.metrics.diagnosisQueryRecall
            + benchmark.metrics.therapyRecall
            + benchmark.metrics.dosageRecall
            + benchmark.metrics.therapyStateRecall
            + benchmark.metrics.sourceIdRate
            - benchmark.metrics.forbiddenLeakRate
        ).toFixed(4)),
    };
}

function combinedScore(contractChamber: ContractChamberAssessment, smartImportChamber: SmartImportChamberAssessment) {
    return Number((contractChamber.score + smartImportChamber.score).toFixed(4));
}

function buildCandidateCapabilities(lane: CandidateLane): CandidateCapabilityProfile {
    return LANE_CAPABILITY_PROFILES[lane];
}

function buildCandidateEconomics(
    candidate: Awaited<ReturnType<typeof runModelStackBenchmark>>['candidates'][number],
    target: LocalChatTarget | null,
    contractChamber: ContractChamberAssessment,
    smartImportChamber: SmartImportChamberAssessment,
    smartImportByModel: Map<string, Awaited<ReturnType<typeof runSmartImportBenchmark>>['models'][number]>,
): CandidateEconomics {
    const contractMetrics = candidate.benchmark?.status === 'completed' && candidate.benchmark.metrics
        ? candidate.benchmark.metrics
        : null;
    const smartImportBenchmark = target ? smartImportByModel.get(buildLocalChatTargetKey(target)) : null;
    const smartImportMetrics = smartImportBenchmark?.status === 'completed' && smartImportBenchmark.metrics
        ? smartImportBenchmark.metrics
        : null;
    const qualityScore = Number((combinedScore(contractChamber, smartImportChamber) / PARLIAMENT_MAX_QUALITY_SCORE).toFixed(3));

    return {
        qualityScore,
        avgLatencyMs: averageNullable([
            contractMetrics?.avgLatencyMs ?? null,
            smartImportMetrics?.avgLatencyMs ?? null,
        ]),
        p95LatencyMs: averageNullable([
            contractMetrics?.p95LatencyMs ?? null,
            smartImportMetrics?.p95LatencyMs ?? null,
        ]),
        relativeLatency: null,
        valueScore: null,
    };
}

export function finalizeCandidateEconomics(candidates: CandidateParliamentDecision[]) {
    const fastestAvgLatencyMs = candidates
        .map((candidate) => candidate.economics.avgLatencyMs)
        .filter((value): value is number => typeof value === 'number' && value > 0)
        .sort((left, right) => left - right)[0];

    if (!fastestAvgLatencyMs) {
        return candidates;
    }

    return candidates.map((candidate) => {
        const avgLatencyMs = candidate.economics.avgLatencyMs;
        if (!avgLatencyMs) {
            return candidate;
        }

        const relativeLatency = Number((fastestAvgLatencyMs / avgLatencyMs).toFixed(3));
        return {
            ...candidate,
            economics: {
                ...candidate.economics,
                relativeLatency,
                valueScore: Number((candidate.economics.qualityScore * relativeLatency).toFixed(3)),
            },
        };
    });
}

function pickBestCandidate(
    candidates: CandidateParliamentDecision[],
    selector: (candidate: CandidateParliamentDecision) => number | null,
) {
    return candidates.reduce<CandidateParliamentDecision | null>((best, candidate) => {
        const score = selector(candidate);
        if (score === null || Number.isNaN(score) || score <= 0) return best;
        if (!best) return candidate;

        const bestScore = selector(best) || 0;
        if (score > bestScore) return candidate;
        if (score < bestScore) return best;

        const bestLatency = best.economics.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
        const candidateLatency = candidate.economics.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
        return candidateLatency < bestLatency ? candidate : best;
    }, null);
}

function collectLaneBlockers(candidates: CandidateParliamentDecision[]) {
    return Array.from(new Set(
        candidates.flatMap((candidate) => [
            ...candidate.blockers,
            ...candidate.reasons.filter((reason) =>
                !reason.includes('thresholds passed')
                && !reason.startsWith('Retained as ')
                && !reason.startsWith('Configured active role model')
                && !reason.startsWith('Strong but redundant')
            ),
        ]),
    )).slice(0, 4);
}

function resolveLaneState(candidates: CandidateParliamentDecision[]): ParliamentLaneState {
    if (candidates.some((candidate) =>
        candidate.verdict === 'baseline'
        || candidate.verdict === 'challenger'
        || candidate.verdict === 'prune_redundant'
    )) {
        return 'competitive';
    }

    if (candidates.some((candidate) =>
        candidate.executionStatus === 'runnable'
        || candidate.registryStatus === 'benchmarked'
    )) {
        return 'hold';
    }

    if (candidates.some((candidate) =>
        candidate.blockers.includes('benchmark_only')
        || candidate.blockers.includes('promotion_gate_failed')
        || candidate.blockers.includes('shadow_validation_failed')
    )) {
        return 'benchmark_only';
    }

    if (candidates.some((candidate) => candidate.executionStatus === 'integration_required')) {
        return 'integration_pending';
    }

    return 'blocked';
}

export function buildParliamentScorecard(candidates: CandidateParliamentDecision[]): ParliamentScorecard {
    const bestQualityCandidate = pickBestCandidate(candidates, (candidate) => candidate.economics.qualityScore);
    const bestValueCandidate = pickBestCandidate(candidates, (candidate) => candidate.economics.valueScore);
    const bestValueChallenger = pickBestCandidate(
        candidates.filter((candidate) =>
            candidate.lane === 'generative'
            && candidate.verdict !== 'baseline',
        ),
        (candidate) => candidate.economics.valueScore,
    );
    const fastestCandidate = pickBestCandidate(candidates, (candidate) =>
        candidate.economics.avgLatencyMs
            ? Number((1 / candidate.economics.avgLatencyMs).toFixed(6))
            : null,
    );

    const lanes = Array.from(new Set(candidates.map((candidate) => candidate.lane)))
        .map((lane) => {
            const laneCandidates = candidates.filter((candidate) => candidate.lane === lane);
            const focusCandidate = pickBestCandidate(laneCandidates, (candidate) => candidate.economics.valueScore)
                || pickBestCandidate(laneCandidates, (candidate) => candidate.economics.qualityScore)
                || laneCandidates[0]
                || null;

            return {
                lane,
                capability: buildCandidateCapabilities(lane).summary,
                tasks: buildCandidateCapabilities(lane).tasks,
                state: resolveLaneState(laneCandidates),
                totalCandidates: laneCandidates.length,
                runnableCandidates: laneCandidates.filter((candidate) => candidate.executionStatus === 'runnable').length,
                benchmarkedCandidates: laneCandidates.filter((candidate) =>
                    candidate.contractChamber.available || candidate.smartImportChamber.available,
                ).length,
                focusCandidateLabel: focusCandidate?.label || null,
                focusCandidateModel: focusCandidate?.runtimeModel || null,
                bestValueModel: pickBestCandidate(laneCandidates, (candidate) => candidate.economics.valueScore)?.runtimeModel || null,
                blockers: collectLaneBlockers(laneCandidates),
                focusNote: focusCandidate?.notes || null,
            };
        })
        .sort((left, right) => left.lane.localeCompare(right.lane));

    return {
        summary: {
            bestQualityModel: bestQualityCandidate?.runtimeModel || null,
            bestQualityLabel: bestQualityCandidate?.label || null,
            bestQualityScore: bestQualityCandidate?.economics.qualityScore ?? null,
            bestValueModel: bestValueCandidate?.runtimeModel || null,
            bestValueLabel: bestValueCandidate?.label || null,
            bestValueScore: bestValueCandidate?.economics.valueScore ?? null,
            bestValueChallengerModel: bestValueChallenger?.runtimeModel || null,
            bestValueChallengerLabel: bestValueChallenger?.label || null,
            fastestModel: fastestCandidate?.runtimeModel || null,
            fastestLabel: fastestCandidate?.label || null,
            fastestAvgLatencyMs: fastestCandidate?.economics.avgLatencyMs ?? null,
            competitiveLaneCount: lanes.filter((lane) => lane.state === 'competitive').length,
            advisoryLaneCount: lanes.filter((lane) => lane.state !== 'competitive').length,
        },
        lanes,
    };
}

function formatScore(value: number | null) {
    return typeof value === 'number' ? value.toFixed(3) : 'n/a';
}

function formatLatency(value: number | null) {
    return typeof value === 'number' ? `${value.toFixed(1)} ms` : 'n/a';
}

function buildPruneCommand(model: string) {
    return `ollama rm ${JSON.stringify(model)}`;
}

function applyPruneModels(models: string[]): PruneResult[] {
    if (models.length === 0) return [];

    const versionProbe = spawnSync('ollama', ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (versionProbe.error || versionProbe.status !== 0) {
        const message = versionProbe.error?.message || versionProbe.stderr.trim() || 'ollama CLI not available.';
        return models.map((model) => ({
            model,
            ok: false,
            command: buildPruneCommand(model),
            message,
        }));
    }

    return models.map((model) => {
        const result = spawnSync('ollama', ['rm', model], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const ok = result.status === 0;
        return {
            model,
            ok,
            command: buildPruneCommand(model),
            message: ok
                ? (result.stdout.trim() || 'Removed from local Ollama runtime.')
                : (result.stderr.trim() || result.error?.message || 'ollama rm failed.'),
        };
    });
}

export function buildMarkdown(report: ParliamentReport) {
    const lines: string[] = [];
    lines.push('# AI model parliament');
    lines.push('');
    lines.push(`- Generated at: \`${report.generatedAt}\``);
    lines.push(`- Ollama runtime: \`${report.baseUrl}\``);
    lines.push(`- MLX runtime: \`${report.mlxBaseUrl}\``);
    lines.push(`- Readiness: \`${report.parliament.readiness}\``);
    lines.push(`- Baseline: \`${report.parliament.baselineModel || 'none'}\``);
    lines.push(`- Challengers kept: ${report.parliament.challengerModels.length > 0 ? report.parliament.challengerModels.map((model) => `\`${model}\``).join(', ') : 'none'}`);
    lines.push(`- Recommended prune: ${report.parliament.recommendedPruneModels.length > 0 ? report.parliament.recommendedPruneModels.map((model) => `\`${model}\``).join(', ') : 'none'}`);
    lines.push('');
    lines.push('## Rationale');
    lines.push('');
    lines.push(report.parliament.rationale);
    lines.push('');
    lines.push('## Protected models');
    lines.push('');
    if (report.parliament.protectedModels.length === 0) {
        lines.push('- None');
    } else {
        for (const model of report.parliament.protectedModels) {
            lines.push(`- \`${model}\``);
        }
    }
    lines.push('');
    lines.push('## Capability / economics scorecard');
    lines.push('');
    lines.push(`- Best quality: ${report.scorecard.summary.bestQualityModel ? `\`${report.scorecard.summary.bestQualityModel}\`` : 'none'} (${formatScore(report.scorecard.summary.bestQualityScore)})`);
    lines.push(`- Best value: ${report.scorecard.summary.bestValueModel ? `\`${report.scorecard.summary.bestValueModel}\`` : 'none'} (${formatScore(report.scorecard.summary.bestValueScore)})`);
    lines.push(`- Best value challenger: ${report.scorecard.summary.bestValueChallengerModel ? `\`${report.scorecard.summary.bestValueChallengerModel}\`` : 'none'}`);
    lines.push(`- Fastest runnable: ${report.scorecard.summary.fastestModel ? `\`${report.scorecard.summary.fastestModel}\`` : 'none'} (${formatLatency(report.scorecard.summary.fastestAvgLatencyMs)})`);
    lines.push(`- Competitive lanes: ${report.scorecard.summary.competitiveLaneCount}`);
    lines.push(`- Advisory lanes: ${report.scorecard.summary.advisoryLaneCount}`);
    lines.push('');
    lines.push('| Lane | Capability | State | Focus candidate | Runnable | Benchmarked | Blockers |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const lane of report.scorecard.lanes) {
        lines.push(`| \`${lane.lane}\` | ${lane.capability} | \`${lane.state}\` | ${lane.focusCandidateModel ? `\`${lane.focusCandidateModel}\`` : lane.focusCandidateLabel || 'n/a'} | ${lane.runnableCandidates}/${lane.totalCandidates} | ${lane.benchmarkedCandidates}/${lane.totalCandidates} | ${lane.blockers.join('; ') || 'none'} |`);
    }
    lines.push('');
    lines.push('## Candidate verdicts');
    lines.push('');
    lines.push('| Candidate | Runtime | Runtime model | Verdict | Quality | Value | Avg latency | Capability | Contract chamber | Smart Import chamber |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const candidate of report.candidates) {
        lines.push(`| ${candidate.label} | \`${candidate.runtime}\` | ${candidate.runtimeModel ? `\`${candidate.runtimeModel}\`` : 'n/a'} | \`${candidate.verdict}\` | ${formatScore(candidate.economics.qualityScore)} | ${formatScore(candidate.economics.valueScore)} | ${formatLatency(candidate.economics.avgLatencyMs)} | ${candidate.capabilities.summary} | ${candidate.contractChamber.reasons.join('; ')} | ${candidate.smartImportChamber.reasons.join('; ')} |`);
    }
    lines.push('');
    if (report.parliament.untrackedInstalledModels.length > 0) {
        lines.push('## Untracked installed models');
        lines.push('');
        for (const model of report.parliament.untrackedInstalledModels) {
            lines.push(`- \`${model}\``);
        }
        lines.push('');
    }
    if (report.parliament.pruneCommands.length > 0) {
        lines.push('## Prune commands');
        lines.push('');
        for (const command of report.parliament.pruneCommands) {
            lines.push(`- \`${command}\``);
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

export async function runModelParliament(options: {
    registryPath?: string;
    taskCorpusPath?: string;
    smartImportCorpusPath?: string;
    baseUrl?: string;
    mlxBaseUrl?: string;
    iterations?: number;
    dbPath?: string | null;
    dataDir?: string | null;
    keepChallengers?: number;
    protectModels?: string[];
    models?: string[];
    mlxModels?: string[];
    applyPrune?: boolean;
}): Promise<ParliamentReport> {
    const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
    const taskCorpusPath = options.taskCorpusPath || DEFAULT_TASK_CORPUS_PATH;
    const smartImportCorpusPath = options.smartImportCorpusPath || DEFAULT_SMART_IMPORT_CORPUS_PATH;
    const baseUrls = resolveLocalChatBaseUrls({
        baseUrl: options.baseUrl,
        mlxBaseUrl: options.mlxBaseUrl,
    });
    const iterations = Math.max(1, options.iterations || 1);
    const keepChallengers = Math.max(0, options.keepChallengers ?? DEFAULT_KEEP_CHALLENGERS);
    const configuredRuntime = readConfiguredRuntime(resolveDbPath(options.dbPath || null, options.dataDir || null), options.protectModels || []);
    const requestedModels = [
        ...(options.models || []),
        ...(options.mlxModels || []),
    ];

    const generative = await runModelStackBenchmark({
        registryPath,
        corpusPath: taskCorpusPath,
        baseUrl: baseUrls.ollama,
        mlxBaseUrl: baseUrls.mlx,
        iterations,
        models: requestedModels.length > 0 ? requestedModels : undefined,
    });

    const runnableTargets = generative.candidates
        .filter((candidate) => candidate.lane === 'generative'
            && (candidate.runtime === 'ollama_chat' || candidate.runtime === 'mlx_chat')
            && candidate.executionStatus === 'runnable'
            && candidate.benchmark
            && typeof candidate.runtimeModel === 'string'
            && candidate.runtimeModel.length > 0)
        .map((candidate) => ({
            runtime: candidate.runtime as LocalChatTarget['runtime'],
            model: candidate.runtimeModel as string,
        }));

    const smartImport = await runSmartImportBenchmark({
        corpusPath: smartImportCorpusPath,
        baseUrl: baseUrls.ollama,
        mlxBaseUrl: baseUrls.mlx,
        iterations,
        targets: runnableTargets,
    });

    const smartImportByModel = new Map(
        smartImport.models.map((modelReport) => [modelReport.targetKey, modelReport]),
    );
    const configuredProtectedSet = new Set(configuredRuntime.protectedModels);
    const installedTargetKeys = new Set<string>([
        ...generative.benchmarkedTargetKeys,
        ...smartImport.installedTargetKeys,
    ]);
    const installedOllamaTargetKeys = new Set(
        Array.from(installedTargetKeys).filter((targetKey) => targetKey.startsWith('ollama_chat:')),
    );
    const registryTargetKeys = new Set(
        generative.candidates
            .map((candidate) => (
                candidate.runtimeModel && (candidate.runtime === 'ollama_chat' || candidate.runtime === 'mlx_chat')
                    ? buildLocalChatTargetKey({ runtime: candidate.runtime, model: candidate.runtimeModel })
                    : null
            ))
            .filter((value): value is string => Boolean(value)),
    );
    const registryOllamaTargetKeys = new Set(
        Array.from(registryTargetKeys).filter((targetKey) => targetKey.startsWith('ollama_chat:')),
    );

    const strongPassers = generative.candidates
        .filter((candidate) => candidate.lane === 'generative'
            && candidate.runtime === 'ollama_chat'
            && typeof candidate.runtimeModel === 'string'
            && candidate.runtimeModel.length > 0)
        .map((candidate) => {
            const contractChamber = assessContractChamber(candidate);
            const smartImportChamber = assessSmartImportChamber(
                candidate.runtimeModel && (candidate.runtime === 'ollama_chat' || candidate.runtime === 'mlx_chat')
                    ? { runtime: candidate.runtime, model: candidate.runtimeModel }
                    : null,
                smartImportByModel,
            );
            return {
                candidate,
                contractChamber,
                smartImportChamber,
                score: combinedScore(contractChamber, smartImportChamber),
            };
        })
        .filter((entry) => entry.contractChamber.passed && entry.smartImportChamber.passed)
        .sort((left, right) => right.score - left.score);

    const baselineEntry = strongPassers.find((entry) => entry.candidate.runtimeModel === CURRENT_BASELINE_MODEL) || strongPassers[0] || null;
    const challengerEntries = strongPassers
        .filter((entry) => entry !== baselineEntry)
        .slice(0, keepChallengers);
    const provisionalBaselineModel = baselineEntry?.candidate.runtimeModel
        || normalizeModelName(configuredRuntime.activeRoleModels.reasoning)
        || normalizeModelName(configuredRuntime.activeRoleModels.clinical)
        || (generative.decisions.generative.recommendedRuntime === 'ollama_chat'
            ? generative.decisions.generative.recommendedModel
            : null)
        || null;

    const retainedModels = new Set<string>([
        ...configuredRuntime.protectedModels,
        ...(baselineEntry?.candidate.runtimeModel ? [baselineEntry.candidate.runtimeModel] : []),
        ...challengerEntries
            .map((entry) => entry.candidate.runtimeModel)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ]);

    const rawCandidates: CandidateParliamentDecision[] = generative.candidates.map((candidate) => {
        const runtimeModel = candidate.runtimeModel || null;
        const contractChamber = assessContractChamber(candidate);
        const target = runtimeModel && (candidate.runtime === 'ollama_chat' || candidate.runtime === 'mlx_chat')
            ? { runtime: candidate.runtime, model: runtimeModel }
            : null;
        const targetKey = target ? buildLocalChatTargetKey(target) : null;
        const smartImportChamber = assessSmartImportChamber(target, smartImportByModel);
        const capabilities = buildCandidateCapabilities(candidate.lane);
        const reasons = [
            ...contractChamber.reasons,
            ...smartImportChamber.reasons,
        ];

        let verdict: ParliamentVerdict;
        if (candidate.lane !== 'generative') {
            verdict = 'lane_pending';
            reasons.unshift('Lane-specific adapter or benchmark still pending.');
        } else if (candidate.runtime === 'mlx_chat') {
            verdict = 'lane_pending';
            reasons.unshift('MLX stays benchmark-only inside parliament: no default/runtime promotion or prune policy is applied here.');
        } else if (candidate.executionStatus !== 'runnable') {
            verdict = 'blocked';
        } else if (!runtimeModel || !targetKey || !installedTargetKeys.has(targetKey)) {
            verdict = 'missing_runtime';
        } else if (configuredProtectedSet.has(runtimeModel)) {
            verdict = 'protected_active';
            reasons.unshift('Configured active role model is protected from pruning.');
        } else if (baselineEntry?.candidate.runtimeModel === runtimeModel) {
            verdict = 'baseline';
            reasons.unshift('Retained as the current parliament baseline.');
        } else if (challengerEntries.some((entry) => entry.candidate.runtimeModel === runtimeModel)) {
            verdict = 'challenger';
            reasons.unshift('Retained as a benchmarked challenger.');
        } else if (contractChamber.passed && smartImportChamber.passed) {
            verdict = 'prune_redundant';
            reasons.unshift('Strong but redundant once baseline and retained challengers are fixed.');
        } else {
            verdict = 'prune_failed';
            reasons.unshift('Failed at least one chamber threshold.');
        }

        return {
            id: candidate.id,
            label: candidate.label,
            lane: candidate.lane,
            origin: candidate.origin,
            runtime: candidate.runtime,
            runtimeModel,
            executionStatus: candidate.executionStatus,
            registryStatus: candidate.status,
            notes: candidate.notes,
            verdict,
            reasons,
            blockers: candidate.blockers || [],
            contractChamber,
            smartImportChamber,
            capabilities,
            economics: buildCandidateEconomics(candidate, target, contractChamber, smartImportChamber, smartImportByModel),
        };
    });
    const candidates = finalizeCandidateEconomics(rawCandidates);
    const scorecard = buildParliamentScorecard(candidates);

    const untrackedInstalledModels = Array.from(installedOllamaTargetKeys)
        .filter((targetKey) => !registryOllamaTargetKeys.has(targetKey))
        .map((targetKey) => targetKey.replace(/^ollama_chat:/, ''))
        .sort();

    const readiness = baselineEntry ? 'prune_ready' : 'hold';
    const rationale = baselineEntry
        ? baselineEntry.candidate.runtimeModel === CURRENT_BASELINE_MODEL
            ? `The current default \`${CURRENT_BASELINE_MODEL}\` passed both chambers, so the parliament keeps it as baseline and limits retention to protected active roles plus the top ${keepChallengers} challenger(s).`
            : `The current default did not produce a stronger result than the available passers, so the parliament recommends \`${baselineEntry.candidate.runtimeModel}\` as the next baseline candidate while still keeping active-role models protected until a separate settings/default migration happens.`
        : `No model passed both the shared-contract chamber and the Smart Import chamber, so pruning is held and the output stays advisory only. Keep \`${provisionalBaselineModel || CURRENT_BASELINE_MODEL}\` as the protected provisional baseline until Smart Import thresholds are met.`;

    const recommendedPruneModels = readiness === 'prune_ready'
        ? candidates
            .filter((candidate) => (candidate.verdict === 'prune_failed' || candidate.verdict === 'prune_redundant')
                && candidate.runtime === 'ollama_chat'
                && candidate.runtimeModel
                && installedTargetKeys.has(buildLocalChatTargetKey({ runtime: 'ollama_chat', model: candidate.runtimeModel }))
                && !retainedModels.has(candidate.runtimeModel))
            .map((candidate) => candidate.runtimeModel as string)
            .sort()
        : [];

    const pruneResults = options.applyPrune ? applyPruneModels(recommendedPruneModels) : [];

    return {
        generatedAt: new Date().toISOString(),
        baseUrl: baseUrls.ollama,
        mlxBaseUrl: baseUrls.mlx,
        registryPath,
        taskCorpusPath,
        smartImportCorpusPath,
        iterations,
        schemaVersion: generative.schemaVersion,
        configuredRuntime,
        chambers: {
            generative,
            smartImport,
        },
        parliament: {
            readiness,
            baselineModel: provisionalBaselineModel,
            challengerModels: challengerEntries
                .map((entry) => entry.candidate.runtimeModel)
                .filter((value): value is string => typeof value === 'string' && value.length > 0),
            rationale,
            protectedModels: Array.from(retainedModels).sort(),
            recommendedPruneModels,
            untrackedInstalledModels,
            pruneCommands: recommendedPruneModels.map((model) => buildPruneCommand(model)),
            pruneApplied: Boolean(options.applyPrune),
            pruneResults,
        },
        candidates,
        scorecard,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const defaultArtifacts = getAiModelParliamentArtifactPaths();
    const report = await runModelParliament({
        registryPath: args.registry,
        taskCorpusPath: args.taskCorpus,
        smartImportCorpusPath: args.smartImportCorpus,
        baseUrl: args.baseUrl,
        mlxBaseUrl: args.mlxBaseUrl,
        iterations: args.iterations,
        dbPath: args.dbPath,
        dataDir: args.dataDir,
        keepChallengers: args.keepChallengers,
        protectModels: args.protectModels,
        models: args.models || undefined,
        mlxModels: args.mlxModels || undefined,
        applyPrune: args.applyPrune,
    });

    const output = JSON.stringify(report, null, 2);
    const jsonOutPath = args.out || defaultArtifacts.jsonPath;
    ensureAiModelParliamentArtifactDirectory();
    fs.mkdirSync(path.dirname(jsonOutPath), { recursive: true });
    fs.writeFileSync(jsonOutPath, output, 'utf8');

    const markdown = buildMarkdown(report);
    const markdownOutPath = args.markdownOut || defaultArtifacts.markdownPath;
    fs.mkdirSync(path.dirname(markdownOutPath), { recursive: true });
    fs.writeFileSync(markdownOutPath, markdown, 'utf8');

    process.stdout.write(`${output}\n`);
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
