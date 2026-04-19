#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    CLINICAL_ENTITIES_SCHEMA_VERSION,
    parseClinicalEntitiesResult,
    type ClinicalEntity,
    type ClinicalEntityType,
} from '../lib/clinical-entities-contracts.ts';

type GoldEntity = {
    type: ClinicalEntityType;
    text: string;
    critical?: boolean;
};

type EntitySummary = {
    type: ClinicalEntityType;
    text: string;
    confidence?: number;
    critical?: boolean;
};

type CorpusEntry = {
    id: string;
    inputText: string;
    gold: {
        entities: GoldEntity[];
    };
};

type CaseResult = {
    id: string;
    latencyMs: number;
    contractValid: boolean;
    spanPrecision: number;
    spanRecall: number;
    evidenceCoverage: number;
    criticalRecall: number;
    missingEntities?: EntitySummary[];
    unexpectedEntities?: EntitySummary[];
    error?: string;
};

type BenchmarkReport = {
    generatedAt: string;
    schemaVersion: typeof CLINICAL_ENTITIES_SCHEMA_VERSION;
    corpusPath: string;
    corpusSize: number;
    adapter: string;
    metrics: {
        contractValidRate: number;
        spanPrecision: number;
        spanRecall: number;
        evidenceCoverage: number;
        criticalRecall: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
    };
    cases: CaseResult[];
};

type ClinicalEntitiesAdapter = {
    name: string;
    run(entry: CorpusEntry): Promise<unknown>;
    dispose?(): Promise<void> | void;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'clinical-entities-benchmark-corpus.json');

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        out: null as string | null,
        adapterModule: null as string | null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--corpus' && argv[index + 1]) {
            args.corpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--adapter-module' && argv[index + 1]) {
            args.adapterModule = path.resolve(argv[index + 1]);
            index += 1;
        }
    }

    return args;
}

function readCorpus(filePath: string): CorpusEntry[] {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CorpusEntry[];
}

function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function toRate(numerator: number, denominator: number) {
    if (denominator === 0) return 1;
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

function findOffsets(inputText: string, value: string) {
    const start = inputText.indexOf(value);
    return {
        start,
        end: start >= 0 ? start + value.length : -1,
    };
}

function buildGoldAdapter(): ClinicalEntitiesAdapter {
    return {
        name: 'gold',
        async run(entry) {
            const entities = entry.gold.entities.flatMap((entity) => {
                const offsets = findOffsets(entry.inputText, entity.text);
                if (offsets.start < 0 || offsets.end <= offsets.start) return [];
                return [{
                    type: entity.type,
                    text: entity.text,
                    evidence: entity.text,
                    start: offsets.start,
                    end: offsets.end,
                    confidence: 1,
                }] satisfies ClinicalEntity[];
            });

            return {
                schemaVersion: CLINICAL_ENTITIES_SCHEMA_VERSION,
                entities,
            };
        },
    };
}

async function loadAdapter(adapterModule: string | null): Promise<ClinicalEntitiesAdapter> {
    if (!adapterModule) return buildGoldAdapter();

    const loaded = await import(pathToFileURL(adapterModule).href) as {
        default?: ClinicalEntitiesAdapter | (() => ClinicalEntitiesAdapter);
        createAdapter?: () => ClinicalEntitiesAdapter;
        adapter?: ClinicalEntitiesAdapter;
    };

    if (typeof loaded.createAdapter === 'function') return loaded.createAdapter();
    if (loaded.adapter) return loaded.adapter;
    if (typeof loaded.default === 'function') return loaded.default();
    if (loaded.default) return loaded.default;

    throw new Error('Adapter module must export `createAdapter()`, `adapter`, or a default adapter.');
}

function matchEntities<T extends GoldEntity>(predicted: ClinicalEntity[], expected: T[]) {
    const matchedGoldIndices = new Set<number>();
    const matchedPredictedIndices = new Set<number>();

    predicted.forEach((entity, predictedIndex) => {
        const probe = normalizeText(entity.text);
        const goldIndex = expected.findIndex((gold, index) =>
            !matchedGoldIndices.has(index)
            && gold.type === entity.type
            && normalizeText(gold.text) === probe,
        );

        if (goldIndex >= 0) {
            matchedGoldIndices.add(goldIndex);
            matchedPredictedIndices.add(predictedIndex);
        }
    });

    return {
        matchedGoldIndices,
        matchedPredictedIndices,
    };
}

function summarizeGoldEntity(entity: GoldEntity): EntitySummary {
    return {
        type: entity.type,
        text: entity.text,
        critical: Boolean(entity.critical),
    };
}

function summarizePredictedEntity(entity: ClinicalEntity): EntitySummary {
    return {
        type: entity.type,
        text: entity.text,
        confidence: entity.confidence,
    };
}

function collectMissingEntities(expected: GoldEntity[], matchedGoldIndices: Set<number>) {
    return expected
        .filter((_, index) => !matchedGoldIndices.has(index))
        .map((entity) => summarizeGoldEntity(entity));
}

function collectUnexpectedEntities(predicted: ClinicalEntity[], matchedPredictedIndices: Set<number>) {
    return predicted
        .filter((_, index) => !matchedPredictedIndices.has(index))
        .map((entity) => summarizePredictedEntity(entity));
}

function toOptionalSummaries<T>(values: T[]) {
    return values.length > 0 ? values : undefined;
}

function summarizeContractFailure(entry: CorpusEntry): EntitySummary[] | undefined {
    if (entry.gold.entities.length === 0) return undefined;
    return entry.gold.entities.map((entity) => summarizeGoldEntity(entity));
}

function scoreCase(inputText: string, expected: GoldEntity[], predicted: ClinicalEntity[], contractValid: boolean) {
    if (!contractValid) {
        return {
            spanPrecision: 0,
            spanRecall: 0,
            evidenceCoverage: 0,
            criticalRecall: 0,
            missingEntities: summarizeContractFailure({ id: '', inputText, gold: { entities: expected } }),
            unexpectedEntities: undefined,
        };
    }

    const matching = matchEntities(predicted, expected);
    const critical = expected.filter((entity) => entity.critical);
    const criticalMatching = matchEntities(predicted, critical);

    return {
        spanPrecision: toRate(matching.matchedGoldIndices.size, predicted.length),
        spanRecall: toRate(matching.matchedGoldIndices.size, expected.length),
        evidenceCoverage: scoreEvidenceCoverage(inputText, predicted),
        criticalRecall: toRate(criticalMatching.matchedGoldIndices.size, critical.length),
        missingEntities: toOptionalSummaries(collectMissingEntities(expected, matching.matchedGoldIndices)),
        unexpectedEntities: toOptionalSummaries(collectUnexpectedEntities(predicted, matching.matchedPredictedIndices)),
    };
}

function scoreEvidenceCoverage(inputText: string, entities: ClinicalEntity[]) {
    const covered = entities.filter((entity) =>
        entity.start >= 0
        && entity.end > entity.start
        && entity.end <= inputText.length
        && inputText.slice(entity.start, entity.end) === entity.evidence,
    ).length;

    return toRate(covered, entities.length);
}

export async function runClinicalEntitiesBenchmark(options: { corpusPath: string; adapterModule: string | null }): Promise<BenchmarkReport> {
    const corpus = readCorpus(options.corpusPath);
    const adapter = await loadAdapter(options.adapterModule);
    const cases: CaseResult[] = [];

    try {
        for (const entry of corpus) {
            const start = performance.now();
            try {
                const raw = await adapter.run(entry);
                const latencyMs = Number((performance.now() - start).toFixed(1));
                const parsed = parseClinicalEntitiesResult(raw);
                const result = parsed.value;
                const scored = scoreCase(entry.inputText, entry.gold.entities, result.entities, parsed.validContract);

                cases.push({
                    id: entry.id,
                    latencyMs,
                    contractValid: parsed.validContract,
                    spanPrecision: scored.spanPrecision,
                    spanRecall: scored.spanRecall,
                    evidenceCoverage: scored.evidenceCoverage,
                    criticalRecall: scored.criticalRecall,
                    missingEntities: scored.missingEntities,
                    unexpectedEntities: scored.unexpectedEntities,
                });
            } catch (error) {
                const latencyMs = Number((performance.now() - start).toFixed(1));
                cases.push({
                    id: entry.id,
                    latencyMs,
                    contractValid: false,
                    spanPrecision: 0,
                    spanRecall: 0,
                    evidenceCoverage: 0,
                    criticalRecall: 0,
                    missingEntities: summarizeContractFailure(entry),
                    error: error instanceof Error ? error.message : 'Unknown adapter error',
                });
            }
        }
    } finally {
        await adapter.dispose?.();
    }

    return {
        generatedAt: new Date().toISOString(),
        schemaVersion: CLINICAL_ENTITIES_SCHEMA_VERSION,
        corpusPath: options.corpusPath,
        corpusSize: corpus.length,
        adapter: adapter.name,
        metrics: {
            contractValidRate: toRate(cases.filter((entry) => entry.contractValid).length, cases.length),
            spanPrecision: average(cases.map((entry) => entry.spanPrecision)),
            spanRecall: average(cases.map((entry) => entry.spanRecall)),
            evidenceCoverage: average(cases.map((entry) => entry.evidenceCoverage)),
            criticalRecall: average(cases.map((entry) => entry.criticalRecall)),
            avgLatencyMs: average(cases.map((entry) => entry.latencyMs)),
            p95LatencyMs: percentile(cases.map((entry) => entry.latencyMs), 0.95),
        },
        cases,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const report = await runClinicalEntitiesBenchmark({
        corpusPath: args.corpus,
        adapterModule: args.adapterModule,
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
