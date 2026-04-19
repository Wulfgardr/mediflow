import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoredMessagePayload } from './message-persistence.ts';

test('normalizeStoredMessagePayload preserves metadata strings as-is', () => {
    const result = normalizeStoredMessagePayload({
        metadata: '{"latencyMs":42}',
    });

    assert.equal(result.metadata, '{"latencyMs":42}');
});

test('normalizeStoredMessagePayload stringifies metadata objects once', () => {
    const result = normalizeStoredMessagePayload({
        metadata: { latencyMs: 42, contextUsed: 'TAG' },
    });

    assert.equal(result.metadata, '{"latencyMs":42,"contextUsed":"TAG"}');
});

test('normalizeStoredMessagePayload keeps supported attachment fields', () => {
    const result = normalizeStoredMessagePayload({
        attachmentType: 'image',
        attachmentBase64: 'data:image/png;base64,abc',
    });

    assert.equal(result.attachmentType, 'image');
    assert.equal(result.attachmentBase64, 'data:image/png;base64,abc');
});

test('normalizeStoredMessagePayload drops unsupported attachment types', () => {
    const result = normalizeStoredMessagePayload({
        attachmentType: 'pdf',
        attachmentBase64: 'payload',
    });

    assert.equal(result.attachmentType, undefined);
    assert.equal(result.attachmentBase64, 'payload');
});
