import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { inspectPdf, normalizePdfInspection, PdfInspectionError } from './pdf-inspector-router';

/* @Codex */
function minimalTextPdf(): Buffer {
    const stream = Buffer.from([
        'BT /F1 12 Tf 72 720 Td',
        '(REFERTO SINTETICO COMPLETO) Tj',
        '0 -20 Td (DIAGNOSI DI CONTROLLO) Tj',
        '0 -20 Td (TERAPIA CONFERMATA) Tj ET',
    ].join('\n'));
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${stream.length} >>\nstream\n${stream.toString()}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let value = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, index) => {
        offsets.push(Buffer.byteLength(value));
        value += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(value);
    value += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    value += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    value += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(value);
}

/* @Codex */
function minimalImageMaskPdf(): Buffer {
    const content = 'q 100 0 0 100 72 600 cm /Im0 Do Q';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true /BitsPerComponent 1 /Length 1 >>\nstream\n\0\nendstream',
    ];
    let value = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, index) => {
        offsets.push(Buffer.byteLength(value));
        value += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(value);
    value += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    value += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    value += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(value);
}

test('per-page normalization ignores the upstream aggregate page numbering', () => {
    const result = normalizePdfInspection([
        { pageIndex: 0, markdown: '# Prima', needsOcr: false },
        { pageIndex: 1, markdown: '', needsOcr: true },
        { pageIndex: 2, markdown: '# Terza', needsOcr: false },
    ]);
    assert.deepEqual(result.pagesNeedingOcr, [2]);
    assert.equal(result.state, 'mixed');
    assert.equal(result.text, '# Prima\n\n# Terza');
});

test('worker inspection accepts a bounded synthetic native PDF', async () => {
    const result = await inspectPdf(minimalTextPdf());
    assert.equal(result.pageCount, 1);
    assert.equal(result.state, 'native');
    assert.deepEqual(result.pagesNeedingOcr, []);
    assert.match(result.text, /REFERTO SINTETICO COMPLETO/);
});

test('PDF.js compatibility worker emits clean JSON for Intel macOS packaging', () => {
    const run = spawnSync(
        process.execPath,
        [join(process.cwd(), 'scripts', 'pdf-inspector-worker.mjs'), '--pdfjs-fallback'],
        { input: minimalTextPdf(), encoding: 'utf8' },
    );
    assert.equal(run.status, 0);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.schema, 'mediflow.pdf-inspection.v1');
    assert.equal(payload.pages[0].needsOcr, false);
});

test('PDF.js compatibility worker routes image-mask pages to OCR', () => {
    const run = spawnSync(
        process.execPath,
        [join(process.cwd(), 'scripts', 'pdf-inspector-worker.mjs'), '--pdfjs-fallback'],
        { input: minimalImageMaskPdf(), encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stdout);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.pages[0].needsOcr, true);
});

test('empty input fails closed at the resource gate', async () => {
    await assert.rejects(inspectPdf(Buffer.alloc(0)), (error: unknown) => (
        error instanceof PdfInspectionError && error.reason === 'resource_limit'
    ));
});

test('page ceiling is classified as a resource limit', () => {
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

test('third concurrent inspection fails fast at admission control', async () => {
    const input = minimalTextPdf();
    const results = await Promise.allSettled([
        inspectPdf(input),
        inspectPdf(input),
        inspectPdf(input),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.ok(rejected.reason instanceof PdfInspectionError);
    assert.equal(rejected.reason.reason, 'resource_limit');
});
