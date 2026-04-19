#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runRedactionBenchmark } from './benchmark-redaction.ts';

type SweepEntry = {
    threshold: number;
    metrics: {
        contractValidRate: number;
        entityRecall: number;
        criticalRecall: number;
        forbiddenLeakRate: number;
        offsetIntegrityRate: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
    };
};

type SweepReport = {
    generatedAt: string;
    corpusPath: string;
    adapterModule: string;
    thresholds: SweepEntry[];
    recommendedThreshold: number | null;
    rationale: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'redaction-benchmark-corpus.json');
const DEFAULT_ADAPTER_MODULE = path.join(__dirname, 'openmed-redaction-adapter.ts');
const DEFAULT_THRESHOLDS = [0.3, 0.5, 0.7];

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        adapterModule: DEFAULT_ADAPTER_MODULE,
        thresholds: DEFAULT_THRESHOLDS,
        out: null as string | null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--corpus' && argv[index + 1]) {
            args.corpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--adapter-module' && argv[index + 1]) {
            args.adapterModule = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--thresholds' && argv[index + 1]) {
            args.thresholds = argv[index + 1]
                .split(',')
                .map((item) => Number.parseFloat(item))
                .filter((item) => Number.isFinite(item))
                .map((item) => Math.min(1, Math.max(0, item)));
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        }
    }

    return args;
}

function pickRecommendedThreshold(entries: SweepEntry[]) {
    if (entries.length === 0) {
        return {
            recommendedThreshold: null,
            rationale: 'No threshold run completed.',
        };
    }

    const best = [...entries].sort((left, right) =>
        left.metrics.forbiddenLeakRate - right.metrics.forbiddenLeakRate
        || right.metrics.criticalRecall - left.metrics.criticalRecall
        || right.metrics.entityRecall - left.metrics.entityRecall
        || right.metrics.contractValidRate - left.metrics.contractValidRate
        || left.metrics.avgLatencyMs - right.metrics.avgLatencyMs
    )[0];

    return {
        recommendedThreshold: best.threshold,
        rationale: `Selected ${best.threshold} because it minimizes forbiddenLeakRate first, then maximizes criticalRecall/entityRecall, and finally prefers lower latency.`,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const entries: SweepEntry[] = [];
    const originalThreshold = process.env.MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD;

    for (const threshold of args.thresholds) {
        process.env.MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD = String(threshold);
        const report = await runRedactionBenchmark({
            corpusPath: args.corpus,
            adapterModule: args.adapterModule,
        });

        entries.push({
            threshold,
            metrics: report.metrics,
        });
    }

    if (typeof originalThreshold === 'string') {
        process.env.MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD = originalThreshold;
    } else {
        delete process.env.MEDIFLOW_OPENMED_CONFIDENCE_THRESHOLD;
    }

    const decision = pickRecommendedThreshold(entries);
    const payload: SweepReport = {
        generatedAt: new Date().toISOString(),
        corpusPath: args.corpus,
        adapterModule: args.adapterModule,
        thresholds: entries,
        recommendedThreshold: decision.recommendedThreshold,
        rationale: decision.rationale,
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
