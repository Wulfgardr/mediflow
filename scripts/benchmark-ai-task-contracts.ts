#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeOllamaBaseUrl } from './ollama-base-url';
import {
    buildDocumentSynthesisExtractionPrompt,
    buildPatientInsightExtractionPrompt,
    buildSmartImportExtractionPrompt,
    parseDocumentSynthesisExtractionResponse,
    parsePatientInsightExtractionResponse,
    parseSmartImportExtractionResponse,
} from '../lib/ai-task-contracts';

type BenchmarkTask = 'patient_insight' | 'smart_import' | 'document_synthesis';

type CorpusEntry =
    | {
        id: string;
        task: 'patient_insight';
        context: string;
        maxTokens?: number;
    }
    | {
        id: string;
        task: 'smart_import';
        payload: Record<string, unknown>;
        maxTokens?: number;
    }
    | {
        id: string;
        task: 'document_synthesis';
        rawText: string;
        maxTokens?: number;
    };

type CaseResult = {
    id: string;
    task: BenchmarkTask;
    iteration: number;
    latencyMs: number;
    validJson: boolean;
    validTask: boolean;
    error?: string;
};

type ModelReport = {
    model: string;
    status: 'completed' | 'missing' | 'error';
    metrics?: {
        jsonValidRate: number;
        contractValidRate: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
    };
    tasks?: Record<BenchmarkTask, {
        jsonValidRate: number;
        contractValidRate: number;
        avgLatencyMs: number;
    }>;
    cases?: CaseResult[];
    error?: string;
};

export type AiTaskContractBenchmarkReport = {
    generatedAt: string;
    baseUrl: string;
    corpusPath: string;
    corpusSize: number;
    iterations: number;
    installedModels: string[];
    targetModels: string[];
    models: ModelReport[];
    decision: {
        recommendedModel: string | null;
        rationale: string;
    };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'ai-task-contract-corpus.json');
const DEFAULT_TARGET_MODELS = ['qwen2.5:32b', 'qwen3:32b'] as const;

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        out: null as string | null,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        iterations: 1,
        validate: false,
        minContractRate: 1,
        maxLatencyMs: null as number | null,
        models: null as string[] | null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--corpus' && argv[index + 1]) {
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
        } else if (value === '--validate') {
            args.validate = true;
        } else if (value === '--min-contract-rate' && argv[index + 1]) {
            args.minContractRate = Number.parseFloat(argv[index + 1]) || 1;
            index += 1;
        } else if (value === '--max-latency-ms' && argv[index + 1]) {
            args.maxLatencyMs = Number.parseFloat(argv[index + 1]) || null;
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

function readCorpus(filePath: string): CorpusEntry[] {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CorpusEntry[];
}

function buildPrompt(entry: CorpusEntry) {
    if (entry.task === 'patient_insight') {
        return {
            prompt: buildPatientInsightExtractionPrompt(entry.context),
            maxTokens: entry.maxTokens ?? 900,
            parse: (content: string) => parsePatientInsightExtractionResponse(content),
        };
    }

    if (entry.task === 'smart_import') {
        return {
            prompt: buildSmartImportExtractionPrompt(entry.payload),
            maxTokens: entry.maxTokens ?? 1400,
            parse: (content: string) => parseSmartImportExtractionResponse(content),
        };
    }

    return {
        prompt: buildDocumentSynthesisExtractionPrompt(entry.rawText),
        maxTokens: entry.maxTokens ?? 1100,
        parse: (content: string) => parseDocumentSynthesisExtractionResponse(content, entry.rawText),
    };
}

async function listInstalledModels(baseUrl: string): Promise<string[]> {
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    try {
        const response = await fetch(`${normalizedBaseUrl}/api/tags`);
        if (!response.ok) return [];
        const payload = await response.json() as { models?: Array<{ name?: string }> };
        return Array.isArray(payload.models)
            ? payload.models
                .map((model) => (typeof model?.name === 'string' ? model.name : ''))
                .filter(Boolean)
            : [];
    } catch {
        return [];
    }
}

async function generateCompletion(baseUrl: string, model: string, prompt: string, maxTokens: number) {
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
                temperature: 0.4,
                num_predict: maxTokens,
            },
        }),
    });

    const latencyMs = Number((performance.now() - start).toFixed(1));

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as {
        message?: { content?: string };
        choices?: Array<{ message?: { content?: string } }>;
    };

    return {
        content: payload.message?.content || payload.choices?.[0]?.message?.content || '',
        latencyMs,
    };
}

function toRate(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return Number((numerator / denominator).toFixed(3));
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return Number(sorted[index].toFixed(1));
}

function buildTaskMetrics(cases: CaseResult[], task: BenchmarkTask) {
    const filtered = cases.filter((entry) => entry.task === task);
    const latencies = filtered.map((entry) => entry.latencyMs);

    return {
        jsonValidRate: toRate(filtered.filter((entry) => entry.validJson).length, filtered.length),
        contractValidRate: toRate(filtered.filter((entry) => entry.validTask).length, filtered.length),
        avgLatencyMs: average(latencies),
    };
}

async function runModel(baseUrl: string, model: string, corpus: CorpusEntry[], iterations: number, installedModels: string[]): Promise<ModelReport> {
    if (!installedModels.includes(model)) {
        return {
            model,
            status: 'missing',
            error: 'Model not installed in local Ollama runtime.',
        };
    }

    const cases: CaseResult[] = [];

    try {
        for (let iteration = 1; iteration <= iterations; iteration += 1) {
            for (const entry of corpus) {
                const { prompt, maxTokens, parse } = buildPrompt(entry);

                try {
                    const completion = await generateCompletion(baseUrl, model, prompt, maxTokens);
                    const parsed = parse(completion.content);

                    cases.push({
                        id: entry.id,
                        task: entry.task,
                        iteration,
                        latencyMs: completion.latencyMs,
                        validJson: parsed.validJson,
                        validTask: parsed.validTask,
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unknown model error';
                    cases.push({
                        id: entry.id,
                        task: entry.task,
                        iteration,
                        latencyMs: 0,
                        validJson: false,
                        validTask: false,
                        error: message,
                    });
                }
            }
        }

        const latencies = cases.map((entry) => entry.latencyMs).filter((value) => value > 0);

        return {
            model,
            status: 'completed',
            metrics: {
                jsonValidRate: toRate(cases.filter((entry) => entry.validJson).length, cases.length),
                contractValidRate: toRate(cases.filter((entry) => entry.validTask).length, cases.length),
                avgLatencyMs: average(latencies),
                p95LatencyMs: percentile(latencies, 0.95),
            },
            tasks: {
                patient_insight: buildTaskMetrics(cases, 'patient_insight'),
                smart_import: buildTaskMetrics(cases, 'smart_import'),
                document_synthesis: buildTaskMetrics(cases, 'document_synthesis'),
            },
            cases,
        };
    } catch (error) {
        return {
            model,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown benchmark error',
            cases,
        };
    }
}

function buildDecision(models: ModelReport[]) {
    const completed = models.filter((report) => report.status === 'completed' && report.metrics);
    if (completed.length === 0) {
        return {
            recommendedModel: null,
            rationale: 'No target model completed the benchmark run.',
        };
    }

    const best = [...completed].sort((left, right) => {
        const contractDelta = (right.metrics?.contractValidRate || 0) - (left.metrics?.contractValidRate || 0);
        if (contractDelta !== 0) return contractDelta;
        const jsonDelta = (right.metrics?.jsonValidRate || 0) - (left.metrics?.jsonValidRate || 0);
        if (jsonDelta !== 0) return jsonDelta;
        return (left.metrics?.avgLatencyMs || Number.MAX_SAFE_INTEGER) - (right.metrics?.avgLatencyMs || Number.MAX_SAFE_INTEGER);
    })[0];

    return {
        recommendedModel: best.model,
        rationale: `Highest contract-valid rate, then JSON-valid rate, then lowest average latency among the target models.`,
    };
}

function validateReport(models: ModelReport[], minContractRate: number, maxLatencyMs: number | null) {
    const failures: string[] = [];

    for (const report of models) {
        if (report.status !== 'completed' || !report.metrics) {
            failures.push(`${report.model}: benchmark not completed (${report.status}).`);
            continue;
        }

        if (report.metrics.contractValidRate < minContractRate) {
            failures.push(`${report.model}: contract-valid rate ${report.metrics.contractValidRate} < ${minContractRate}.`);
        }

        if (typeof maxLatencyMs === 'number' && report.metrics.avgLatencyMs > maxLatencyMs) {
            failures.push(`${report.model}: avg latency ${report.metrics.avgLatencyMs}ms > ${maxLatencyMs}ms.`);
        }
    }

    return failures;
}

export async function runAiTaskContractBenchmark(options: {
    corpusPath?: string;
    baseUrl?: string;
    iterations?: number;
    models?: string[];
}): Promise<AiTaskContractBenchmarkReport> {
    const corpusPath = options.corpusPath || DEFAULT_CORPUS_PATH;
    const baseUrl = normalizeOllamaBaseUrl(options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    const iterations = Math.max(1, options.iterations || 1);
    const targetModels = options.models && options.models.length > 0
        ? options.models
        : [...DEFAULT_TARGET_MODELS];

    const corpus = readCorpus(corpusPath);
    const installedModels = await listInstalledModels(baseUrl);
    const modelReports: ModelReport[] = [];
    for (const model of targetModels) {
        modelReports.push(await runModel(baseUrl, model, corpus, iterations, installedModels));
    }

    return {
        generatedAt: new Date().toISOString(),
        baseUrl,
        corpusPath,
        corpusSize: corpus.length,
        iterations,
        installedModels,
        targetModels,
        models: modelReports,
        decision: buildDecision(modelReports),
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const report = await runAiTaskContractBenchmark({
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

    if (args.validate) {
        const failures = validateReport(report.models, args.minContractRate, args.maxLatencyMs);
        if (failures.length > 0) {
            console.error('\nValidation failed:');
            for (const failure of failures) {
                console.error(`- ${failure}`);
            }
            process.exitCode = 1;
        }
    }
}

const isMainModule = process.argv[1]
    ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
    : false;

if (isMainModule) {
    void main();
}
