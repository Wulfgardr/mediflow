/* @Codex */
export const PROSTHETIC_PRESCRIPTION_STATUSES = ['draft', 'prescribed', 'submitted', 'authorized', 'delivered', 'tested', 'cancelled'] as const;
/* @Codex */
export const PROSTHETIC_PRESCRIPTION_CATEGORIES = ['standard', 'oxygen', 'repair', 'replacement', 'trial', 'other'] as const;
/* @Codex */
export const PROSTHETIC_PRESCRIPTION_SOURCES = ['manual', 'document_review'] as const;

/* @Codex */
export const SERVICE_PRESCRIPTION_STATUSES = ['prescribed', 'booked', 'performed', 'report_received', 'cancelled'] as const;
/* @Codex */
export const SERVICE_PRESCRIPTION_CATEGORIES = ['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other'] as const;
/* @Codex */
export const SERVICE_PRESCRIPTION_PRIORITIES = ['U', 'B', 'D', 'P', 'routine', 'unknown'] as const;
/* @Codex */
export const SERVICE_PRESCRIPTION_SOURCES = ['manual', 'document_review', 'legacy_therapy_cleanup'] as const;
/* @Codex */
export const SERVICE_PRESCRIPTION_ITEM_MATCH_STATUSES = ['unmatched', 'candidate', 'matched', 'manual', 'not_found'] as const;
/* @Codex */
export const SERVICE_PRESCRIPTION_ITEM_CONFIDENCES = ['high', 'medium', 'low'] as const;

type LiteralTuple = readonly [string, ...string[]];

function asSet<T extends LiteralTuple>(values: T): ReadonlySet<T[number]> {
    return new Set(values);
}

/* @Codex */
export const PROSTHETIC_PRESCRIPTION_STATUS_SET = asSet(PROSTHETIC_PRESCRIPTION_STATUSES);
/* @Codex */
export const PROSTHETIC_PRESCRIPTION_CATEGORY_SET = asSet(PROSTHETIC_PRESCRIPTION_CATEGORIES);
/* @Codex */
export const PROSTHETIC_PRESCRIPTION_SOURCE_SET = asSet(PROSTHETIC_PRESCRIPTION_SOURCES);
/* @Codex */
export const SERVICE_PRESCRIPTION_STATUS_SET = asSet(SERVICE_PRESCRIPTION_STATUSES);
/* @Codex */
export const SERVICE_PRESCRIPTION_CATEGORY_SET = asSet(SERVICE_PRESCRIPTION_CATEGORIES);
/* @Codex */
export const SERVICE_PRESCRIPTION_PRIORITY_SET = asSet(SERVICE_PRESCRIPTION_PRIORITIES);
/* @Codex */
export const SERVICE_PRESCRIPTION_SOURCE_SET = asSet(SERVICE_PRESCRIPTION_SOURCES);
/* @Codex */
export const SERVICE_PRESCRIPTION_ITEM_MATCH_STATUS_SET = asSet(SERVICE_PRESCRIPTION_ITEM_MATCH_STATUSES);
/* @Codex */
export const SERVICE_PRESCRIPTION_ITEM_CONFIDENCE_SET = asSet(SERVICE_PRESCRIPTION_ITEM_CONFIDENCES);

/* @Codex */
export function parsePrescriptionDate(value: unknown): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* @Codex */
export function parseOptionalPrescriptionDate(value: unknown): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const parsed = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/* @Codex */
export function optionalPrescriptionText(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/* @Codex */
export function optionalPrescriptionTextForUpdate(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return typeof value === 'string' ? value.trim() || null : undefined;
}

/* @Codex */
export function optionalPrescriptionInteger(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

/* @Codex */
export function optionalPrescriptionIntegerForUpdate(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

/* @Codex */
export function isAllowedPrescriptionValue<T extends string>(
    values: ReadonlySet<T>,
    value: string | null | undefined
): value is T {
    return typeof value === 'string' && values.has(value as T);
}
