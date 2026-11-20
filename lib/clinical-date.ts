export function parseClinicalDate(value: unknown): Date | null {
    if (typeof value === 'string') {
        const iso = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(value);
        if (!iso || iso[1].startsWith('0000-')) return null;
        const day = new Date(iso[1]);
        if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== iso[1]) return null;
    } else if (typeof value !== 'number' && !(value instanceof Date)) {
        return null;
    }

    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function compareClinicalDatesDesc(left: unknown, right: unknown): number {
    const leftTime = parseClinicalDate(left)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = parseClinicalDate(right)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return leftTime === rightTime ? 0 : rightTime - leftTime;
}
