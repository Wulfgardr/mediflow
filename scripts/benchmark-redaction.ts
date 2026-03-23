#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REDACTION_SCHEMA_VERSION, parseRedactionResult, type RedactionEntity, type RedactionEntityType } from '../lib/redaction-contracts.ts';

type GoldEntity = {
    type: RedactionEntityType;
    text: string;
    critical?: boolean;
};

type MissingGoldEntity = {
    type: RedactionEntityType;
    text: string;
    critical: boolean;
};

type TypeRecallBreakdown = {
    goldCount: number;
    matchedCount: number;
    recall: number;
    criticalGoldCount: number;
    criticalMatchedCount: number;
    criticalRecall: number;
};

type CorpusEntry = {
    id: string;
    inputText: string;
    gold: {
        redactedText: string;
        entities: GoldEntity[];
        forbiddenTokens: string[];
    };
};

type CaseResult = {
    id: string;
    latencyMs: number;
    contractValid: boolean;
    entityRecall: number;
    criticalRecall: number;
    forbiddenLeakCount: number;
    leakedForbiddenTokens: string[];
    missingEntities: MissingGoldEntity[];
    offsetIntegrityRate: number;
    error?: string;
};

type BenchmarkReport = {
    generatedAt: string;
    schemaVersion: typeof REDACTION_SCHEMA_VERSION;
    corpusPath: string;
    corpusSize: number;
    adapter: string;
    metrics: {
        contractValidRate: number;
        entityRecall: number;
        criticalRecall: number;
        forbiddenLeakRate: number;
        offsetIntegrityRate: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
        recallByType: Record<RedactionEntityType, TypeRecallBreakdown>;
    };
    cases: CaseResult[];
};

type RedactionAdapter = {
    name: string;
    run(entry: CorpusEntry): Promise<unknown>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'redaction-benchmark-corpus.json');
const ENTITY_TYPES: RedactionEntityType[] = [
    'person',
    'date',
    'phone',
    'address',
    'tax_id',
    'email',
    'organization',
    'identifier',
    'other',
];

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

function createEmptyTypeRecallBreakdown(): Record<RedactionEntityType, TypeRecallBreakdown> {
    return Object.fromEntries(
        ENTITY_TYPES.map((type) => [type, {
            goldCount: 0,
            matchedCount: 0,
            recall: 1,
            criticalGoldCount: 0,
            criticalMatchedCount: 0,
            criticalRecall: 1,
        } satisfies TypeRecallBreakdown]),
    ) as Record<RedactionEntityType, TypeRecallBreakdown>;
}

function finalizeTypeRecallBreakdown(
    breakdown: Record<RedactionEntityType, TypeRecallBreakdown>,
): Record<RedactionEntityType, TypeRecallBreakdown> {
    return Object.fromEntries(
        ENTITY_TYPES.map((type) => {
            const entry = breakdown[type];
            return [type, {
                ...entry,
                recall: toRate(entry.matchedCount, entry.goldCount),
                criticalRecall: toRate(entry.criticalMatchedCount, entry.criticalGoldCount),
            }];
        }),
    ) as Record<RedactionEntityType, TypeRecallBreakdown>;
}

function findOffsets(inputText: string, value: string) {
    const start = inputText.indexOf(value);
    return {
        start,
        end: start >= 0 ? start + value.length : -1,
    };
}

function buildGoldAdapter(): RedactionAdapter {
    return {
        name: 'gold',
        async run(entry) {
            const entities = entry.gold.entities.flatMap((entity) => {
                    const offsets = findOffsets(entry.inputText, entity.text);
                    if (offsets.start < 0 || offsets.end <= offsets.start) return [];
                    return [{
                        type: entity.type,
                        text: entity.text,
                        start: offsets.start,
                        end: offsets.end,
                        replacement: `[${entity.type.toUpperCase()}]`,
                        confidence: 1,
                    }] satisfies RedactionEntity[];
                });

            return {
                schemaVersion: REDACTION_SCHEMA_VERSION,
                redactedText: entry.gold.redactedText,
                entities,
            };
        },
    };
}

async function loadAdapter(adapterModule: string | null): Promise<RedactionAdapter> {
    if (!adapterModule) return buildGoldAdapter();

    const loaded = await import(pathToFileURL(adapterModule).href) as {
        default?: RedactionAdapter | (() => RedactionAdapter);
        createAdapter?: () => RedactionAdapter;
        adapter?: RedactionAdapter;
    };

    if (typeof loaded.createAdapter === 'function') return loaded.createAdapter();
    if (loaded.adapter) return loaded.adapter;
    if (typeof loaded.default === 'function') return loaded.default();
    if (loaded.default) return loaded.default;

    throw new Error('Adapter module must export `createAdapter()`, `adapter`, or a default adapter.');
}

function matchGoldEntities(predicted: RedactionEntity[], expected: GoldEntity[]) {
    const matched = new Set<number>();

    for (const entity of predicted) {
        const probe = normalizeText(entity.text);
        const index = expected.findIndex((gold, goldIndex) =>
            !matched.has(goldIndex)
            && gold.type === entity.type
            && normalizeText(gold.text) === probe,
        );
        if (index >= 0) {
            matched.add(index);
        }
    }

    return matched;
}

function scoreEntityRecall(matched: Set<number>, expected: GoldEntity[]) {
    return toRate(matched.size, expected.length);
}

function collectMissingGoldEntities(expected: GoldEntity[], matched: Set<number>): MissingGoldEntity[] {
    return expected.flatMap((entity, index) =>
        matched.has(index)
            ? []
            : [{
                type: entity.type,
                text: entity.text,
                critical: Boolean(entity.critical),
            }],
    );
}

function collectForbiddenLeaks(redactedText: string, forbiddenTokens: string[]) {
    const haystack = normalizeText(redactedText);
    return forbiddenTokens.filter((token) => haystack.includes(normalizeText(token)));
}

function scoreOffsetIntegrity(inputText: string, entities: RedactionEntity[]) {
    const valid = entities.filter((entity) =>
        entity.start >= 0
        && entity.end > entity.start
        && entity.end <= inputText.length
        && inputText.slice(entity.start, entity.end) === entity.text,
    ).length;

    return toRate(valid, entities.length);
}

export async function runRedactionBenchmark(options: { corpusPath: string; adapterModule: string | null }): Promise<BenchmarkReport> {
    const corpus = readCorpus(options.corpusPath);
    const adapter = await loadAdapter(options.adapterModule);
    const cases: CaseResult[] = [];
    const recallByType = createEmptyTypeRecallBreakdown();

    for (const entry of corpus) {
        const start = performance.now();
        try {
            const raw = await adapter.run(entry);
            const latencyMs = Number((performance.now() - start).toFixed(1));
            const parsed = parseRedactionResult(raw);
            const result = parsed.value;
            const allMatched = parsed.validContract ? matchGoldEntities(result.entities, entry.gold.entities) : new Set<number>();
            const criticalGoldCount = entry.gold.entities.filter((entity) => entity.critical).length;
            const criticalMatchedCount = entry.gold.entities.filter((entity, index) =>
                entity.critical && allMatched.has(index),
            ).length;
            const leakedForbiddenTokens = collectForbiddenLeaks(result.redactedText, entry.gold.forbiddenTokens);

            for (const [index, entity] of entry.gold.entities.entries()) {
                recallByType[entity.type].goldCount += 1;
                if (entity.critical) {
                    recallByType[entity.type].criticalGoldCount += 1;
                }
                if (allMatched.has(index)) {
                    recallByType[entity.type].matchedCount += 1;
                    if (entity.critical) {
                        recallByType[entity.type].criticalMatchedCount += 1;
                    }
                }
            }

            cases.push({
                id: entry.id,
                latencyMs,
                contractValid: parsed.validContract,
                entityRecall: parsed.validContract ? scoreEntityRecall(allMatched, entry.gold.entities) : 0,
                criticalRecall: parsed.validContract ? toRate(criticalMatchedCount, criticalGoldCount) : 0,
                forbiddenLeakCount: leakedForbiddenTokens.length,
                leakedForbiddenTokens,
                missingEntities: parsed.validContract ? collectMissingGoldEntities(entry.gold.entities, allMatched) : entry.gold.entities.map((entity) => ({
                    type: entity.type,
                    text: entity.text,
                    critical: Boolean(entity.critical),
                })),
                offsetIntegrityRate: parsed.validContract ? scoreOffsetIntegrity(entry.inputText, result.entities) : 0,
            });
        } catch (error) {
            const latencyMs = Number((performance.now() - start).toFixed(1));
            cases.push({
                id: entry.id,
                latencyMs,
                contractValid: false,
                entityRecall: 0,
                criticalRecall: 0,
                forbiddenLeakCount: entry.gold.forbiddenTokens.length,
                leakedForbiddenTokens: [...entry.gold.forbiddenTokens],
                missingEntities: entry.gold.entities.map((entity) => ({
                    type: entity.type,
                    text: entity.text,
                    critical: Boolean(entity.critical),
                })),
                offsetIntegrityRate: 0,
                error: error instanceof Error ? error.message : 'Unknown adapter error',
            });
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        schemaVersion: REDACTION_SCHEMA_VERSION,
        corpusPath: options.corpusPath,
        corpusSize: corpus.length,
        adapter: adapter.name,
        metrics: {
            contractValidRate: toRate(cases.filter((entry) => entry.contractValid).length, cases.length),
            entityRecall: average(cases.map((entry) => entry.entityRecall)),
            criticalRecall: average(cases.map((entry) => entry.criticalRecall)),
            forbiddenLeakRate: toRate(cases.filter((entry) => entry.forbiddenLeakCount > 0).length, cases.length),
            offsetIntegrityRate: average(cases.map((entry) => entry.offsetIntegrityRate)),
            avgLatencyMs: average(cases.map((entry) => entry.latencyMs)),
            p95LatencyMs: percentile(cases.map((entry) => entry.latencyMs), 0.95),
            recallByType: finalizeTypeRecallBreakdown(recallByType),
        },
        cases,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const report = await runRedactionBenchmark({
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
