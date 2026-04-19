#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runClinicalEntitiesBenchmark } from './benchmark-clinical-entities.ts';

type NumericSummary = {
    min: number;
    max: number;
    avg: number;
};

type CorpusEntry = {
    id: string;
    gold: {
        entities: Array<unknown>;
    };
};

type RepeatRunEntry = {
    run: number;
    generatedAt: string;
    metrics: Awaited<ReturnType<typeof runClinicalEntitiesBenchmark>>['metrics'];
    negativeCaseLeakRate: number;
};

type RepeatReport = {
    generatedAt: string;
    corpusPath: string;
    adapterModule: string | null;
    runs: RepeatRunEntry[];
    summary: {
        contractValidRate: NumericSummary;
        spanPrecision: NumericSummary;
        spanRecall: NumericSummary;
        evidenceCoverage: NumericSummary;
        criticalRecall: NumericSummary;
        avgLatencyMs: NumericSummary;
        p95LatencyMs: NumericSummary;
        negativeCaseLeakRate: NumericSummary;
    };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'clinical-entities-benchmark-corpus.json');

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        adapterModule: null as string | null,
        out: null as string | null,
        runs: 5,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--corpus' && argv[index + 1]) {
            args.corpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--adapter-module' && argv[index + 1]) {
            args.adapterModule = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--runs' && argv[index + 1]) {
            const parsed = Number.parseInt(argv[index + 1], 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                args.runs = parsed;
            }
            index += 1;
        }
    }

    return args;
}

function readCorpus(filePath: string) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CorpusEntry[];
}

function summarize(values: number[]): NumericSummary {
    if (values.length === 0) {
        return { min: 0, max: 0, avg: 0 };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;

    return {
        min: Number(min.toFixed(3)),
        max: Number(max.toFixed(3)),
        avg: Number(avg.toFixed(3)),
    };
}

function calculateNegativeCaseLeakRate(
    corpus: CorpusEntry[],
    report: Awaited<ReturnType<typeof runClinicalEntitiesBenchmark>>,
) {
    const negativeIds = new Set(
        corpus.filter((entry) => entry.gold.entities.length === 0).map((entry) => entry.id),
    );

    if (negativeIds.size === 0) return 0;

    const leakingCases = report.cases.filter((entry) =>
        negativeIds.has(entry.id) && (entry.unexpectedEntities?.length || 0) > 0,
    ).length;

    return Number((leakingCases / negativeIds.size).toFixed(3));
}

async function main() {
    const args = parseArgs(process.argv);
    const corpus = readCorpus(args.corpus);
    const runs: RepeatRunEntry[] = [];

    for (let run = 1; run <= args.runs; run += 1) {
        const report = await runClinicalEntitiesBenchmark({
            corpusPath: args.corpus,
            adapterModule: args.adapterModule,
        });
        runs.push({
            run,
            generatedAt: report.generatedAt,
            metrics: report.metrics,
            negativeCaseLeakRate: calculateNegativeCaseLeakRate(corpus, report),
        });
    }

    const payload: RepeatReport = {
        generatedAt: new Date().toISOString(),
        corpusPath: args.corpus,
        adapterModule: args.adapterModule,
        runs,
        summary: {
            contractValidRate: summarize(runs.map((entry) => entry.metrics.contractValidRate)),
            spanPrecision: summarize(runs.map((entry) => entry.metrics.spanPrecision)),
            spanRecall: summarize(runs.map((entry) => entry.metrics.spanRecall)),
            evidenceCoverage: summarize(runs.map((entry) => entry.metrics.evidenceCoverage)),
            criticalRecall: summarize(runs.map((entry) => entry.metrics.criticalRecall)),
            avgLatencyMs: summarize(runs.map((entry) => entry.metrics.avgLatencyMs)),
            p95LatencyMs: summarize(runs.map((entry) => entry.metrics.p95LatencyMs)),
            negativeCaseLeakRate: summarize(runs.map((entry) => entry.negativeCaseLeakRate)),
        },
    };

    const output = JSON.stringify(payload, null, 2);
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
    void main()
        .then(() => {
            setImmediate(() => {
                process.exit(process.exitCode ?? 0);
            });
        })
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
