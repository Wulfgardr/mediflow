/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandTwoDigitYear, normalizeDocumentInput } from './document-input-normalization';

test('expandTwoDigitYear uses a pivot window so future 20xx years fall back to 19xx', () => {
    // Recent past stays in 2000s.
    assert.equal(expandTwoDigitYear('24', 2026), 2024);
    assert.equal(expandTwoDigitYear('26', 2026), 2026);
    // A 20xx interpretation in the future is demoted to 19xx (birth dates).
    assert.equal(expandTwoDigitYear('58', 2026), 1958);
    assert.equal(expandTwoDigitYear('27', 2026), 1927);
    assert.ok(Number.isNaN(expandTwoDigitYear('ab', 2026)));
});

test('normalizeDocumentInput extracts tolerant narrative from partial CDA sections', () => {
    const result = normalizeDocumentInput(`
        <ClinicalDocument>
          <component>
            <structuredBody>
              <component>
                <section>
                  <title>Diagnosi alla dimissione</title>
                  <text>
                    <paragraph>Frattura pertrocanterica femore sinistro</paragraph>
                    <paragraph>ICD-9 820.8</paragraph>
                  </text>
                </section>
              </component>
              <component>
                <section>
                  <title>Terapia domiciliare</title>
                  <text>
                    <list>
                      <item>Paracetamolo 1000 mg al bisogno</item>
                    </list>
                  </text>
                </section>
              </component>
            </structuredBody>
          </component>
        </ClinicalDocument>
    `);

    assert.equal(result.sourceKind, 'xml');
    assert.equal(result.hints.structuredNarrative, true);
    assert.deepEqual(result.hints.detectedHeadings, [
        'Diagnosi alla dimissione',
        'Terapia domiciliare',
    ]);
    assert.match(result.normalizedText, /Diagnosi alla dimissione:/);
    assert.match(result.normalizedText, /ICD-9 820\.8/);
    assert.match(result.normalizedText, /Paracetamolo 1000 mg al bisogno/);
});

test('normalizeDocumentInput rescues noisy OCR-like text into sections and local hints', () => {
    const result = normalizeDocumentInput([
        'VERBALE DI DIMISSIONE  ANAMNESI remota: ipertensione arteriosa.',
        'TERAPIA domiciliare: Paracetamolo 1000 mg al bisogno.',
        'ALLERGIE: assenza di reazioni note.',
        'Controllo ortopedico il 03/04/2026.',
    ].join('  '), { sourceKind: 'ocr' });

    assert.equal(result.sourceKind, 'ocr');
    assert.match(result.normalizedText, /anamnesi remota:/i);
    assert.match(result.normalizedText, /terapia domiciliare:/i);
    assert.match(result.normalizedText, /allergie:/i);
    assert.deepEqual(result.hints.normalizedDates, [
        { raw: '03/04/2026', iso: '2026-04-03' },
    ]);
    assert.ok(result.hints.negationPhrases.includes('assenza di'));
    assert.ok(result.hints.temporalityPhrases.some((value) => value.toLowerCase() === 'anamnesi remota'));
});
