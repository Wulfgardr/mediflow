import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { dbServer, openDbServer } from './db-server';
import { readSqliteArchiveGeneration } from './archive-generation';
import type { BackupRowArtifact } from './backup-artifact';
import { planBackupRestore } from './backup-restore-policy';

import { RESTORE_RECEIPT_PREFIX as PREFIX } from './backup-restore-receipt-contract';
export type RestoreIntent = { id: string; expectedSnapshot: string; expectedSourceChecksum?: string };
export type RestoreReceipt = { id: string; sourceChecksum: string; archiveGeneration: string; completedAt: string; excludedRetiredPatients: number };
export function parseRestoreIntent(request: Request): RestoreIntent | null {
    const id = request.headers.get('x-mediflow-restore-id');
    const expectedSnapshot = request.headers.get('x-mediflow-restore-snapshot');
    const confirmation = request.headers.get('x-mediflow-restore-confirmation');
    const expectedSourceChecksum = request.headers.get('x-mediflow-restore-source-checksum');
    if (id === null && expectedSnapshot === null && confirmation === null && expectedSourceChecksum === null) return null;
    if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id)
        || !expectedSnapshot || !/^[a-f0-9]{64}$/u.test(expectedSnapshot) || confirmation !== 'RIPRISTINA'
        || (expectedSourceChecksum !== null && !/^[a-f0-9]{64}$/u.test(expectedSourceChecksum))) {
        throw new Error('INVALID_RESTORE_INTENT');
    }
    return { id, expectedSnapshot, ...(expectedSourceChecksum === null ? {} : { expectedSourceChecksum }) };
}
function quote(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }
export function readRestorePreviewSnapshot(): string {
    const db = openDbServer();
    return db.transaction(() => restoreSnapshot(db))();
}
export function readRestorePreview(artifact: BackupRowArtifact): { expectedSnapshot: string; excludedRetiredPatients: number } {
    const db = openDbServer();
    return db.transaction(() => {
        const { excludedRetiredPatients } = planBackupRestore(db, artifact.payload, dbServer);
        return { expectedSnapshot: restoreSnapshot(db), excludedRetiredPatients };
    })();
}
export function readCurrentRestoreReceipt(id: string): RestoreReceipt | null {
    return readRestoreReceipt(openDbServer(), id);
}
export function restoreSnapshot(db: Database.Database): string {
    const hash = createHash('sha256');
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as { name: string }[];
    for (const { name } of tables) {
        if (name === 'archive_session_generations') continue;
        const digests: string[] = [];
        for (const row of db.prepare(`SELECT * FROM ${quote(name)}`).iterate() as Iterable<Record<string, unknown>>) {
            if (name === 'settings' && String(row.key).startsWith(PREFIX)) continue;
            const digest = createHash('sha256');
            for (const [key, value] of Object.entries(row)) {
                digest.update(JSON.stringify(key) + '\0');
                if (Buffer.isBuffer(value)) digest.update(`blob:${value.length}\0`).update(value);
                else digest.update(JSON.stringify(value) + '\0');
            }
            digests.push(digest.digest('hex'));
        }
        hash.update(JSON.stringify(name) + '\0');
        for (const digest of digests.sort()) hash.update(digest);
    }
    return hash.digest('hex');
}
export function writeRestoreReceipt(db: Database.Database, intent: RestoreIntent, sourceChecksum: string, excludedRetiredPatients: number): RestoreReceipt {
    const receipt = { id: intent.id, sourceChecksum, archiveGeneration: readSqliteArchiveGeneration(db), completedAt: new Date().toISOString(), excludedRetiredPatients };
    const key = PREFIX + intent.id;
    const value = JSON.stringify(receipt);
    const inserted = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(key, value);
    const stored = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    if (inserted.changes !== 1 || stored?.value !== value) throw new Error('RESTORE_RECEIPT_NOT_PERSISTED');
    return receipt;
}
export function readRestoreReceipt(db: Database.Database, id: string): RestoreReceipt | null {
    if (!/^[a-f0-9-]{36}$/u.test(id)) return null;
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(PREFIX + id) as { value: string } | undefined;
    if (!row) return null;
    const receipt = JSON.parse(row.value) as RestoreReceipt;
    return { ...receipt, excludedRetiredPatients: receipt.excludedRetiredPatients ?? 0 };
}
