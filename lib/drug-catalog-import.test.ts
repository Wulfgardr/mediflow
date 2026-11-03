import assert from 'node:assert/strict';
import test from 'node:test';
import { readDrugCatalogHeader } from './drug-catalog-import';

test('a semicolon header with commas inside a quoted label keeps the semicolon', () => {
    const { header, suggestion } = readDrugCatalogHeader(new TextEncoder().encode('code;"name, description, long";substance\nA1;X;Y\n'));
    assert.equal(suggestion.delimiter, ';');
    assert.deepEqual(header, ['code', 'name, description, long', 'substance']);
});

test('a large valid file with an accented character across the preview cut is not rejected', () => {
    const head = 'code;name;substance\n';
    const filler = 'A'.repeat(256 * 1024 - head.length - 1);
    const { header } = readDrugCatalogHeader(new TextEncoder().encode(`${head}${filler}è;fine;fine\n`));
    assert.deepEqual(header, ['code', 'name', 'substance']);
});
