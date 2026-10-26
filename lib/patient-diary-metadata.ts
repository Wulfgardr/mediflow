import { isEncryptedFieldValue, isLockedDataPlaceholder } from './locked-field-guard';

type DiaryMetadata = { state: 'absent' | 'unreadable'; value?: undefined }
    | { state: 'readable'; value: Record<string, unknown> };

const TEXT_FIELDS = ['authorName', 'author', 'signedBy', 'sourceLabel', 'source', 'workflowStatus', 'status'];

/** Read the existing object/JSON metadata forms without inventing a write or decrypt path. */
export function readPatientDiaryMetadata(input: unknown): DiaryMetadata {
    if (input === null || input === undefined || input === '') return { state: 'absent' };
    let value = input;
    if (typeof value === 'string') {
        if (!value.trim()) return { state: 'absent' };
        if (isEncryptedFieldValue(value) || isLockedDataPlaceholder(value)) return { state: 'unreadable' };
        try { value = JSON.parse(value); } catch { return { state: 'unreadable' }; }
    }
    if (value === null) return { state: 'absent' };
    if (typeof value !== 'object' || Array.isArray(value)) return { state: 'unreadable' };
    const record = value as Record<string, unknown>;
    for (const field of TEXT_FIELDS) {
        const text = record[field];
        if (text === null || text === undefined || text === '') continue;
        if (typeof text !== 'string' || isEncryptedFieldValue(text.trim()) || isLockedDataPlaceholder(text.trim())) return { state: 'unreadable' };
    }
    return { state: 'readable', value: record };
}
