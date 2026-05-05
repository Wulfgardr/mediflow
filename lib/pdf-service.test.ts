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

test('extractUsableOcrText rejects degenerate OCR loops', () => {
    assert.equal(
        extractUsableOcrText({ rawMarkdown: '1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.1.' }),
        ''
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

test('parsePatientData handles surname-first Piano Terapeutico patient labels and address', () => {
    const parsed = parsePatientData([
        'Piano Terapeutico',
        'Paziente: ROSSI MARIA',
        'Data di nascita: 17.12.1994',
        'Codice Fiscale: RSSMRA94T57A271J',
        'Indirizzo: VIA TEST 25 MILANO',
        'Diagnosi e motivazione clinica della scelta del farmaco',
        'Trapianto di polmone',
        'Farmaco prescritto',
        'CELLCEPT',
        'Posologia',
        '500 mg x2',
    ].join('\n'));

    assert.equal(parsed.firstName, 'MARIA');
    assert.equal(parsed.lastName, 'ROSSI');
    assert.equal(parsed.taxCode, 'RSSMRA94T57A271J');
    assert.equal(parsed.birthDate?.toISOString().slice(0, 10), '1994-12-17');
    assert.equal(parsed.address, 'VIA TEST 25 MILANO');
    assert.match(parsed.notes || '', /Trapianto di polmone/i);
    assert.doesNotMatch(parsed.notes || '', /CELLCEPT/i);
});

test('parsePatientData preserves name-first patient labels when casing is not surname-first', () => {
    const parsed = parsePatientData('Paziente: Mario Rossi\nData di nascita: 01/02/1970');

    assert.equal(parsed.firstName, 'Mario');
    assert.equal(parsed.lastName, 'Rossi');
});
