import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOcrFallbackResult, extractUsableOcrText } from './pdf-service';

test('extractUsableOcrText keeps markdown-like OCR text and ignores structured JSON payloads', () => {
    assert.equal(
        extractUsableOcrText({ rawMarkdown: 'Referto:\nPaziente con follow-up cardiologico.' }),
        'Referto:\nPaziente con follow-up cardiologico.'
    );
    assert.equal(
        extractUsableOcrText({ rawMarkdown: '{"paziente":{"nome":"Giulia"}}', notes: 'Nota sintetica utile' }),
        'Nota sintetica utile'
    );
});

test('buildOcrFallbackResult promotes low-confidence OCR when usable local text exists', () => {
    const result = buildOcrFallbackResult({
        confidence: 0.2,
        notes: 'Dimissione con rivalutazione ortopedica consigliata.',
    }, 'ai');

    assert.ok(result);
    assert.equal(result?.rawText, 'Dimissione con rivalutazione ortopedica consigliata.');
    assert.equal(result?.notes, 'Dimissione con rivalutazione ortopedica consigliata.');
    assert.equal(result?.source, 'ai');
});

test('buildOcrFallbackResult ignores pure OCR failure notes', () => {
    const result = buildOcrFallbackResult({
        confidence: 0,
        notes: 'OCR extraction failed: model unavailable',
    }, 'ai');

    assert.equal(result, null);
});
