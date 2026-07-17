import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { AIFA_CATALOG_DEFAULT_SOURCE_URL } from './aifa-catalog';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

type CatalogModules = {
    clearAifaCatalog: typeof import('./aifa-catalog-server.ts').clearAifaCatalog;
    getAifaCatalogStatus: typeof import('./aifa-catalog-server.ts').getAifaCatalogStatus;
    replaceAifaCatalog: typeof import('./aifa-catalog-server.ts').replaceAifaCatalog;
    searchAifaCatalog: typeof import('./aifa-catalog-server.ts').searchAifaCatalog;
};

let modulesPromise: Promise<CatalogModules> | null = null;

function bootstrapDatabase(dataDir: string): void {
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        for (const fileName of fs.readdirSync(path.join(ROOT_DIR, 'drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
            const sql = fs.readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8')
                .replace(/^-->\s+statement-breakpoint\s*$/gm, '');
            sqlite.exec(sql);
        }
    } finally {
        sqlite.close();
    }
}

async function loadCatalogModules(): Promise<CatalogModules> {
    if (!modulesPromise) {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-aifa-catalog-'));
        bootstrapDatabase(dataDir);
        process.env.MEDIFLOW_DATA_DIR = dataDir;
        modulesPromise = import('./aifa-catalog-server.ts');
    }
    return modulesPromise;
}

test('import persists the provenance manifest and enables bounded prefix search', async () => {
    const catalog = await loadCatalogModules();
    const csv = fs.readFileSync(path.join(ROOT_DIR, 'scripts/fixtures/aifa-confezioni-synthetic.csv'));
    const result = await catalog.replaceAifaCatalog(
        new File([csv], 'aifa-synthetic.csv', { type: 'text/csv' }),
        {
            sourceUrl: AIFA_CATALOG_DEFAULT_SOURCE_URL,
            downloadedAt: '2026-07-17',
            version: 'synthetic-test-v1',
        },
    );

    assert.equal(result.state, 'ready');
    assert.equal(result.count, 3);
    assert.ok(result.manifest);
    assert.equal(result.manifest.rowCount, 3);
    assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);

    const status = await catalog.getAifaCatalogStatus();
    assert.deepEqual(status.manifest, result.manifest);

    const search = await catalog.searchAifaCatalog('acido', 1);
    assert.equal(search.rows.length, 1);
    assert.equal(search.rows[0].name, 'ACIDO SINTETICO');

    catalog.clearAifaCatalog();
    assert.deepEqual(await catalog.getAifaCatalogStatus(), {
        count: 0,
        manifest: null,
        state: 'not-imported',
    });
});
