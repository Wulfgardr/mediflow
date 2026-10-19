import { differenceInYears } from 'date-fns';
import { tz } from '@date-fns/tz';
import { buildAnalyticsStats, isAnalyticsPatient, normalizeAgeRange, type AnalyticsPatient } from './patient-analytics';

export const POPULATION_DEMOGRAPHICS_OPERATION = 'population-demographics.read.v1';
export const POPULATION_DEMOGRAPHICS_MAX_BYTES = 4096;
export const POPULATION_DEMOGRAPHICS_CAPABILITY = 'network.replica.readonly-patients';

export type PopulationDemographicsQuery = Readonly<{
    ageRange: readonly [number, number];
    timeZone: string;
}>;
export type DemographicsPatient = Pick<AnalyticsPatient, 'birthDate' | 'isAdi' | 'isArchived'>;
export type PopulationDemographicsStats = Pick<ReturnType<typeof buildAnalyticsStats>,
    'totalInRange' | 'withBirthDate' | 'withoutBirthDate' | 'adiCount' | 'ageDist'>;
export type PopulationDemographicsResult = Readonly<{
    operation: typeof POPULATION_DEMOGRAPHICS_OPERATION;
    contractVersion: 1;
    scope: Readonly<{ ambulatoryId: string; archiveGeneration: string }>;
    ageRange: readonly [number, number];
    timeZone: string;
    observedAt: string;
    stats: PopulationDemographicsStats;
}>;

/** Only presentation parameters; neither IDs nor authority enter through the query. */
export function parsePopulationDemographicsQuery(url: URL): PopulationDemographicsQuery | null {
    const parameters = url.searchParams;
    const keys = ['minAge', 'maxAge', 'timeZone'];
    if (parameters.size !== keys.length || keys.some(key => parameters.getAll(key).length !== 1)) return null;
    const bounds = keys.slice(0, 2).map(key => parameters.get(key)!);
    if (bounds.some(value => !/^(?:0|[1-9][0-9]{0,2})$/u.test(value) || Number(value) > 120)) return null;
    const candidate = parameters.get('timeZone')!;
    if (candidate.length > 100 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/u.test(candidate)) return null;
    try {
        const timeZone = new Intl.DateTimeFormat('en', { timeZone: candidate }).resolvedOptions().timeZone;
        return Object.freeze({
            ageRange: Object.freeze(normalizeAgeRange([Number(bounds[0]), Number(bounds[1])])),
            timeZone,
        });
    } catch { return null; }
}

/** Uses the canonical algorithm with the client's calendar and a host-owned instant. */
export function buildPopulationDemographics(
    patients: DemographicsPatient[], query: PopulationDemographicsQuery, observedAt: Date,
): PopulationDemographicsStats {
    const context = tz(query.timeZone);
    const { totalInRange, withBirthDate, withoutBirthDate, adiCount, ageDist } = buildAnalyticsStats(
        patients.filter(isAnalyticsPatient), [...query.ageRange],
        (now, birthDate) => differenceInYears(now, birthDate, { in: context }), observedAt,
    );
    // Omit diagnostic counts: this projection never read or decrypted diagnoses.
    return { totalInRange, withBirthDate, withoutBirthDate, adiCount, ageDist };
}
