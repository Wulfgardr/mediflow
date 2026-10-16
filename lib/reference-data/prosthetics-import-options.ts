import { PROSTHETICS_COLUMNS, isProstheticsDate, isProstheticsText, type ProstheticsImportOptions, type ProstheticsMapping } from './prosthetics-catalog-contract.ts';

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
    return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
}
export function normalizeProstheticsImportOptions(value: unknown): ProstheticsImportOptions | null {
    if (!object(value) || !keys(value, [], ['mapping', 'sourceDetails'])) return null;
    const normalized: ProstheticsImportOptions = {};
    if (Object.hasOwn(value, 'mapping')) {
        const mapping = value.mapping;
        if (!object(mapping) || !keys(mapping, ['delimiter', 'columns']) || ![',', ';'].includes(String(mapping.delimiter)) || !object(mapping.columns)
            || !keys(mapping.columns, [...PROSTHETICS_COLUMNS])) return null;
        const columns = mapping.columns;
        if (PROSTHETICS_COLUMNS.some(key => typeof columns[key] !== 'number' || !Number.isSafeInteger(columns[key]) || Number(columns[key]) < 0 || Number(columns[key]) > 99)) return null;
        normalized.mapping = { delimiter: mapping.delimiter as ',' | ';', columns: Object.fromEntries(PROSTHETICS_COLUMNS.map(key => [key, columns[key]])) as ProstheticsMapping['columns'] };
    }
    if (Object.hasOwn(value, 'sourceDetails')) {
        const details = value.sourceDetails;
        if (!object(details) || !keys(details, ['authority', 'date', 'notes'], ['id']) || (details.authority !== '' && !isProstheticsText(details.authority))
            || (details.date !== null && !isProstheticsDate(details.date)) || typeof details.notes !== 'string' || details.notes.length > 2000
            || /[\u0000-\u001f\u007f]/u.test(details.notes) || (details.id !== undefined && !isProstheticsText(details.id, 1024))) return null;
        normalized.sourceDetails = { ...(details.id === undefined ? {} : { id: details.id as string }), authority: details.authority as string, date: details.date as string | null, notes: details.notes };
    }
    return normalized;
}
