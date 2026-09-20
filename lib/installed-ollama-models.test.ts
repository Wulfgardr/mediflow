/* @Codex */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInstalledOllamaModel, parseInstalledOllamaModels } from './installed-ollama-models.ts';

test('installed identity permits only exact names and an optional latest tag', () => {
    for (const [installed, selected] of [['llama3', 'llama3:latest'], ['llama3:latest', 'llama3'], ['qwen:7b', 'qwen:7b']]) {
        assert.equal(isInstalledOllamaModel([installed], selected), true);
    }
    for (const [installed, selected] of [
        ['qwen:7b', 'qwen'], ['qwen:7b', 'qwen:7b-instruct'], ['qwen:7b-instruct', 'qwen:7b'],
        ['qwen:14b', 'qwen:7b'], ['org/model', 'model'], ['llama3', 'llama'], ['Llama3', 'llama3'], ['', ''], ['qwen:7b:latest', 'qwen:7b'],
    ]) assert.equal(isInstalledOllamaModel([installed], selected), false);
});

test('inventory accepts real descriptors, preserves names and deduplicates canonical identity', () => {
    assert.deepEqual(parseInstalledOllamaModels({ models: [
        { name: 'llama3:latest', size: 42 }, { name: 'llama3', size: null },
        { name: 'qwen:7b' }, { name: 'qwen:14b' }, { name: 'org/model:tag' },
    ] }), ['llama3:latest', 'qwen:7b', 'qwen:14b', 'org/model:tag']);
    assert.deepEqual(parseInstalledOllamaModels({ models: [] }), []);
});

test('malformed inventory fails instead of reporting no installed models', () => {
    for (const value of [null, [], {}, { models: {} }, { models: ['llama3'] },
        { models: [{ name: '' }] }, { models: [{ name: ' llama3' }] },
        { models: [{ name: 'llama\n3' }] }, { models: [{ name: 'ok' }, null] }]) {
        assert.throws(() => parseInstalledOllamaModels(value), /Elenco modelli non valido/);
    }
});
