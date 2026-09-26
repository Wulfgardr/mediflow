/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { analyzeSyntheticCohort } from './synthetic-cohort-analysis.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, 'fixtures/operational-cohort-synthetic.json'), 'utf8'));
const copy = () => structuredClone(fixture);
const row = (activityId = 'activity-extra') => ({ activityId, version: 1,
  recordedAt: '2026-03-11T12:00:00Z', receivedAt: '2026-03-10T12:00:00Z',
  reviewState: 'pending', reviewedAt: null });

test('hand-counted fixture, correction as-of, duplicate and missingness', () => {
  const report = analyzeSyntheticCohort(fixture);
  assert.deepEqual(report.counts, {
    receivedTotal: 6, pending: 3, documented: 2, unknown: 1, known: 5,
    missingReceived: 1, outsideWindow: 1, notYetRecorded: 0, exactDuplicateRows: 1,
  });
  assert.equal(report.pendingAmongKnownPercent, 60);
  assert.equal(report.knownStatusCoveragePercent, 5 / 6 * 100);
});

test('zero known denominator emits no percentage', () => {
  const input = copy();
  input.rows = [row()];
  input.rows[0].reviewState = 'unknown';
  const report = analyzeSyntheticCohort(input);
  assert.equal(report.pendingAmongKnownPercent, null);
  assert.equal(report.knownStatusCoveragePercent, 0);
  input.rows = [];
  const empty = analyzeSyntheticCohort(input);
  assert.equal(empty.pendingAmongKnownPercent, null);
  assert.equal(empty.knownStatusCoveragePercent, null);
});

test('unknown and absent result are never counted as pending', () => {
  const input = copy();
  input.rows = [row('activity-one'), row('activity-two')];
  input.rows[0].reviewState = 'unknown';
  input.rows[1].receivedAt = null;
  input.rows[1].reviewState = 'unknown';
  assert.deepEqual(analyzeSyntheticCohort(input).counts, {
    receivedTotal: 1, pending: 0, documented: 0, unknown: 1, known: 0,
    missingReceived: 1, outsideWindow: 0, notYetRecorded: 0, exactDuplicateRows: 0,
  });
});

test('exact same version collapses; conflicting same version fails closed', () => {
  const input = copy();
  input.rows = [row(), row()];
  assert.equal(analyzeSyntheticCohort(input).counts.exactDuplicateRows, 1);
  input.rows[1].reviewState = 'unknown';
  assert.throws(() => analyzeSyntheticCohort(input), /conflicting same-version duplicate/u);
});

test('latest correction is selected only when recorded by cutoff', () => {
  const input = copy();
  input.rows = [row(), { ...row(), version: 2, recordedAt: '2026-04-06T00:00:00Z',
    reviewState: 'documented', reviewedAt: '2026-04-04T00:00:00Z' }];
  assert.equal(analyzeSyntheticCohort(input).counts.pending, 1);
  input.asOf = '2026-04-07T00:00:00Z';
  assert.equal(analyzeSyntheticCohort(input).counts.documented, 1);
  input.rows[1].recordedAt = input.rows[0].recordedAt;
  assert.throws(() => analyzeSyntheticCohort(input), /nonmonotonic correction/u);
});

test('window is half-open and explicit offsets resolve DST transition', () => {
  const input = copy();
  input.rows = [row('activity-start'), row('activity-end')];
  input.rows[0].receivedAt = '2026-03-01T01:00:00+01:00';
  input.rows[1].receivedAt = '2026-04-01T02:00:00+02:00';
  input.rows[1].recordedAt = '2026-04-02T00:00:00Z';
  assert.equal(analyzeSyntheticCohort(input).counts.receivedTotal, 1);
  assert.equal(analyzeSyntheticCohort(input).counts.outsideWindow, 1);
  input.rows[0].receivedAt = '2026-03-29T02:30:00';
  assert.throws(() => analyzeSyntheticCohort(input), /receivedAt/u);
});

test('invalid calendar, offset, ordering and future actual event fail closed', () => {
  const input = copy();
  input.rows = [row()];
  for (const invalid of ['2026-02-30T00:00:00Z', '2026-03-01T00:00:00+15:00', '2026-03-01']) {
    input.rows[0].receivedAt = invalid;
    assert.throws(() => analyzeSyntheticCohort(input), /receivedAt/u);
  }
  input.rows[0].receivedAt = '2026-04-06T00:00:00Z';
  assert.throws(() => analyzeSyntheticCohort(input), /future\/inconsistent actual event/u);
});

test('synthetic marker, shape and row volume bound', () => {
  const input = copy();
  input.syntheticOnly = false;
  assert.throws(() => analyzeSyntheticCohort(input), /synthetic marker/u);
  input.syntheticOnly = true;
  input.rows = Array.from({ length: 501 }, (_, index) => row(`activity-${index}`));
  assert.throws(() => analyzeSyntheticCohort(input), /row volume/u);
  input.rows = [row()];
  input.rows[0].patientId = 'synthetic-patient';
  assert.throws(() => analyzeSyntheticCohort(input), /row shape/u);
});

test('report and CLI expose no activity identifier or individual row', () => {
  const report = JSON.stringify(analyzeSyntheticCohort(fixture));
  assert.doesNotMatch(report, /activity-[a-z]/u);
  assert.doesNotMatch(report, /patientId|rows|receivedAt|reviewedAt/u);
  const script = resolve(here, 'synthetic-cohort-analysis.mjs');
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /activity-[a-z]/u);
  const rejected = spawnSync(process.execPath, [script, '/tmp/real.db'], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /CLI accepts no input path/u);
});
