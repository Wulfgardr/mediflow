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
        class: null,
        price: null,
        atc: 'B01AC06',
        aicSearch: '000000101',
        nameSearch: 'acido sintetico',
        activePrincipleSearch: 'acido acetilsalicilico',
        packagingSearch: '20 compresse da 100 mg uso orale',
    });
    assert.equal(parsed.drugs[1].nameSearch, 'farmaco citta');
    assert.equal(parsed.drugs[2].name, 'SOLUZIONE "TEST"');
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
    assert.throws(() => validateAifaManifestInput({
        sourceUrl: ['https:', '', 'example.com', 'not-aifa.csv'].join('/'),
        downloadedAt: '2026-07-17',
        version: 'untrusted-source',
    }), /dominio ufficiale aifa\.gov\.it/);
    assert.throws(() => validateAifaManifestInput({
        sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL.replace('https:', 'http:'),
        downloadedAt: '2026-07-17',
        version: 'insecure-source',
    }), /dominio ufficiale aifa\.gov\.it/);
});

test('strict AIFA imports require ATC and active-principle columns even when AIC and name exist', () => {
    assert.throws(() => parseAifaCsv('CODICE_AIC;DENOMINAZIONE\n000000101;TEST', true), /codice_atc/);
    assert.throws(() => parseAifaCsv('CODICE_AIC;DENOMINAZIONE;CODICE_ATC\n000000101;TEST;A01AA01', true), /pa_associati/);
});

test('remote comparison never calls a legacy or metadata-free catalog unchanged', async () => {
    const { compareAifaSource } = await import('./aifa-catalog-source');
    const { AIFA_DOWNLOAD_URL } = await import('./aifa-catalog');
    const manifest = buildAifaCatalogManifest({ sourceUrl: AIFA_DOWNLOAD_URL, version: 'synthetic-version', downloadedAt: '2026-10-15',
        etag: '"local"', lastModified: 'Tue, 13 Oct 2026 23:02:27 GMT' }, { sha256: 'a'.repeat(64), fileName: 'synthetic.csv', rowCount: 3 });
    const remote = { checkedAt: '2026-10-15T10:00:00Z', outcome: 'unchanged' as const, etag: '"remote"', lastModified: 'Wed, 14 Oct 2026 23:02:27 GMT' };
    assert.equal(compareAifaSource(remote, manifest, 3).outcome, 'available');
    assert.equal(compareAifaSource({ ...remote, etag: '"local"' }, manifest, 3).outcome, 'unchanged');
    assert.equal(compareAifaSource(remote, null, 3).reason, 'local_metadata_absent');
    assert.equal(compareAifaSource(remote, { ...manifest, etag: undefined, lastModified: undefined }, 3).outcome, 'unavailable');
    assert.equal(compareAifaSource({ ...remote, outcome: 'unavailable' }, manifest, 3).outcome, 'unavailable');
    assert.deepEqual(parseStoredAifaCatalogManifest(JSON.stringify(manifest)), manifest);
});
