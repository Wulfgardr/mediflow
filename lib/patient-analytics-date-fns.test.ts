/* @Codex */
// Integration with the SAME date-fns function used by app/analytics/page.tsx.
// Requires the repository's locked dependencies and supported Node 24 runtime.
import assert from 'node:assert/strict';
import test from 'node:test';
import { differenceInYears } from 'date-fns';
import { buildAnalyticsStats } from './patient-analytics.ts';

test('date-fns: birthday and inclusive 18-year age filter retain production semantics', () => {
    const now = new Date(2026, 8, 5, 12);
    const diagnosis = { system: 'ICD-11', code: 'SYN-1', description: 'Diagnosi sintetica' };
    const cohort = [
        { birthDate: new Date(2008, 8, 5), diagnoses: [diagnosis, diagnosis] },
        { birthDate: new Date(2008, 8, 6), diagnoses: [diagnosis] },
        { birthDate: new Date(2007, 8, 5), diagnoses: [diagnosis] },
    ];
    const stats = buildAnalyticsStats(cohort, [18, 18], differenceInYears, now);
    assert.equal(stats.withBirthDate, 3);
    assert.equal(stats.totalInRange, 1);
    assert.equal(stats.ageDist['0-18'], 1);
    assert.equal(stats.topDiagnoses[0].count, 1);
});

test('date-fns: Date/string inputs and exact age 80 remain equivalent', () => {
    const now = new Date(2026, 8, 5, 12);
    const birthDate = new Date(1946, 8, 5);
    const stats = buildAnalyticsStats([{ birthDate }, { birthDate: birthDate.toISOString() }], [80, 80], differenceInYears, now);
    assert.equal(stats.totalInRange, 2);
    assert.equal(stats.ageDist['65-80'], 2);
    assert.equal(stats.ageDist['80+'], 0);
});
