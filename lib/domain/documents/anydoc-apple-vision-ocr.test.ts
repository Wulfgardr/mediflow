/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCanvas } from '@napi-rs/canvas';

import {
    ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256,
    extractAnyDocAppleVisionImage,
} from './anydoc-apple-vision-ocr';

function image(text: string, footer = true): Buffer {
    const canvas = createCanvas(1600, 500); const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000'; context.font = 'bold 92px Helvetica'; context.fillText(text, 60, 210);
    if (footer) { context.font = '56px Helvetica'; context.fillText('Controllo locale offline', 60, 340); }
    return canvas.toBuffer('image/png');
}

test('recognizes a synthetic image offline with bounded PHI-safe provenance', { skip: process.platform !== 'darwin' }, async () => {
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('mediflow-vision-ocr-')));
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
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('mediflow-vision-ocr-') && !before.has(name));
    assert.deepEqual(after, []);
});

test('fails closed for blank, malformed, oversized, and hostile image inputs', { skip: process.platform !== 'darwin' }, async () => {
    const blank = await extractAnyDocAppleVisionImage(image('', false));
    assert.equal(blank.status, 'review_required');
    if (blank.status === 'review_required') assert.equal(blank.reason, 'empty_output');
    assert.equal((await extractAnyDocAppleVisionImage(Buffer.from('not-an-image'))).status, 'review_required');
    assert.equal((await extractAnyDocAppleVisionImage(Buffer.alloc(16 * 1024 * 1024 + 1))).status, 'review_required');
    assert.equal((await extractAnyDocAppleVisionImage(new Proxy(Buffer.from([1]), {}))).status, 'review_required');
});

test('pins the owned script and contains no path input or network API', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'apple-vision-ocr.swift'));
    const source = script.toString('utf8');
    assert.equal(createHash('sha256').update(script).digest('hex'),
        ANYDOC_APPLE_VISION_OCR_SCRIPT_SHA256);
    assert.doesNotMatch(source, /CommandLine\.arguments\[[1-9]|URLSession|Network|http:|https:|fileURLWithPath|\.path\b/u);
    assert.match(source, /standardInput/u);
});
