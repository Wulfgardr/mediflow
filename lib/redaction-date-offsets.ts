const DAY_MS = 86_400_000;
const DAY_MONTH_YEAR = /^(0[1-9]|[12][0-9]|3[01])[/.-](0[1-9]|1[0-2])[/.-]((?:19|20)[0-9]{2})$/u;
const ISO_DATE = /^((?:19|20)[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/u;
const BIRTH_CUE = /(?:\bnat[oaie]\b|\bnascita\b|\bDN\b|\bDOB\b|\bbirth)[^\r\n.;]{0,24}$/iu;
const FIRST_DAY = Date.UTC(1900, 0, 1) / DAY_MS;
const LAST_DAY = Date.UTC(2099, 11, 31) / DAY_MS;
export const MAX_OFFSET_DAYS = 36_525;
export const ANCHOR_SPREAD_DAYS = 1_024;

function calendarDay(year: number, month: number, day: number): number | null {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? date.getTime() / DAY_MS : null;
}

/** Epoch day of a whole day/month/year date in the Layer 1 grammar, or null. */
export function clinicalDateDay(text: string): number | null {
    const match = DAY_MONTH_YEAR.exec(text);
    return match ? calendarDay(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

export function birthDateDays(values: readonly string[] | undefined): ReadonlySet<number> {
    const days = new Set<number>();
    for (const value of values ?? []) {
        const trimmed = value.trim();
        const iso = ISO_DATE.exec(trimmed);
        const day = iso ? calendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3])) : clinicalDateDay(trimmed);
        if (day !== null) days.add(day);
    }
    return days;
}

export function followsBirthCue(textBefore: string): boolean {
    return BIRTH_CUE.test(textBefore.slice(-48));
}

export function offsetFromAnchor(day: number, anchor: number): number | null {
    const offset = day - anchor;
    return Math.abs(offset) <= MAX_OFFSET_DAYS ? offset : null;
}

export function dayFromOffset(anchor: number, offset: number): number | null {
    const day = anchor + offset;
    return Number.isSafeInteger(offset) && Math.abs(offset) <= MAX_OFFSET_DAYS && day >= FIRST_DAY && day <= LAST_DAY ? day : null;
}

export function formatDay(day: number): string {
    const date = new Date(day * DAY_MS);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}
