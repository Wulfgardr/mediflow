/* @Codex */
export const SCHEDULED_BACKUP_RUNTIME_ROSTER: readonly Readonly<{ path: string; sha256: string }>[];
export const SCHEDULED_BACKUP_TRACING_INCLUDES: readonly string[];
export function assertScheduledBackupRuntime(runtimeRoot: string, options?: { timeoutMs?: number }): Promise<Readonly<{
  runtimeRoot: string;
  sourceFiles: number;
  imported: true;
  databaseAccess: 'denied';
  resolvedFiles: readonly string[];
}>>;
