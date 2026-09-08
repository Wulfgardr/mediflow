/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    ANYDOC_LOCAL_OCR_PROVENANCE_SCHEMA_VERSION,
    buildAnyDocLocalExtraction,
    type LocalExtractionResult,
} from '../../domain/documents/anydoc-local-extraction-contract.ts';
import { resolveDocumentSynthesisAnyDocProjection } from './document-synthesis-production-operation.ts';

// Contract fixtures only: no OCR engine, source authority or clinical record is simulated as real.
const ATTACHMENT = 'attachment.synthetic.ocr.projection';
const BYTES = Buffer.from('Entirely synthetic source bytes for a contract test.', 'utf8');
const TEXT = 'Qualità locale.\n12/03/2026 quantità 25 mg.';
function extraction(engine?: 'apple_vision' | 'tesseract_wasm') {
    const result = buildAnyDocLocalExtraction({ attachmentId: ATTACHMENT,
        sourceSha256: createHash('sha256').update(BYTES).digest('hex'), byteLength: BYTES.length,
    }, TEXT, engine === undefined ? undefined : {
        schemaVersion: ANYDOC_LOCAL_OCR_PROVENANCE_SCHEMA_VERSION, engine,
        scriptSha256: 'a'.repeat(64), receiptSetSha256: 'b'.repeat(64), pageCount: 2, ocrPageCount: 1,
    });
    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') throw new Error('Synthetic extraction contract rejected');
    return result;
}
function assertBlocked(value: unknown, attachmentId = ATTACHMENT) {
    assert.equal(resolveDocumentSynthesisAnyDocProjection(value as LocalExtractionResult, attachmentId), null);
}

for (const engine of [undefined, 'apple_vision', 'tesseract_wasm'] as const) {
    test(`AnyDoc projection preserves ${engine ?? 'native text'} without changing case or review status`, () => {
        const result = extraction(engine);
        const before = JSON.stringify(result);
        const projection = resolveDocumentSynthesisAnyDocProjection(result, ATTACHMENT);
        assert.ok(projection);
        assert.equal(projection.sourceKind, engine === undefined ? 'native_text' : 'ocr_text');
        assert.equal(projection.sourceText, TEXT);
        assert.equal(projection.classification, 'review_required');
        assert.equal(Object.isFrozen(projection), true);
        assert.equal(JSON.stringify(result), before);
        assert.deepEqual([result.review, result.writes, result.apply, result.candidateUse],
            ['required', 0, 'none', 'review_only']);
    });
}

test('AnyDoc projection accepts the frozen null-prototype OCR receipt shape published by composition', () => {
    for (const engine of ['apple_vision', 'tesseract_wasm'] as const) {
        const result = extraction(engine);
        const published = Object.freeze(Object.assign(Object.create(null), result, {
            provenance: Object.freeze(Object.assign(Object.create(null), result.provenance)),
            receipt: Object.freeze(Object.assign(Object.create(null), result.receipt, {
                ocrProvenance: Object.freeze(Object.assign(Object.create(null), result.receipt.ocrProvenance)),
            })),
        }));
        assert.equal(resolveDocumentSynthesisAnyDocProjection(published, ATTACHMENT)?.sourceKind, 'ocr_text');
    }
});

test('AnyDoc projection rejects invalid OCR metadata instead of silently classifying it as native', () => {
    const result = extraction('tesseract_wasm');
    const valid = result.receipt.ocrProvenance!;
    for (const ocrProvenance of [null, undefined,
        { ...valid, engine: 'unqualified_engine' },
        { ...valid, schemaVersion: 'unsupported.v1' },
        { ...valid, scriptSha256: 'invalid' },
        { ...valid, receiptSetSha256: 'invalid' },
        { ...valid, pageCount: 501 }, { ...valid, pageCount: 0 },
        { ...valid, ocrPageCount: 0 }, { ...valid, ocrPageCount: 3 },
        { ...valid, ocrPageCount: 1.5 }, { ...valid, extra: true },
    ]) assertBlocked({ ...result, receipt: { ...result.receipt, ocrProvenance } });
});

test('AnyDoc projection keeps exact attachment, source and Markdown bindings for both OCR engines', () => {
    for (const engine of ['apple_vision', 'tesseract_wasm'] as const) {
        const result = extraction(engine);
        assertBlocked(result, 'attachment.synthetic.other');
        assertBlocked({ ...result, markdown: TEXT.replace('quantità', 'Quantità') });
        for (const receipt of [
            { ...result.receipt, sourceSha256: '0'.repeat(64) },
            { ...result.receipt, sourceByteLength: BYTES.length + 1 },
            { ...result.receipt, markdownSha256: '0'.repeat(64) },
            { ...result.receipt, markdownByteLength: TEXT.length }, // UTF-16 length is not UTF-8 length.
        ]) assertBlocked({ ...result, receipt });
    }
});

test('AnyDoc projection does not turn blocked or writable results into a review candidate', () => {
    const result = extraction('tesseract_wasm');
    for (const change of [
        { status: 'review_required' }, { status: 'denied' }, { candidateUse: 'blocked' },
        { writes: 1 }, { review: 'optional' }, { apply: 'automatic' },
    ]) assertBlocked({ ...result, ...change });
});
