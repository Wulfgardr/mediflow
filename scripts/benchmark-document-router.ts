/* @Codex */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { routeDocumentClass, type DocumentClassRouterInput } from '../lib/domain/documents/document-class-router';
import type { DocumentDecisionClassification } from '../lib/domain/documents/document-decision';

/* @Codex */
export interface DocumentRouterBenchmarkEntry {
    file: string;
    expectedClass: DocumentDecisionClassification;
    labelSource: string;
    text?: string;
    producer?: string;
    creator?: string;
}

/* @Codex */
export interface DocumentRouterBenchmarkRow {
    file: string;
    expectedClass: DocumentDecisionClassification;
    predictedClass: DocumentDecisionClassification;
    correct: boolean;
    labelSource: string;
    confidence: string;
    signals: string[];
}

/* @Codex */
export interface DocumentRouterClassMetric {
    expectedClass: DocumentDecisionClassification;
    total: number;
    correct: number;
    accuracy: number;
}

/* @Codex */
export interface DocumentRouterConfusion {
    expectedClass: DocumentDecisionClassification;
    predictedClass: DocumentDecisionClassification;
    count: number;
}

/* @Codex */
export interface DocumentRouterBenchmarkReport {
    schemaVersion: 'mediflow.document_router_benchmark.v1';
    total: number;
    correct: number;
    accuracy: number;
    byClass: DocumentRouterClassMetric[];
    confusions: DocumentRouterConfusion[];
    rows: DocumentRouterBenchmarkRow[];
}

/* @Codex */
export const DOCUMENT_ROUTER_SELF_TEST_FIXTURES: DocumentRouterBenchmarkEntry[] = [
    {
        file: '2026-01-12__laboratorio__emocromo_sintetico.pdf',
        expectedClass: 'lab_report',
        labelSource: 'synthetic_filename',
        text: 'Ematologia. Determinazione Risultato Unita Limiti di riferimento.',
        producer: 'JasperReports Library',
    },
    {
        file: '2026-02-03__lettera_dimissione__ortopedia_sintetica.pdf',
        expectedClass: 'specialist_report',
        labelSource: 'synthetic_filename',
        text: 'Lettera di dimissione. Diagnosi alla dimissione: frattura sintetica.',
        producer: 'OpenPDF',
    },
    {
        file: '2026-03-04__protesica__ausilio_sintetico.pdf',
        expectedClass: 'prosthetic_prescription',
        labelSource: 'synthetic_filename',
        text: 'Prescrizione protesica. Codice ISO ausilio sintetico.',
    },
    {
        file: '2026-04-05__certificato_malattia__assenza_sintetica.pdf',
        expectedClass: 'administrative',
        labelSource: 'synthetic_filename',
        text: 'Certificato di malattia. Prognosi di giorni tre.',
    },
];

const VALID_CLASSES: ReadonlySet<string> = new Set([
    'identity_document',
    'medication_prescription',
    'specialist_service_prescription',
    'lab_prescription',
    'imaging_prescription',
    'screening_prescription_or_invitation',
    'specialist_report',
    'lab_report',
    'imaging_report',
    'exemption_document',
    'prosthetic_prescription',
    'administrative',
    'mute_or_scanned',
    'unknown',
]);

function isDocumentDecisionClassification(value: unknown): value is DocumentDecisionClassification {
    return typeof value === 'string' && VALID_CLASSES.has(value);
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
    const value = record[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${path}.${key} must be a non-empty string`);
    }
    return value;
}

function readOptionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string when present`);
    return value;
}

/* @Codex */
export function parseDocumentRouterManifest(payload: unknown): DocumentRouterBenchmarkEntry[] {
    const entries: unknown[] | null = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).entries)
            ? (payload as { entries: unknown[] }).entries
            : null;

    if (!entries) throw new Error('Manifest must be an array or an object with entries[]');

    return entries.map((entry, index): DocumentRouterBenchmarkEntry => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`entries[${index}] must be an object`);
        }
        const record = entry as Record<string, unknown>;
        const expectedClass = record.expectedClass;
        if (!isDocumentDecisionClassification(expectedClass)) {
            throw new Error(`entries[${index}].expectedClass is not a supported document class`);
        }
        return {
            file: readString(record, 'file', `entries[${index}]`),
            expectedClass,
            labelSource: readString(record, 'labelSource', `entries[${index}]`),
            text: readOptionalString(record, 'text', `entries[${index}]`),
            producer: readOptionalString(record, 'producer', `entries[${index}]`),
            creator: readOptionalString(record, 'creator', `entries[${index}]`),
        };
    });
}

/* @Codex */
export async function loadDocumentRouterManifest(manifestPath: string): Promise<DocumentRouterBenchmarkEntry[]> {
    const raw = await readFile(manifestPath, 'utf8');
    return parseDocumentRouterManifest(JSON.parse(raw));
}

function routerInputFor(entry: DocumentRouterBenchmarkEntry): DocumentClassRouterInput {
    return {
        fileName: entry.file,
        textSample: entry.text,
        producer: entry.producer,
        creator: entry.creator,
    };
}

function roundMetric(value: number): number {
    return Number(value.toFixed(4));
}

/* @Codex */
export function runDocumentRouterBenchmark(entries: DocumentRouterBenchmarkEntry[]): DocumentRouterBenchmarkReport {
    const rows = entries.map((entry): DocumentRouterBenchmarkRow => {
        const routed = routeDocumentClass(routerInputFor(entry));
        return {
            file: entry.file,
            expectedClass: entry.expectedClass,
            predictedClass: routed.classification,
            correct: routed.classification === entry.expectedClass,
            labelSource: entry.labelSource,
            confidence: routed.confidence,
            signals: routed.signals,
        };
    });

    const byClassMap = new Map<DocumentDecisionClassification, { total: number; correct: number }>();
    const confusionMap = new Map<string, DocumentRouterConfusion>();
    for (const row of rows) {
        const current = byClassMap.get(row.expectedClass) ?? { total: 0, correct: 0 };
        current.total += 1;
        if (row.correct) current.correct += 1;
        byClassMap.set(row.expectedClass, current);

        if (!row.correct) {
            const key = `${row.expectedClass}->${row.predictedClass}`;
            const currentConfusion = confusionMap.get(key) ?? {
                expectedClass: row.expectedClass,
                predictedClass: row.predictedClass,
                count: 0,
            };
            currentConfusion.count += 1;
            confusionMap.set(key, currentConfusion);
        }
    }

    const correct = rows.filter((row) => row.correct).length;
    const byClass = Array.from(byClassMap.entries())
        .map(([expectedClass, metric]) => ({
            expectedClass,
            total: metric.total,
            correct: metric.correct,
            accuracy: roundMetric(metric.total === 0 ? 0 : metric.correct / metric.total),
        }))
        .sort((a, b) => a.expectedClass.localeCompare(b.expectedClass));

    return {
        schemaVersion: 'mediflow.document_router_benchmark.v1',
        total: rows.length,
        correct,
        accuracy: roundMetric(rows.length === 0 ? 0 : correct / rows.length),
        byClass,
        confusions: Array.from(confusionMap.values()).sort((a, b) => (
            a.expectedClass.localeCompare(b.expectedClass)
            || a.predictedClass.localeCompare(b.predictedClass)
        )),
        rows,
    };
}

function table(headers: string[], rows: string[][]): string {
    return [
        headers.join(' | '),
        headers.map(() => '---').join(' | '),
        ...rows.map((row) => row.join(' | ')),
    ].join('\n');
}

/* @Codex */
export function formatDocumentRouterBenchmarkReport(report: DocumentRouterBenchmarkReport): string {
    const summary = [
        `schemaVersion: ${report.schemaVersion}`,
        `total: ${report.total}`,
        `correct: ${report.correct}`,
        `accuracy: ${report.accuracy}`,
    ].join('\n');
    const byClass = table(
        ['class', 'total', 'correct', 'accuracy'],
        report.byClass.map((metric) => [
            metric.expectedClass,
            String(metric.total),
            String(metric.correct),
            String(metric.accuracy),
        ]),
    );
    const confusions = report.confusions.length === 0
        ? 'No confusions.'
        : table(
            ['expected', 'predicted', 'count'],
            report.confusions.map((item) => [
                item.expectedClass,
                item.predictedClass,
                String(item.count),
            ]),
        );
    return `${summary}\n\nBy class\n${byClass}\n\nConfusions\n${confusions}`;
}

async function main(argv: string[]): Promise<void> {
    const selfTest = argv.includes('--self-test');
    const manifestFlagIndex = argv.indexOf('--manifest');
    const manifestPath = manifestFlagIndex >= 0 ? argv[manifestFlagIndex + 1] : argv.find((arg) => !arg.startsWith('--'));
    if (!selfTest && !manifestPath) {
        throw new Error('Usage: benchmark-document-router --self-test OR benchmark-document-router --manifest <manifest.json>');
    }

    const entries = selfTest
        ? DOCUMENT_ROUTER_SELF_TEST_FIXTURES
        : await loadDocumentRouterManifest(manifestPath as string);
    const report = runDocumentRouterBenchmark(entries);
    console.log(formatDocumentRouterBenchmarkReport(report));

    if (selfTest && report.accuracy !== 1) {
        process.exitCode = 1;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2)).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
