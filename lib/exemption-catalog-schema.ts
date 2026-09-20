/* @Codex */
import type Database from 'better-sqlite3';

export const EXEMPTION_RECEIPTS_SQL = `CREATE TABLE IF NOT EXISTS exemption_import_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    operation_key TEXT NOT NULL UNIQUE,
    receipt_json TEXT NOT NULL
)`;

export function ensureExemptionImportSchema(connection: Database.Database): void {
    connection.exec(EXEMPTION_RECEIPTS_SQL);
    const columns = connection.prepare('PRAGMA table_info(exemption_import_receipts)').all() as { name: string; type: string; notnull: number; pk: number }[];
    const expected = [['id', 'INTEGER', 1], ['operation_key', 'TEXT', 0], ['receipt_json', 'TEXT', 0]];
    if (columns.length !== 3 || expected.some(([name, type, pk], i) => columns[i].name !== name
        || columns[i].type !== type || columns[i].pk !== pk || columns[i].notnull !== 1)) {
        throw new Error('EXEMPTION_RECEIPTS_SCHEMA_UNSUPPORTED');
    }
    const uniqueKey = connection.prepare(`SELECT 1 FROM pragma_index_list('exemption_import_receipts') i
        WHERE i."unique" = 1 AND i.partial = 0
        AND (SELECT count(*) FROM pragma_index_info(i.name)) = 1
        AND (SELECT name FROM pragma_index_info(i.name) LIMIT 1) = 'operation_key'`).get();
    if (!uniqueKey) throw new Error('EXEMPTION_RECEIPTS_SCHEMA_UNSUPPORTED');
}
