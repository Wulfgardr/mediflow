/* @Codex */
export function normalizeId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/* @Codex */
export function normalizeIdList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const ids = value
        .map((item) => normalizeId(item))
        .filter((item): item is string => item !== null);
    return Array.from(new Set(ids));
}
