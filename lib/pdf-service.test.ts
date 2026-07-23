// Pin a timezone ahead of UTC before importing so date parsing is exercised under the
// conditions where local-time parsing would shift birth dates to the previous day.
process.env.TZ = 'Europe/Rome';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildOcrFallbackResult,
    extractPdfTextLayer,
    extractDocumentTextForSummary,
    extractTextFromPdf,
    extractUsableOcrText,
    mergePdfPageText,
    mergeExtractedPatientDataWithTextFallback,
    parsePatientData,
} from './pdf-service';

test('extractPdfTextLayer preserves the 1-indexed selective OCR contract', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        text: '<!-- Page 1 -->\nTesto nativo',
        textLayer: {
            state: 'mixed',
            pageCount: 3,
            pagesNeedingOcr: [2],
            pages: [
                { page: 1, text: 'Pagina uno', needsOcr: false },
                { page: 2, text: '', needsOcr: true },
                { page: 3, text: 'Pagina tre', needsOcr: false },
            ],
        },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
        const result = await extractPdfTextLayer(new Blob(['synthetic']));
        assert.equal(result.state, 'mixed');
        assert.deepEqual(result.pagesNeedingOcr, [2]);
        assert.match(result.text, /Testo nativo/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('mergePdfPageText restores mixed PDF source order', () => {
    const text = mergePdfPageText({
        text: 'Pagina uno\n\nPagina tre',
        state: 'mixed',
        pageCount: 3,
        pagesNeedingOcr: [2],
        pages: [
            { page: 1, text: 'Pagina uno', needsOcr: false },
            { page: 2, text: '', needsOcr: true },
            { page: 3, text: 'Pagina tre', needsOcr: false },
        ],
    }, new Map([[2, 'Pagina due OCR con contenuto clinico sufficientemente informativo.']]));
    assert.equal(
        text,
        'Pagina uno\n\nPagina due OCR con contenuto clinico sufficientemente informativo.\n\nPagina tre',
    );
});

test('mergePdfPageText fails closed when a selected OCR page is missing', () => {
    assert.throws(() => mergePdfPageText({
        text: 'Pagina uno',
        state: 'mixed',
        pageCount: 2,
        pagesNeedingOcr: [2],
        pages: [
            { page: 1, text: 'Pagina uno', needsOcr: false },
            { page: 2, text: '', needsOcr: true },
        ],
    }, new Map()), /OCR selettivo incompleto/);
});

test('mergePdfPageText accepts short but non-degenerate OCR text', () => {
    const text = mergePdfPageText({
        text: 'Pagina uno',
        state: 'mixed',
        pageCount: 2,
        pagesNeedingOcr: [2],
        pages: [
            { page: 1, text: 'Pagina uno', needsOcr: false },
            { page: 2, text: '', needsOcr: true },
        ],
    }, new Map([[2, 'Firma']]));
    assert.equal(text, 'Pagina uno\n\nFirma');
});

test('extractTextFromPdf does not expose partial mixed-document text', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        text: 'Pagina nativa sufficientemente lunga da sembrare completa al consumer.',
        textLayer: {
            state: 'mixed',
            pageCount: 2,
            pagesNeedingOcr: [2],
            pages: [
                { page: 1, text: 'Pagina nativa sufficientemente lunga.', needsOcr: false },
                { page: 2, text: '', needsOcr: true },
            ],
        },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
        await assert.rejects(extractTextFromPdf(new Blob(['synthetic'])), /richiede OCR selettivo/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('extractPdfTextLayer preserves the resource-limit stop', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        error: 'PDF inspection failed',
        textLayer: { state: 'unreadable', reason: 'resource_limit' },
    }), { status: 413, headers: { 'content-type': 'application/json' } });
    try {
        await assert.rejects(
            extractPdfTextLayer(new Blob(['synthetic'])),
            /supera i limiti locali/,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('summary extraction does not bypass an inspector failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        error: 'PDF inspection failed',
        textLayer: { state: 'unreadable', reason: 'parser_failed' },
    }), { status: 500, headers: { 'content-type': 'application/json' } });
    try {
        await assert.rejects(
            extractDocumentTextForSummary(new File(['%PDF-synthetic'], 'synthetic.pdf', {
                type: 'application/pdf',
            })),
            /Ispezione PDF locale non disponibile/,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('extractPdfTextLayer rejects inconsistent routing metadata', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        text: 'testo parziale',
        textLayer: { state: 'native', pageCount: 2, pagesNeedingOcr: [2] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    try {
        await assert.rejects(
            extractPdfTextLayer(new Blob(['synthetic'])),
            /Invalid PDF inspection response/,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

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

test('parsePatientData accepts standard and omocodia tax codes without matching adjacent tokens', () => {
    assert.equal(
        parsePatientData('Codice Fiscale: RSSMRA94T57A271J').taxCode,
        'RSSMRA94T57A271J',
    );
    assert.equal(
        parsePatientData('Codice Fiscale: RSSMRA94T57A27MJ').taxCode,
        'RSSMRA94T57A27MJ',
    );
    assert.equal(
        parsePatientData('Identificativo: XRSSMRA94T57A271JY').taxCode,
        undefined,
    );
    assert.equal(
        parsePatientData('Codice Fiscale: RSSMRAA4T57A271J').taxCode,
        undefined,
    );
});

test('parsePatientData rejects tax codes embedded in Unicode letter or number tokens', () => {
    for (const token of [
        'ÀRSSMRA94T57A271J',
        'RSSMRA94T57A271Jè',
        '١RSSMRA94T57A271J',
        'RSSMRA94T57A271Jα',
    ]) {
        assert.equal(parsePatientData(token).taxCode, undefined);
    }
});

test('parsePatientData rejects Unicode case-folded characters in tax code bodies', () => {
    assert.equal(parsePatientData('KSSMRA94T57A271J').taxCode, undefined);
    assert.equal(parsePatientData('RſSMRA94T57A271J').taxCode, undefined);
});

test('parsePatientData validates calendar birth dates, including leap years', () => {
    assert.equal(
        parsePatientData('Nata il 29/02/2024').birthDate?.toISOString().slice(0, 10),
        '2024-02-29',
    );
    assert.equal(parsePatientData('Nato il 31/04/1990').birthDate, undefined);
    assert.equal(parsePatientData('Nata il 29/02/2023').birthDate, undefined);
});

test('parsePatientData recognizes birthplace dates without promoting partial or unanchored dates', () => {
    assert.equal(
        parsePatientData('Mario Rossi, nato a Milano il 23/02/1932').birthDate?.toISOString().slice(0, 10),
        '1932-02-23',
    );
    assert.equal(
        parsePatientData('nata a L’Aquila il 29-2-2024').birthDate?.toISOString().slice(0, 10),
        '2024-02-29',
    );
    assert.equal(parsePatientData('nata a Milano il referto è stato emesso il 05/03/2024').birthDate, undefined);
    assert.equal(parsePatientData('nata a Milano il il 05/03/2024').birthDate, undefined);
    assert.equal(parsePatientData('nata a Milano il controllo è avvenuto il 05/03/2024').birthDate, undefined);
    assert.equal(parsePatientData('La paziente e rinata il 12/03/1990').birthDate, undefined);
    assert.equal(parsePatientData('nata12/03/1990').birthDate, undefined);
    assert.equal(parsePatientData('Referto del 05/03/2024').birthDate, undefined);
});

test('parsePatientData preserves name-first patient labels when casing is not surname-first', () => {
    const parsed = parsePatientData('Paziente: Mario Rossi\nData di nascita: 01/02/1970');

    assert.equal(parsed.firstName, 'Mario');
    assert.equal(parsed.lastName, 'Rossi');
});

test('parsePatientData leaves birth date empty instead of promoting unanchored document dates', () => {
    const parsed = parsePatientData('Referto ambulatoriale del 05/03/2024\nPaziente: Mario Rossi\nDiagnosi: controllo di routine');

    assert.equal(parsed.birthDate, undefined);
});

test('parsePatientData parses single-digit birth dates as UTC without timezone day shift', () => {
    const parsed = parsePatientData('Sig. Mario Rossi, nato il 1/2/1970.\nLettera di dimissione');

    assert.equal(parsed.birthDate?.toISOString().slice(0, 10), '1970-02-01');
});

test('mergeExtractedPatientDataWithTextFallback keeps AI omocodia tax codes instead of overwriting from text', () => {
    const merged = mergeExtractedPatientDataWithTextFallback(
        // Fake omocodia CF: trailing digit replaced by its substitution letter (1 -> M).
        { rawText: '', source: 'ai', confidence: 0.9, taxCode: 'rssmra94t57a27mj' },
        'Medico curante Dott. Luigi Verdi, Codice Fiscale VRDLGU70A01F205Z.\nPiano terapeutico.',
    );

    assert.equal(merged.taxCode, 'RSSMRA94T57A27MJ');
});

test('mergeExtractedPatientDataWithTextFallback replaces an invalid AI tax code from text', () => {
    const merged = mergeExtractedPatientDataWithTextFallback(
        { rawText: '', source: 'ai', confidence: 0.9, taxCode: 'INVALID' },
        'Codice Fiscale: RSSMRA94T57A271J',
    );

    assert.equal(merged.taxCode, 'RSSMRA94T57A271J');
});
