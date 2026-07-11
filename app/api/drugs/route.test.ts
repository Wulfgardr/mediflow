/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const ROUTE_SOURCE = fs.readFileSync(path.join(process.cwd(), 'app/api/drugs/route.ts'), 'utf8');

function escapeLikeToken(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}

function searchSyntheticCatalog(database: Database.Database, query: string): string[] {
    const tokens = [...new Set(query.normalize('NFKC').trim().split(/\s+/).filter(Boolean))];
    const escapedTokens = JSON.stringify(tokens.map(escapeLikeToken));
    return database.prepare(`
        SELECT aic
        FROM drugs
        WHERE NOT EXISTS (
            SELECT 1
            FROM json_each(?) AS search_token
            WHERE NOT (
                coalesce(name, '') LIKE '%' || search_token.value || '%' ESCAPE '\\'
                OR coalesce(active_principle, '') LIKE '%' || search_token.value || '%' ESCAPE '\\'
                OR coalesce(packaging, '') LIKE '%' || search_token.value || '%' ESCAPE '\\'
                OR coalesce(aic, '') LIKE '%' || search_token.value || '%' ESCAPE '\\'
            )
        )
        ORDER BY name, packaging
        LIMIT 250
    `).all(escapedTokens).map((row) => (row as { aic: string }).aic);
}

test('drug search applies cross-field token matching before the 250 candidate cap', () => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE drugs (
            aic TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            active_principle TEXT,
            packaging TEXT
        )
    `);
    const insert = database.prepare(`
        INSERT INTO drugs (aic, name, active_principle, packaging)
        VALUES (?, ?, ?, ?)
    `);

    const transaction = database.transaction(() => {
        for (let index = 0; index < 300; index += 1) {
            insert.run(`DECOY-${index}`, `Alfa ${String(index).padStart(3, '0')}`, 'Principio diverso', 'Compresse');
        }
        insert.run('TARGET', 'Zeta Alfa', 'Principio diverso', 'Beta soluzione');
    });
    transaction();

    assert.deepEqual(searchSyntheticCatalog(database, '  Alfa   Beta  '), ['TARGET']);
    assert.equal(searchSyntheticCatalog(database, 'Alfa').length, 250);
    database.close();

    assert.match(ROUTE_SOURCE, /FROM json_each\(\$\{escapedTokens\}\)/);
    for (const field of ['name', 'activePrinciple', 'packaging', 'aic']) {
        assert.match(ROUTE_SOURCE, new RegExp(`coalesce\\(\\$\\{drugs\\.${field}\\}, ''\\) LIKE`));
    }
    assert.ok(
        ROUTE_SOURCE.indexOf('.where(tokenPredicate)') < ROUTE_SOURCE.indexOf('.limit(250)'),
        'the complete token predicate must be applied before the candidate cap',
    );
});

test('drug search keeps SQL expression depth bounded for very large token sets', () => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE drugs (
            aic TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            active_principle TEXT,
            packaging TEXT
        );
        INSERT INTO drugs VALUES ('ONLY', 'Farmaco sintetico', NULL, 'Compresse');
    `);
    const query = Array.from({ length: 1_100 }, (_, index) => `token${index}`).join(' ');

    assert.deepEqual(searchSyntheticCatalog(database, query), []);
    database.close();
});

test('drug search treats SQL wildcard characters as literals', () => {
    const database = new Database(':memory:');
    database.exec(`
        CREATE TABLE drugs (
            aic TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            active_principle TEXT,
            packaging TEXT
        );
        INSERT INTO drugs VALUES ('LITERAL', 'Farmaco 100%', NULL, 'Flacone_1');
        INSERT INTO drugs VALUES ('DECOY', 'Farmaco 1000', NULL, 'FlaconeX1');
    `);

    assert.deepEqual(searchSyntheticCatalog(database, '100% Flacone_1'), ['LITERAL']);
    database.close();
});
