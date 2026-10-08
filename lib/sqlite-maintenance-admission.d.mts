/* @Codex */
import type Database from 'better-sqlite3';

export class SqliteMaintenanceHoldError extends Error {
  readonly code: 'SQLITE_MAINTENANCE_HOLD';
  readonly reason: string;
  constructor(reason?: string);
}

export function openAdmittedSqlite(file: string, options?: {
  role?: string;
  sqliteOptions?: Database.Options;
}): Readonly<{
  database: Database.Database;
  close(options?: { timeoutMs?: number }): Promise<void>;
}>;

/** Does not prove the owning Web process's logical operations have drained. */
export function runWithSqliteMaintenance<T>(file: string, options: { timeoutMs?: number } | undefined,
  operation: () => T | Promise<T>): Promise<T>;
