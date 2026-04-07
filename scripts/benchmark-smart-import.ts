#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeOllamaBaseUrl } from './ollama-base-url.ts';
import {
    buildSmartImportExtractionPrompt,
    parseSmartImportExtractionResponse,
    type SmartImportDiagnosisExtraction,
    type SmartImportTherapyExtraction,
    type TherapySuggestionState,
} from '../lib/ai-task-contracts.ts';

type SmartImportBenchmarkArchetype =
    | 'mixed-profile'
    | 'discharge-letter'
    | 'emergency-report'
    | 'specialist-report'
    | 'clinical-relation'
    | 'referral'
    | 'rehab-adi';

const SMART_IMPORT_ARCHETYPES: SmartImportBenchmarkArchetype[] = [
    'mixed-profile',
    'discharge-letter',
    'emergency-report',
    'specialist-report',
    'clinical-relation',
    'referral',
    'rehab-adi',
];

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
    archetype?: SmartImportBenchmarkArchetype;
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
    archetype: SmartImportBenchmarkArchetype;
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
    reviewUsefulnessRate: number;
    forbiddenLeakCount: number;
    alreadyPresentLeakCount: number;
    error?: string;
};

type ArchetypeMetrics = {
    archetype: SmartImportBenchmarkArchetype;
    caseCount: number;
    jsonValidRate: number;
    contractValidRate: number;
    diagnosisRecall: number;
    diagnosisQueryRecall: number;
    therapyRecall: number;
    dosageRecall: number;
    therapyStateRecall: number;
    sourceIdRate: number;
    reviewUsefulnessRate: number;
    forbiddenLeakRate: number;
    alreadyPresentLeakRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
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
        reviewUsefulnessRate: number;
        forbiddenLeakRate: number;
        alreadyPresentLeakRate: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
    };
    archetypes?: ArchetypeMetrics[];
    cases?: CaseResult[];
    error?: string;
};

export type SmartImportBenchmarkReport = {
    generatedAt: string;
    baseUrl: string;
    corpusPath: string;
    corpusSize: number;
    corpusArchetypes: SmartImportBenchmarkArchetype[];
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
const NO_NOVELTY_BACKGROUND_MARKERS = /\b(gia noto|gia presente|profilo cronico|cronico|stabile|terapia domiciliare|domiciliar)\b/;
const NO_NOVELTY_FOLLOW_UP_MARKERS = /\b(controllo|follow up|richiesta di visita|impegnativa|rivalutaz|valutare)\b/;
const NO_NOVELTY_CONTINUATION_MARKERS = /\b(continuare|proseguire|mantenere|come da piano in corso|senza variazioni|senza novita|nessuna novita|nessun cambiamento)\b/;
const NO_NOVELTY_CHANGE_MARKERS = /\b(nuov|peggior|riacut|acut|switch|passare a|sostit|sospend|interromp|inizia|introd|increment|aument|ridurr|modifica posolog|titolaz|decrement|dimission)\b/;

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

function normalizeArchetype(value: unknown): SmartImportBenchmarkArchetype {
    return SMART_IMPORT_ARCHETYPES.includes(value as SmartImportBenchmarkArchetype)
        ? value as SmartImportBenchmarkArchetype
        : 'mixed-profile';
}

function getRecordArray(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
    const value = payload[key];
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is Record<string, unknown> => (
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    ));
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function buildProbeTokens(...values: Array<string | undefined>): string[] {
    return Array.from(new Set(
        values
            .flatMap((value) => normalizeText(value || '').split(/\s+/))
            .map((token) => token.trim())
            .filter((token) => token.length >= 3 || /^[0-9]+$/.test(token))
    ));
}

function normalizeTherapyStateForBenchmark(therapy: SmartImportTherapyExtraction): TherapySuggestionState {
    const probe = normalizeText([
        therapy.drugMention,
        therapy.drugQuery,
        therapy.activePrinciple,
        therapy.dosage,
        therapy.motivation,
        therapy.reviewNote,
        therapy.evidence,
    ].filter(Boolean).join(' '));
    const explicitState = therapy.therapyState;
    const switchLike = /switch|passa a|passare a|sostit|transizion|scal|titol|sospend(?:ere|e).*(?:iniz|pass|switch|sostit)/.test(probe);
    const consultiveLike = /proporr|propost|considerar|eventual|se necessario|al bisogno|\bprn\b|rivalutar|da rivalutare|monitorare prima|trial terapeutico/.test(probe);
    const titrationLike = /aumentar|incrementar|ridurr|decrementar|modifica posolog|titolaz|titolare|portare a/.test(probe);

    if (explicitState === 'inactive' && switchLike) return 'transition';
    if (consultiveLike && !switchLike) return 'uncertain';
    if (titrationLike && !switchLike && !consultiveLike) return 'active';
    if (explicitState === 'transition') return 'transition';
    if (explicitState === 'uncertain') return 'uncertain';
    if (explicitState === 'inactive') return 'inactive';

    if (switchLike) return 'transition';
    if (consultiveLike) return 'uncertain';
    if (titrationLike) return 'active';
    if (/da verificare|da confermare|incert|non chiar|dubb|valutar|\?/.test(probe)) return 'uncertain';
    if (/sospes|interrott|stop|terminat|conclus|discontinuat/.test(probe)) return 'inactive';

    return explicitState || 'active';
}

function isNoClinicalNoveltyContextForBenchmark(value: string): boolean {
    const normalized = normalizeText(value);
    if (!normalized) return false;
    if (NO_NOVELTY_CHANGE_MARKERS.test(normalized)) return false;

    const hasBackground = NO_NOVELTY_BACKGROUND_MARKERS.test(normalized);
    const hasFollowUp = NO_NOVELTY_FOLLOW_UP_MARKERS.test(normalized);
    const hasContinuation = NO_NOVELTY_CONTINUATION_MARKERS.test(normalized);

    return (hasBackground && hasFollowUp)
        || (hasBackground && hasContinuation)
        || (hasFollowUp && hasContinuation);
}

function matchesExistingText(existingTexts: string[], tokens: string[]): boolean {
    if (tokens.length === 0) return false;
    return existingTexts.some((text) => includesAllTokens(text, tokens));
}

function collectCurrentDiagnosisTexts(payload: Record<string, unknown>): string[] {
    return getRecordArray(payload, 'currentDiagnoses')
        .map((diagnosis) => [
            stringValue(diagnosis.system),
            stringValue(diagnosis.code),
            stringValue(diagnosis.description),
        ].filter(Boolean).join(' '))
        .filter(Boolean);
}

function collectCurrentTherapies(payload: Record<string, unknown>) {
    return getRecordArray(payload, 'currentActiveTherapies')
        .map((therapy) => ({
            label: [
                stringValue(therapy.drugName),
                stringValue(therapy.activePrinciple),
                stringValue(therapy.aic),
                stringValue(therapy.atc),
            ].filter(Boolean).join(' '),
            dosage: stringValue(therapy.dosage),
        }))
        .filter((therapy) => therapy.label.length > 0);
}

function buildSourceContentMap(payload: Record<string, unknown>): Map<string, string> {
    return new Map(
        getRecordArray(payload, 'sources')
            .map((source) => {
                const id = stringValue(source.id);
                const content = stringValue(source.content);
                return id && content ? [id, content] : null;
            })
            .filter((entry): entry is [string, string] => Boolean(entry))
    );
}

function hasValidSourceId(
    suggestion: SmartImportDiagnosisExtraction | SmartImportTherapyExtraction,
    allowedSourceIds: Set<string>
): boolean {
    const sourceId = 'sourceId' in suggestion ? suggestion.sourceId : undefined;
    return typeof sourceId === 'string' && allowedSourceIds.has(sourceId);
}

function isDiagnosisAlreadyPresent(
    diagnosis: SmartImportDiagnosisExtraction,
    currentDiagnosisTexts: string[]
): boolean {
    const tokenGroups = [
        buildProbeTokens(diagnosis.label),
        buildProbeTokens(diagnosis.icdQuery),
        buildProbeTokens(diagnosis.explicitCode),
    ].filter((tokens) => tokens.length > 0);

    return tokenGroups.some((tokens) => matchesExistingText(currentDiagnosisTexts, tokens));
}

function matchCurrentTherapy(
    therapy: Pick<SmartImportTherapyExtraction, 'drugMention' | 'activePrinciple' | 'drugQuery' | 'dosage'>,
    currentTherapies: Array<{ label: string; dosage: string }>
) {
    const therapyTokenGroups = [
        buildProbeTokens(therapy.activePrinciple),
        buildProbeTokens(therapy.drugMention),
        buildProbeTokens(therapy.drugQuery),
    ].filter((tokens) => tokens.length > 0);
    if (therapyTokenGroups.length === 0) {
        return { related: false, exact: false };
    }

    const relatedMatches = currentTherapies.filter((existing) => (
        therapyTokenGroups.some((tokens) => includesAllTokens(existing.label, tokens))
    ));
    if (relatedMatches.length === 0) {
        return { related: false, exact: false };
    }

    const dosageTokens = buildProbeTokens(therapy.dosage);
    const exact = dosageTokens.length === 0
        ? true
        : relatedMatches.some((existing) => includesAllTokens(existing.dosage, dosageTokens));

    return {
        related: true,
        exact,
    };
}

function readCorpus(filePath: string): SmartImportBenchmarkEntry[] {
    const rawEntries = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SmartImportBenchmarkEntry[];
    return rawEntries.map((entry) => ({
        ...entry,
        archetype: normalizeArchetype(entry.archetype),
    }));
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

function scoreCase(entry: SmartImportBenchmarkEntry, parsed: ReturnType<typeof parseSmartImportExtractionResponse>): Omit<CaseResult, 'id' | 'archetype' | 'iteration' | 'latencyMs' | 'validJson' | 'validTask' | 'error'> {
    const rawDiagnoses = parsed.value.data.diagnoses;
    const rawTherapies = parsed.value.data.therapies.map((therapy) => ({
        ...therapy,
        therapyState: normalizeTherapyStateForBenchmark(therapy),
    }));
    const allowedSourceIds = new Set(
        Array.isArray(entry.payload.sources)
            ? entry.payload.sources
                .map((source) => (source && typeof source === 'object' ? (source as { id?: unknown }).id : undefined))
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
            : [],
    );
    const currentDiagnosisTexts = collectCurrentDiagnosisTexts(entry.payload);
    const currentTherapies = collectCurrentTherapies(entry.payload);
    const sourceContentById = buildSourceContentMap(entry.payload);
    const diagnoses = rawDiagnoses.filter((diagnosis) => {
        const context = [sourceContentById.get(diagnosis.sourceId || ''), diagnosis.evidence].filter(Boolean).join(' ');
        return !(isDiagnosisAlreadyPresent(diagnosis, currentDiagnosisTexts) && isNoClinicalNoveltyContextForBenchmark(context));
    });
    const therapies = rawTherapies.filter((therapy) => {
        const context = [sourceContentById.get(therapy.sourceId || ''), therapy.evidence].filter(Boolean).join(' ');
        return !(matchCurrentTherapy(therapy, currentTherapies).exact && isNoClinicalNoveltyContextForBenchmark(context));
    });

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
    const usefulDiagnosisTargets = expectedDiagnoses.filter((expected) => (
        !matchesExistingText(currentDiagnosisTexts, expected.labelTokens)
    ));
    const usefulDiagnosisHits = usefulDiagnosisTargets.filter((expected) => {
        const match = findDiagnosisMatch(diagnoses, expected);
        return Boolean(match && hasValidSourceId(match, allowedSourceIds));
    }).length;
    const usefulTherapyTargets = expectedTherapies.filter((expected) => {
        if (expected.therapyState && expected.therapyState !== 'active') {
            return true;
        }
        return !matchCurrentTherapy({
            drugMention: expected.drugTokens.join(' '),
            activePrinciple: expected.drugTokens.join(' '),
            drugQuery: expected.drugTokens.join(' '),
            dosage: expected.dosageTokens?.join(' '),
        }, currentTherapies).exact;
    });
    const usefulTherapyHits = usefulTherapyTargets.filter((expected) => {
        const match = findTherapyMatch(therapies, expected);
        if (!match || !hasValidSourceId(match, allowedSourceIds)) return false;
        if (expected.dosageTokens?.length && !includesAllTokens(match.dosage || '', expected.dosageTokens)) {
            return false;
        }
        if (expected.therapyState && match.therapyState !== expected.therapyState) {
            return false;
        }
        return true;
    }).length;

    const forbiddenDiagnosisHits = (entry.expected.forbiddenDiagnosisTokens || []).filter((tokens) => (
        diagnoses.some((diagnosis) => includesAllTokens([diagnosis.label, diagnosis.icdQuery].join(' '), tokens))
    )).length;
    const forbiddenTherapyHits = (entry.expected.forbiddenTherapyTokens || []).filter((tokens) => (
        therapies.some((therapy) => includesAllTokens([therapy.drugMention, therapy.activePrinciple, therapy.drugQuery].join(' '), tokens))
    )).length;
    const alreadyPresentDiagnosisLeaks = diagnoses.filter((diagnosis) => (
        isDiagnosisAlreadyPresent(diagnosis, currentDiagnosisTexts)
    )).length;
    const alreadyPresentTherapyLeaks = therapies.filter((therapy) => (
        (therapy.therapyState || 'active') === 'active'
        && matchCurrentTherapy(therapy, currentTherapies).exact
    )).length;

    return {
        diagnosisRecall: toRate(diagnosisHits, expectedDiagnoses.length),
        diagnosisQueryRecall: toRate(diagnosisQueryHits, expectedDiagnoses.length),
        therapyRecall: toRate(therapyHits, expectedTherapies.length),
        dosageRecall: toRate(dosageHits, dosageTargets.length),
        therapyStateRecall: toRate(therapyStateHits, therapyStateTargets.length),
        sourceIdRate: toRate(validSourceIdCount, suggestions.length),
        reviewUsefulnessRate: toRate(
            usefulDiagnosisHits + usefulTherapyHits,
            usefulDiagnosisTargets.length + usefulTherapyTargets.length,
        ),
        forbiddenLeakCount: forbiddenDiagnosisHits + forbiddenTherapyHits,
        alreadyPresentLeakCount: alreadyPresentDiagnosisLeaks + alreadyPresentTherapyLeaks,
    };
}

function buildArchetypeBreakdown(cases: CaseResult[]): ArchetypeMetrics[] {
    return SMART_IMPORT_ARCHETYPES
        .map((archetype) => {
            const archetypeCases = cases.filter((entry) => entry.archetype === archetype);
            if (archetypeCases.length === 0) return null;

            const latencies = archetypeCases.map((entry) => entry.latencyMs).filter((value) => value > 0);
            const forbiddenTotal = archetypeCases.reduce((sum, entry) => sum + entry.forbiddenLeakCount, 0);
            const alreadyPresentTotal = archetypeCases.reduce((sum, entry) => sum + entry.alreadyPresentLeakCount, 0);

            return {
                archetype,
                caseCount: archetypeCases.length,
                jsonValidRate: toRate(archetypeCases.filter((entry) => entry.validJson).length, archetypeCases.length),
                contractValidRate: toRate(archetypeCases.filter((entry) => entry.validTask).length, archetypeCases.length),
                diagnosisRecall: average(archetypeCases.map((entry) => entry.diagnosisRecall)),
                diagnosisQueryRecall: average(archetypeCases.map((entry) => entry.diagnosisQueryRecall)),
                therapyRecall: average(archetypeCases.map((entry) => entry.therapyRecall)),
                dosageRecall: average(archetypeCases.map((entry) => entry.dosageRecall)),
                therapyStateRecall: average(archetypeCases.map((entry) => entry.therapyStateRecall)),
                sourceIdRate: average(archetypeCases.map((entry) => entry.sourceIdRate)),
                reviewUsefulnessRate: average(archetypeCases.map((entry) => entry.reviewUsefulnessRate)),
                forbiddenLeakRate: Number((forbiddenTotal / Math.max(1, archetypeCases.length)).toFixed(3)),
                alreadyPresentLeakRate: Number((alreadyPresentTotal / Math.max(1, archetypeCases.length)).toFixed(3)),
                avgLatencyMs: average(latencies),
                p95LatencyMs: percentile(latencies, 0.95),
            };
        })
        .filter((entry): entry is ArchetypeMetrics => Boolean(entry));
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
                        archetype: entry.archetype || 'mixed-profile',
                        iteration,
                        latencyMs: completion.latencyMs,
                        validJson: parsed.validJson,
                        validTask: parsed.validTask,
                        ...scored,
                    });
                } catch (error) {
                    cases.push({
                        id: entry.id,
                        archetype: entry.archetype || 'mixed-profile',
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
                        reviewUsefulnessRate: 0,
                        forbiddenLeakCount: 0,
                        alreadyPresentLeakCount: 0,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        const latencies = cases.map((entry) => entry.latencyMs).filter((value) => value > 0);
        const forbiddenTotal = cases.reduce((sum, entry) => sum + entry.forbiddenLeakCount, 0);
        const alreadyPresentTotal = cases.reduce((sum, entry) => sum + entry.alreadyPresentLeakCount, 0);

        return {
            model,
            status: 'completed',
            cases,
            archetypes: buildArchetypeBreakdown(cases),
            metrics: {
                jsonValidRate: toRate(cases.filter((entry) => entry.validJson).length, cases.length),
                contractValidRate: toRate(cases.filter((entry) => entry.validTask).length, cases.length),
                diagnosisRecall: average(cases.map((entry) => entry.diagnosisRecall)),
                diagnosisQueryRecall: average(cases.map((entry) => entry.diagnosisQueryRecall)),
                therapyRecall: average(cases.map((entry) => entry.therapyRecall)),
                dosageRecall: average(cases.map((entry) => entry.dosageRecall)),
                therapyStateRecall: average(cases.map((entry) => entry.therapyStateRecall)),
                sourceIdRate: average(cases.map((entry) => entry.sourceIdRate)),
                reviewUsefulnessRate: average(cases.map((entry) => entry.reviewUsefulnessRate)),
                forbiddenLeakRate: Number((forbiddenTotal / Math.max(1, cases.length)).toFixed(3)),
                alreadyPresentLeakRate: Number((alreadyPresentTotal / Math.max(1, cases.length)).toFixed(3)),
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
        const leftScore = left.metrics.contractValidRate
            + left.metrics.diagnosisRecall
            + left.metrics.diagnosisQueryRecall
            + left.metrics.therapyRecall
            + left.metrics.dosageRecall
            + left.metrics.therapyStateRecall
            + left.metrics.sourceIdRate
            + left.metrics.reviewUsefulnessRate
            - left.metrics.forbiddenLeakRate
            - left.metrics.alreadyPresentLeakRate;
        const rightScore = right.metrics.contractValidRate
            + right.metrics.diagnosisRecall
            + right.metrics.diagnosisQueryRecall
            + right.metrics.therapyRecall
            + right.metrics.dosageRecall
            + right.metrics.therapyStateRecall
            + right.metrics.sourceIdRate
            + right.metrics.reviewUsefulnessRate
            - right.metrics.forbiddenLeakRate
            - right.metrics.alreadyPresentLeakRate;

        if (rightScore !== leftScore) return rightScore - leftScore;
        return left.metrics.avgLatencyMs - right.metrics.avgLatencyMs;
    });

    return {
        recommendedModel: ranked[0].model,
        rationale: 'Chosen for the best combined contract validity, diagnosis/query recall, therapy/dosage recall, source tracing, review usefulness, and lowest forbidden or already-present leakage.',
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
    const models: ModelReport[] = [];

    for (const model of targetModels) {
        models.push(await runModel(baseUrl, model, corpus, iterations, installedModels));
    }

    return {
        generatedAt: new Date().toISOString(),
        baseUrl,
        corpusPath,
        corpusSize: corpus.length,
        corpusArchetypes: Array.from(new Set(corpus.map((entry) => entry.archetype || 'mixed-profile'))),
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
