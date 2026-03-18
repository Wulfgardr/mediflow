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

/* @Codex */
export function parsePatientExemptions(value: unknown): string[] {
    const parsed = parseArrayField(value);
    if (!parsed) return [];
    return parsed.filter((code): code is string => typeof code === 'string');
}

/* @Codex */
export function parsePatientDatedRecords<T extends object>(value: unknown): Array<T & { date: Date }> {
    const parsed = parseArrayField(value);
    if (!parsed) return [];

    return parsed
        .filter((item): item is ParsedStructuredRecord => Boolean(item) && typeof item === 'object')
        .map((item) => ({
            ...item,
            date: item.date ? new Date(item.date as string | number | Date) : new Date(),
        } as T & { date: Date }));
}

/* @Codex */
export function revivePatientStructuredFields<T extends object>(item: T): T {
    const record = item as T & {
        exemptions?: unknown;
        diagnoses?: unknown;
        documentInsights?: unknown;
    };

    const parsedExemptions = parseArrayField(record.exemptions);
    if (parsedExemptions) {
        record.exemptions = parsePatientExemptions(parsedExemptions);
    }

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
