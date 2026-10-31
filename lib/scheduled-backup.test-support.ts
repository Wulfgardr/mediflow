import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { backupDestinationIdentity } from '../scripts/backup-destination-policy.mjs';

export function prepareSyntheticBackupDestination(dataDir: string, destination: string): void {
    const root = fs.realpathSync(os.tmpdir());
    const ancestor = fs.realpathSync(dataDir);
    if (!ancestor.startsWith(`${root}${path.sep}`)) throw new Error('Synthetic temporary archive required');
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    const db = new Database(path.join(dataDir, 'medical.db'));
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key=?').get('backupScheduler') as { value: string } | undefined;
        const state = row ? JSON.parse(row.value) : { version: 1, config: {}, run: {} };
        state.config = { ...state.config, destinationDir: destination, volumeProtectionAcknowledged: true, volumeProtectionIdentity: backupDestinationIdentity(fs.realpathSync(destination)) };
        db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('backupScheduler', JSON.stringify(state));
    } finally { db.close(); }
}
