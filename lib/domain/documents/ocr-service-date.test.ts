import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItalianDate } from '../../italian-date';
/* @Codex */
import { extractDocumentWithAI } from './ocr-service';
/* @Codex */
import type { AIService, ChatMessage } from '../../ai-service';

function isoDate(value: Date | undefined): string | undefined {
    return value?.toISOString().slice(0, 10);
}

test('parseItalianDate accepts common Italian date separators', () => {
    assert.equal(isoDate(parseItalianDate('15/03/2020')), '2020-03-15');
    assert.equal(isoDate(parseItalianDate('15-03-2020')), '2020-03-15');
    assert.equal(isoDate(parseItalianDate('15.03.2020')), '2020-03-15');
});

test('parseItalianDate keeps ISO fallback and rejects invalid values', () => {
    assert.equal(isoDate(parseItalianDate('2020-03-15')), '2020-03-15');
    assert.equal(parseItalianDate('not a date'), undefined);
});

test('extractDocumentWithAI propagates caller abort to generation', async () => {
    /* @Codex */
    const controller = new AbortController();
    controller.abort(new Error('operator cancelled import'));

    const ai = {
        chat: async (_messages: ChatMessage[], signal?: AbortSignal) => {
            if (signal?.aborted) throw signal.reason;
            throw new Error('expected aborted signal');
        },
    } as unknown as AIService;

    const result = await extractDocumentWithAI('fake-image', 'full', ai, {
        signal: controller.signal,
        timeoutMs: 1000,
    });

    assert.equal(result.confidence, 0);
    assert.match(result.notes || '', /operator cancelled import/);
});

test('extractDocumentWithAI times out hung generation with a clear error', async () => {
    /* @Codex */
    const ai = {
        chat: async (_messages: ChatMessage[], signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
            if (signal?.aborted) {
                reject(signal.reason);
                return;
            }
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    } as unknown as AIService;

    const result = await extractDocumentWithAI('fake-image', 'full', ai, {
        timeoutMs: 5,
    });

    assert.equal(result.confidence, 0);
    assert.match(result.notes || '', /OCR generation timed out after 5ms/);
});
