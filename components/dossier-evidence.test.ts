import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DossierEvidenceText, splitDossierPassage } from './dossier-evidence';
import { PrivacyProvider } from './privacy-provider';
import { splitDossierUnits, unitText } from '../lib/domain/documents/dossier-import';
import { anchorPreparedQuote } from '../lib/domain/documents/dossier-prepared';

const before = '## Pagina 2\nIl paziente ';
const passage = 'riferisce dispnea da sforzo\nda circa due mesi';
const after = '.\nControllo programmato.';
const page = before + passage + after;
const text = '## Pagina 1\nReferto sintetico.\n' + page;
const { units } = splitDossierUnits(text, 2);
const unitTexts = new Map(units.map((unit) => [unit.index, unitText(text, unit)]));
const evidence = { unit: 2, start: before.length, end: before.length + passage.length, excerpt: 'riferisce dispnea da sforzo da circa due mesi' };

test('evidenzia il passo esatto agli offset della seconda pagina', () => {
    const anchor = anchorPreparedQuote(text, units, evidence.excerpt);
    assert.equal(anchor?.match, 'exact');
    assert.deepEqual(anchor.evidence, evidence);
    const selection = splitDossierPassage(unitTexts, anchor.evidence);
    assert.deepEqual(selection, { before, passage, after });

    const html = renderToStaticMarkup(createElement(PrivacyProvider, null,
        createElement(DossierEvidenceText, { text: page, selection })));
    assert.equal(html, `<span>${before}<mark tabindex="-1">${passage}</mark>${after}</span>`);
});

test('per una citazione approssimata evidenzia la grafia originale del documento', () => {
    const anchor = anchorPreparedQuote(text, units, 'riferisce dispnaa da sforzo da circa due mesi');
    assert.equal(anchor?.match, 'approximate');
    assert.deepEqual(splitDossierPassage(unitTexts, anchor.evidence), { before, passage, after });
});

test('un’unità assente o un intervallo invalido lascia il testo senza evidenziazione', () => {
    for (const invalid of [
        { ...evidence, unit: 3 },
        { ...evidence, start: -1 },
        { ...evidence, start: 0.5 },
        { ...evidence, end: NaN },
        { ...evidence, end: evidence.start },
        { ...evidence, end: evidence.start - 1 },
        { ...evidence, end: page.length + 1 },
    ]) {
        const selection = splitDossierPassage(unitTexts, invalid);
        assert.equal(selection, null);
        assert.equal(renderToStaticMarkup(createElement(PrivacyProvider, null,
            createElement(DossierEvidenceText, { text: page, selection }))), `<span>${page}</span>`);
    }
});
