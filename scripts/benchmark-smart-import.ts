#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeOllamaBaseUrl } from './ollama-base-url';
import {
    buildSmartImportExtractionPrompt,
    parseSmartImportExtractionResponse,
    type SmartImportDiagnosisExtraction,
    type SmartImportTherapyExtraction,
} from '../lib/ai-task-contracts';

type ExpectedDiagnosis = {
    labelTokens: string[];
    icdQueryTokens?: string[];
};

type ExpectedTherapy = {
    drugTokens: string[];
    dosageTokens?: string[];
    therapyState?: 'active' | 'transition' | 'uncertain' | 'inactive';
};

type SmartImportBenchmarkEntry = {
    id: string;
    payload: Record<string, unknown>;
    expected: {
        diagnoses?: ExpectedDiagnosis[];
        therapies?: ExpectedTherapy[];
        forbiddenDiagnosisTokens?: string[][];
        forbiddenTherapyTokens?: string[][];
    };
    maxTokens?: number;
};

type CaseResult = {
    id: string;
    iteration: number;
    latencyMs: number;
    validJson: boolean;
    validTask: boolean;
    diagnosisRecall: number;
    diagnosisQueryRecall: number;
    therapyRecall: number;
    dosageRecall: number;
    therapyStateRecall: number;
    sourceIdRate: number;
    forbiddenLeakCount: number;
    error?: string;
};

type ModelReport = {
    model: string;
    status: 'completed' | 'missing' | 'error';
    metrics?: {
        jsonValidRate: number;
        contractValidRate: number;
        diagnosisRecall: number;
        diagnosisQueryRecall: number;
        therapyRecall: number;
        dosageRecall: number;
        therapyStateRecall: number;
        sourceIdRate: number;
        forbiddenLeakRate: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
    };
    cases?: CaseResult[];
    error?: string;
};

export type SmartImportBenchmarkReport = {
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
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'smart-import-benchmark-corpus.json');
const DEFAULT_TARGET_MODELS = ['qwen3.5:35b-a3b', 'qwen3:32b'] as const;

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        out: null as string | null,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        iterations: 1,
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

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function includesAllTokens(text: string, tokens: string[] | undefined): boolean {
    if (!tokens || tokens.length === 0) return true;
    const haystack = normalizeText(text);
    return tokens.every((token) => haystack.includes(normalizeText(token)));
}

function toRate(numerator: number, denominator: number): number {
    if (denominator === 0) return 1;
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

function readCorpus(filePath: string): SmartImportBenchmarkEntry[] {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SmartImportBenchmarkEntry[];
}

async function listInstalledModels(baseUrl: string): Promise<string[]> {
    const normalizedBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    try {
        const response = await fetch(`${normalizedBaseUrl}/api/tags`);
        if (!response.ok) return [];
        const payload = await response.json() as { models?: Array<{ name?: string }> };
        return Array.isArray(payload.models)
            ? payload.models.map((model) => model.name || '').filter(Boolean)
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
                temperature: 0.2,
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
        latencyMs,
        content: payload.message?.content || payload.choices?.[0]?.message?.content || '',
    };
}

function findDiagnosisMatch(
    diagnoses: SmartImportDiagnosisExtraction[],
    expected: ExpectedDiagnosis
) {
    return diagnoses.find((diagnosis) => includesAllTokens(diagnosis.label, expected.labelTokens));
}

function findTherapyMatch(
    therapies: SmartImportTherapyExtraction[],
    expected: ExpectedTherapy
) {
    return therapies.find((therapy) => {
        const probe = [therapy.drugMention, therapy.activePrinciple, therapy.drugQuery].filter(Boolean).join(' ');
        return includesAllTokens(probe, expected.drugTokens);
    });
}

function scoreCase(entry: SmartImportBenchmarkEntry, parsed: ReturnType<typeof parseSmartImportExtractionResponse>): Omit<CaseResult, 'id' | 'iteration' | 'latencyMs' | 'validJson' | 'validTask' | 'error'> {
    const diagnoses = parsed.value.data.diagnoses;
    const therapies = parsed.value.data.therapies;
    const allowedSourceIds = new Set(
        Array.isArray(entry.payload.sources)
            ? entry.payload.sources
                .map((source) => (source && typeof source === 'object' ? (source as { id?: unknown }).id : undefined))
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
            : [],
    );

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
    const validSourceIdCount = suggestions.filter((suggestion) => {
        const sourceId = 'sourceId' in suggestion ? suggestion.sourceId : undefined;
        return typeof sourceId === 'string' && allowedSourceIds.has(sourceId);
    }).length;

    const forbiddenDiagnosisHits = (entry.expected.forbiddenDiagnosisTokens || []).filter((tokens) => (
        diagnoses.some((diagnosis) => includesAllTokens([diagnosis.label, diagnosis.icdQuery].join(' '), tokens))
    )).length;
    const forbiddenTherapyHits = (entry.expected.forbiddenTherapyTokens || []).filter((tokens) => (
        therapies.some((therapy) => includesAllTokens([therapy.drugMention, therapy.activePrinciple, therapy.drugQuery].join(' '), tokens))
    )).length;

    return {
        diagnosisRecall: toRate(diagnosisHits, expectedDiagnoses.length),
        diagnosisQueryRecall: toRate(diagnosisQueryHits, expectedDiagnoses.length),
        therapyRecall: toRate(therapyHits, expectedTherapies.length),
        dosageRecall: toRate(dosageHits, dosageTargets.length),
        therapyStateRecall: toRate(therapyStateHits, therapyStateTargets.length),
        sourceIdRate: toRate(validSourceIdCount, suggestions.length),
        forbiddenLeakCount: forbiddenDiagnosisHits + forbiddenTherapyHits,
    };
}

async function runModel(baseUrl: string, model: string, corpus: SmartImportBenchmarkEntry[], iterations: number, installedModels: string[]): Promise<ModelReport> {
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
                const prompt = buildSmartImportExtractionPrompt(entry.payload);

                try {
                    const completion = await generateCompletion(baseUrl, model, prompt, entry.maxTokens ?? 1100);
                    const parsed = parseSmartImportExtractionResponse(completion.content);
                    const scored = scoreCase(entry, parsed);

                    cases.push({
                        id: entry.id,
                        iteration,
                        latencyMs: completion.latencyMs,
                        validJson: parsed.validJson,
                        validTask: parsed.validTask,
                        ...scored,
                    });
                } catch (error) {
                    cases.push({
                        id: entry.id,
                        iteration,
                        latencyMs: 0,
                        validJson: false,
                        validTask: false,
                        diagnosisRecall: 0,
                        diagnosisQueryRecall: 0,
                        therapyRecall: 0,
                        dosageRecall: 0,
                        therapyStateRecall: 0,
                        sourceIdRate: 0,
                        forbiddenLeakCount: 0,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        const latencies = cases.map((entry) => entry.latencyMs).filter((value) => value > 0);
        const forbiddenTotal = cases.reduce((sum, entry) => sum + entry.forbiddenLeakCount, 0);

        return {
            model,
            status: 'completed',
            cases,
            metrics: {
                jsonValidRate: toRate(cases.filter((entry) => entry.validJson).length, cases.length),
                contractValidRate: toRate(cases.filter((entry) => entry.validTask).length, cases.length),
                diagnosisRecall: average(cases.map((entry) => entry.diagnosisRecall)),
                diagnosisQueryRecall: average(cases.map((entry) => entry.diagnosisQueryRecall)),
                therapyRecall: average(cases.map((entry) => entry.therapyRecall)),
                dosageRecall: average(cases.map((entry) => entry.dosageRecall)),
                therapyStateRecall: average(cases.map((entry) => entry.therapyStateRecall)),
                sourceIdRate: average(cases.map((entry) => entry.sourceIdRate)),
                forbiddenLeakRate: Number((forbiddenTotal / Math.max(1, cases.length)).toFixed(3)),
                avgLatencyMs: average(latencies),
                p95LatencyMs: percentile(latencies, 0.95),
            },
        };
    } catch (error) {
        return {
            model,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function chooseRecommendation(models: ModelReport[]) {
    const completed = models.filter((entry): entry is ModelReport & { metrics: NonNullable<ModelReport['metrics']> } => entry.status === 'completed' && Boolean(entry.metrics));
    if (completed.length === 0) {
        return {
            recommendedModel: null,
            rationale: 'No completed smart import benchmark runs were available.',
        };
    }

    const ranked = [...completed].sort((left, right) => {
        const leftScore = left.metrics.contractValidRate + left.metrics.diagnosisRecall + left.metrics.diagnosisQueryRecall + left.metrics.therapyRecall + left.metrics.dosageRecall + left.metrics.therapyStateRecall + left.metrics.sourceIdRate - left.metrics.forbiddenLeakRate;
        const rightScore = right.metrics.contractValidRate + right.metrics.diagnosisRecall + right.metrics.diagnosisQueryRecall + right.metrics.therapyRecall + right.metrics.dosageRecall + right.metrics.therapyStateRecall + right.metrics.sourceIdRate - right.metrics.forbiddenLeakRate;

        if (rightScore !== leftScore) return rightScore - leftScore;
        return left.metrics.avgLatencyMs - right.metrics.avgLatencyMs;
    });

    return {
        recommendedModel: ranked[0].model,
        rationale: 'Chosen for the best combined contract validity, diagnosis/query recall, therapy/dosage recall, source tracing, and lowest forbidden leakage.',
    };
}

export async function runSmartImportBenchmark(options: {
    corpusPath?: string;
    baseUrl?: string;
    iterations?: number;
    models?: string[];
}): Promise<SmartImportBenchmarkReport> {
    const corpusPath = options.corpusPath || DEFAULT_CORPUS_PATH;
    const baseUrl = normalizeOllamaBaseUrl(options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434');
    const iterations = Math.max(1, options.iterations || 1);
    const targetModels = options.models && options.models.length > 0
        ? options.models
        : [...DEFAULT_TARGET_MODELS];

    const corpus = readCorpus(corpusPath);
    const installedModels = await listInstalledModels(baseUrl);
    const models = [];

    for (const model of targetModels) {
        models.push(await runModel(baseUrl, model, corpus, iterations, installedModels));
    }

    return {
        generatedAt: new Date().toISOString(),
        baseUrl,
        corpusPath,
        corpusSize: corpus.length,
        iterations,
        installedModels,
        targetModels,
        models,
        decision: chooseRecommendation(models),
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const report = await runSmartImportBenchmark({
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
