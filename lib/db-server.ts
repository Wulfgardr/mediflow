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
try {
    const columns = sqlite.prepare("PRAGMA table_info(attachments)").all().map((col: any) => col.name);
    if (!columns.includes('summary_snapshot')) {
        sqlite.prepare("ALTER TABLE attachments ADD COLUMN summary_snapshot TEXT").run();
    }
} catch (error) {
    console.warn('[MediFlow] Attachments schema check skipped:', error);
}
export const dbServer = drizzle(sqlite);
