#!/usr/bin/env node

/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import {
    runEvidenceAbsorptionBenchmark,
    type EvidenceAbsorptionBenchmarkCase,
    type EvidenceAbsorptionBenchmarkReport,
} from '../lib/evidence-absorption-benchmark';

type CliArgs = {
    corpus: string;
    out: string | null;
    markdownOut: string | null;
    validate: boolean;
};

const DEFAULT_CORPUS = 'scripts/fixtures/evidence-absorption-benchmark-corpus.json';

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        corpus: path.resolve(DEFAULT_CORPUS),
        out: null,
        markdownOut: null,
        validate: false,
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
        } else if (value === '--validate') {
            args.validate = true;
        } else {
            throw new Error(`Unknown or incomplete argument: ${value}`);
        }
    }

    return args;
}

function loadCorpus(filePath: string): EvidenceAbsorptionBenchmarkCase[] {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Evidence absorption corpus must be a JSON array.');
    return parsed as EvidenceAbsorptionBenchmarkCase[];
}

function writeOutput(filePath: string, value: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
}

function renderMarkdown(report: EvidenceAbsorptionBenchmarkReport): string {
    return [
        '# Evidence Absorption Benchmark',
        '',
        `Schema: \`${report.schemaVersion}\``,
        `Generated: \`${report.generatedAt}\``,
        `Cases: ${report.caseCount}`,
        '',
        '## Aggregate',
        '',
        `- relevantSourceRecall: ${report.aggregate.relevantSourceRecall.toFixed(3)}`,
        `- citationCoverage: ${report.aggregate.citationCoverage.toFixed(3)}`,
        `- citationCorrectness: ${report.aggregate.citationCorrectness.toFixed(3)}`,
        `- staleLeakageRate: ${report.aggregate.staleLeakageRate.toFixed(3)}`,
        `- negativeAssertionLeakage: ${report.aggregate.negativeAssertionLeakage.toFixed(3)}`,
        `- diaryEvidenceCoverage: ${report.aggregate.diaryEvidenceCoverage.toFixed(3)}`,
        `- attachmentEvidenceCoverage: ${report.aggregate.attachmentEvidenceCoverage.toFixed(3)}`,
        '',
        '## Cases',
        '',
        '| Case | Source recall | Citation coverage | Citation correctness | Stale leakage | Negative leakage | Diary coverage | Attachment coverage | Findings |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
        ...report.cases.map((item) => [
            item.id,
            item.relevantSourceRecall.toFixed(3),
            item.citationCoverage.toFixed(3),
            item.citationCorrectness.toFixed(3),
            item.staleLeakageRate.toFixed(3),
            item.negativeAssertionLeakage.toFixed(3),
            item.diaryEvidenceCoverage.toFixed(3),
            item.attachmentEvidenceCoverage.toFixed(3),
            item.findings.join(', ') || 'none',
        ].join(' | ')).map((row) => `| ${row} |`),
        '',
    ].join('\n');
}

function validationFailures(report: EvidenceAbsorptionBenchmarkReport): string[] {
    const failures: string[] = [];
    const normalCases = report.cases.filter((item) => item.id !== 'adversarial-fabricated-citation');
    const normalAverage = (field: keyof EvidenceAbsorptionBenchmarkReport['cases'][number]) => {
        const values = normalCases
            .map((item) => item[field])
            .filter((value): value is number => typeof value === 'number');
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 1;
    };

    if (normalAverage('relevantSourceRecall') < 1) failures.push('relevantSourceRecall below 1');
    if (normalAverage('citationCoverage') < 1) failures.push('citationCoverage below 1');
    if (normalAverage('citationCorrectness') < 1) failures.push('citationCorrectness below 1');
    if (normalAverage('staleLeakageRate') > 0) failures.push('staleLeakageRate above 0');
    if (normalAverage('negativeAssertionLeakage') > 0) failures.push('negativeAssertionLeakage above 0');
    if (normalAverage('diaryEvidenceCoverage') < 1) failures.push('diaryEvidenceCoverage below 1');
    if (normalAverage('attachmentEvidenceCoverage') < 1) failures.push('attachmentEvidenceCoverage below 1');

    const adversarial = report.cases.find((item) => item.id === 'adversarial-fabricated-citation');
    if (!adversarial || adversarial.citationCorrectness >= 1 || !adversarial.findings.includes('citation_correctness')) {
        failures.push('adversarial fabricated citation did not fail citation_correctness');
    }

    return failures;
}

function main(): void {
    const args = parseArgs(process.argv);
    const report = runEvidenceAbsorptionBenchmark(loadCorpus(args.corpus));
    const json = JSON.stringify(report, null, 2) + '\n';

    if (args.out) {
        writeOutput(args.out, json);
    } else {
        process.stdout.write(json);
    }

    if (args.markdownOut) {
        writeOutput(args.markdownOut, renderMarkdown(report));
    }

    process.stderr.write([
        `evidence absorption benchmark: cases=${report.caseCount}`,
        `sourceRecall=${report.aggregate.relevantSourceRecall.toFixed(3)}`,
        `citationCorrectness=${report.aggregate.citationCorrectness.toFixed(3)}`,
        `staleLeakage=${report.aggregate.staleLeakageRate.toFixed(3)}`,
    ].join(' ') + '\n');

    if (args.validate) {
        const failures = validationFailures(report);
        if (failures.length > 0) {
            throw new Error(`Evidence absorption validation failed: ${failures.join('; ')}`);
        }
    }
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
}
