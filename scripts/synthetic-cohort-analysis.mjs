/* @Codex */
// WUL-747: isolated, synthetic-only descriptive projection. No production data adapter.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const MAX_ROWS = 500;
const MAX_BYTES = 100_000;
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/operational-cohort-synthetic.json');
const DATE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/u;
const ROW_KEYS = ['activityId', 'version', 'recordedAt', 'receivedAt', 'reviewState', 'reviewedAt'];
const DOCUMENTED = 'documented';
const PENDING = 'pending';
const UNKNOWN = 'unknown';

function reject(reason) { throw new Error(`SYNTHETIC_COHORT_INVALID: ${reason}`); }
function object(value, keys, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) reject(name);
}
function instant(value, name) {
  if (typeof value !== 'string') reject(name);
  const match = DATE.exec(value);
  if (!match) reject(name);
  const [, y, mo, d, h, mi, s, zone] = match;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  const milliseconds = value.includes('.') ? Number(value.slice(20, 23)) : 0;
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) reject(name);
  const offset = zone === 'Z' ? 0 : (zone[0] === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const local = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const check = new Date(local);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month
    || check.getUTCDate() !== day || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) reject(name);
  const timestamp = local - offset * 60_000;
  if (!Number.isFinite(timestamp)) reject(name);
  return timestamp;
}

/** Half-open UTC instant window [start, end); one activity is one unit. */
export function analyzeSyntheticCohort(input) {
  object(input, ['syntheticOnly', 'windowStart', 'windowEnd', 'asOf', 'rows'], 'fixture shape');
  if (input.syntheticOnly !== true) reject('synthetic marker');
  if (!Array.isArray(input.rows) || input.rows.length > MAX_ROWS) reject('row volume');
  const start = instant(input.windowStart, 'windowStart');
  const end = instant(input.windowEnd, 'windowEnd');
  const asOf = instant(input.asOf, 'asOf');
  if (start >= end || end > asOf) reject('window/cutoff order');

  const byId = new Map();
  let exactDuplicateRows = 0;
  for (const row of input.rows) {
    object(row, ROW_KEYS, 'row shape');
    if (typeof row.activityId !== 'string' || !/^activity-[a-z0-9-]{1,48}$/u.test(row.activityId)
      || !Number.isSafeInteger(row.version) || row.version < 1) reject('synthetic activity/version');
    const recordedAt = instant(row.recordedAt, 'recordedAt');
    const receivedAt = row.receivedAt === null ? null : instant(row.receivedAt, 'receivedAt');
    const reviewedAt = row.reviewedAt === null ? null : instant(row.reviewedAt, 'reviewedAt');
    if (![DOCUMENTED, PENDING, UNKNOWN].includes(row.reviewState)) reject('reviewState');
    if (receivedAt === null && (row.reviewState !== UNKNOWN || reviewedAt !== null)) reject('review without received result');
    if (row.reviewState === DOCUMENTED && (reviewedAt === null || receivedAt === null || reviewedAt < receivedAt)) reject('documented review date');
    if (row.reviewState !== DOCUMENTED && reviewedAt !== null) reject('review date without documented status');
    const versions = byId.get(row.activityId) ?? new Map();
    const normalized = { version: row.version, recordedAt, receivedAt, reviewState: row.reviewState, reviewedAt };
    const prior = versions.get(row.version);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(normalized)) reject('conflicting same-version duplicate');
      exactDuplicateRows += 1;
    } else versions.set(row.version, normalized);
    byId.set(row.activityId, versions);
  }

  let missingReceived = 0, outsideWindow = 0, receivedTotal = 0;
  let documented = 0, pending = 0, unknown = 0, notYetRecorded = 0;
  for (const versions of byId.values()) {
    const ordered = [...versions.values()].sort((a, b) => a.version - b.version);
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].recordedAt <= ordered[i - 1].recordedAt) reject('nonmonotonic correction');
    }
    const current = ordered.filter((row) => row.recordedAt <= asOf).at(-1);
    if (!current) { notYetRecorded += 1; continue; }
    if ((current.receivedAt !== null && (current.receivedAt > asOf || current.receivedAt > current.recordedAt))
      || (current.reviewedAt !== null && (current.reviewedAt > asOf || current.reviewedAt > current.recordedAt))) reject('future/inconsistent actual event');
    if (current.receivedAt === null) { missingReceived += 1; continue; }
    if (current.receivedAt < start || current.receivedAt >= end) { outsideWindow += 1; continue; }
    receivedTotal += 1;
    if (current.reviewState === DOCUMENTED) documented += 1;
    else if (current.reviewState === PENDING) pending += 1;
    else unknown += 1;
  }
  const known = pending + documented;
  return {
    scope: 'synthetic_only_review_pending',
    unit: 'activity',
    window: { start: input.windowStart, endExclusive: input.windowEnd, asOf: input.asOf },
    inclusion: 'Latest correction recorded by asOf; result received in half-open window',
    counts: { receivedTotal, pending, documented, unknown, known, missingReceived, outsideWindow, notYetRecorded, exactDuplicateRows },
    pendingAmongKnownPercent: known === 0 ? null : (pending / known) * 100,
    knownStatusCoveragePercent: receivedTotal === 0 ? null : (known / receivedTotal) * 100,
    interpretation: 'Descriptive synthetic activity counts. Unknown review status is separate. No real-data export, clinical inference, individual risk, or automatic action.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) reject('CLI accepts no input path or arguments');
  const bytes = readFileSync(FIXTURE);
  if (bytes.length > MAX_BYTES) reject('fixture byte volume');
  process.stdout.write(`${JSON.stringify(analyzeSyntheticCohort(JSON.parse(bytes.toString('utf8'))), null, 2)}\n`);
}
