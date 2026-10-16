export const PROSTHETIC_PRESCRIPTION_STATUSES = ['draft', 'prescribed', 'submitted', 'authorized', 'delivered', 'tested', 'cancelled'] as const;
export const PROSTHETIC_PRESCRIPTION_CATEGORIES = ['standard', 'oxygen', 'repair', 'replacement', 'trial', 'other'] as const;
export const PROSTHETIC_PRESCRIPTION_SOURCES = ['manual', 'document_review'] as const;

export const SERVICE_PRESCRIPTION_STATUSES = ['prescribed', 'booked', 'performed', 'report_received', 'cancelled'] as const;
export const SERVICE_PRESCRIPTION_CATEGORIES = ['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other'] as const;
export const SERVICE_PRESCRIPTION_PRIORITIES = ['U', 'B', 'D', 'P', 'routine', 'unknown'] as const;
export const SERVICE_PRESCRIPTION_SOURCES = ['manual', 'document_review', 'legacy_therapy_cleanup'] as const;
export const SERVICE_PRESCRIPTION_ITEM_MATCH_STATUSES = ['unmatched', 'candidate', 'matched', 'manual', 'not_found'] as const;
export const SERVICE_PRESCRIPTION_ITEM_CONFIDENCES = ['high', 'medium', 'low'] as const;

type LiteralTuple = readonly [string, ...string[]];

function asSet<T extends LiteralTuple>(values: T): ReadonlySet<T[number]> {
    return new Set(values);
}

export const PROSTHETIC_PRESCRIPTION_STATUS_SET = asSet(PROSTHETIC_PRESCRIPTION_STATUSES);
export const PROSTHETIC_PRESCRIPTION_CATEGORY_SET = asSet(PROSTHETIC_PRESCRIPTION_CATEGORIES);
export const PROSTHETIC_PRESCRIPTION_SOURCE_SET = asSet(PROSTHETIC_PRESCRIPTION_SOURCES);
export const SERVICE_PRESCRIPTION_STATUS_SET = asSet(SERVICE_PRESCRIPTION_STATUSES);
export const SERVICE_PRESCRIPTION_CATEGORY_SET = asSet(SERVICE_PRESCRIPTION_CATEGORIES);
export const SERVICE_PRESCRIPTION_PRIORITY_SET = asSet(SERVICE_PRESCRIPTION_PRIORITIES);
export const SERVICE_PRESCRIPTION_SOURCE_SET = asSet(SERVICE_PRESCRIPTION_SOURCES);
export const SERVICE_PRESCRIPTION_ITEM_MATCH_STATUS_SET = asSet(SERVICE_PRESCRIPTION_ITEM_MATCH_STATUSES);
export const SERVICE_PRESCRIPTION_ITEM_CONFIDENCE_SET = asSet(SERVICE_PRESCRIPTION_ITEM_CONFIDENCES);

export function parsePrescriptionDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseOptionalPrescriptionDate(value: unknown): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function optionalPrescriptionText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function optionalPrescriptionTextForUpdate(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'string' ? value.trim() || null : undefined;
}

export function optionalPrescriptionInteger(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

export function optionalPrescriptionIntegerForUpdate(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

export function isAllowedPrescriptionValue<T extends string>(
    values: ReadonlySet<T>,
    value: string | null | undefined
): value is T {
    return typeof value === 'string' && values.has(value as T);
}
