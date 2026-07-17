/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { normalizeAifaSearchText } from '@/lib/aifa-catalog';
import {
    buildDrugPrefixSearchOrder,
    buildDrugPrefixSearchPredicate,
    buildDrugSearchPredicate,
    normalizeDrugSearchQuery,
    parseDrugSearchLimit,
} from '@/lib/drug-search-query';
import { drugs } from '@/lib/schema';

type SyntheticDrug = {
    aic: string;
    name: string;
    activePrinciple?: string | null;
    packaging?: string | null;
};

function createSyntheticCatalog(rows: SyntheticDrug[]) {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE drugs (
            aic TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            active_principle TEXT,
            company TEXT,
            packaging TEXT,
            class TEXT,
            price INTEGER,
            atc TEXT,
            aic_search TEXT,
            name_search TEXT,
            active_principle_search TEXT
        );
        CREATE INDEX drugs_aic_search_idx ON drugs(aic_search);
        CREATE INDEX drugs_name_search_idx ON drugs(name_search);
        CREATE INDEX drugs_active_principle_search_idx ON drugs(active_principle_search);
    `);
    const insert = sqlite.prepare(`
        INSERT INTO drugs (aic, name, active_principle, packaging, aic_search, name_search, active_principle_search)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAll = sqlite.transaction(() => {
        for (const row of rows) {
            insert.run(
                row.aic,
                row.name,
                row.activePrinciple ?? null,
                row.packaging ?? null,
                normalizeAifaSearchText(row.aic),
                normalizeAifaSearchText(row.name),
                normalizeAifaSearchText(row.activePrinciple || ''),
            );
        }
    });
    insertAll();

    const database = drizzle(sqlite);
    const search = (query: string, limit = 250) => database
        .select({ aic: drugs.aic })
        .from(drugs)
        .where(buildDrugSearchPredicate(query))
        .orderBy(asc(drugs.name), asc(drugs.packaging))
        .limit(limit)
        .all()
        .map((row) => row.aic);

    const searchPrefix = (query: string, limit = 30) => {
        const normalized = normalizeDrugSearchQuery(query);
        return database
            .select({ aic: drugs.aic })
            .from(drugs)
            .where(buildDrugPrefixSearchPredicate(normalized))
            .orderBy(buildDrugPrefixSearchOrder(normalized), asc(drugs.name))
            .limit(limit)
            .all()
            .map((row) => row.aic);
    };

    return { search, searchPrefix, close: () => sqlite.close() };
}

test('indexed prefix search folds accents and ranks exact AIC before names', () => {
    const catalog = createSyntheticCatalog([
        { aic: '000000102', name: 'CITTÀ FORTE', activePrinciple: 'Metformina' },
        { aic: '000000101', name: 'ACIDO SINTETICO', activePrinciple: 'Acido acetilsalicilico' },
        { aic: '000000103', name: 'ALTRO FARMACO', activePrinciple: 'Acido citrico' },
    ]);

    assert.deepEqual(catalog.searchPrefix('àcido'), ['000000101', '000000103']);
    assert.deepEqual(catalog.searchPrefix('citta'), ['000000102']);
    assert.deepEqual(catalog.searchPrefix('000000101'), ['000000101']);
    catalog.close();
});

test('indexed prefix search enforces the requested limit and rejects contains-only matches', () => {
    const catalog = createSyntheticCatalog(Array.from({ length: 12 }, (_, index) => ({
        aic: String(index + 1).padStart(9, '0'),
        name: index === 11 ? 'ZETA PREFISSO' : `PREFISSO ${String(index).padStart(2, '0')}`,
        activePrinciple: null,
    })));

    assert.equal(catalog.searchPrefix('prefisso', 5).length, 5);
    assert.deepEqual(catalog.searchPrefix('zeta'), ['000000012']);
    assert.deepEqual(catalog.searchPrefix('fisso'), []);
    assert.equal(parseDrugSearchLimit('999'), 50);
    assert.equal(parseDrugSearchLimit('0'), 1);
    catalog.close();
});

test('production drug predicate matches every normalized token before the candidate cap', () => {
    const decoys = Array.from({ length: 300 }, (_, index) => ({
        aic: `DECOY-${index}`,
        name: `Alfa ${String(index).padStart(3, '0')}`,
        activePrinciple: null,
        packaging: 'Compresse',
    }));
    const catalog = createSyntheticCatalog([
        ...decoys,
        { aic: 'TARGET', name: 'Zeta Alfa', activePrinciple: null, packaging: 'Beta soluzione' },
    ]);

    assert.deepEqual(catalog.search('  Ａlfa   Beta  '), ['TARGET']);
    assert.equal(catalog.search('Alfa').length, 250);
    catalog.close();
});

test('production drug predicate handles nullable columns and literal LIKE metacharacters', () => {
    const catalog = createSyntheticCatalog([
        { aic: 'LITERAL', name: 'Farmaco 100%', activePrinciple: null, packaging: 'Flacone_1\\speciale' },
        { aic: 'DECOY', name: 'Farmaco 1000', activePrinciple: null, packaging: 'FlaconeX1speciale' },
    ]);

    assert.deepEqual(catalog.search('100% Flacone_1\\speciale'), ['LITERAL']);
    catalog.close();
});

test('production drug predicate keeps SQL depth bounded beyond one thousand tokens', () => {
    const catalog = createSyntheticCatalog([
        { aic: 'ONLY', name: 'Farmaco sintetico', activePrinciple: null, packaging: null },
    ]);
    const query = Array.from({ length: 1_100 }, (_, index) => `token${index}`).join(' ');

    assert.deepEqual(catalog.search(query), []);
    catalog.close();
});
