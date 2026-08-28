/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractAnyDocLocalBytes } from './anydoc-local-extraction-runner';
import { ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES, ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES } from './anydoc-local-extraction-contract';

const SYNTHETIC_RTF = Buffer.from('{\\rtf1\\ansi Synthetic discharge note.}', 'utf8');
const RUNNER_SOURCE = readFileSync(new URL('./anydoc-local-extraction-runner.ts', import.meta.url), 'utf8');

test('binds successful extraction evidence to the exact copied source bytes', async () => {
    const result = await extractAnyDocLocalBytes('synthetic-attachment-rtf', SYNTHETIC_RTF);

    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.equal(result.markdown, 'Synthetic discharge note.');
    assert.equal(result.provenance.sourceSha256, 'ebf4cc680419e22ec7f636bcb3b5f9767e1edb64b6a47704672c8e9eb9f3a1f4');
    assert.equal(result.provenance.byteLength, 38);
    assert.equal(result.receipt.sourceSha256, result.provenance.sourceSha256);
    assert.equal(result.receipt.sourceByteLength, result.provenance.byteLength);
    assert.equal(result.writes, 0);
    assert.equal(result.apply, 'none');
});

test('copies source bytes before asynchronous conversion', async () => {
    const callerBytes = Buffer.from(SYNTHETIC_RTF);
    const pending = extractAnyDocLocalBytes('synthetic-attachment-copy', callerBytes);
    callerBytes.fill(0);
    const result = await pending;

    assert.equal(result.status, 'extracted');
    if (result.status !== 'extracted') return;
    assert.equal(result.markdown, 'Synthetic discharge note.');
    assert.equal(result.provenance.sourceSha256, 'ebf4cc680419e22ec7f636bcb3b5f9767e1edb64b6a47704672c8e9eb9f3a1f4');
});

test('does not inherit provider, native override or Node option variables', async () => {
    const names = ['FIRECRAWL_API_KEY', 'FIRECRAWL_API_URL', 'NAPI_RS_NATIVE_LIBRARY_PATH', 'NODE_OPTIONS'] as const;
    const previous = names.map((name) => process.env[name]);
    process.env.FIRECRAWL_API_KEY = 'synthetic-forbidden-key';
    process.env.FIRECRAWL_API_URL = 'synthetic-forbidden-url';
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = '/synthetic/forbidden-native.node';
    process.env.NODE_OPTIONS = '--synthetic-invalid-option';
    try {
        const result = await extractAnyDocLocalBytes('synthetic-attachment-env', SYNTHETIC_RTF);
        assert.equal(result.status, 'extracted');
    } finally {
        names.forEach((name, index) => {
            const value = previous[index];
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        });
    }
});

test('pins child cwd to the owned worker directory without ambient input', () => {
    assert.match(RUNNER_SOURCE, /const WORKER_DIRECTORY = fileURLToPath\(new URL\('\.\.\/\.\.\/\.\.\/scripts\/', import\.meta\.url\)\);/u);
    assert.match(RUNNER_SOURCE, /cwd: WORKER_DIRECTORY,/u);
    assert.doesNotMatch(RUNNER_SOURCE, /cwd:\s*(?:process\.cwd|process\.env)/u);
});

test('maps an unsupported byte snapshot to review-required without candidate output', async () => {
    const result = await extractAnyDocLocalBytes('synthetic-attachment-unsupported', Buffer.from([0, 1, 2, 3]));

    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.reason, 'unsupported_local_extraction');
    assert.equal(result.detail, 'unsupported_format');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
    assert.equal(result.writes, 0);
});

test('denies proxy, empty, oversized and invalid attachment inputs without throwing', async () => {
    const proxy = new Proxy(SYNTHETIC_RTF, { get() { throw new Error('trap'); } });
    const inputs = [
        extractAnyDocLocalBytes('synthetic-attachment-proxy', proxy),
        extractAnyDocLocalBytes('synthetic-attachment-empty', Buffer.alloc(0)),
        extractAnyDocLocalBytes('synthetic-attachment-large', Buffer.alloc(ANYDOC_LOCAL_EXTRACTION_MAX_SOURCE_BYTES + 1)),
        extractAnyDocLocalBytes('', SYNTHETIC_RTF),
    ];
    const results = await Promise.all(inputs);

    for (const result of results) {
        assert.equal(result.status, 'denied');
        if (result.status === 'denied') assert.equal(result.field, 'source');
        assert.equal(result.writes, 0);
        assert.equal(result.apply, 'none');
    }
});

test('denies a typed-array proxy before instanceof can invoke its prototype trap', async () => {
    let prototypeTrapReads = 0;
    const proxy = new Proxy(SYNTHETIC_RTF, {
        getPrototypeOf() {
            prototypeTrapReads += 1;
            throw new Error('synthetic-prototype-trap');
        },
    });

    let result: Awaited<ReturnType<typeof extractAnyDocLocalBytes>> | undefined;
    await assert.doesNotReject(async () => { result = await extractAnyDocLocalBytes('synthetic-attachment-prototype-proxy', proxy); });
    assert.ok(result);
    assert.equal(result.status, 'denied');
    if (result.status === 'denied') assert.equal(result.field, 'source');
    assert.equal(prototypeTrapReads, 0);
});

test('fails closed when extracted Markdown crosses the output cap', async () => {
    const largeRtf = Buffer.from(`{\\rtf1\\ansi ${'x'.repeat(ANYDOC_LOCAL_EXTRACTION_MAX_MARKDOWN_BYTES + 1)}}`, 'utf8');
    const result = await extractAnyDocLocalBytes('synthetic-attachment-output-cap', largeRtf);

    assert.equal(result.status, 'review_required');
    if (result.status !== 'review_required') return;
    assert.equal(result.detail, 'resource_limit');
    assert.equal(result.markdown, '');
    assert.equal(result.candidateUse, 'blocked');
});
