import { INSIGHT_LIMITS, isInsightMode, isDocumentRouterMode } from './insight-parameters-contract';

export function normalizeSettingValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

export function isValidInsightSetting(key: string, value: unknown): boolean {
    if (key === 'aiInsightMode') return isInsightMode(value);
    if (key === 'documentRouterControlFlow') return isDocumentRouterMode(value);
    if (key !== 'aiInsightManualConfig') return true;
    let parsed = value;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return false; }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    return Object.keys(record).length === Object.keys(INSIGHT_LIMITS).length
        && Object.entries(INSIGHT_LIMITS).every(([field, [min, max]]) => {
            const number = record[field];
            return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max;
        });
}
