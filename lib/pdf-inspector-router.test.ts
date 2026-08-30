import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfInspectorRouter from './pdf-inspector-router';
import { normalizePdfInspection, PdfInspectionError } from './pdf-inspector-router';

test('retired PDF inspection module exposes no executable inspection API', () => {
    assert.equal('inspectPdf' in pdfInspectorRouter, false);
    assert.equal('PDF_INSPECTOR_MAX_BYTES' in pdfInspectorRouter, false);
});

test('pure per-page normalization remains available during retirement', () => {
    const result = normalizePdfInspection([
        { pageIndex: 0, markdown: '# Prima', needsOcr: false },
        { pageIndex: 1, markdown: '', needsOcr: true },
        { pageIndex: 2, markdown: '# Terza', needsOcr: false },
    ]);
    assert.deepEqual(result.pagesNeedingOcr, [2]);
    assert.equal(result.state, 'mixed');
    assert.equal(result.text, '# Prima\n\n# Terza');
});

test('pure normalization still classifies the retired page ceiling', () => {
    const pages = Array.from({ length: 501 }, (_, pageIndex) => ({
        pageIndex,
        markdown: 'testo sintetico',
        needsOcr: false,
    }));
    assert.throws(
        () => normalizePdfInspection(pages),
        (error: unknown) => error instanceof PdfInspectionError && error.reason === 'resource_limit',
    );
});
