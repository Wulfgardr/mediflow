import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHtmlSinkSource } from './html-sink-guard.mjs';

const validate = source => validateHtmlSinkSource(source, 'components/fixture.tsx');
const imported = "import { sanitizeClinicalRichTextHtml } from '@/lib/clinical-rich-text';";

test('il controllo rifiuta assegnazioni e proprietà HTML prive del sanitizzatore', () => {
    const issues = validate([
        imported,
        'node.innerHTML = value;',
        'node["innerHTML"] = value;',
        'node.innerHTML += sanitizeClinicalRichTextHtml(value);',
        'const props = { dangerouslySetInnerHTML: { __html: value } };',
        'const view = <div dangerouslySetInnerHTML={{ __html: value }} />;',
        'function unsafe(sanitizeClinicalRichTextHtml) { node.innerHTML = sanitizeClinicalRichTextHtml(value); }',
    ].join('\n'));
    assert.deepEqual(issues.map(issue => issue.line), [2, 3, 4, 5, 6, 7]);
    assert.ok(issues.every(issue => issue.message.includes('sanitizeClinicalRichTextHtml')));
    assert.equal(validate('node.innerHTML = sanitizeClinicalRichTextHtml(value);').length, 1);
});

test('ammette la chiamata diretta al sanitizzatore condiviso, la lettura e il testo semplice', () => {
    assert.deepEqual(validate([
        imported,
        'node.innerHTML = sanitizeClinicalRichTextHtml(value);',
        'node["innerHTML"] = sanitizeClinicalRichTextHtml(value);',
        'const view = <div dangerouslySetInnerHTML={{ __html: sanitizeClinicalRichTextHtml(value) }} />;',
        'node.textContent = value;',
        'const html = node.innerHTML;',
    ].join('\n')), []);
});
