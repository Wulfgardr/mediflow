import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDbServer } from './db-server';
import { readSqliteArchiveGeneration } from './archive-generation';

const PREFIX = 'archive.restore.receipt.';
export type RestoreIntent = { id: string; expectedSnapshot: string };
export type RestoreReceipt = { id: string; sourceChecksum: string; archiveGeneration: string; completedAt: string };
export function parseRestoreIntent(request: Request): RestoreIntent | null {
    const id = request.headers.get('x-mediflow-restore-id');
    const expectedSnapshot = request.headers.get('x-mediflow-restore-snapshot');
    const confirmation = request.headers.get('x-mediflow-restore-confirmation');
    if (id === null && expectedSnapshot === null && confirmation === null) return null;
    if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id)
        || !expectedSnapshot || !/^[a-f0-9]{64}$/u.test(expectedSnapshot) || confirmation !== 'RIPRISTINA') {
        throw new Error('INVALID_RESTORE_INTENT');
    }
    return { id, expectedSnapshot };
}
function quote(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }
export function readRestorePreviewSnapshot(): string {
    const db = openDbServer();
    return db.transaction(() => restoreSnapshot(db))();
}
export function readCurrentRestoreReceipt(id: string): RestoreReceipt | null {
    return readRestoreReceipt(openDbServer(), id);
}
export function restoreSnapshot(db: Database.Database): string {
    const hash = createHash('sha256');
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[];
    for (const { name } of tables) {
        if (name === 'archive_session_generations') continue;
        const rows = db.prepare(`SELECT * FROM ${quote(name)}`).all() as Record<string, unknown>[];
        const included = name === 'settings' ? rows.filter(row => !String(row.key).startsWith(PREFIX)) : rows;
        hash.update(JSON.stringify([name, included.map(row => JSON.stringify(row)).sort()]));
    }
    return hash.digest('hex');
}
export function writeRestoreReceipt(db: Database.Database, intent: RestoreIntent, sourceChecksum: string): RestoreReceipt {
    const receipt = { id: intent.id, sourceChecksum, archiveGeneration: readSqliteArchiveGeneration(db), completedAt: new Date().toISOString() };
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(PREFIX + intent.id, JSON.stringify(receipt));
    return receipt;
}
export function readRestoreReceipt(db: Database.Database, id: string): RestoreReceipt | null {
    if (!/^[a-f0-9-]{36}$/u.test(id)) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(PREFIX + id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as RestoreReceipt : null;
}
