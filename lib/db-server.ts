import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
/* @Codex */
import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/data-dir';

// Ensure the data directory exists in production or use project root for dev
/* @Codex */
const dbPath = resolveDataPath('medical.db');
const legacyDbPath = path.join(process.cwd(), 'medical.db');

if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    try {
        fs.copyFileSync(legacyDbPath, dbPath);
        console.log(`[MediFlow] Copied legacy DB to ${dbPath}`);
    } catch (error) {
        console.error('[MediFlow] Failed to copy legacy DB:', error);
    }
}

const sqlite = new Database(dbPath);
/* @Codex */
type TableInfoRow = { name: string };
/* @Codex */
function ensureColumn(table: string, columnName: string, columnSql: string) {
    const columns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as TableInfoRow[]).map((col) => col.name);
    if (!columns.includes(columnName)) {
        sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`).run();
    }
}
/* @Codex */
try {
    ensureColumn('attachments', 'summary_snapshot', 'summary_snapshot TEXT');
} catch (error) {
    console.warn('[MediFlow] Attachments schema check skipped:', error);
}
/* @Codex */
try {
    ensureColumn('patients', 'exemptions', 'exemptions TEXT');
    /* @Codex */
    ensureColumn('patients', 'diagnoses', 'diagnoses TEXT');
    /* @Codex */
    ensureColumn('patients', 'monitoring_profile', 'monitoring_profile TEXT');
    /* @Codex */
    ensureColumn('patients', 'status_reason', 'status_reason TEXT');
} catch (error) {
    console.warn('[MediFlow] Patients schema check skipped:', error);
}
/* @Codex */
try {
    ensureColumn('checkups', 'notes', 'notes TEXT');
    /* @Codex */
    ensureColumn('checkups', 'source', 'source TEXT');
} catch (error) {
    console.warn('[MediFlow] Checkups schema check skipped:', error);
}
/* @Codex */
try {
    ensureColumn('therapies', 'active_principle', 'active_principle TEXT');
    /* @Codex */
    ensureColumn('therapies', 'motivation', 'motivation TEXT');
    /* @Codex */
    ensureColumn('therapies', 'diagnosis_code', 'diagnosis_code TEXT');
    /* @Codex */
    ensureColumn('therapies', 'diagnosis_name', 'diagnosis_name TEXT');
} catch (error) {
    console.warn('[MediFlow] Therapies schema check skipped:', error);
}
/* @Codex */
try {
    sqlite.prepare(`
        CREATE TABLE IF NOT EXISTS exemptions (
            code TEXT PRIMARY KEY NOT NULL,
            description TEXT NOT NULL,
            type TEXT,
            source TEXT,
            start_date INTEGER,
            end_date INTEGER,
            is_pharma INTEGER,
            is_specialist INTEGER,
            is_national INTEGER,
            updated_at INTEGER DEFAULT (unixepoch())
        )
    `).run();
    sqlite.prepare("CREATE INDEX IF NOT EXISTS exemptions_code_idx ON exemptions(code)").run();
    sqlite.prepare("CREATE INDEX IF NOT EXISTS exemptions_type_idx ON exemptions(type)").run();
} catch (error) {
    console.warn('[MediFlow] Exemptions schema check skipped:', error);
}
export const dbServer = drizzle(sqlite);
