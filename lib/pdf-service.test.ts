import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOcrFallbackResult, extractUsableOcrText, parsePatientData } from './pdf-service';

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

test('extractUsableOcrText normalizes noisy OCR-like headings before downstream parsing', () => {
    assert.equal(
        extractUsableOcrText({
            rawMarkdown: 'ANAMNESI remota: ipertensione arteriosa.  TERAPIA domiciliare: Paracetamolo 1000 mg al bisogno.',
        }),
        'ANAMNESI remota:\nipertensione arteriosa.\n\nTERAPIA domiciliare:\nParacetamolo 1000 mg al bisogno.'
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

test('parsePatientData extracts name and birth date from signature-style discharge text', () => {
    const parsed = parsePatientData('Sig. Pasquale Milone, nato il 23/02/1932.\nLettera di dimissione');

    assert.equal(parsed.firstName, 'Pasquale');
    assert.equal(parsed.lastName, 'Milone');
    assert.equal(parsed.birthDate?.toISOString().slice(0, 10), '1932-02-23');
});
