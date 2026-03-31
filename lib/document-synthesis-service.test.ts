/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoredDocumentExcerpt } from './document-excerpt';
import { parseStructuredAnalysisResponse } from './document-synthesis-parser';

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

test('buildStoredDocumentExcerpt keeps high-signal sections in clinical order', () => {
    const excerpt = buildStoredDocumentExcerpt([
        'Intestazione amministrativa ripetuta',
        ...Array.from({ length: 90 }, (_, index) => `rumore burocratico ${index + 1}`),
        'Diagnosi alla dimissione',
        'Scompenso cardiaco congestizio in paziente diabetico',
        'Terapia domiciliare',
        'Furosemide 25 mg 1 cp al mattino',
        'Metformina 500 mg 1 cp x 2/die',
        'Indicazioni alla dimissione',
        'Controllo cardiologico tra 7 giorni',
        'ADI infermieristica da proseguire',
        ...Array.from({ length: 90 }, (_, index) => `appendice descrittiva ${index + 1}`),
    ].join('\n'));

    assert.match(excerpt, /Diagnosi alla dimissione/);
    assert.match(excerpt, /Scompenso cardiaco congestizio/);
    assert.match(excerpt, /Terapia domiciliare/);
    assert.match(excerpt, /Furosemide 25 mg 1 cp al mattino/);
    assert.match(excerpt, /Controllo cardiologico tra 7 giorni/);
    assert.match(excerpt, /ADI infermieristica da proseguire/);
    assert.ok(excerpt.indexOf('Diagnosi alla dimissione') < excerpt.indexOf('Terapia domiciliare'));
    assert.ok(excerpt.indexOf('Terapia domiciliare') < excerpt.indexOf('Indicazioni alla dimissione'));
});
