/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentParseEvidenceArtifact, serializeDocumentParseEvidenceArtifact } from './domain/documents/document-parse-evidence-artifact';
import { buildLocalAbsorptionTelemetryReportFromInputs } from './local-absorption-telemetry';

test('buildLocalAbsorptionTelemetryReportFromInputs emits PHI-safe counts only', () => {
    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: 'insight-telemetry',
        attachmentId: 'attachment-current',
        fileName: 'synthetic-current.pdf',
        documentDate: '2026-04-20T00:00:00.000Z',
        summary: 'Synthetic follow-up summary.',
        rawMarkdown: 'Follow-up\nSynthetic review planned.',
        diagnoses: [],
        medications: [],
    });

    const report = buildLocalAbsorptionTelemetryReportFromInputs([
        {
            patientId: 'synthetic-patient',
            generatedAt: '2026-05-03T00:00:00.000Z',
            attachments: [
                {
                    id: 'attachment-current',
                    patientId: 'synthetic-patient',
                    fileName: 'synthetic-current.pdf',
                    createdAt: '2026-04-20T00:00:00.000Z',
                    parseEvidenceArtifactSnapshot: serializeDocumentParseEvidenceArtifact(artifact),
                },
                {
                    id: 'attachment-low',
                    patientId: 'synthetic-patient',
                    fileName: 'synthetic-low.pdf',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    summarySnapshot: 'No',
                },
                {
                    id: 'attachment-invalid',
                    patientId: 'synthetic-patient',
                    fileName: 'synthetic-invalid.pdf',
                    createdAt: '2026-04-01T00:00:00.000Z',
                    summarySnapshot: 'Synthetic invalidated summary.',
                    sourceVersion: '2',
                    artifactSourceVersion: '1',
                },
            ],
            diaryEntries: [
                {
                    id: 'entry-deleted',
                    patientId: 'synthetic-patient',
                    date: '2026-04-10T00:00:00.000Z',
                    content: 'Synthetic deleted diary content that must not appear.',
                    deletedAt: '2026-04-11T00:00:00.000Z',
                    version: 2,
                },
            ],
        },
    ]);

    assert.equal(report.schemaVersion, 'mediflow.local_absorption_telemetry.v1');
    assert.equal(report.queueCount, 1);
    assert.equal(report.totals.sources, 4);
    assert.equal(report.totals.byReason.included, 1);
    assert.equal(report.totals.byReason.low_signal, 1);
    assert.equal(report.totals.byReason.invalidated, 1);
    assert.equal(report.totals.byReason.superseded, 1);
    assert.equal(report.totals.staleOrInvalidatedSources, 2);
    assert.equal(report.totals.artifactCoverageRate, 1 / 3);
    assert.deepEqual(report.phiSafety, {
        includesRawText: false,
        includesPatientIdentifiers: false,
        includesPromptsOrModelOutput: false,
    });

    const serialized = JSON.stringify(report);
    assert.ok(!serialized.includes('Synthetic deleted diary content'));
    assert.ok(!serialized.includes('Synthetic invalidated summary'));
    assert.ok(!serialized.includes('synthetic-patient'));
    assert.ok(!serialized.includes('Synthetic review planned'));
});
