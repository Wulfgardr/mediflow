/* @Codex */
import type Database from 'better-sqlite3';
export const PROSTHETICS_CATALOG_SQL = `
CREATE TABLE IF NOT EXISTS prosthetics_catalog_entries (
    id TEXT PRIMARY KEY NOT NULL,
    code_system TEXT NOT NULL, code TEXT NOT NULL, description TEXT NOT NULL,
    version TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL,
    start_date TEXT, end_date TEXT,
    source_sha256 TEXT NOT NULL, operation_key TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prosthetics_catalog_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    operation_key TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL
);`;
/** Called within the canonical db-server IMMEDIATE bootstrap, never a second connection. */
export function ensureProstheticsCatalogSchema(connection: Database.Database) {
    connection.exec(PROSTHETICS_CATALOG_SQL);
    for (const [table, expected] of [
        ['prosthetics_catalog_entries', ['id', 'code_system', 'code', 'description', 'version', 'source', 'scope', 'start_date', 'end_date', 'source_sha256', 'operation_key', 'imported_at']],
        ['prosthetics_catalog_receipts', ['id', 'operation_key', 'receipt_json']],
    ] as const) {
        const columns = connection.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; pk: number }[];
        if (columns.length !== expected.length || expected.some((name, i) => columns[i].name !== name
            || columns[i].type !== (name === 'id' && table.endsWith('receipts') ? 'INTEGER' : 'TEXT')
            || columns[i].pk !== (i === 0 ? 1 : 0)
            || columns[i].notnull !== (['start_date', 'end_date'].includes(name) ? 0 : 1))) {
            throw new Error('PROSTHETICS_CATALOG_SCHEMA_UNSUPPORTED');
        }
    }
    const unique = connection.prepare(`SELECT 1 FROM pragma_index_list('prosthetics_catalog_receipts') i
        WHERE i."unique" = 1 AND i.partial = 0
        AND (SELECT count(*) FROM pragma_index_info(i.name)) = 1
        AND (SELECT name FROM pragma_index_info(i.name) LIMIT 1) = 'operation_key'`).get();
    if (!unique) throw new Error('PROSTHETICS_CATALOG_SCHEMA_UNSUPPORTED');
}
