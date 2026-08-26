import type Database from 'better-sqlite3';

// WUL-268 (STREAM A): shared connection pragmas.
//
// Live databases historically opened with journal_mode=delete and
// foreign_keys=0. This helper is applied right after every Database() open
// (boot in lib/db-server.ts and the reopen inside swapDatabaseFromFile) so the
// connection is crash-resilient (WAL), waits instead of throwing SQLITE_BUSY
// under concurrent writers, and enforces referential integrity on future writes.
//
// PRAGMA foreign_key_check is run BEFORE enabling FK: pre-existing violations are
// reported (never thrown, never deleted) so the operator can repair, and FK is
// still enabled afterwards because SQLite only enforces it on subsequent writes.

const SQLITE_LOCK_RETRY_MS = 50;
const SQLITE_LOCK_TIMEOUT_MS = 5000;
const sqliteLockWaiter = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

function isSqliteLockError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    const code = String((error as { code: unknown }).code);
    return code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED');
}

/* @Codex */
function enableWalWithBoundedRetry(connection: Database.Database): void {
    const deadline = Date.now() + SQLITE_LOCK_TIMEOUT_MS;
    while (true) {
        try {
            connection.pragma('journal_mode = WAL');
            return;
        } catch (error) {
            if (!isSqliteLockError(error) || Date.now() >= deadline) throw error;
            Atomics.wait(sqliteLockWaiter, 0, 0, SQLITE_LOCK_RETRY_MS);
        }
    }
}

export function initSqlitePragmas(connection: Database.Database): void {
    // @Codex Configure waiting before the first pragma that may need the
    // database write lock. Next.js evaluates server modules in parallel build
    // workers, so setting WAL first would otherwise fail immediately.
    connection.pragma('busy_timeout = 5000');
    enableWalWithBoundedRetry(connection);
    connection.pragma('synchronous = NORMAL');

    try {
        const violations = connection.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
            console.warn(
                `[MediFlow] foreign_key_check found ${violations.length} pre-existing violation(s) before enabling FK enforcement. ` +
                    'Existing data is left untouched; FK is enforced on future writes only.',
            );
        }
    } catch {
        console.warn('[MediFlow] foreign_key_check skipped. Existing data is left untouched; FK is enforced on future writes only.');
    }

    connection.pragma('foreign_keys = ON');
}
