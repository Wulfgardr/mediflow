/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DOCUMENT_ROUTER_SELF_TEST_FIXTURES,
    formatDocumentRouterBenchmarkReport,
    parseDocumentRouterManifest,
    runDocumentRouterBenchmark,
} from './benchmark-document-router';

test('document router benchmark self-test fixtures classify cleanly', () => {
    const report = runDocumentRouterBenchmark(DOCUMENT_ROUTER_SELF_TEST_FIXTURES);

    assert.equal(report.schemaVersion, 'mediflow.document_router_benchmark.v1');
    assert.equal(report.total, 4);
    assert.equal(report.accuracy, 1);
    assert.deepEqual(report.confusions, []);
    assert.deepEqual(
        report.skipDecisions.map((metric) => [metric.classification, metric.wouldSkip]),
        [
            ['administrative', 0],
            ['lab_report', 1],
            ['prosthetic_prescription', 0],
            ['specialist_report', 0],
        ],
    );
});

test('document router benchmark reports class-level metrics and confusions', () => {
    const entries = parseDocumentRouterManifest({
        entries: [
            {
                file: '2026-01-01__laboratorio__sintetico.pdf',
                expectedClass: 'lab_report',
                labelSource: 'synthetic',
                text: 'Determinazione Risultato Unita Limiti di riferimento',
            },
            {
                file: 'scan_sconosciuto.pdf',
                expectedClass: 'lab_report',
                labelSource: 'synthetic',
                text: 'testo generico senza testata utile',
            },
        ],
    });
    const report = runDocumentRouterBenchmark(entries);
    const formatted = formatDocumentRouterBenchmarkReport(report);

    assert.equal(report.total, 2);
    assert.equal(report.correct, 1);
    assert.equal(report.byClass[0]?.expectedClass, 'lab_report');
    assert.equal(report.confusions[0]?.predictedClass, 'unknown');
    assert.match(formatted, /By class/);
    assert.match(formatted, /Confusions/);
    assert.match(formatted, /Deterministic skip decisions/);
});

test('document router manifest parser validates required fields', () => {
    assert.throws(
        () => parseDocumentRouterManifest({ entries: [{ file: 'x.pdf', expectedClass: 'not-a-class', labelSource: 'synthetic' }] }),
        /expectedClass/,
    );
});
