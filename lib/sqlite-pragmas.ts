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

type ForeignKeyViolationRow = { table: string };

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
        const violations = connection.pragma('foreign_key_check') as ForeignKeyViolationRow[];
        if (violations.length > 0) {
            const perTable = new Map<string, number>();
            for (const row of violations) {
                perTable.set(row.table, (perTable.get(row.table) ?? 0) + 1);
            }
            const summary = Array.from(perTable.entries())
                .map(([table, count]) => `${table}=${count}`)
                .join(', ');
            console.warn(
                `[MediFlow] foreign_key_check found ${violations.length} pre-existing violation(s) before enabling FK enforcement. ` +
                    `Per-table counts: ${summary}. Existing data is left untouched; FK is enforced on future writes only.`,
            );
        }
    } catch (error) {
        console.warn('[MediFlow] foreign_key_check skipped:', error);
    }

    connection.pragma('foreign_keys = ON');
}
