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

export function initSqlitePragmas(connection: Database.Database): void {
    connection.pragma('journal_mode = WAL');
    connection.pragma('busy_timeout = 5000');
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
