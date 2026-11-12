import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { scoreAnnotations, validateCorpus } from './measure-cb-redaction';
import { createRedactionSession } from '../lib/ai-redaction-session';

const corpus = () => JSON.parse(fs.readFileSync(new URL('./fixtures/cb-redaction-acceptance.json', import.meta.url), 'utf8'));

test('C-B corpus fixes the synthetic families and occurrence counts before inference', () => {
    const value = validateCorpus(corpus());
    assert.equal(value.cases.length, 36);
    assert.equal(value.cases.reduce((sum, entry) => sum + entry.expected.length, 0), 43);
    assert.equal(value.cases.filter(entry => entry.preserveText).length, 3);
    assert.deepEqual(value.families, {
        cf_ocr: { cases: 6, identifiers: 6 }, terze_persone: { cases: 5, identifiers: 7 },
        luoghi: { cases: 4, identifiers: 5 }, nascita: { cases: 4, identifiers: 8 },
        nomi_file: { cases: 4, identifiers: 5 }, campi_ignoti: { cases: 4, identifiers: 5 },
        identita_nota: { cases: 3, identifiers: 3 }, contatti: { cases: 3, identifiers: 4 },
        controlli_clinici: { cases: 3, identifiers: 0 },
    });
});

test('C-B counts a partially covered identifier as escaped and retains the exact residual', () => {
    const text = '📎 Lidia Zanfelli';
    const expected = [{ type: 'person', text: 'Lidia Zanfelli', start: 3, end: text.length }];
    const [score] = scoreAnnotations(text, expected, [{ start: 3, end: 8 }]);
    assert.equal(score.stopped, false);
    assert.deepEqual(score.visibleFragments, [{ start: 8, end: text.length, text: ' Zanfelli' }]);
    assert.equal(scoreAnnotations(text, expected, [{ start: 3, end: 8 }, { start: 8, end: text.length }])[0].stopped, true);
});

test('C-B does not call a remaining invisible separator an escaped identifier', () => {
    const text = 'NVNZLM74\u200bD52Z999X';
    const [score] = scoreAnnotations(text, [{ type: 'tax_id', text, start: 0, end: text.length }],
        [{ start: 0, end: 8 }, { start: 9, end: text.length }]);
    assert.equal(score.stopped, true);
    assert.equal(score.fullyCovered, false);
    assert.equal(score.visibleFragments[0].text, '\u200b');
});

test('C-B rejects wrong offsets, repeated annotations and changed family totals', () => {
    const wrongOffset = corpus(); wrongOffset.cases[0].expected[0].start++;
    assert.throws(() => validateCorpus(wrongOffset), /invalid_annotation/);
    const duplicate = corpus(); duplicate.cases[0].expected.push(duplicate.cases[0].expected[0]);
    assert.throws(() => validateCorpus(duplicate), /duplicate_annotation/);
    const totals = corpus(); totals.families.cf_ocr.identifiers++;
    assert.throws(() => validateCorpus(totals), /family_counts_mismatch/);
});

test('C-B empty neural runner leaves annotated misses through the production local rules', () => {
    const value = validateCorpus(corpus());
    let stopped = 0, escaped = 0;
    for (const entry of value.cases) {
        const session = createRedactionSession();
        try {
            const prepared = session.prepare({ text: entry.inputText, entities: [], knownIdentifiers: entry.knownIdentifiers });
            const scored = scoreAnnotations(entry.inputText, entry.expected, prepared.spans);
            stopped += scored.filter(e => e.stopped).length;
            escaped += scored.filter(e => !e.stopped).length;
            assert.equal(prepared.rehydrate(prepared.redactedText), entry.inputText);
        } finally { session.close(); }
    }
    assert.ok(stopped > 0, 'positive deterministic control must still work');
    assert.ok(escaped > 0, 'empty neural runner must turn acceptance red');
    assert.equal(stopped + escaped, 43);
});
