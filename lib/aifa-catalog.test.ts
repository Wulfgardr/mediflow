/* @Codex */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    AIFA_CATALOG_DEFAULT_SOURCE_URL,
    AIFA_CATALOG_SOURCE,
    AIFA_REUSE_TERMS_URL,
    buildAifaCatalogManifest,
    normalizeAifaSearchText,
    parseAifaCsv,
    parseStoredAifaCatalogManifest,
    validateAifaManifestInput,
} from './aifa-catalog';

const fixturePath = path.join(process.cwd(), 'scripts/fixtures/aifa-confezioni-synthetic.csv');

test('parses the synthetic fixture with the real AIFA confezioni headers', () => {
    const parsed = parseAifaCsv(fs.readFileSync(fixturePath, 'utf8'));

    assert.equal(parsed.totalRecords, 4);
    assert.equal(parsed.rejectedRecords, 1);
    assert.equal(parsed.drugs.length, 3);
    assert.deepEqual(parsed.drugs[0], {
        aic: '000000101',
        name: 'ACIDO SINTETICO',
        activePrinciple: 'Acido acetilsalicilico',
        company: 'AZIENDA SINTETICA UNO',
        packaging: '20 compresse da 100 mg; uso orale',
        class: 'A',
        price: 250,
        atc: 'B01AC06',
        aicSearch: '000000101',
        nameSearch: 'acido sintetico',
        activePrincipleSearch: 'acido acetilsalicilico',
    });
    assert.equal(parsed.drugs[1].nameSearch, 'farmaco citta');
    assert.equal(parsed.drugs[2].name, 'SOLUZIONE TEST');
});

test('normalizes accents and rejects missing required AIFA headers', () => {
    assert.equal(normalizeAifaSearchText('  Città ÀCIDA  '), 'citta acida');
    assert.throws(() => parseAifaCsv('aic;descrizione\n000000001;Dato'), /denominazione/);
});

test('builds and validates the persisted provenance manifest', () => {
    const input = validateAifaManifestInput({
        sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL,
        downloadedAt: '2026-07-17',
        version: 'confezioni-2026-07-16',
    });
    const manifest = buildAifaCatalogManifest(input, {
        sha256: 'a'.repeat(64),
        fileName: 'confezioni.csv',
        rowCount: 3,
        importedAt: '2026-07-17T10:00:00.000Z',
    });

    assert.equal(manifest.source, AIFA_CATALOG_SOURCE);
    assert.equal(manifest.reuseTermsUrl, AIFA_REUSE_TERMS_URL);
    assert.equal(manifest.reuseStatus, 'source-artifact-review-required');
    assert.deepEqual(parseStoredAifaCatalogManifest(JSON.stringify(manifest)), manifest);
    assert.equal(parseStoredAifaCatalogManifest('{"format":"unknown"}'), null);
    assert.throws(() => validateAifaManifestInput({
        sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL,
        downloadedAt: '2026-02-31',
        version: 'invalid-date',
    }), /Data di scarico/);
});
