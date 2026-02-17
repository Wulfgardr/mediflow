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
try {
    const columns = (sqlite.prepare("PRAGMA table_info(attachments)").all() as TableInfoRow[]).map((col) => col.name);
    if (!columns.includes('summary_snapshot')) {
        sqlite.prepare("ALTER TABLE attachments ADD COLUMN summary_snapshot TEXT").run();
    }
} catch (error) {
    console.warn('[MediFlow] Attachments schema check skipped:', error);
}
/* @Codex */
try {
    const patientColumns = (sqlite.prepare("PRAGMA table_info(patients)").all() as TableInfoRow[]).map((col) => col.name);
    if (!patientColumns.includes('exemptions')) {
        sqlite.prepare("ALTER TABLE patients ADD COLUMN exemptions TEXT").run();
    }
} catch (error) {
    console.warn('[MediFlow] Patients schema check skipped:', error);
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
