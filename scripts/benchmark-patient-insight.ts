#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeOllamaBaseUrl } from './ollama-base-url.ts';
import {
    buildPatientInsightExtractionPrompt,
    parsePatientInsightExtractionResponse,
    type PatientInsightExtractionData,
} from '../lib/ai-task-contracts.ts';

type PatientInsightBenchmarkEntry = {
    id: string;
    context: string;
    expected: {
        currentStateAny?: string[][];
        alertsAny?: string[][];
        nextStepsAny?: string[][];
        gapsAny?: string[][];
        preferredSourceIds?: string[];
        forbiddenSourceIds?: string[];
        forbiddenTokens?: string[][];
        maxIncompleteClaims?: number;
    };
    maxTokens?: number;
};

type CaseResult = {
    id: string;
    iteration: number;
    latencyMs: number;
    validJson: boolean;
    validTask: boolean;
    currentStateRecall: number;
    alertsRecall: number;
    nextStepsRecall: number;
    gapsRecall: number;
    focusRecall: number;
    citationCoverageRate: number;
    supportedClaimRate: number;
    preferredSourceCoverage: number;
    incompleteClaimRate: number;
    forbiddenLeakCount: number;
    forbiddenSourceLeakCount: number;
    moralizingLeakCount: number;
    incompleteClaimCount: number;
    incompleteBudgetExceeded: boolean;
    citedSourceIds: string[];
    output: PatientInsightExtractionData;
    error?: string;
};

type ModelReport = {
    model: string;
    status: 'completed' | 'missing' | 'error';
    metrics?: {
        jsonValidRate: number;
        contractValidRate: number;
        currentStateRecall: number;
        alertsRecall: number;
        nextStepsRecall: number;
        gapsRecall: number;
        focusRecall: number;
        citationCoverageRate: number;
        supportedClaimRate: number;
        preferredSourceCoverage: number;
        incompleteClaimRate: number;
        forbiddenLeakRate: number;
        forbiddenSourceLeakRate: number;
        moralizingLeakRate: number;
        incompleteBudgetFailureRate: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
    };
    cases?: CaseResult[];
    error?: string;
};

export type PatientInsightBenchmarkReport = {
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
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'patient-insight-benchmark-corpus.json');
const DEFAULT_TARGET_MODELS = ['qwen3.5:35b-a3b', 'qwen3:32b'] as const;
const MORALIZING_TOKEN_GROUPS = [
    ['fragilita'],
    ['pericoloso'],
    ['complesso'],
    ['elevato', 'rischio'],
    ['scarsa', 'compliance'],
    ['non', 'compliant'],
    ['poco', 'collaborante'],
] as const;

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        out: null as string | null,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
        iterations: 1,
        models: null as string[] | null,
        validate: false,
        minContractRate: 0.95,
        minFocusRecall: 0.75,
        minCitationRate: 0.95,
        minPreferredSourceCoverage: 0.6,
        maxForbiddenLeakRate: 0.1,
        maxForbiddenSourceLeakRate: 0.05,
        maxMoralizingRate: 0,
        maxIncompleteClaimRate: 0.35,
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
        } else if (value === '--validate') {
            args.validate = true;
        } else if (value === '--min-contract-rate' && argv[index + 1]) {
            args.minContractRate = Number.parseFloat(argv[index + 1]) || args.minContractRate;
            index += 1;
        } else if (value === '--min-focus-recall' && argv[index + 1]) {
            args.minFocusRecall = Number.parseFloat(argv[index + 1]) || args.minFocusRecall;
            index += 1;
        } else if (value === '--min-citation-rate' && argv[index + 1]) {
            args.minCitationRate = Number.parseFloat(argv[index + 1]) || args.minCitationRate;
            index += 1;
        } else if (value === '--min-preferred-source-coverage' && argv[index + 1]) {
            args.minPreferredSourceCoverage = Number.parseFloat(argv[index + 1]) || args.minPreferredSourceCoverage;
            index += 1;
        } else if (value === '--max-forbidden-leak-rate' && argv[index + 1]) {
            args.maxForbiddenLeakRate = Number.parseFloat(argv[index + 1]) || args.maxForbiddenLeakRate;
            index += 1;
        } else if (value === '--max-forbidden-source-leak-rate' && argv[index + 1]) {
            args.maxForbiddenSourceLeakRate = Number.parseFloat(argv[index + 1]) || args.maxForbiddenSourceLeakRate;
            index += 1;
        } else if (value === '--max-moralizing-rate' && argv[index + 1]) {
            args.maxMoralizingRate = Number.parseFloat(argv[index + 1]) || args.maxMoralizingRate;
            index += 1;
        } else if (value === '--max-incomplete-claim-rate' && argv[index + 1]) {
            args.maxIncompleteClaimRate = Number.parseFloat(argv[index + 1]) || args.maxIncompleteClaimRate;
            index += 1;
        }
    }

    return args;
}

function readCorpus(filePath: string): PatientInsightBenchmarkEntry[] {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PatientInsightBenchmarkEntry[];
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

function toRate(numerator: number, denominator: number): number {
    if (denominator === 0) return 1;
    return Number((numerator / denominator).toFixed(3));
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return Number(sorted[index].toFixed(1));
}

function extractSourceIds(text: string): string[] {
    return Array.from(
        new Set(Array.from(text.matchAll(/\bS\d+\b/g), (match) => match[0])),
    );
}

function hasSourceCitation(text: string): boolean {
    return /\bS\d+\b/.test(text);
}

function hasCitationOrGapMarker(text: string): boolean {
    return hasSourceCitation(text) || text.includes('[DATI-INCOMPLETI]');
}

function scoreExpectedGroups(claims: string[], expectedGroups: string[][] | undefined): number {
    if (!expectedGroups || expectedGroups.length === 0) return 1;
    const strippedClaims = claims.map((claim) => stripMarkers(claim));
    const hits = expectedGroups.filter((tokens) => strippedClaims.some((claim) => includesAllTokens(claim, tokens))).length;
    return toRate(hits, expectedGroups.length);
}

function scoreCase(
    entry: PatientInsightBenchmarkEntry,
    output: PatientInsightExtractionData,
): Omit<CaseResult, 'id' | 'iteration' | 'latencyMs' | 'validJson' | 'validTask' | 'error'> {
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
        claims.some((claim) => includesAllTokens(stripMarkers(claim), [...tokens]))
    )).length;
    const incompleteClaimCount = claims.filter((claim) => claim.includes('[DATI-INCOMPLETI]')).length;

    const currentStateRecall = scoreExpectedGroups(output.currentState, entry.expected.currentStateAny);
    const alertsRecall = scoreExpectedGroups(output.alerts, entry.expected.alertsAny);
    const nextStepsRecall = scoreExpectedGroups(output.nextSteps, entry.expected.nextStepsAny);
    const gapsRecall = scoreExpectedGroups(output.gaps, entry.expected.gapsAny);

    return {
        currentStateRecall,
        alertsRecall,
        nextStepsRecall,
        gapsRecall,
        focusRecall: average([currentStateRecall, nextStepsRecall]),
        citationCoverageRate: toRate(claims.filter((claim) => hasCitationOrGapMarker(claim)).length, claims.length),
        supportedClaimRate: toRate(claims.filter((claim) => hasSourceCitation(claim)).length, claims.length),
        preferredSourceCoverage: toRate(preferredSourceHits, preferredSourceIds.size),
        incompleteClaimRate: toRate(incompleteClaimCount, claims.length),
        forbiddenLeakCount,
        forbiddenSourceLeakCount: forbiddenSourceHits,
        moralizingLeakCount,
        incompleteClaimCount,
        incompleteBudgetExceeded: incompleteClaimCount > (entry.expected.maxIncompleteClaims ?? Number.MAX_SAFE_INTEGER),
        citedSourceIds,
        output,
    };
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

async function runModel(
    baseUrl: string,
    model: string,
    corpus: PatientInsightBenchmarkEntry[],
    iterations: number,
    installedModels: string[],
): Promise<ModelReport> {
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
                const prompt = buildPatientInsightExtractionPrompt(entry.context);

                try {
                    const completion = await generateCompletion(baseUrl, model, prompt, entry.maxTokens ?? 1100);
                    const parsed = parsePatientInsightExtractionResponse(completion.content);
                    const scored = scoreCase(entry, parsed.value.data);

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
                        currentStateRecall: 0,
                        alertsRecall: 0,
                        nextStepsRecall: 0,
                        gapsRecall: 0,
                        focusRecall: 0,
                        citationCoverageRate: 0,
                        supportedClaimRate: 0,
                        preferredSourceCoverage: 0,
                        incompleteClaimRate: 1,
                        forbiddenLeakCount: 0,
                        forbiddenSourceLeakCount: 0,
                        moralizingLeakCount: 0,
                        incompleteClaimCount: 0,
                        incompleteBudgetExceeded: false,
                        citedSourceIds: [],
                        output: {
                            currentState: [],
                            alerts: [],
                            nextSteps: [],
                            gaps: [],
                        },
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        const latencies = cases.map((entry) => entry.latencyMs).filter((value) => value > 0);

        return {
            model,
            status: 'completed',
            cases,
            metrics: {
                jsonValidRate: toRate(cases.filter((entry) => entry.validJson).length, cases.length),
                contractValidRate: toRate(cases.filter((entry) => entry.validTask).length, cases.length),
                currentStateRecall: average(cases.map((entry) => entry.currentStateRecall)),
                alertsRecall: average(cases.map((entry) => entry.alertsRecall)),
                nextStepsRecall: average(cases.map((entry) => entry.nextStepsRecall)),
                gapsRecall: average(cases.map((entry) => entry.gapsRecall)),
                focusRecall: average(cases.map((entry) => entry.focusRecall)),
                citationCoverageRate: average(cases.map((entry) => entry.citationCoverageRate)),
                supportedClaimRate: average(cases.map((entry) => entry.supportedClaimRate)),
                preferredSourceCoverage: average(cases.map((entry) => entry.preferredSourceCoverage)),
                incompleteClaimRate: average(cases.map((entry) => entry.incompleteClaimRate)),
                forbiddenLeakRate: toRate(cases.filter((entry) => entry.forbiddenLeakCount > 0).length, cases.length),
                forbiddenSourceLeakRate: toRate(cases.filter((entry) => entry.forbiddenSourceLeakCount > 0).length, cases.length),
                moralizingLeakRate: toRate(cases.filter((entry) => entry.moralizingLeakCount > 0).length, cases.length),
                incompleteBudgetFailureRate: toRate(cases.filter((entry) => entry.incompleteBudgetExceeded).length, cases.length),
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
            rationale: 'No completed patient insight benchmark runs were available.',
        };
    }

    const ranked = [...completed].sort((left, right) => {
        const leftScore = left.metrics.contractValidRate
            + left.metrics.focusRecall
            + left.metrics.citationCoverageRate
            + left.metrics.preferredSourceCoverage
            + left.metrics.supportedClaimRate
            - left.metrics.forbiddenLeakRate
            - left.metrics.forbiddenSourceLeakRate
            - left.metrics.moralizingLeakRate
            - left.metrics.incompleteClaimRate;
        const rightScore = right.metrics.contractValidRate
            + right.metrics.focusRecall
            + right.metrics.citationCoverageRate
            + right.metrics.preferredSourceCoverage
            + right.metrics.supportedClaimRate
            - right.metrics.forbiddenLeakRate
            - right.metrics.forbiddenSourceLeakRate
            - right.metrics.moralizingLeakRate
            - right.metrics.incompleteClaimRate;

        if (rightScore !== leftScore) return rightScore - leftScore;
        return left.metrics.avgLatencyMs - right.metrics.avgLatencyMs;
    });

    return {
        recommendedModel: ranked[0].model,
        rationale: 'Chosen for the best combined contract validity, focus recall, citation discipline, preferred-source coverage, and lowest leakage burden.',
    };
}

function validateReport(
    models: ModelReport[],
    thresholds: {
        minContractRate: number;
        minFocusRecall: number;
        minCitationRate: number;
        minPreferredSourceCoverage: number;
        maxForbiddenLeakRate: number;
        maxForbiddenSourceLeakRate: number;
        maxMoralizingRate: number;
        maxIncompleteClaimRate: number;
    },
) {
    const failures: string[] = [];

    for (const report of models) {
        if (report.status !== 'completed' || !report.metrics) {
            failures.push(`${report.model}: benchmark not completed (${report.status}).`);
            continue;
        }

        if (report.metrics.contractValidRate < thresholds.minContractRate) {
            failures.push(`${report.model}: contract-valid rate ${report.metrics.contractValidRate} < ${thresholds.minContractRate}.`);
        }
        if (report.metrics.focusRecall < thresholds.minFocusRecall) {
            failures.push(`${report.model}: focus recall ${report.metrics.focusRecall} < ${thresholds.minFocusRecall}.`);
        }
        if (report.metrics.citationCoverageRate < thresholds.minCitationRate) {
            failures.push(`${report.model}: citation coverage ${report.metrics.citationCoverageRate} < ${thresholds.minCitationRate}.`);
        }
        if (report.metrics.preferredSourceCoverage < thresholds.minPreferredSourceCoverage) {
            failures.push(`${report.model}: preferred-source coverage ${report.metrics.preferredSourceCoverage} < ${thresholds.minPreferredSourceCoverage}.`);
        }
        if (report.metrics.forbiddenLeakRate > thresholds.maxForbiddenLeakRate) {
            failures.push(`${report.model}: forbidden leak rate ${report.metrics.forbiddenLeakRate} > ${thresholds.maxForbiddenLeakRate}.`);
        }
        if (report.metrics.forbiddenSourceLeakRate > thresholds.maxForbiddenSourceLeakRate) {
            failures.push(`${report.model}: forbidden-source leak rate ${report.metrics.forbiddenSourceLeakRate} > ${thresholds.maxForbiddenSourceLeakRate}.`);
        }
        if (report.metrics.moralizingLeakRate > thresholds.maxMoralizingRate) {
            failures.push(`${report.model}: moralizing leak rate ${report.metrics.moralizingLeakRate} > ${thresholds.maxMoralizingRate}.`);
        }
        if (report.metrics.incompleteClaimRate > thresholds.maxIncompleteClaimRate) {
            failures.push(`${report.model}: incomplete-claim rate ${report.metrics.incompleteClaimRate} > ${thresholds.maxIncompleteClaimRate}.`);
        }
    }

    return failures;
}

export async function runPatientInsightBenchmark(options: {
    corpusPath?: string;
    baseUrl?: string;
    iterations?: number;
    models?: string[];
}): Promise<PatientInsightBenchmarkReport> {
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
    const report = await runPatientInsightBenchmark({
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
        const failures = validateReport(report.models, {
            minContractRate: args.minContractRate,
            minFocusRecall: args.minFocusRecall,
            minCitationRate: args.minCitationRate,
            minPreferredSourceCoverage: args.minPreferredSourceCoverage,
            maxForbiddenLeakRate: args.maxForbiddenLeakRate,
            maxForbiddenSourceLeakRate: args.maxForbiddenSourceLeakRate,
            maxMoralizingRate: args.maxMoralizingRate,
            maxIncompleteClaimRate: args.maxIncompleteClaimRate,
        });

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
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
