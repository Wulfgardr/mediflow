/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

type ForeignKeyRow = {
    table: string;
    from: string;
    on_delete: string;
};

type IndexRow = {
    name: string;
};

function assertLinkSchema(sqlite: Database.Database): void {
    const foreignKeys = sqlite.pragma("foreign_key_list('observations')") as ForeignKeyRow[];
    const linkForeignKey = foreignKeys.find((row) => row.from === 'service_prescription_item_id');
    assert.ok(linkForeignKey);
    assert.equal(linkForeignKey.table, 'service_prescription_items');
    assert.equal(linkForeignKey.on_delete, 'SET NULL');

    const indices = sqlite.pragma("index_list('observations')") as IndexRow[];
    assert.ok(indices.some((row) => row.name === 'observations_service_prescription_item_idx'));
    assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
}

function applyMigrations(sqlite: Database.Database, excludedFiles: ReadonlySet<string> = new Set()): void {
    const migrationFiles = fs
        .readdirSync(path.join(ROOT_DIR, 'drizzle'))
        .filter((file) => file.endsWith('.sql') && !excludedFiles.has(file))
        .sort((left, right) => left.localeCompare(right));
    for (const fileName of migrationFiles) {
        const migration = fs.readFileSync(path.join(ROOT_DIR, 'drizzle', fileName), 'utf8');
        if (migration.trim().length > 0) sqlite.exec(migration);
    }
}

test('historical migrations bootstrap the result link with SET NULL and an index', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-observation-link-migration-'));
    const sqlite = new Database(path.join(dataDir, 'medical.db'));
    try {
        applyMigrations(sqlite);
        sqlite.pragma('foreign_keys = ON');
        assertLinkSchema(sqlite);
    } finally {
        sqlite.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test('runtime schema guards bootstrap the result link with SET NULL and an index', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-observation-link-runtime-'));
    const seed = new Database(path.join(dataDir, 'medical.db'));
    try {
        applyMigrations(seed, new Set(['0021_observations_service_prescription_item_link.sql']));
    } finally {
        seed.close();
    }
    process.env.MEDIFLOW_DATA_DIR = dataDir;
    const { dbServer } = await import('./db-server.ts');
    try {
        assertLinkSchema(dbServer.$client);
    } finally {
        dbServer.$client.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});
