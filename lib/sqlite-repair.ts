import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

/** Thrown when a swap is requested while another swap of the same file is still running. */
export class SqliteSwapInProgressError extends Error {
    constructor(destPath: string) {
        super(`A database swap is already in progress for ${destPath}`);
        this.name = 'SqliteSwapInProgressError';
    }
}

// In-flight guard, keyed by resolved destination path. Two swaps of the same
// file interleave at the await points below and can delete each other's only
// surviving copy, so a second request fails fast instead of queueing.
const inFlightSwaps = new Set<string>();

// Monotonic per-process counter so every swap stages to a unique file name.
let swapSequence = 0;

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

/**
 * Synchronous consistent copy for call sites that cannot await (the module-load
 * legacy migration). VACUUM INTO reads through SQLite, so committed pages still
 * sitting in a -wal sidecar are included — unlike fs.copyFileSync, which tears
 * a WAL-mode database. destPath must not exist yet.
 */
export function copySqliteDatabaseSync(sourcePath: string, destPath: string): void {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
        source.prepare('VACUUM INTO ?').run(destPath);
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

function renameIfExists(fromPath: string, toPath: string): boolean {
    if (!fs.existsSync(fromPath)) return false;
    fs.renameSync(fromPath, toPath);
    return true;
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
    /** Re-establishes the connection on destPath; always invoked once the swap has started. */
    reopenConnection: () => void;
    /**
     * Test seam: runs after destPath has been retired to its .old-* name and
     * before the staged file is renamed into place, i.e. inside the only
     * window where destPath is missing from disk.
     */
    beforeSwapInForTest?: () => void;
}

/**
 * Replaces destPath with the content of sourcePath without ever writing to the
 * file while a connection is open on it: checkpoint + close the live
 * connection, snapshot a consistent backup, stage the replacement through the
 * SQLite backup API (which also recovers any WAL of the source), retire the
 * destination (and its sidecars) to a unique .old-* name, rename the staged
 * file in, then reopen.
 *
 * Crash/failure safety: the previous DB is never deleted before the staged
 * copy has landed — on failure it is restored from the .old-* name, and a
 * crash inside the window leaves the .old-* file on disk for boot recovery.
 * Swaps of the same destination are serialized: a second concurrent call
 * fails fast with SqliteSwapInProgressError without touching the connection.
 */
export async function replaceSqliteDatabase(options: ReplaceSqliteDatabaseOptions): Promise<void> {
    const { sourcePath, destPath, backupPath, connection, reopenConnection } = options;
    const destKey = path.resolve(destPath);
    if (inFlightSwaps.has(destKey)) {
        throw new SqliteSwapInProgressError(destPath);
    }
    inFlightSwaps.add(destKey);

    // Unique per invocation so one swap can never clobber another's staging or
    // retired files (a fixed staging name was the WUL-321 data-loss vector).
    const unique = `${process.pid}-${swapSequence++}`;
    const stagingPath = `${destPath}.repair-tmp-${unique}`;
    const retiredPath = `${destPath}.old-${unique}`;
    let destRetired = false;

    try {
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
            // Retire the live file by rename instead of deleting it: until the
            // staged copy lands, the previous DB stays recoverable on disk.
            destRetired = renameIfExists(destPath, retiredPath);
            for (const suffix of SIDECAR_SUFFIXES) {
                renameIfExists(`${destPath}${suffix}`, `${retiredPath}${suffix}`);
            }
            options.beforeSwapInForTest?.();
            fs.renameSync(stagingPath, destPath);
            // Success: the retired copy is now redundant.
            fs.rmSync(retiredPath, { force: true });
            removeSqliteSidecars(retiredPath);
        } catch (error) {
            if (destRetired && !fs.existsSync(destPath)) {
                try {
                    for (const suffix of SIDECAR_SUFFIXES) {
                        renameIfExists(`${retiredPath}${suffix}`, `${destPath}${suffix}`);
                    }
                    renameIfExists(retiredPath, destPath);
                } catch (restoreError) {
                    console.error(
                        `[MediFlow] Could not restore previous DB after failed swap; recoverable copy kept at ${retiredPath}:`,
                        restoreError,
                    );
                }
            }
            throw error;
        } finally {
            // The staging name is unique to this invocation, so this can only
            // remove our own leftovers; after a successful swap it is a no-op.
            fs.rmSync(stagingPath, { force: true });
            removeSqliteSidecars(stagingPath);
            reopenConnection();
        }
    } finally {
        inFlightSwaps.delete(destKey);
    }
}
