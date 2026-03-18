/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredAnalysisResponse } from './document-synthesis-parser.ts';

test('parses explicit medications from the model JSON payload', () => {
    const analysis = parseStructuredAnalysisResponse(
        JSON.stringify({
            summary_markdown: '**Terapia domiciliare**',
            quality: { level: 'green', reason: 'Documento chiaro' },
            medications: [
                'Lasix 25 mg 1 cp al mattino',
                'Metformina 500 mg x 2/die',
                'Lasix 25 mg 1 cp al mattino',
            ],
            diagnoses: [],
        }),
        'terapia domiciliare esplicita',
    );

    assert.deepEqual(analysis.medications, [
        'Lasix 25 mg 1 cp al mattino',
        'Metformina 500 mg x 2/die',
    ]);
    assert.equal(analysis.quality?.level, 'green');
});

test('falls back to empty medications when the model returns invalid JSON', () => {
    const analysis = parseStructuredAnalysisResponse('not-json', 'testo OCR rumoroso');

    assert.deepEqual(analysis.medications, []);
    assert.equal(analysis.quality?.level, 'yellow');
});
