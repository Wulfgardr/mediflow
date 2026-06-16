/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOllamaPullStreamLine } from './ollama-pull-stream';

test('parseOllamaPullStreamLine surfaces upstream pull errors', () => {
    assert.throws(
        () => parseOllamaPullStreamLine('{"error":"model not found"}'),
        /model not found/,
    );
});

test('parseOllamaPullStreamLine ignores malformed partial JSON without swallowing later errors', () => {
    assert.equal(parseOllamaPullStreamLine('{"status":"pulling"'), null);
    assert.deepEqual(parseOllamaPullStreamLine('{"status":"pulling","completed":25,"total":100}'), {
        status: 'pulling',
        progress: 25,
    });
});

test('parseOllamaPullStreamLine surfaces an unterminated final error line', () => {
    /* @Codex */
    const streamChunks = ['{"status":"pulling"}\n{"error":"no manifest found"}'];
    let buffer = '';

    for (const chunk of streamChunks) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) parseOllamaPullStreamLine(line);
    }

    assert.throws(
        () => parseOllamaPullStreamLine(buffer),
        /no manifest found/,
    );
});

test('parseOllamaPullStreamLine skips progress when completed is absent', () => {
    /* @Codex */
    assert.deepEqual(parseOllamaPullStreamLine('{"status":"verifying","total":100}'), {
        status: 'verifying',
    });
});
