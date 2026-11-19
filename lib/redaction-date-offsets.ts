const DAY_MS = 86_400_000;
const DAY_MONTH_YEAR = /^(0[1-9]|[12][0-9]|3[01])[/.-](0[1-9]|1[0-2])[/.-]((?:19|20)[0-9]{2})$/u;
const ISO_DATE = /^((?:19|20)[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/u;
const BIRTH_CUE = /(?:\bnat[oaie]\b|\bnascita\b|\bDN\b|\bDOB\b|\bbirth)(?:[^\r\n.!?]|\.(?!\s)){0,64}$/iu;
const LABEL_ONLY_LINE = /^[\s:.,-]*$/u;
const FIRST_DAY = Date.UTC(1900, 0, 1) / DAY_MS;
const LAST_DAY = Date.UTC(2099, 11, 31) / DAY_MS;
export const MAX_OFFSET_DAYS = 36_525;
export const ANCHOR_SPREAD_DAYS = 1_024;
export const CLINICAL_WINDOW = Object.freeze({ daysBefore: 1_826, daysAfter: 731 });

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

export function writtenDateDay(text: string): number | null {
    const iso = ISO_DATE.exec(text);
    return iso ? calendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3])) : clinicalDateDay(text);
}

export function isoDay(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function birthDateDays(values: readonly string[] | undefined): ReadonlySet<number> {
    const days = new Set<number>();
    for (const value of values ?? []) {
        const day = writtenDateDay(value.trim());
        if (day !== null) days.add(day);
    }
    return days;
}

export function followsBirthCue(textBefore: string): boolean {
    const lines = textBefore.slice(-160).split(/\r?\n/u);
    const current = lines.pop() ?? '';
    if (BIRTH_CUE.test(current)) return true;
    if (!LABEL_ONLY_LINE.test(current)) return false;
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return BIRTH_CUE.test(lines.pop() ?? '');
}

export function inClinicalWindow(day: number, reference: number): boolean {
    return day >= reference - CLINICAL_WINDOW.daysBefore && day <= reference + CLINICAL_WINDOW.daysAfter;
}

export function registryNameWords(names: readonly string[] | undefined): ReadonlySet<string> {
    return new Set((names ?? []).flatMap(nameWords));
}

export function nameWords(text: string): string[] {
    return text.normalize('NFC').toLocaleLowerCase('it-IT').match(/[\p{L}\p{M}]+/gu) ?? [];
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
