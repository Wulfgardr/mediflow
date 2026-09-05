/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildAnalyticsStats, diagnosisKey, isAnalyticsPatient, normalizeAgeRange,
    type AnalyticsDiagnosis, type AnalyticsPatient,
} from './patient-analytics.ts';

// Synthetic projections only. Age policy is injected, not reimplemented here.
const NOW = new Date('2026-09-05T12:00:00.000Z');
const diagnosis = (overrides: Partial<AnalyticsDiagnosis> = {}): AnalyticsDiagnosis => ({
    system: 'ICD-11', code: 'SYN-1', description: 'Diagnosi sintetica', ...overrides,
});
const patient = (diagnoses: AnalyticsDiagnosis[] = [], extra: Partial<AnalyticsPatient> = {}): AnalyticsPatient => ({
    birthDate: new Date('1980-01-01T00:00:00.000Z'), diagnoses, ...extra,
});
const aggregate = (patients: AnalyticsPatient[]) => buildAnalyticsStats(patients, [0, 120], () => 46, NOW);

test('Schede: repeated diagnosis within one patient contributes exactly one', () => {
    const stats = aggregate([patient([diagnosis(), diagnosis(), diagnosis()])]);
    assert.equal(stats.topDiagnoses[0].count, 1);
    assert.equal(stats.withDiagnoses, 1);
    assert.equal(stats.totalInRange, 1);
});

test('Schede: two distinct patients contribute independently despite duplicates', () => {
    const stats = aggregate([patient([diagnosis(), diagnosis()]), patient([diagnosis(), diagnosis()])]);
    assert.equal(stats.topDiagnoses[0].count, 2);
    assert.equal(stats.withDiagnoses, 2);
});

test('existing key trims fields and folds Italian description case only', () => {
    const original = diagnosis({ description: '  SÌNTESI  ' });
    const equivalent = diagnosis({ system: ' ICD-11 ', code: ' SYN-1 ', description: 'sìntesi' });
    assert.equal(diagnosisKey(original), diagnosisKey(equivalent));
    assert.equal(aggregate([patient([original, equivalent])]).topDiagnoses[0].count, 1);
    assert.notEqual(diagnosisKey(original), diagnosisKey({ ...original, system: 'icd-11' }));
    assert.notEqual(diagnosisKey(original), diagnosisKey({ ...original, code: 'syn-1' }));
});

test('same code with distinct description or system remains three groups', () => {
    const stats = aggregate([patient([
        diagnosis(), diagnosis({ description: 'Altra diagnosi sintetica' }), diagnosis({ system: 'ALT' }),
    ])]);
    assert.equal(stats.topDiagnoses.length, 3);
    assert.deepEqual(stats.topDiagnoses.map(row => row.count), [1, 1, 1]);
});

test('key and display fallbacks remain unchanged, not normalized to code-only', () => {
    const empty = diagnosis({ system: ' ', code: '', description: '' });
    const codeOnly = diagnosis({ system: '', code: 'SYN-2', description: ' ' });
    assert.equal(diagnosisKey(empty), 'ICD:senza-codice:senza-codice');
    assert.equal(diagnosisKey(codeOnly), 'ICD:SYN-2:syn-2');
    const stats = aggregate([patient([empty, empty, codeOnly])]);
    assert.deepEqual(stats.topDiagnoses[0], {
        key: diagnosisKey(empty), description: 'Diagnosi senza descrizione', system: 'ICD', code: 'n/d', count: 1,
    });
    assert.equal(stats.topDiagnoses[1].description, 'SYN-2');
});

test('the first encountered label is retained across equivalent keys', () => {
    const stats = aggregate([
        patient([diagnosis({ description: '  Sintesi CLINICA  ' }), diagnosis({ description: 'sintesi clinica' })]),
        patient([diagnosis({ description: 'SINTESI CLINICA' })]),
    ]);
    assert.equal(stats.topDiagnoses[0].description, 'Sintesi CLINICA');
    assert.equal(stats.topDiagnoses[0].count, 2);
});

test('age bounds stay inclusive and reversed bounds retain their meaning', () => {
    const ages = new Map([[2001, 17], [2002, 18], [2003, 64], [2004, 65]]);
    const cohort = [...ages.keys()].map(year => patient([diagnosis(), diagnosis()], {
        birthDate: new Date(`${year}-01-01T00:00:00Z`), isAdi: true,
    }));
    const age = (now: Date, birth: Date) => {
        assert.equal(now, NOW);
        return ages.get(birth.getUTCFullYear())!;
    };
    const stats = buildAnalyticsStats(cohort, [64, 18], age, NOW);
    assert.deepEqual(stats, buildAnalyticsStats(cohort, [18, 64], age, NOW));
    assert.equal(stats.withBirthDate, 4); // Deliberately counted before the age filter.
    assert.equal(stats.totalInRange, 2);
    assert.equal(stats.adiCount, 2);
    assert.equal(stats.withDiagnoses, 2);
    assert.equal(stats.topDiagnoses[0].count, 2);
    assert.deepEqual(stats.ageDist, { '0-18': 1, '19-64': 1, '65-80': 0, '80+': 0 });
    assert.deepEqual(normalizeAgeRange([64, 18]), [18, 64]);
});

test('missing and invalid dates remain excluded from range, diagnoses and ADI', () => {
    const cohort = [undefined, null, '', 'not-a-date', new Date(Number.NaN)].map(birthDate =>
        patient([diagnosis()], { birthDate, isAdi: true }));
    let ageCalls = 0;
    const stats = buildAnalyticsStats(cohort, [0, 120], () => { ageCalls++; return 46; }, NOW);
    assert.equal(ageCalls, 0);
    assert.equal(stats.withoutBirthDate, 5);
    assert.equal(stats.withBirthDate, 0);
    assert.equal(stats.totalInRange, 0);
    assert.equal(stats.adiCount, 0);
    assert.equal(stats.withDiagnoses, 0);
    assert.deepEqual(stats.topDiagnoses, []);
});

test('existing age buckets preserve all edges, including exactly 80', () => {
    const ages = [0, 18, 19, 64, 65, 80, 81, 120];
    let index = 0;
    const stats = buildAnalyticsStats(ages.map(() => patient()), [0, 120], () => ages[index++], NOW);
    assert.deepEqual(stats.ageDist, { '0-18': 2, '19-64': 2, '65-80': 2, '80+': 2 });
    assert.equal(stats.withDiagnoses, 0);
});

test('production active-patient predicate excludes archived cards before aggregation', () => {
    const cohort = [patient([diagnosis()]), patient([diagnosis()], { isArchived: false }),
        patient([diagnosis()], { isArchived: true, isAdi: true })];
    const stats = aggregate(cohort.filter(isAnalyticsPatient));
    assert.equal(stats.totalInRange, 2);
    assert.equal(stats.topDiagnoses[0].count, 2);
    assert.equal(stats.adiCount, 0);
});

test('outside-range patients contribute to date coverage, not the diagnosis table', () => {
    const stats = buildAnalyticsStats([patient([diagnosis()], { isAdi: true })], [65, 80], () => 46, NOW);
    assert.equal(stats.withBirthDate, 1);
    assert.equal(stats.totalInRange, 0);
    assert.equal(stats.withDiagnoses, 0);
    assert.equal(stats.adiCount, 0);
    assert.deepEqual(stats.topDiagnoses, []);
});

test('top ten remains sorted by Schede with stable tie order', () => {
    const diagnoses = Array.from({ length: 12 }, (_, index) => diagnosis({ code: `SYN-${index}` }));
    const stats = aggregate([patient(diagnoses.flatMap(item => [item, item])), patient([diagnoses[11]])]);
    assert.equal(stats.topDiagnoses.length, 10);
    assert.equal(stats.topDiagnoses[0].code, 'SYN-11');
    assert.equal(stats.topDiagnoses[0].count, 2);
    assert.deepEqual(stats.topDiagnoses.slice(1).map(row => row.code), diagnoses.slice(0, 9).map(row => row.code));
});

test('aggregation does not mutate inputs or leak state between calls', () => {
    const cohort = [patient([diagnosis(), diagnosis()])];
    const before = structuredClone(cohort);
    const first = aggregate(cohort);
    first.ageDist['19-64'] = 999;
    first.topDiagnoses[0].count = 999;
    assert.equal(aggregate(cohort).topDiagnoses[0].count, 1);
    assert.equal(aggregate(cohort).ageDist['19-64'], 1);
    assert.deepEqual(cohort, before);
    assert.equal(aggregate([]).totalInRange, 0);
});
