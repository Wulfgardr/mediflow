#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildTreatmentReasoningPrompt,
    parseTreatmentReasoningResponse,
    type TreatmentReasoningEvidenceRef,
} from '../lib/treatment-reasoning-contract.ts';

type CorpusEntry = {
    id: string;
    question: string;
    patientContext: string;
    diagnoses?: string[];
    activeTherapies?: string[];
    observations?: string[];
    sources: TreatmentReasoningEvidenceRef[];
    expectedResponse: unknown;
};

type CaseResult = {
    id: string;
    promptChars: number;
    validJson: boolean;
    validTask: boolean;
    validEvidenceRefs: boolean;
    blockedAutoWriteActions: number;
};

type TreatmentReasoningBenchmarkReport = {
    generatedAt: string;
    corpusPath: string;
    corpusSize: number;
    responseDir: string | null;
    metrics: {
        jsonValidRate: number;
        contractValidRate: number;
        evidenceRefValidRate: number;
        blockedAutoWriteActions: number;
        avgPromptChars: number;
    };
    cases: CaseResult[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CORPUS_PATH = path.join(__dirname, 'fixtures', 'treatment-reasoning-corpus.json');

function parseArgs(argv: string[]) {
    const args = {
        corpus: DEFAULT_CORPUS_PATH,
        responses: null as string | null,
        out: null as string | null,
        validate: false,
        minContractRate: 1,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--corpus' && argv[index + 1]) {
            args.corpus = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--responses' && argv[index + 1]) {
            args.responses = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--out' && argv[index + 1]) {
            args.out = path.resolve(argv[index + 1]);
            index += 1;
        } else if (value === '--validate') {
            args.validate = true;
        } else if (value === '--min-contract-rate' && argv[index + 1]) {
            args.minContractRate = Number.parseFloat(argv[index + 1]) || 1;
            index += 1;
        }
    }

    return args;
}

function readCorpus(filePath: string): CorpusEntry[] {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as CorpusEntry[];
}

function readResponse(entry: CorpusEntry, responseDir: string | null): string {
    if (!responseDir) {
        return JSON.stringify(entry.expectedResponse);
    }

    const filePath = path.join(responseDir, `${entry.id}.json`);
    return fs.readFileSync(filePath, 'utf8');
}

function rate(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return Number((numerator / denominator).toFixed(3));
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function countBlockedAutoWriteActions(result: ReturnType<typeof parseTreatmentReasoningResponse>): number {
    return result.value.data.suggestedActions
        .filter((action) => /Automatic clinical writes/i.test(action.blockedReason ?? ''))
        .length;
}

function runBenchmark(options: ReturnType<typeof parseArgs>): TreatmentReasoningBenchmarkReport {
    const corpus = readCorpus(options.corpus);
    const cases = corpus.map((entry): CaseResult => {
        const prompt = buildTreatmentReasoningPrompt({
            question: entry.question,
            patientContext: entry.patientContext,
            diagnoses: entry.diagnoses,
            activeTherapies: entry.activeTherapies,
            observations: entry.observations,
            sources: entry.sources,
        });
        const parsed = parseTreatmentReasoningResponse(readResponse(entry, options.responses), {
            allowedEvidenceIds: entry.sources.map((source) => source.id),
        });

        return {
            id: entry.id,
            promptChars: prompt.length,
            validJson: parsed.validJson,
            validTask: parsed.validTask,
            validEvidenceRefs: parsed.validEvidenceRefs,
            blockedAutoWriteActions: countBlockedAutoWriteActions(parsed),
        };
    });

    return {
        generatedAt: new Date().toISOString(),
        corpusPath: options.corpus,
        corpusSize: corpus.length,
        responseDir: options.responses,
        metrics: {
            jsonValidRate: rate(cases.filter((entry) => entry.validJson).length, cases.length),
            contractValidRate: rate(cases.filter((entry) => entry.validJson && entry.validTask).length, cases.length),
            evidenceRefValidRate: rate(cases.filter((entry) => entry.validEvidenceRefs).length, cases.length),
            blockedAutoWriteActions: cases.reduce((sum, entry) => sum + entry.blockedAutoWriteActions, 0),
            avgPromptChars: average(cases.map((entry) => entry.promptChars)),
        },
        cases,
    };
}

const args = parseArgs(process.argv);
const report = runBenchmark(args);
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (args.out) {
    fs.writeFileSync(args.out, serialized, 'utf8');
} else {
    process.stdout.write(serialized);
}

if (args.validate) {
    const failed = report.metrics.contractValidRate < args.minContractRate
        || report.metrics.evidenceRefValidRate < 1
        || report.metrics.blockedAutoWriteActions > 0;
    if (failed) {
        process.stderr.write('[MediFlow] treatment reasoning benchmark validation failed\n');
        process.exitCode = 1;
    }
}
