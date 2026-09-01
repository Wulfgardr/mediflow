/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_TEXT_MODEL,
    LEGACY_MEDGEMMA_TEXT_MODEL,
    LEGACY_QWEN_TEXT_MODEL,
    resolveTextModel,
} from './ai-model-selection.ts';

test('espone i default e i modelli testuali legacy canonici', () => {
    assert.equal(DEFAULT_TEXT_MODEL, 'qwen3.5:35b-a3b');
    assert.equal(LEGACY_QWEN_TEXT_MODEL, 'qwen2.5:32b');
    assert.equal(LEGACY_MEDGEMMA_TEXT_MODEL, 'hf.co/unsloth/medgemma-1.5-4b-it-GGUF');
});

test('preferisce il modello specifico e normalizza il whitespace esterno', () => {
    assert.equal(resolveTextModel('  clinical-local:latest  ', 'legacy-local'), 'clinical-local:latest');
});

test('usa il modello legacy quando quello specifico contiene solo whitespace', () => {
    assert.equal(resolveTextModel(' \n\t ', '  legacy-local:latest  '), 'legacy-local:latest');
});

test('usa il default per valori assenti, vuoti o legacy obsoleti', () => {
    for (const [specific, legacy] of [
        [undefined, undefined],
        ['', '  '],
        [null, LEGACY_QWEN_TEXT_MODEL],
        ['  ', LEGACY_MEDGEMMA_TEXT_MODEL],
    ] as const) {
        assert.equal(resolveTextModel(specific, legacy), DEFAULT_TEXT_MODEL);
    }
});
