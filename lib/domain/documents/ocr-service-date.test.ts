import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractDocumentWithAI, isOcrModelAvailable } from './ocr-service';

test('extractDocumentWithAI is a terminal review-required compatibility boundary', async () => {
    let providerCalls = 0;
    const provider = Object.freeze({
        chat: async () => {
            providerCalls += 1;
            throw new Error('retired OCR must not reach a provider');
        },
    });

    const result = await extractDocumentWithAI('synthetic-image', 'full', provider as never);

    assert.deepEqual(result, {
        status: 'review_required',
        reason: 'unsupported_local_extraction',
        detail: 'image_or_scan',
        rawMarkdown: '',
        confidence: 0,
        review: 'required',
        writes: 0,
        apply: 'none',
        candidateUse: 'blocked',
    });
    assert.equal(providerCalls, 0);
});

test('OCR readiness is terminally unavailable and the compatibility module has no runtime provider seam', async () => {
    assert.equal(await isOcrModelAvailable(), false);
    const source = fs.readFileSync(new URL('./ocr-service.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /AIService|ChatMessage|fetch\(|DeepSeek|Apple Vision|apple_vision|OCR_PROMPTS/u);
});
