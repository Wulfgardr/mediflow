#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ResolverLanguage = 'en' | 'it' | 'mixed';

type IcdResolverBenchmarkEntry = {
    id: string;
    query: string;
    language?: ResolverLanguage;
    expected: {
        top1Code?: string;
        topKCodes: string[];
        notes?: string;
    };
    limit?: number;
};

type IcdCandidate = {
    code: string;
    description: string;
};

type IcdCaseResult = {
    id: string;
    query: string;
    language: ResolverLanguage;
    latencyMs: number;
    candidateCount: number;
    top1Code: string | null;
    top1Hit: boolean;
    topKHit: boolean;
    ambiguity: boolean;
    falsePositive: boolean;
    noResult: boolean;
    hallucination: boolean;
    notes?: string;
    candidates: IcdCandidate[];
    error?: string;
};

type IcdAggregateMetrics = {
    label: string;
    caseCount: number;
    top1Recall: number;
    topKRecall: number;
    ambiguityRate: number;
    falsePositiveRate: number;
    noResultRate: number;
    hallucinationRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
};

export type IcdResolverBenchmarkReport = {
    generatedAt: string;
    corpusPath: string;
    corpusSize: number;
    baseUrl: string;
    topK: number;
    limit: number;
    overall: IcdAggregateMetrics;
    languages: IcdAggregateMetrics[];
    cases: IcdCaseResult[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'icd-resolver-benchmark-corpus.json');
const DEFAULT_BASE_URL = (process.env.ICD_BASE_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');
const DEFAULT_LIMIT = 10;
const DEFAULT_TOP_K = 5;

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        out: null as string | null,
        markdownOut: null as string | null,
        baseUrl: DEFAULT_BASE_URL,
        limit: DEFAULT_LIMIT,
        topK: DEFAULT_TOP_K,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--corpus' && argv[index + 1]) {
            args.corpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--markdown-out' && argv[index + 1]) {
            args.markdownOut = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--base-url' && argv[index + 1]) {
            args.baseUrl = argv[index + 1].replace(/\/$/, '');
            index += 1;
        } else if (value === '--limit' && argv[index + 1]) {
            args.limit = Math.max(1, Number.parseInt(argv[index + 1], 10) || DEFAULT_LIMIT);
            index += 1;
        } else if (value === '--top-k' && argv[index + 1]) {
            args.topK = Math.max(1, Number.parseInt(argv[index + 1], 10) || DEFAULT_TOP_K);
            index += 1;
        }
    }

    return args;
}

function readCorpus(filePath: string): IcdResolverBenchmarkEntry[] {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as IcdResolverBenchmarkEntry[];
}

function toRate(numerator: number, denominator: number) {
    if (denominator === 0) return 0;
    return Number((numerator / denominator).toFixed(3));
}

function average(values: number[]) {
    if (values.length === 0) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function percentile(values: number[], fraction: number) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return Number(sorted[index].toFixed(1));
}

function normalizeLanguage(value: unknown): ResolverLanguage {
    return value === 'it' || value === 'mixed' ? value : 'en';
}

function mapIcdCandidate(entity: Record<string, unknown>): IcdCandidate {
    const rawTitle = typeof entity.title === 'string'
        ? entity.title
        : typeof entity.title === 'object' && entity.title && typeof (entity.title as { value?: unknown }).value === 'string'
            ? String((entity.title as { value: string }).value)
            : '';
    const cleanDescription = rawTitle.replace(/<[^>]*>?/gm, '').trim();

    const code = [
        entity.theCode,
        entity.code,
        entity.codeRange,
    ].find((value) => typeof value === 'string' && value.trim()) as string | undefined;

    return {
        code: code?.trim() || 'N/A',
        description: cleanDescription || 'Descrizione assente',
    };
}

async function searchIcdResolver(query: string, baseUrl: string, limit: number): Promise<IcdCandidate[]> {
    const targetUrl = `${baseUrl}/icd/release/11/2024-01/mms/search?q=${encodeURIComponent(query)}&includeKeywordResult=true&useaperiodic=false`;
    const response = await fetch(targetUrl, {
        headers: {
            Accept: 'application/json',
            'API-Version': 'v2',
            'Accept-Language': 'en',
        },
    });

    if (!response.ok) {
        throw new Error(`ICD resolver upstream error: ${response.status}`);
    }

    const payload = await response.json() as { destinationEntities?: Array<Record<string, unknown>> };
    return (payload.destinationEntities || [])
        .slice(0, limit)
        .map(mapIcdCandidate);
}

export async function evaluateIcdResolverCase(
    entry: IcdResolverBenchmarkEntry,
    baseUrl: string,
    topK: number,
    defaultLimit: number,
): Promise<IcdCaseResult> {
    const startedAt = performance.now();
    try {
        const candidates = await searchIcdResolver(entry.query, baseUrl, entry.limit || defaultLimit);
        const latencyMs = Number((performance.now() - startedAt).toFixed(1));
        const topCandidates = candidates.slice(0, topK);
        const top1 = topCandidates[0];
        const acceptableCodes = new Set(entry.expected.topKCodes);
        const top1Hit = top1
            ? (entry.expected.top1Code ? top1.code === entry.expected.top1Code : acceptableCodes.has(top1.code))
            : false;
        const topKHit = topCandidates.some((candidate) => acceptableCodes.has(candidate.code));
        const noResult = candidates.length === 0;
        const hallucination = Boolean(top1 && (!top1.code || top1.code === 'N/A'));

        return {
            id: entry.id,
            query: entry.query,
            language: normalizeLanguage(entry.language),
            latencyMs,
            candidateCount: candidates.length,
            top1Code: top1?.code || null,
            top1Hit,
            topKHit,
            ambiguity: candidates.length > 1,
            falsePositive: candidates.length > 0 && !topKHit,
            noResult,
            hallucination,
            notes: entry.expected.notes,
            candidates: topCandidates,
        };
    } catch (error) {
        return {
            id: entry.id,
            query: entry.query,
            language: normalizeLanguage(entry.language),
            latencyMs: Number((performance.now() - startedAt).toFixed(1)),
            candidateCount: 0,
            top1Code: null,
            top1Hit: false,
            topKHit: false,
            ambiguity: false,
            falsePositive: false,
            noResult: true,
            hallucination: false,
            notes: entry.expected.notes,
            candidates: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function aggregateIcdResults(label: string, results: IcdCaseResult[]): IcdAggregateMetrics {
    const latencies = results.map((result) => result.latencyMs);
    return {
        label,
        caseCount: results.length,
        top1Recall: toRate(results.filter((result) => result.top1Hit).length, results.length),
        topKRecall: toRate(results.filter((result) => result.topKHit).length, results.length),
        ambiguityRate: toRate(results.filter((result) => result.ambiguity).length, results.length),
        falsePositiveRate: toRate(results.filter((result) => result.falsePositive).length, results.length),
        noResultRate: toRate(results.filter((result) => result.noResult).length, results.length),
        hallucinationRate: toRate(results.filter((result) => result.hallucination).length, results.length),
        avgLatencyMs: average(latencies),
        p95LatencyMs: percentile(latencies, 0.95),
    };
}

function buildIcdResolverMarkdown(report: IcdResolverBenchmarkReport) {
    const lines = [
        '# ICD Resolver Benchmark',
        '',
        `Generated at: ${report.generatedAt}`,
        `Corpus: ${report.corpusPath}`,
        `Cases: ${report.corpusSize}`,
        `ICD base URL: ${report.baseUrl}`,
        `Top-K window: ${report.topK}`,
        '',
        '## Overall',
        '',
        '| Metric | Value |',
        '| --- | ---: |',
        `| Top-1 recall | ${report.overall.top1Recall} |`,
        `| Top-K recall | ${report.overall.topKRecall} |`,
        `| Ambiguity rate | ${report.overall.ambiguityRate} |`,
        `| False positive rate | ${report.overall.falsePositiveRate} |`,
        `| No result rate | ${report.overall.noResultRate} |`,
        `| Hallucination rate | ${report.overall.hallucinationRate} |`,
        `| Avg latency (ms) | ${report.overall.avgLatencyMs} |`,
        `| P95 latency (ms) | ${report.overall.p95LatencyMs} |`,
        '',
        '## By Language',
        '',
        '| Language | Cases | Top-1 recall | Top-K recall | No result rate | Avg latency (ms) |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        ...report.languages.map((metrics) => (
            `| ${metrics.label} | ${metrics.caseCount} | ${metrics.top1Recall} | ${metrics.topKRecall} | ${metrics.noResultRate} | ${metrics.avgLatencyMs} |`
        )),
        '',
        '## Cases',
        '',
    ];

    for (const result of report.cases) {
        lines.push(`### ${result.id}`);
        lines.push('');
        lines.push(`- Query: \`${result.query}\``);
        lines.push(`- Language: \`${result.language}\``);
        lines.push(`- Top-1: \`${result.top1Code || 'none'}\``);
        lines.push(`- Top-1 hit: \`${result.top1Hit}\``);
        lines.push(`- Top-K hit: \`${result.topKHit}\``);
        lines.push(`- Candidate count: \`${result.candidateCount}\``);
        lines.push(`- Latency: \`${result.latencyMs} ms\``);
        if (result.notes) lines.push(`- Notes: ${result.notes}`);
        if (result.error) lines.push(`- Error: ${result.error}`);
        if (result.candidates.length > 0) {
            lines.push('- Candidates:');
            for (const candidate of result.candidates) {
                lines.push(`  - \`${candidate.code}\` ${candidate.description}`);
            }
        }
        lines.push('');
    }

    return `${lines.join('\n').trim()}\n`;
}

async function main() {
    const args = parseArgs(process.argv);
    const corpus = readCorpus(args.corpus);
    const results: IcdCaseResult[] = [];

    for (const entry of corpus) {
        results.push(await evaluateIcdResolverCase(entry, args.baseUrl, args.topK, args.limit));
    }

    const languages = ['en', 'it', 'mixed'].flatMap((language) => {
        const scoped = results.filter((result) => result.language === language);
        return scoped.length > 0 ? [aggregateIcdResults(language, scoped)] : [];
    });

    const report: IcdResolverBenchmarkReport = {
        generatedAt: new Date().toISOString(),
        corpusPath: args.corpus,
        corpusSize: corpus.length,
        baseUrl: args.baseUrl,
        topK: args.topK,
        limit: args.limit,
        overall: aggregateIcdResults('overall', results),
        languages,
        cases: results,
    };

    if (args.out) {
        fs.mkdirSync(path.dirname(args.out), { recursive: true });
        fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    }

    if (args.markdownOut) {
        fs.mkdirSync(path.dirname(args.markdownOut), { recursive: true });
        fs.writeFileSync(args.markdownOut, buildIcdResolverMarkdown(report));
    }

    console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

