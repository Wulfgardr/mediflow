/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES,
    ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES,
    buildAnyDocLocalExtraction,
    mapAnyDocLocalFailure,
    type LocalAttachmentByteSource,
} from './anydoc-local-extraction-contract';

const source: LocalAttachmentByteSource = { attachmentId: 'synthetic-attachment-001', sourceSha256: 'a'.repeat(64), byteLength: 4096 };
function assertDenied(result: ReturnType<typeof buildAnyDocLocalExtraction>, field: 'source' | 'signal' | 'markdown') {
    assert.equal(result.status, 'denied');
    if (result.status === 'denied') assert.equal(result.field, field);
    assert.equal(result.writes, 0);
    assert.equal(result.apply, 'none');
}

test('success binds minimized Markdown to validated metadata and an outcome receipt', () => {
    const result = buildAnyDocLocalExtraction(source, '\r\n# Lettera sintetica   \r\n\r\n\r\nTerapia da verificare.\0\r\n');
    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.deepEqual(result.provenance, source);
    assert.equal(result.markdown, '# Lettera sintetica\n\nTerapia da verificare.');
    assert.equal(result.receipt.outcome, 'extracted');
    assert.match(result.receipt.receiptId, /^[a-f0-9]{64}$/u);
    assert.equal(result.candidateUse, 'review_only');
    assert.equal(result.writes, 0);
    assert.equal(result.apply, 'none');
});

test('failure receipt distinguishes needsOcr from io for the same source', () => {
    const scan = mapAnyDocLocalFailure(source, 'needsOcr');
    const io = mapAnyDocLocalFailure(source, 'io');
    assert.equal(scan.status, 'review_required');
    assert.equal(io.status, 'review_required');
    if (scan.status !== 'review_required' || io.status !== 'review_required') return;
    assert.equal(scan.reason, 'unsupported_local_extraction');
    assert.equal(scan.detail, 'image_or_scan');
    assert.equal(scan.receipt.outcome, 'review_required:image_or_scan');
    assert.notEqual(scan.receipt.receiptId, io.receipt.receiptId);
});

test('proxy and accessor sources deny without invoking a trap or getter', () => {
    let trapReads = 0;
    const proxy = new Proxy(source, { get() { trapReads += 1; throw new Error('trap'); }, ownKeys() { trapReads += 1; throw new Error('trap'); } });
    let accessorReads = 0;
    const accessor = { ...source, get attachmentId() { accessorReads += 1; throw new Error('getter'); } };
    assert.doesNotThrow(() => assertDenied(buildAnyDocLocalExtraction(proxy, 'synthetic'), 'source'));
    assert.doesNotThrow(() => assertDenied(buildAnyDocLocalExtraction(accessor, 'synthetic'), 'source'));
    assert.equal(trapReads, 0);
    assert.equal(accessorReads, 0);
});

test('non-enumerable, symbol, extra-key and custom-prototype sources deny', () => {
    const nonEnumerable = { ...source };
    Object.defineProperty(nonEnumerable, 'attachmentId', { value: source.attachmentId, enumerable: false, writable: true, configurable: true });
    const withSymbol = { ...source, [Symbol('extra')]: true };
    const withExtra = { ...source, extra: true };
    const customPrototype = Object.assign(Object.create({ inherited: true }), source);
    for (const invalid of [nonEnumerable, withSymbol, withExtra, customPrototype]) assertDenied(buildAnyDocLocalExtraction(invalid, 'synthetic'), 'source');
});

test('invalid digest and byteLength values deny', () => {
    const invalidSources = [
        { ...source, sourceSha256: 'not-a-sha256' },
        { ...source, sourceSha256: 'A'.repeat(64) },
        { ...source, byteLength: 0 },
        { ...source, byteLength: 1.5 },
        { ...source, byteLength: ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES + 1 },
    ];
    for (const invalid of invalidSources) assertDenied(buildAnyDocLocalExtraction(invalid, 'synthetic'), 'source');
});

test('unknown signal denies without coercion or throw', () => {
    assertDenied(mapAnyDocLocalFailure(source, 'unknown') as ReturnType<typeof buildAnyDocLocalExtraction>, 'signal');
    const hostile = new Proxy({}, { get() { throw new Error('signal trap'); } });
    assert.doesNotThrow(() => assertDenied(mapAnyDocLocalFailure(source, hostile) as ReturnType<typeof buildAnyDocLocalExtraction>, 'signal'));
});

test('non-string and oversized Markdown deny without coercion or throw', () => {
    const hostile = new Proxy({}, { get() { throw new Error('markdown trap'); } });
    assert.doesNotThrow(() => assertDenied(buildAnyDocLocalExtraction(source, hostile), 'markdown'));
    assertDenied(buildAnyDocLocalExtraction(source, 42), 'markdown');
    assertDenied(buildAnyDocLocalExtraction(source, 'x'.repeat(ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES + 1)), 'markdown');
});

test('empty canonical Markdown fails closed with a distinct failure receipt', () => {
    const result = buildAnyDocLocalExtraction(source, ' \n\0 ');
    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.detail, 'empty_extraction');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
    assert.equal(result.receipt.outcome, 'review_required:empty_extraction');
});
