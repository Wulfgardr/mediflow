#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeOllamaBaseUrl } from './ollama-base-url.ts';
import {
    runAiTaskContractBenchmark,
    type AiTaskContractBenchmarkReport,
} from './benchmark-ai-task-contracts.ts';

type CandidateLane = 'generative' | 'pii' | 'clinical_entities' | 'embedding';
type CandidateOrigin = 'current_stack' | 'report';
type CandidateRuntime =
    | 'ollama_chat'
    | 'external_chat_runtime'
    | 'transformers_token_classification'
    | 'transformers_encoder';
type CandidateExecutionStatus =
    | 'runnable'
    | 'integration_required'
    | 'license_blocked'
    | 'gated_access';

type CandidateRegistry = {
    schemaVersion: 'mediflow.ai.model-stack-candidates.v1';
    candidates: ModelStackCandidate[];
};

type ModelStackCandidate = {
    id: string;
    label: string;
    lane: CandidateLane;
    origin: CandidateOrigin;
    runtime: CandidateRuntime;
    runtimeModel?: string;
    executionStatus: CandidateExecutionStatus;
    blockers?: string[];
    notes: string;
};

type CandidateEvaluationStatus = 'benchmarked' | 'missing_runtime' | 'blocked' | 'error';

type CandidateReport = ModelStackCandidate & {
    status: CandidateEvaluationStatus;
    stopRule: string;
    benchmark?: AiTaskContractBenchmarkReport['models'][number];
};

type StackBenchmarkReport = {
    generatedAt: string;
    registryPath: string;
    corpusPath: string;
    baseUrl: string;
    iterations: number;
    schemaVersion: CandidateRegistry['schemaVersion'];
    benchmarkedRuntimeModels: string[];
    summary: {
        totalCandidates: number;
        benchmarked: number;
        blocked: number;
        missingRuntime: number;
        errors: number;
    };
    decisions: {
        generative: {
            recommendedCandidateId: string | null;
            recommendedModel: string | null;
            rationale: string;
        };
    };
    candidates: CandidateReport[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'fixtures', 'ai-model-stack-candidates.json');
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'ai-task-contract-corpus.json');

function parseArgs(argv: string[]) {
    const args = {
        registry: DEFAULT_REGISTRY_PATH,
        corpus: DEFAULT_CORPUS_PATH,
        out: null as string | null,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        iterations: 1,
        models: null as string[] | null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--registry' && argv[index + 1]) {
            args.registry = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--corpus' && argv[index + 1]) {
            args.corpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--base-url' && argv[index + 1]) {
            args.baseUrl = argv[index + 1];
            index += 1;
        } else if (value === '--iterations' && argv[index + 1]) {
            args.iterations = Math.max(1, Number.parseInt(argv[index + 1], 10) || 1);
            index += 1;
        } else if (value === '--models' && argv[index + 1]) {
            args.models = argv[index + 1]
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
            index += 1;
        }
    }

    return args;
}

function readRegistry(registryPath: string): CandidateRegistry {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8')) as CandidateRegistry;
}

function buildStopRule(candidate: ModelStackCandidate): string {
    if (candidate.lane === 'generative') {
        return 'Promote only if contractValidRate >= 0.95, jsonValidRate >= 0.95, and no task falls below 0.90 on the shared synthetic corpus.';
    }

    if (candidate.lane === 'clinical_entities' || candidate.lane === 'pii') {
        return 'Do not integrate before a dedicated local adapter and a lane-specific benchmark exist.';
    }

    return 'Do not integrate before license/runtime fit is clear and the usage is narrowed to a local encoder lane.';
}

function summarizeCandidates(candidates: CandidateReport[]) {
    return {
        totalCandidates: candidates.length,
        benchmarked: candidates.filter((candidate) => candidate.status === 'benchmarked').length,
        blocked: candidates.filter((candidate) => candidate.status === 'blocked').length,
        missingRuntime: candidates.filter((candidate) => candidate.status === 'missing_runtime').length,
        errors: candidates.filter((candidate) => candidate.status === 'error').length,
    };
}

export async function runModelStackBenchmark(options: {
    registryPath?: string;
    corpusPath?: string;
    baseUrl?: string;
    iterations?: number;
    models?: string[];
}): Promise<StackBenchmarkReport> {
    const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
    const corpusPath = options.corpusPath || DEFAULT_CORPUS_PATH;
    const baseUrl = normalizeOllamaBaseUrl(options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    const iterations = Math.max(1, options.iterations || 1);

    const registry = readRegistry(registryPath);
    const allowedModels = options.models && options.models.length > 0
        ? new Set(options.models)
        : null;
    const runnableGenerativeCandidates = registry.candidates.filter((candidate) =>
        candidate.lane === 'generative'
        && candidate.runtime === 'ollama_chat'
        && candidate.executionStatus === 'runnable'
        && typeof candidate.runtimeModel === 'string'
        && candidate.runtimeModel.length > 0
        && (!allowedModels || allowedModels.has(candidate.runtimeModel))
    );

    const benchmarkReport = runnableGenerativeCandidates.length > 0
        ? await runAiTaskContractBenchmark({
            corpusPath,
            baseUrl,
            iterations,
            models: runnableGenerativeCandidates
                .map((candidate) => candidate.runtimeModel)
                .filter((model): model is string => typeof model === 'string' && model.length > 0),
        })
        : null;

    const benchmarkByModel = new Map(
        (benchmarkReport?.models || []).map((report) => [report.model, report]),
    );

    const candidates: CandidateReport[] = registry.candidates.map((candidate) => {
        const benchmark = candidate.runtimeModel
            ? benchmarkByModel.get(candidate.runtimeModel)
            : undefined;

        if (benchmark) {
            return {
                ...candidate,
                status:
                    benchmark.status === 'completed'
                        ? 'benchmarked'
                        : benchmark.status === 'missing'
                            ? 'missing_runtime'
                            : 'error',
                stopRule: buildStopRule(candidate),
                benchmark,
            };
        }

        return {
            ...candidate,
            status: candidate.executionStatus === 'runnable' ? 'missing_runtime' : 'blocked',
            stopRule: buildStopRule(candidate),
        };
    });

    const recommendedModel = benchmarkReport?.decision.recommendedModel || null;
    const recommendedCandidate = recommendedModel
        ? candidates.find((candidate) => candidate.runtimeModel === recommendedModel) || null
        : null;

    return {
        generatedAt: new Date().toISOString(),
        registryPath,
        corpusPath,
        baseUrl,
        iterations,
        schemaVersion: registry.schemaVersion,
        benchmarkedRuntimeModels: benchmarkReport?.targetModels || [],
        summary: summarizeCandidates(candidates),
        decisions: {
            generative: {
                recommendedCandidateId: recommendedCandidate?.id || null,
                recommendedModel,
                rationale: benchmarkReport?.decision.rationale || 'No runnable generative candidate completed the benchmark.',
            },
        },
        candidates,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const report = await runModelStackBenchmark({
        registryPath: args.registry,
        corpusPath: args.corpus,
        baseUrl: args.baseUrl,
        iterations: args.iterations,
        models: args.models || undefined,
    });

    const output = JSON.stringify(report, null, 2);
    if (args.out) {
        fs.mkdirSync(path.dirname(args.out), { recursive: true });
        fs.writeFileSync(args.out, output, 'utf8');
    }

    console.log(output);
}

const isMainModule = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false;

if (isMainModule) {
    void main();
}
