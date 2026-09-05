// Keep in sync with DATE_FIELDS in lib/backup-restore-executor.ts
// (enforced by scripts/backup-restore-date-fields.test.mjs).
export const DATE_FIELDS = new Set([
  'assignedAt',
  'birthDate',
  'collaudoAt',
  'decidedAt',
  'createdAt',
  'date',
  'endDate',
  'importedAt',
  'observedAt',
  'ocrQueueUpdatedAt',
  'performedAt',
  'prescribedAt',
  'reportReceivedAt',
  'scheduledAt',
  'startDate',
  'startedAt',
  'completedAt',
  'committedAt', // @Codex H7b ledger timestamp.
  'expiresAt',
  'activatedAt',
  'revokedAt',
  'deletedAt',
  'updatedAt',
]);

// Drizzle integer(..., { mode: 'timestamp' }) columns persist unix-SECONDS;
// scheduled artifacts must carry ISO strings to match the web-export contract.
export function unixSecondsToIsoString(value) {
  const parsed = new Date(value * 1000);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function normalizeRowDates(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      DATE_FIELDS.has(key) && typeof value === 'number' && Number.isInteger(value)
        ? unixSecondsToIsoString(value)
        : value,
    ]),
  );
}
