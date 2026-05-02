/* @Codex */
export function parseApiV1Limit(value: string | null, fallback: number, max: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

/* @Codex */
export function parseApiV1NullableDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const parsed = new Date(value as string | number);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* @Codex */
export function toApiV1IsoString(value: unknown): string | null {
    const parsed = parseApiV1NullableDate(value);
    return parsed ? parsed.toISOString() : null;
}
