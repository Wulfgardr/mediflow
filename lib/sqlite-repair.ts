import Database from 'better-sqlite3';
import fs from 'fs';

const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

/**
 * Copies a SQLite database via the online backup API so pending WAL pages are
 * included even while another connection holds the source file open. A plain
 * fs.copyFileSync of a WAL-mode database misses every page still in the -wal
 * sidecar and produces a torn copy.
 */
export async function backupSqliteDatabase(sourcePath: string, destPath: string): Promise<void> {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
        await source.backup(destPath);
    } finally {
        source.close();
    }
}

/** Removes -wal/-shm sidecar files so a swapped-in DB cannot inherit stale WAL pages. */
export function removeSqliteSidecars(dbPath: string): void {
    for (const suffix of SIDECAR_SUFFIXES) {
        fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
}

export interface ReplaceSqliteDatabaseOptions {
    /** Database file whose content replaces destPath. */
    sourcePath: string;
    /** Live database file, currently open through `connection`. */
    destPath: string;
    /** Optional pre-swap backup of destPath, written before any file is touched. */
    backupPath?: string | null;
    /** Open connection on destPath; it is checkpointed and closed before the swap. */
    connection: Database.Database;
    /** Re-establishes the connection on destPath; always invoked, even when the swap fails. */
    reopenConnection: () => void;
}

/**
 * Replaces destPath with the content of sourcePath without ever writing to the
 * file while a connection is open on it: checkpoint + close the live
 * connection, snapshot a consistent backup, stage the replacement through the
 * SQLite backup API (which also recovers any WAL of the source), drop stale
 * sidecars of the destination, swap, then reopen.
 */
export async function replaceSqliteDatabase(options: ReplaceSqliteDatabaseOptions): Promise<void> {
    const { sourcePath, destPath, backupPath, connection, reopenConnection } = options;
    const stagingPath = `${destPath}.repair-tmp`;

    try {
        connection.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
        console.warn('[MediFlow] WAL checkpoint before DB swap failed:', error);
    }
    connection.close();
    try {
        if (backupPath) {
            // Online backup keeps the .bak consistent even if the checkpoint above failed.
            await backupSqliteDatabase(destPath, backupPath);
        }
        // Stage the new file first so a failure here leaves the live DB untouched.
        await backupSqliteDatabase(sourcePath, stagingPath);
        fs.rmSync(destPath, { force: true });
        removeSqliteSidecars(destPath);
        fs.renameSync(stagingPath, destPath);
    } finally {
        fs.rmSync(stagingPath, { force: true });
        removeSqliteSidecars(stagingPath);
        reopenConnection();
    }
}
