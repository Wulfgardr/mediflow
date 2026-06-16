/* @Codex */

/**
 * Parse Italian date formats (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
 */
export function parseItalianDate(dateStr: string): Date | undefined {
    if (!dateStr) return undefined;

    const match = dateStr.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
    if (match) {
        const [, day, month, year] = match;
        return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }

    // Try ISO format
    const isoDate = new Date(dateStr);
    return isNaN(isoDate.getTime()) ? undefined : isoDate;
}
