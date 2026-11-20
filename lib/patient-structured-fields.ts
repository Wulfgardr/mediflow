import { parseClinicalDate } from './clinical-date';

export type PatientDatedRecord<T> = Omit<T, 'date'> & { date: Date | null };

type ParsedStructuredRecord = Record<string, unknown>;

function parseJsonField<T>(value: unknown): T | undefined {
    if (typeof value !== 'string') return undefined;
    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function parseArrayField(value: unknown): unknown[] | undefined {
    if (Array.isArray(value)) return value;
    const parsed = parseJsonField<unknown>(value);
    return Array.isArray(parsed) ? parsed : undefined;
}

export function parsePatientExemptions(value: unknown): string[] {
    const parsed = parseArrayField(value);
    if (!parsed) return [];
    return parsed.filter((code): code is string => typeof code === 'string');
}

export function parsePatientDatedRecords<T extends object>(value: unknown): PatientDatedRecord<T>[] {
    const parsed = parseArrayField(value);
    if (!parsed) return [];

    return parsed
        .filter((item): item is ParsedStructuredRecord => item !== null && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
            ...item,
            date: parseClinicalDate(item.date),
        } as PatientDatedRecord<T>));
}

export function revivePatientStructuredFields<T extends object>(item: T): T {
    const record = item as T & {
        exemptions?: unknown;
        diagnoses?: unknown;
        allergies?: unknown;
        documentInsights?: unknown;
    };

    const parsedExemptions = parseArrayField(record.exemptions);
    if (parsedExemptions) {
        record.exemptions = parsePatientExemptions(parsedExemptions);
    }

    const parsedAllergies = parseArrayField(record.allergies);
    if (parsedAllergies) record.allergies = parsedAllergies;

    const parsedDiagnoses = parseArrayField(record.diagnoses);
    if (parsedDiagnoses) {
        record.diagnoses = parsePatientDatedRecords(record.diagnoses);
    }

    const parsedDocumentInsights = parseArrayField(record.documentInsights);
    if (parsedDocumentInsights) {
        record.documentInsights = parsePatientDatedRecords(record.documentInsights);
    }

    return item;
}
