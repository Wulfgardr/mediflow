/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION,
    buildAnyDocLocalExtraction,
    mapAnyDocLocalFailure,
    type AnyDocLocalFailureSignal,
    type LocalAttachmentByteSource,
} from './anydoc-local-extraction-contract';

const source: LocalAttachmentByteSource = {
    attachmentId: 'synthetic-attachment-001',
    sourceSha256: 'synthetic-source-sha256-001',
    byteLength: 4096,
};

test('extraction binds minimized Markdown to source provenance and a receipt', () => {
    const result = buildAnyDocLocalExtraction(
        source,
        '\r\n# Lettera sintetica   \r\n\r\n\r\nTerapia da verificare.\0\r\n',
    );

    assert.equal(result.schemaVersion, ANYDOC_LOCAL_EXTRACTION_SCHEMA_VERSION);
    assert.equal(result.status, 'extracted');
    assert.deepEqual(result.provenance, source);
    assert.equal(result.markdown, '# Lettera sintetica\n\nTerapia da verificare.');
    assert.equal(result.receipt.parser, 'anydoc-local');
    assert.equal(result.receipt.sourceSha256, source.sourceSha256);
    assert.equal(result.receipt.sourceByteLength, source.byteLength);
    assert.equal(result.receipt.markdownByteLength, Buffer.byteLength(result.markdown));
    assert.match(result.receipt.markdownSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.match(result.receipt.receiptId, /^[a-f0-9]{64}$/u);
    assert.equal(result.review, 'required');
    assert.equal(result.candidateUse, 'review_only');
    assert.equal(result.writes, 0);
    assert.equal(result.apply, 'none');
});

test('receipt is deterministic for the same source bytes and minimized Markdown', () => {
    const first = buildAnyDocLocalExtraction(source, 'Sintesi sintetica.\n\n\n');
    const second = buildAnyDocLocalExtraction(source, '\r\nSintesi sintetica.\r\n');

    assert.equal(first.receipt.receiptId, second.receipt.receiptId);
    assert.equal(first.receipt.markdownSha256, second.receipt.markdownSha256);
});

test('empty extraction fails closed without Markdown or candidate use', () => {
    const result = buildAnyDocLocalExtraction(source, ' \n\0 ');

    assert.equal(result.status, 'review_required');
    assert.equal(result.reason, 'unsupported_local_extraction');
    assert.equal(result.detail, 'empty_extraction');
    assert.equal(result.markdown, '');
    assert.equal(result.receipt.markdownSha256, undefined);
    assert.equal(result.receipt.markdownByteLength, 0);
    assert.equal(result.candidateUse, 'blocked');
    assert.equal(result.writes, 0);
    assert.equal(result.apply, 'none');
});

test('needsOcr and image-only content fail as unsupported local extraction', () => {
    const result = mapAnyDocLocalFailure(source, 'needsOcr');

    assert.equal(result.status, 'review_required');
    assert.equal(result.reason, 'unsupported_local_extraction');
    assert.equal(result.detail, 'image_or_scan');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
    assert.deepEqual(result.provenance, source);
});

test('all native failure signals remain review-only, zero-write and apply-none', () => {
    const signals: AnyDocLocalFailureSignal[] = [
        'unsupported',
        'needsOcr',
        'malformed',
        'encrypted',
        'resourceLimit',
        'missingPart',
        'io',
    ];

    for (const signal of signals) {
        const result = mapAnyDocLocalFailure(source, signal);
        assert.equal(result.status, 'review_required', signal);
        assert.equal(result.reason, 'unsupported_local_extraction', signal);
        assert.equal(result.markdown, '', signal);
        assert.equal(result.candidateUse, 'blocked', signal);
        assert.equal(result.writes, 0, signal);
        assert.equal(result.apply, 'none', signal);
    }
});

test('contract contains no path, raw document, log, secret, provider option or egress field', () => {
    const result = buildAnyDocLocalExtraction(source, 'Contenuto sintetico.');
    const serialized = JSON.stringify(result);

    for (const forbidden of ['path', 'rawDocument', 'log', 'secret', 'providerOption', 'egress']) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
});
