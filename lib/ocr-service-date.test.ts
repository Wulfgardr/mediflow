import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItalianDate } from './italian-date';

function isoDate(value: Date | undefined): string | undefined {
    return value?.toISOString().slice(0, 10);
}

test('parseItalianDate accepts common Italian date separators', () => {
    assert.equal(isoDate(parseItalianDate('15/03/2020')), '2020-03-15');
    assert.equal(isoDate(parseItalianDate('15-03-2020')), '2020-03-15');
    assert.equal(isoDate(parseItalianDate('15.03.2020')), '2020-03-15');
});

test('parseItalianDate keeps ISO fallback and rejects invalid values', () => {
    assert.equal(isoDate(parseItalianDate('2020-03-15')), '2020-03-15');
    assert.equal(parseItalianDate('not a date'), undefined);
});
