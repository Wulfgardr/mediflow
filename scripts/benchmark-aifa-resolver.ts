#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

type AifaCategory = 'brand' | 'active-principle' | 'strength' | 'packaging' | 'combo' | 'state';
type TherapyState = 'active' | 'suspended';

type AifaResolverBenchmarkEntry = {
    id: string;
    query: string;
    category?: AifaCategory;
    expected: {
        matchTokens: string[];
        dosageTokens?: string[];
        packagingTokens?: string[];
        topKAics?: string[];
        rejectTokenGroups?: string[][];
        state?: TherapyState;
        notes?: string;
    };
    limit?: number;
};

type AifaCandidate = {
    aic: string;
    name: string;
    activePrinciple: string | null;
    packaging: string | null;
    atc: string | null;
};

type AifaCaseResult = {
    id: string;
    query: string;
    category: AifaCategory;
    latencyMs: number;
    candidateCount: number;
    top1Aic: string | null;
    top1Match: boolean;
    topKMatch: boolean;
    dosageAligned: boolean | null;
    packagingAligned: boolean | null;
    rejectTokenHit: boolean;
    ambiguity: boolean;
    falsePositive: boolean;
    noResult: boolean;
    hallucination: boolean;
    stateBlindHit: boolean;
    notes?: string;
    candidates: AifaCandidate[];
    error?: string;
};

type AifaAggregateMetrics = {
    label: string;
    caseCount: number;
    top1MatchRate: number;
    topKMatchRate: number;
    dosageAlignmentRate: number | null;
    packagingAlignmentRate: number | null;
    rejectTokenHitRate: number;
    ambiguityRate: number;
    falsePositiveRate: number;
    noResultRate: number;
    hallucinationRate: number;
    stateBlindHitRate: number | null;
    avgLatencyMs: number;
    p95LatencyMs: number;
};

export type AifaResolverBenchmarkReport = {
    generatedAt: string;
    corpusPath: string;
    corpusSize: number;
    dbPath: string;
    topK: number;
    limit: number;
    overall: AifaAggregateMetrics;
    categories: AifaAggregateMetrics[];
    cases: AifaCaseResult[];
};

const DEFAULT_DATA_DIR = process.env.MEDIFLOW_DATA_DIR
    || (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'MediFlow')
        : path.join(os.homedir(), '.mediflow'));
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, 'medical.db');
const DEFAULT_LIMIT = 12;
const DEFAULT_TOP_K = 5;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'aifa-resolver-benchmark-corpus.json');

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        out: null as string | null,
        markdownOut: null as string | null,
        dbPath: DEFAULT_DB_PATH,
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
        } else if (value === '--db-path' && argv[index + 1]) {
            args.dbPath = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--data-dir' && argv[index + 1]) {
            args.dbPath = path.join(path.resolve(argv[index + 1]), 'medical.db');
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

function readCorpus(filePath: string): AifaResolverBenchmarkEntry[] {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AifaResolverBenchmarkEntry[];
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

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function includesAllTokens(text: string, tokens: string[] | undefined) {
    if (!tokens || tokens.length === 0) return true;
    const haystack = normalizeText(text);
    return tokens.every((token) => haystack.includes(normalizeText(token)));
}

function candidateText(candidate: AifaCandidate) {
    return [
        candidate.aic,
        candidate.name,
        candidate.activePrinciple || '',
        candidate.packaging || '',
        candidate.atc || '',
    ].join(' ');
}

function normalizeCategory(value: unknown): AifaCategory {
    return value === 'brand'
        || value === 'active-principle'
        || value === 'strength'
        || value === 'packaging'
        || value === 'combo'
        || value === 'state'
        ? value
        : 'active-principle';
}

function hasRejectTokenHit(candidate: AifaCandidate | undefined, rejectTokenGroups: string[][] | undefined) {
    if (!candidate || !rejectTokenGroups || rejectTokenGroups.length === 0) return false;
    const text = candidateText(candidate);
    return rejectTokenGroups.some((group) => includesAllTokens(text, group));
}

function matchesExpectedCandidate(candidate: AifaCandidate, entry: AifaResolverBenchmarkEntry) {
    const byAic = entry.expected.topKAics?.includes(candidate.aic) || false;
    const byTokens = includesAllTokens(candidateText(candidate), entry.expected.matchTokens);
    return byAic || byTokens;
}

function openDrugCatalog(dbPath: string) {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function searchAifaResolver(db: Database.Database, query: string, limit: number): AifaCandidate[] {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const pattern = `%${trimmed}%`;
    return db.prepare(`
        SELECT
            aic,
            name,
            active_principle AS activePrinciple,
            packaging,
            atc
        FROM drugs
        WHERE name LIKE ?
           OR active_principle LIKE ?
           OR aic LIKE ?
        ORDER BY name ASC
        LIMIT ?
    `).all(pattern, pattern, pattern, limit) as AifaCandidate[];
}

export function evaluateAifaResolverCase(
    entry: AifaResolverBenchmarkEntry,
    db: Database.Database,
    topK: number,
    defaultLimit: number,
): AifaCaseResult {
    const startedAt = performance.now();
    try {
        const candidates = searchAifaResolver(db, entry.query, entry.limit || defaultLimit);
        const latencyMs = Number((performance.now() - startedAt).toFixed(1));
        const topCandidates = candidates.slice(0, topK);
        const top1 = topCandidates[0];
        const top1Match = top1 ? matchesExpectedCandidate(top1, entry) : false;
        const topKMatch = topCandidates.some((candidate) => matchesExpectedCandidate(candidate, entry));

        return {
            id: entry.id,
            query: entry.query,
            category: normalizeCategory(entry.category),
            latencyMs,
            candidateCount: candidates.length,
            top1Aic: top1?.aic || null,
            top1Match,
            topKMatch,
            dosageAligned: entry.expected.dosageTokens ? (top1 ? includesAllTokens(candidateText(top1), entry.expected.dosageTokens) : false) : null,
            packagingAligned: entry.expected.packagingTokens ? (top1 ? includesAllTokens(candidateText(top1), entry.expected.packagingTokens) : false) : null,
            rejectTokenHit: hasRejectTokenHit(top1, entry.expected.rejectTokenGroups),
            ambiguity: candidates.length > 1,
            falsePositive: candidates.length > 0 && !topKMatch,
            noResult: candidates.length === 0,
            hallucination: Boolean(top1 && !top1.aic.trim()),
            stateBlindHit: entry.expected.state === 'suspended' && candidates.length > 0,
            notes: entry.expected.notes,
            candidates: topCandidates,
        };
    } catch (error) {
        return {
            id: entry.id,
            query: entry.query,
            category: normalizeCategory(entry.category),
            latencyMs: Number((performance.now() - startedAt).toFixed(1)),
            candidateCount: 0,
            top1Aic: null,
            top1Match: false,
            topKMatch: false,
            dosageAligned: entry.expected.dosageTokens ? false : null,
            packagingAligned: entry.expected.packagingTokens ? false : null,
            rejectTokenHit: false,
            ambiguity: false,
            falsePositive: false,
            noResult: true,
            hallucination: false,
            stateBlindHit: false,
            notes: entry.expected.notes,
            candidates: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function aggregateBooleanRate(results: AifaCaseResult[], selector: (result: AifaCaseResult) => boolean) {
    return toRate(results.filter(selector).length, results.length);
}

function aggregateOptionalRate(
    results: AifaCaseResult[],
    selector: (result: AifaCaseResult) => boolean | null,
) {
    const scoped = results.filter((result) => selector(result) !== null);
    if (scoped.length === 0) return null;
    return toRate(scoped.filter((result) => selector(result) === true).length, scoped.length);
}

function aggregateAifaResults(label: string, results: AifaCaseResult[]): AifaAggregateMetrics {
    const latencies = results.map((result) => result.latencyMs);
    const suspendedCases = results.filter((result) => result.category === 'state');

    return {
        label,
        caseCount: results.length,
        top1MatchRate: aggregateBooleanRate(results, (result) => result.top1Match),
        topKMatchRate: aggregateBooleanRate(results, (result) => result.topKMatch),
        dosageAlignmentRate: aggregateOptionalRate(results, (result) => result.dosageAligned),
        packagingAlignmentRate: aggregateOptionalRate(results, (result) => result.packagingAligned),
        rejectTokenHitRate: aggregateBooleanRate(results, (result) => result.rejectTokenHit),
        ambiguityRate: aggregateBooleanRate(results, (result) => result.ambiguity),
        falsePositiveRate: aggregateBooleanRate(results, (result) => result.falsePositive),
        noResultRate: aggregateBooleanRate(results, (result) => result.noResult),
        hallucinationRate: aggregateBooleanRate(results, (result) => result.hallucination),
        stateBlindHitRate: suspendedCases.length > 0
            ? aggregateBooleanRate(suspendedCases, (result) => result.stateBlindHit)
            : null,
        avgLatencyMs: average(latencies),
        p95LatencyMs: percentile(latencies, 0.95),
    };
}

function buildAifaResolverMarkdown(report: AifaResolverBenchmarkReport) {
    const lines = [
        '# AIFA Resolver Benchmark',
        '',
        `Generated at: ${report.generatedAt}`,
        `Corpus: ${report.corpusPath}`,
        `Cases: ${report.corpusSize}`,
        `DB path: ${report.dbPath}`,
        `Top-K window: ${report.topK}`,
        '',
        '## Overall',
        '',
        '| Metric | Value |',
        '| --- | ---: |',
        `| Top-1 match rate | ${report.overall.top1MatchRate} |`,
        `| Top-K match rate | ${report.overall.topKMatchRate} |`,
        `| Dosage alignment rate | ${report.overall.dosageAlignmentRate ?? 'n/a'} |`,
        `| Packaging alignment rate | ${report.overall.packagingAlignmentRate ?? 'n/a'} |`,
        `| Reject token hit rate | ${report.overall.rejectTokenHitRate} |`,
        `| Ambiguity rate | ${report.overall.ambiguityRate} |`,
        `| False positive rate | ${report.overall.falsePositiveRate} |`,
        `| No result rate | ${report.overall.noResultRate} |`,
        `| Hallucination rate | ${report.overall.hallucinationRate} |`,
        `| State-blind hit rate | ${report.overall.stateBlindHitRate ?? 'n/a'} |`,
        `| Avg latency (ms) | ${report.overall.avgLatencyMs} |`,
        `| P95 latency (ms) | ${report.overall.p95LatencyMs} |`,
        '',
        '## By Category',
        '',
        '| Category | Cases | Top-1 match | Top-K match | Dosage align | Packaging align | False positive |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...report.categories.map((metrics) => (
            `| ${metrics.label} | ${metrics.caseCount} | ${metrics.top1MatchRate} | ${metrics.topKMatchRate} | ${metrics.dosageAlignmentRate ?? 'n/a'} | ${metrics.packagingAlignmentRate ?? 'n/a'} | ${metrics.falsePositiveRate} |`
        )),
        '',
        '## Cases',
        '',
    ];

    for (const result of report.cases) {
        lines.push(`### ${result.id}`);
        lines.push('');
        lines.push(`- Query: \`${result.query}\``);
        lines.push(`- Category: \`${result.category}\``);
        lines.push(`- Top-1 AIC: \`${result.top1Aic || 'none'}\``);
        lines.push(`- Top-1 match: \`${result.top1Match}\``);
        lines.push(`- Top-K match: \`${result.topKMatch}\``);
        if (result.dosageAligned !== null) lines.push(`- Dosage aligned: \`${result.dosageAligned}\``);
        if (result.packagingAligned !== null) lines.push(`- Packaging aligned: \`${result.packagingAligned}\``);
        lines.push(`- Reject token hit: \`${result.rejectTokenHit}\``);
        lines.push(`- State-blind hit: \`${result.stateBlindHit}\``);
        lines.push(`- Candidate count: \`${result.candidateCount}\``);
        lines.push(`- Latency: \`${result.latencyMs} ms\``);
        if (result.notes) lines.push(`- Notes: ${result.notes}`);
        if (result.error) lines.push(`- Error: ${result.error}`);
        if (result.candidates.length > 0) {
            lines.push('- Candidates:');
            for (const candidate of result.candidates) {
                lines.push(`  - \`${candidate.aic}\` ${candidate.name} | ${candidate.activePrinciple || '-'} | ${candidate.packaging || '-'}`);
            }
        }
        lines.push('');
    }

    return `${lines.join('\n').trim()}\n`;
}

function main() {
    const args = parseArgs(process.argv);
    if (!fs.existsSync(args.dbPath)) {
        throw new Error(`AIFA catalog database not found at ${args.dbPath}`);
    }

    const corpus = readCorpus(args.corpus);
    const db = openDrugCatalog(args.dbPath);

    try {
        const results = corpus.map((entry) => evaluateAifaResolverCase(entry, db, args.topK, args.limit));
        const categories = ['brand', 'active-principle', 'strength', 'packaging', 'combo', 'state'].flatMap((category) => {
            const scoped = results.filter((result) => result.category === category);
            return scoped.length > 0 ? [aggregateAifaResults(category, scoped)] : [];
        });

        const report: AifaResolverBenchmarkReport = {
            generatedAt: new Date().toISOString(),
            corpusPath: args.corpus,
            corpusSize: corpus.length,
            dbPath: args.dbPath,
            topK: args.topK,
            limit: args.limit,
            overall: aggregateAifaResults('overall', results),
            categories,
            cases: results,
        };

        if (args.out) {
            fs.mkdirSync(path.dirname(args.out), { recursive: true });
            fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
        }

        if (args.markdownOut) {
            fs.mkdirSync(path.dirname(args.markdownOut), { recursive: true });
            fs.writeFileSync(args.markdownOut, buildAifaResolverMarkdown(report));
        }

        console.log(JSON.stringify(report, null, 2));
    } finally {
        db.close();
    }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
