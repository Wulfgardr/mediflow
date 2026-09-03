/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCanvas } from '@napi-rs/canvas';

import {
    ANYDOC_APPLE_VISION_OCR_DOCUMENT_TIMEOUT_MS,
    ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256,
    ANYDOC_APPLE_VISION_OCR_TIMEOUT_MS,
    createAnyDocAppleVisionDocumentExtractorForTest,
    createAnyDocAppleVisionImageExtractorForTest,
    extractAnyDocAppleVisionImage,
    type AnyDocAppleVisionOcrResult,
} from './anydoc-apple-vision-ocr';

function image(text: string, footer = true): Buffer {
    const canvas = createCanvas(1600, 500); const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000'; context.font = 'bold 92px Helvetica'; context.fillText(text, 60, 210);
    if (footer) { context.font = '56px Helvetica'; context.fillText('Controllo locale offline', 60, 340); }
    return canvas.toBuffer('image/png');
}

function recognized(input: Uint8Array, text = 'RISULTATO SINTETICO'): AnyDocAppleVisionOcrResult {
    const inputBytes = Buffer.from(input); const outputBytes = Buffer.from(text, 'utf8');
    return Object.freeze({ schemaVersion: 'mediflow.anydoc_apple_vision_ocr.v1', status: 'recognized', text,
        receipt: Object.freeze({ engine: 'apple_vision', scriptSha256: ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256,
            inputSha256: createHash('sha256').update(inputBytes).digest('hex'), inputByteLength: inputBytes.byteLength,
            outputSha256: createHash('sha256').update(outputBytes).digest('hex'), outputByteLength: outputBytes.byteLength,
            averageConfidence: 1, network: 'denied', temporaryInput: 'none',
            timeoutMs: ANYDOC_APPLE_VISION_OCR_TIMEOUT_MS, durationMs: 0,
            review: 'required', writes: 0, apply: 'none' }),
        review: 'required', writes: 0, apply: 'none' });
}

test('recognizes a synthetic image offline with bounded PHI-safe provenance', { skip: process.platform !== 'darwin' }, async () => {
    const result = await extractAnyDocAppleVisionImage(image('DOCUMENTO SINTETICO'));
    assert.equal(result.status, 'recognized');
    if (result.status !== 'recognized') return;
    assert.match(result.text, /DOCUMENTO SINTETICO/iu);
    assert.match(result.text, /Controllo locale offline/iu);
    assert.equal(result.receipt.scriptSha256, ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256);
    assert.deepEqual([result.receipt.engine, result.receipt.network, result.receipt.temporaryInput],
        ['apple_vision', 'denied', 'none']);
    assert.deepEqual([result.review, result.writes, result.apply], ['required', 0, 'none']);
    assert.doesNotMatch(JSON.stringify(result.receipt), /DOCUMENTO|Controllo|(?:\/Users|\/private\/tmp)/u);
});

test('maps owned temporary-root creation and cleanup failures without rejecting', {
    skip: process.platform !== 'darwin',
}, async () => {
    let removals = 0;
    const createFailure = createAnyDocAppleVisionImageExtractorForTest({
        createTemporaryRoot() { throw new Error('synthetic create failure'); },
        removeTemporaryRoot() { removals += 1; },
    });
    let result: Awaited<ReturnType<typeof extractAnyDocAppleVisionImage>> | undefined;
    await assert.doesNotReject(async () => { result = await createFailure(Buffer.from('not-an-image')); });
    assert.ok(result);
    assert.equal(result.status, 'review_required');
    if (result.status === 'review_required') assert.equal(result.reason, 'temporary_storage_unavailable');
    assert.equal(removals, 0);

    const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-vision-ocr-test-scope-'));
    let ownedRoot = '';
    try {
        const cleanupFailure = createAnyDocAppleVisionImageExtractorForTest({
            createTemporaryRoot() {
                ownedRoot = fs.mkdtempSync(path.join(scope, 'owned-'));
                return ownedRoot;
            },
            removeTemporaryRoot(value: string) {
                assert.equal(value, ownedRoot);
                fs.rmSync(value, { recursive: true, force: true });
                throw new Error('synthetic cleanup failure');
            },
        });
        await assert.doesNotReject(async () => { result = await cleanupFailure(Buffer.from('not-an-image')); });
        assert.ok(result);
        assert.equal(result.status, 'review_required');
        if (result.status === 'review_required') assert.equal(result.reason, 'cleanup_failed');
        assert.equal(fs.existsSync(ownedRoot), false);
    } finally { fs.rmSync(scope, { recursive: true, force: true }); }
});

test('fails closed for blank, malformed, oversized, and hostile image inputs', { skip: process.platform !== 'darwin' }, async () => {
    const blank = await extractAnyDocAppleVisionImage(image('', false));
    assert.equal(blank.status, 'review_required');
    if (blank.status === 'review_required') assert.equal(blank.reason, 'empty_output');
    const empty = await extractAnyDocAppleVisionImage(Buffer.alloc(0));
    assert.equal(empty.status, 'review_required');
    if (empty.status === 'review_required') assert.equal(empty.reason, 'invalid_input');
    assert.equal((await extractAnyDocAppleVisionImage(Buffer.from('not-an-image'))).status, 'review_required');
    assert.equal((await extractAnyDocAppleVisionImage(Buffer.alloc(16 * 1024 * 1024 + 1))).status, 'review_required');
    assert.equal((await extractAnyDocAppleVisionImage(new Proxy(Buffer.from([1]), {}))).status, 'review_required');
});

test('admits one complete OCR document and rejects overlap immediately without a queue', async () => {
    let finishFirst: ((value: AnyDocAppleVisionOcrResult) => void) | undefined;
    let extractionCalls = 0; let scheduled = 0; let cancelled = 0;
    const extractDocument = createAnyDocAppleVisionDocumentExtractorForTest({
        cancelDeadline() { cancelled += 1; },
        extractImage() {
            extractionCalls += 1;
            return new Promise<AnyDocAppleVisionOcrResult>((resolve) => { finishFirst = resolve; });
        },
        now() { return 100; },
        scheduleDeadline(_callback: () => void, delayMs: number) {
            scheduled += 1; assert.equal(delayMs, ANYDOC_APPLE_VISION_OCR_DOCUMENT_TIMEOUT_MS); return Object.freeze({});
        },
    });
    const firstInput = Buffer.from([1, 2, 3]);
    const pending = extractDocument([firstInput]);
    assert.equal(extractionCalls, 1);
    const overlap = await extractDocument([Buffer.from([4, 5, 6])]);
    assert.equal(overlap.status, 'review_required');
    if (overlap.status === 'review_required') assert.equal(overlap.reason, 'resource_limit');
    assert.equal(extractionCalls, 1);
    assert.ok(finishFirst); finishFirst(recognized(firstInput));
    const completed = await pending;
    assert.equal(completed.status, 'recognized');
    assert.deepEqual([scheduled, cancelled], [1, 1]);
});

test('shares one document deadline, aborts the active page, and never starts a later page', async () => {
    let fireDeadline: (() => void) | undefined;
    let extractionCalls = 0; let observedAbort = false; let effectivePageTimeout = 0;
    const extractDocument = createAnyDocAppleVisionDocumentExtractorForTest({
        cancelDeadline() {},
        extractImage(_input: unknown, control: { signal: AbortSignal; timeoutMs: number }) {
            extractionCalls += 1; effectivePageTimeout = control.timeoutMs;
            return new Promise<AnyDocAppleVisionOcrResult>((resolve) => {
                control.signal.addEventListener('abort', () => {
                    observedAbort = true;
                    resolve(Object.freeze({ schemaVersion: 'mediflow.anydoc_apple_vision_ocr.v1',
                        status: 'review_required', reason: 'timeout', review: 'required', writes: 0, apply: 'none' }));
                }, { once: true });
            });
        },
        now() { return 250; },
        scheduleDeadline(callback: () => void, delayMs: number) {
            assert.equal(delayMs, ANYDOC_APPLE_VISION_OCR_DOCUMENT_TIMEOUT_MS);
            fireDeadline = callback; return Object.freeze({});
        },
    });
    const pending = extractDocument([Buffer.from([1]), Buffer.from([2])]);
    assert.equal(extractionCalls, 1); assert.equal(effectivePageTimeout, ANYDOC_APPLE_VISION_OCR_TIMEOUT_MS);
    assert.ok(fireDeadline); fireDeadline();
    const result = await pending;
    assert.equal(result.status, 'review_required');
    if (result.status === 'review_required') assert.equal(result.reason, 'timeout');
    assert.equal(observedAbort, true); assert.equal(extractionCalls, 1);

    const source = fs.readFileSync(new URL('./anydoc-apple-vision-ocr.ts', import.meta.url), 'utf8');
    assert.match(source, /control\.signal\.addEventListener\('abort', abortDocument/u);
    assert.match(source, /process\.kill\(-child\.pid, 'SIGKILL'\)/u);
    assert.match(source, /child\.once\('close'/u);
});

test('reduces the shared deadline across successful pages and preserves their order', async () => {
    const clock = [0, 0, 0, 7_500]; const observedTimeouts: number[] = [];
    const inputs = [Buffer.from([1, 2]), Buffer.from([3, 4])];
    const extractDocument = createAnyDocAppleVisionDocumentExtractorForTest({
        cancelDeadline() {},
        extractImage(input: Uint8Array, control: { timeoutMs: number }) {
            observedTimeouts.push(control.timeoutMs);
            return Promise.resolve(recognized(input, `PAGINA ${observedTimeouts.length}`));
        },
        now() { const value = clock.shift(); assert.notEqual(value, undefined); return value; },
        scheduleDeadline(_callback: () => void, delayMs: number) {
            assert.equal(delayMs, ANYDOC_APPLE_VISION_OCR_DOCUMENT_TIMEOUT_MS); return Object.freeze({});
        },
    });
    const result = await extractDocument(inputs);
    assert.equal(result.status, 'recognized');
    if (result.status === 'recognized') {
        assert.deepEqual(result.pages.map((page) => page.text), ['PAGINA 1', 'PAGINA 2']);
        assert.deepEqual(result.pages.map((page) => page.receipt.inputSha256),
            inputs.map((input) => createHash('sha256').update(input).digest('hex')));
    }
    assert.deepEqual(observedTimeouts, [30_000, 22_500]);
    assert.equal(clock.length, 0);
});

test('pins the owned script and contains no path input or network API', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'apple-vision-ocr.swift'));
    const source = script.toString('utf8');
    assert.equal(createHash('sha256').update(script).digest('hex'),
        ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256);
    assert.doesNotMatch(source, /CommandLine\.arguments\[[1-9]|URLSession|Network|http:|https:|fileURLWithPath|\.path\b/u);
    assert.match(source, /standardInput/u);
});
