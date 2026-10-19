import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildPopulationDemographics, parsePopulationDemographicsQuery } from './population-demographics';

const load = createRequire(import.meta.url);
const url = (query: string) => new URL(`http://127.0.0.1/api/v1/network/analytics/demographics?${query}`);

test('the closed query accepts only explicit calendar and bounded integer ages', () => {
    assert.deepEqual(parsePopulationDemographicsQuery(url('minAge=80&maxAge=18&timeZone=UTC')),
        { ageRange: [18, 80], timeZone: 'UTC' });
    for (const query of [
        '', 'minAge=0&maxAge=120', 'minAge=0&maxAge=120&timeZone=UTC&minAge=0',
        'minAge=0&maxAge=120&timeZone=UTC&includeDiagnoses=true',
        ...['-1', '121', '1.5', '01', '+1', '1e1', '', 'NaN'].map(value => `minAge=${value}&maxAge=120&timeZone=UTC`),
        ...['', 'Unknown/Zone', '+01:00', '-01:00', ' UTC', 'UTC ', 'A'.repeat(101)]
            .map(value => `minAge=0&maxAge=120&timeZone=${encodeURIComponent(value)}`),
    ]) assert.equal(parsePopulationDemographicsQuery(url(query)), null, query);
    assert.equal(parsePopulationDemographicsQuery(url('minAge=0&maxAge=120&timeZone=America%2FNew_York'))?.timeZone,
        'America/New_York');
});

test('demographic coverage and ADI preserve the canonical range, archive and age-80 rules without diagnostic zeros', () => {
    const result = buildPopulationDemographics([
        { birthDate: '2008-01-01', isAdi: true }, { birthDate: '1946-01-01', isAdi: false },
        { birthDate: '1945-01-01', isAdi: true }, { birthDate: null, isAdi: true },
        { birthDate: 'invalid-synthetic-date' }, { birthDate: '2008-01-01', isArchived: true },
    ], { ageRange: [18, 80], timeZone: 'UTC' }, new Date('2026-06-01T12:00:00.000Z'));
    assert.deepEqual(result, { totalInRange: 2, withBirthDate: 3, withoutBirthDate: 2, adiCount: 1,
        ageDist: { '0-18': 1, '19-64': 0, '65-80': 1, '80+': 0 } });
    assert.equal('withDiagnoses' in result, false);
    assert.equal('topDiagnoses' in result, false);
});

// The oracle is date-fns with the browser's initial local calendar in a separate
// process. The serving process never changes its global TZ, including for tests.
for (const [timeZone, now, birthDate] of [
    ['America/New_York', '2026-03-08T23:30:00.000Z', '2008-03-09T00:00:00.000Z'],
    ['Europe/Rome', '2026-02-28T23:30:00.000Z', '2004-02-29T00:30:00.000Z'],
    ['Pacific/Apia', '2026-12-29T12:30:00.000Z', '2000-12-30T00:00:00.000Z'],
    ['Australia/Lord_Howe', '2026-10-03T15:45:00.000Z', '2008-10-04T15:45:00.000Z'],
]) test(`explicit ${timeZone} calendar equals the canonical local-calendar oracle`, () => {
    const before = process.env.TZ;
    const oracle = spawnSync(process.execPath, ['-e',
        'const {differenceInYears}=require(process.argv[1]);process.stdout.write(JSON.stringify(differenceInYears(new Date(process.argv[2]),new Date(process.argv[3]))));',
        load.resolve('date-fns'), now, birthDate], {
        encoding: 'utf8', env: { ...process.env, TZ: timeZone }, timeout: 10_000, maxBuffer: 4096,
    });
    assert.equal(oracle.status, 0, oracle.stderr);
    const age: number = JSON.parse(oracle.stdout);
    assert.ok(Number.isInteger(age) && age > 0);
    const result = buildPopulationDemographics([{ birthDate, isAdi: true }],
        { ageRange: [age, age], timeZone }, new Date(now));
    assert.equal(result.totalInRange, 1);
    assert.equal(result.adiCount, 1);
    assert.equal(buildPopulationDemographics([{ birthDate }],
        { ageRange: [age - 1, age - 1], timeZone }, new Date(now)).totalInRange, 0);
    assert.equal(process.env.TZ, before);
    if (timeZone === 'America/New_York') {
        assert.equal(age, 18);
        assert.equal(buildPopulationDemographics([{ birthDate }],
            { ageRange: [18, 18], timeZone: 'UTC' }, new Date(now)).totalInRange, 0);
    }
});
