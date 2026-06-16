/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    clinicalRichTextToPlainText,
    compactClinicalRichText,
    sanitizeClinicalRichTextHtml,
} from './clinical-rich-text.ts';

test('sanitizeClinicalRichTextHtml keeps the supported subset and strips unsafe payloads', () => {
    const input = '<div><strong onclick="alert(1)">Piano</strong><script>alert(1)</script><img src=x onerror=1 /><ul><li>Terapia</li></ul></div>';
    const result = sanitizeClinicalRichTextHtml(input);

    assert.equal(result, '<p><strong>Piano</strong><ul><li>Terapia</li></ul></p>');
});

test('sanitizeClinicalRichTextHtml neutralizes slash-separated tag bypasses', () => {
    // Browsers treat `/` as a tag-name/attribute separator, so these must not survive.
    assert.equal(sanitizeClinicalRichTextHtml('<img/src=x onerror=alert(1)>'), '');
    assert.equal(sanitizeClinicalRichTextHtml('<svg/onload=alert(1)>'), '');
    assert.equal(
        sanitizeClinicalRichTextHtml('<p>ok</p><img/src=x onerror=alert(1)>'),
        '<p>ok</p>',
    );
});

test('sanitizeClinicalRichTextHtml escapes unterminated and stray tag-like input', () => {
    // An unterminated tag cannot be matched by the tag regex; its `<` must be escaped.
    assert.equal(
        sanitizeClinicalRichTextHtml('<img src=x onerror=alert(1)'),
        '&lt;img src=x onerror=alert(1)',
    );
    assert.equal(sanitizeClinicalRichTextHtml('a < b'), 'a &lt; b');
});

test('sanitizeClinicalRichTextHtml preserves the allowed subset unchanged', () => {
    assert.equal(
        sanitizeClinicalRichTextHtml('<p><strong>A</strong><br><ul><li>B</li></ul></p>'),
        '<p><strong>A</strong><br><ul><li>B</li></ul></p>',
    );
});

test('clinicalRichTextToPlainText renders readable text for headings and bullets', () => {
    const input = '<h2>SOAP</h2><p>Stabile</p><ul><li>Controllo tra 7 giorni</li><li>Ematochimici</li></ul>';
    const result = clinicalRichTextToPlainText(input);

    assert.equal(result, 'SOAP\nStabile\n- Controllo tra 7 giorni\n- Ematochimici');
});

test('compactClinicalRichText truncates sanitized content', () => {
    const input = '<p>Visita di controllo con andamento clinico stabile e follow-up pianificato.</p>';
    const result = compactClinicalRichText(input, 32);

    assert.equal(result, 'Visita di controllo con andamen...');
});
