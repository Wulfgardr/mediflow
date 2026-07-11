/* @Codex */
const CLINICAL_DOSAGE_NEEDLE_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u)\b/gi;

/* @Codex */
export function normalizeClinicalText(value: string | undefined): string {
    return (value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* @Codex */
export function extractClinicalDosageNeedles(value: string | undefined): string[] {
    if (!value?.trim()) return [];

    const matches = value.match(CLINICAL_DOSAGE_NEEDLE_REGEX) || [];
    return Array.from(new Set(matches.map((item) => item.toLowerCase().replace(/,/g, '.').replace(/\s+/g, ''))));
}
