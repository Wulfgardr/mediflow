#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runRedactionBenchmark } from './benchmark-redaction.ts';

type NumericSummary = {
    min: number;
    max: number;
    avg: number;
};

type RepeatRunEntry = {
    run: number;
    generatedAt: string;
    metrics: Awaited<ReturnType<typeof runRedactionBenchmark>>['metrics'];
};

type RepeatReport = {
    generatedAt: string;
    corpusPath: string;
    adapterModule: string | null;
    runs: RepeatRunEntry[];
    summary: {
        contractValidRate: NumericSummary;
        entityRecall: NumericSummary;
        criticalRecall: NumericSummary;
        forbiddenLeakRate: NumericSummary;
        offsetIntegrityRate: NumericSummary;
        avgLatencyMs: NumericSummary;
        p95LatencyMs: NumericSummary;
        emailRecall: NumericSummary;
        emailCriticalRecall: NumericSummary;
    };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'redaction-benchmark-corpus.json');

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

async function main() {
    const args = parseArgs(process.argv);
    const runs: RepeatRunEntry[] = [];

    for (let run = 1; run <= args.runs; run += 1) {
        const report = await runRedactionBenchmark({
            corpusPath: args.corpus,
            adapterModule: args.adapterModule,
        });
        runs.push({
            run,
            generatedAt: report.generatedAt,
            metrics: report.metrics,
        });
    }

    const payload: RepeatReport = {
        generatedAt: new Date().toISOString(),
        corpusPath: args.corpus,
        adapterModule: args.adapterModule,
        runs,
        summary: {
            contractValidRate: summarize(runs.map((entry) => entry.metrics.contractValidRate)),
            entityRecall: summarize(runs.map((entry) => entry.metrics.entityRecall)),
            criticalRecall: summarize(runs.map((entry) => entry.metrics.criticalRecall)),
            forbiddenLeakRate: summarize(runs.map((entry) => entry.metrics.forbiddenLeakRate)),
            offsetIntegrityRate: summarize(runs.map((entry) => entry.metrics.offsetIntegrityRate)),
            avgLatencyMs: summarize(runs.map((entry) => entry.metrics.avgLatencyMs)),
            p95LatencyMs: summarize(runs.map((entry) => entry.metrics.p95LatencyMs)),
            emailRecall: summarize(runs.map((entry) => entry.metrics.recallByType.email.recall)),
            emailCriticalRecall: summarize(runs.map((entry) => entry.metrics.recallByType.email.criticalRecall)),
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
    void main();
}
