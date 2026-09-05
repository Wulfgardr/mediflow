/* @Codex */
// Only the aggregate's inputs are needed here; no DB/React/runtime dependency.
export type AnalyticsDiagnosis = { system: string; code: string; description: string };
export type AnalyticsPatient = {
    birthDate?: Date | string | null;
    isAdi?: boolean;
    isArchived?: boolean;
    diagnoses?: AnalyticsDiagnosis[];
};

export function isAnalyticsPatient(patient: AnalyticsPatient): boolean {
    return !patient.isArchived;
}

type AgeBucket = '0-18' | '19-64' | '65-80' | '80+';

type DiagnosisStat = {
    key: string;
    description: string;
    system: string;
    code: string;
    count: number;
};

type AnalyticsStats = {
    totalInRange: number;
    withBirthDate: number;
    withoutBirthDate: number;
    adiCount: number;
    withDiagnoses: number;
    ageDist: Record<AgeBucket, number>;
    topDiagnoses: DiagnosisStat[];
};

const EMPTY_AGE_DIST: Record<AgeBucket, number> = {
    '0-18': 0,
    '19-64': 0,
    '65-80': 0,
    '80+': 0,
};

export function normalizeAgeRange(range: [number, number]): [number, number] {
    return range[0] <= range[1] ? range : [range[1], range[0]];
}

function toDate(value: AnalyticsPatient['birthDate']): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getAgeBucket(age: number): AgeBucket {
    if (age <= 18) return '0-18';
    if (age <= 64) return '19-64';
    if (age <= 80) return '65-80';
    return '80+';
}

export function diagnosisKey(diagnosis: AnalyticsDiagnosis): string {
    const system = diagnosis.system?.trim() || 'ICD';
    const code = diagnosis.code?.trim() || 'senza-codice';
    const description = diagnosis.description?.trim() || code;
    return `${system}:${code}:${description.toLocaleLowerCase('it-IT')}`;
}

export function buildAnalyticsStats(
    patients: AnalyticsPatient[],
    ageRange: [number, number],
    differenceInYears: (now: Date, birthDate: Date) => number,
    now = new Date(),
): AnalyticsStats {
    const [minAge, maxAge] = normalizeAgeRange(ageRange);
    const ageDist: Record<AgeBucket, number> = { ...EMPTY_AGE_DIST };
    const diagnosisCounts = new Map<string, DiagnosisStat>();
    let totalInRange = 0;
    let withBirthDate = 0;
    let withoutBirthDate = 0;
    let adiCount = 0;
    let withDiagnoses = 0;

    for (const patient of patients) {
        const birthDate = toDate(patient.birthDate);
        if (!birthDate) {
            withoutBirthDate += 1;
            continue;
        }

        withBirthDate += 1;
        const age = differenceInYears(now, birthDate);
        if (age < minAge || age > maxAge) continue;

        totalInRange += 1;
        if (patient.isAdi) adiCount += 1;
        ageDist[getAgeBucket(age)] += 1;

        if (!patient.diagnoses?.length) continue;
        withDiagnoses += 1;
        /* @Codex: Schede counts each diagnosis key once per patient, not each occurrence. */
        const seen = new Set<string>();
        for (const diagnosis of patient.diagnoses) {
            const key = diagnosisKey(diagnosis);
            if (seen.has(key)) continue;
            seen.add(key);
            const current = diagnosisCounts.get(key);
            if (current) {
                current.count += 1;
                continue;
            }
            diagnosisCounts.set(key, {
                key,
                description: diagnosis.description?.trim() || diagnosis.code || 'Diagnosi senza descrizione',
                system: diagnosis.system?.trim() || 'ICD',
                code: diagnosis.code?.trim() || 'n/d',
                count: 1,
            });
        }
    }

    return {
        totalInRange,
        withBirthDate,
        withoutBirthDate,
        adiCount,
        withDiagnoses,
        ageDist,
        topDiagnoses: Array.from(diagnosisCounts.values())
            .sort((left, right) => right.count - left.count)
            .slice(0, 10),
    };
}
