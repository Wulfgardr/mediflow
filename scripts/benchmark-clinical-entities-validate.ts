#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runClinicalEntitiesBenchmark } from './benchmark-clinical-entities.ts';

type CorpusEntry = {
    id: string;
    gold: {
        entities: Array<{ type: string; text: string; critical?: boolean }>;
    };
};

type ValidationFailure = {
    scope: 'report' | 'case';
    id: string;
    message: string;
};

type ValidationReport = {
    generatedAt: string;
    corpusPath: string;
    adapterModule: string | null;
    failures: ValidationFailure[];
    promotionReady: boolean;
    benchmark: Awaited<ReturnType<typeof runClinicalEntitiesBenchmark>>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'clinical-entities-benchmark-corpus.json');

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        adapterModule: null as string | null,
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
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        }
    }

    return args;
}

function readCorpus(filePath: string) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CorpusEntry[];
}

function validateBenchmark(
    corpus: CorpusEntry[],
    report: Awaited<ReturnType<typeof runClinicalEntitiesBenchmark>>,
) {
    const failures: ValidationFailure[] = [];
    const goldById = new Map(corpus.map((entry) => [entry.id, entry]));

    if (report.metrics.contractValidRate < 1) {
        failures.push({
            scope: 'report',
            id: 'contract-valid-rate',
            message: `contractValidRate=${report.metrics.contractValidRate} (expected 1.0 for promotion readiness)`,
        });
    }

    if (report.metrics.evidenceCoverage < 1) {
        failures.push({
            scope: 'report',
            id: 'evidence-coverage',
            message: `evidenceCoverage=${report.metrics.evidenceCoverage} (expected 1.0 for promotion readiness)`,
        });
    }

    for (const entry of report.cases) {
        const gold = goldById.get(entry.id);

        if (!entry.contractValid) {
            failures.push({
                scope: 'case',
                id: entry.id,
                message: 'Case does not satisfy mediflow.clinical_entities.v1 contract.',
            });
        }

        if (entry.criticalRecall < 1) {
            failures.push({
                scope: 'case',
                id: entry.id,
                message: `criticalRecall=${entry.criticalRecall} (expected 1.0; missing critical entities: ${entry.missingEntities?.filter((entity) => entity.critical).map((entity) => entity.text).join(', ') || 'n/a'})`,
            });
        }

        if (gold && gold.gold.entities.length === 0 && (entry.unexpectedEntities?.length || 0) > 0) {
            failures.push({
                scope: 'case',
                id: entry.id,
                message: `Unexpected entities on negative case: ${entry.unexpectedEntities?.map((entity) => entity.text).join(', ')}`,
            });
        }
    }

    return failures;
}

async function main() {
    const args = parseArgs(process.argv);
    const corpus = readCorpus(args.corpus);
    const benchmark = await runClinicalEntitiesBenchmark({
        corpusPath: args.corpus,
        adapterModule: args.adapterModule,
    });

    const failures = validateBenchmark(corpus, benchmark);
    const payload: ValidationReport = {
        generatedAt: new Date().toISOString(),
        corpusPath: args.corpus,
        adapterModule: args.adapterModule,
        failures,
        promotionReady: failures.length === 0,
        benchmark,
    };

    const output = JSON.stringify(payload, null, 2);
    if (args.out) {
        fs.mkdirSync(path.dirname(args.out), { recursive: true });
        fs.writeFileSync(args.out, output, 'utf8');
    }

    console.log(output);

    if (failures.length > 0) {
        process.exitCode = 1;
    }
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
