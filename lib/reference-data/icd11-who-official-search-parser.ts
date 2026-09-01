/* @Codex */
import { types } from 'node:util';
import { ICD11_WHO_BINDING } from './icd11-who-service.ts';

const RESULT_KEYS = ['destinationEntities', 'error', 'errorMessage', 'resultChopped',
    'wordSuggestionsChopped', 'guessType', 'uniqueSearchId', 'words'] as const;
const RESULT_REQUIRED = ['destinationEntities', 'error', 'resultChopped'] as const;
const ENTITY_KEYS = ['id', 'title', 'stemId', 'isLeaf', 'postcoordinationAvailability',
    'hasCodingNote', 'hasMaternalChapterLink', 'hasPerinatalChapterLink', 'matchingPVs',
    'propertiesTruncated', 'isResidualOther', 'isResidualUnspecified', 'chapter', 'theCode',
    'score', 'titleIsASearchResult', 'titleIsTopScore', 'entityType', 'important', 'descendants'] as const;
const PROPERTY_KEYS = ['propertyId', 'label', 'score', 'important', 'foundationUri', 'propertyValueType'] as const;
const NULLABLE_ENTITY_STRINGS = ['id', 'stemId', 'chapter'] as const;
const ENTITY_BOOLEANS = ['isLeaf', 'hasCodingNote', 'hasMaternalChapterLink', 'hasPerinatalChapterLink',
    'propertiesTruncated', 'isResidualOther', 'isResidualUnspecified', 'titleIsASearchResult',
    'titleIsTopScore', 'important'] as const;
const unsafeDisplayText = /[\u0000-\u001f\u007f<>\u061c\u200e\u200f\ud800-\udfff\u202a-\u202e\u2066-\u2069]/u;

function dataRecord(value: unknown, allowed: readonly string[], required: readonly string[] = []) {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null)
            || ownKeys.some((key) => typeof key !== 'string' || !allowed.includes(key))
            || required.some((key) => !ownKeys.includes(key))) return null;
        const output: Record<string, unknown> = Object.create(null);
        for (const key of ownKeys) {
            if (typeof key !== 'string') return null;
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function arrayValues(value: unknown, maximum: number): unknown[] | null {
    try {
        if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > maximum
            || Reflect.ownKeys(descriptors).length !== length + 1) return null;
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            output.push(descriptor.value);
        }
        return output;
    } catch { return null; }
}

function present(record: Record<string, unknown>, key: string): boolean {
    return Object.hasOwn(record, key);
}

function optionalNullableString(record: Record<string, unknown>, key: string): boolean {
    return !present(record, key) || record[key] === null || typeof record[key] === 'string';
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean {
    return !present(record, key) || typeof record[key] === 'boolean';
}

function optionalEnum(record: Record<string, unknown>, key: string, maximum: number): boolean {
    return !present(record, key) || (Number.isSafeInteger(record[key])
        && (record[key] as number) >= 0 && (record[key] as number) <= maximum);
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string): boolean {
    return !present(record, key) || (typeof record[key] === 'number' && Number.isFinite(record[key]));
}

function matchingProperties(value: unknown): boolean {
    if (value === null) return true;
    const properties = arrayValues(value, 128);
    if (!properties) return false;
    for (const valueItem of properties) {
        const item = dataRecord(valueItem, PROPERTY_KEYS);
        if (!item || !optionalNullableString(item, 'propertyId')
            || !optionalNullableString(item, 'label')
            || !optionalFiniteNumber(item, 'score') || !optionalBoolean(item, 'important')
            || !optionalNullableString(item, 'foundationUri')
            || !optionalEnum(item, 'propertyValueType', 3)) return false;
        if (typeof item.label === 'string'
            && (item.label !== item.label.trim().replace(/\s+/g, ' ') || unsafeDisplayText.test(item.label))) return false;
    }
    return true;
}

function entity(value: unknown): Readonly<{ code: string; description: string }> | null {
    const item = dataRecord(value, ENTITY_KEYS, ['theCode', 'title']);
    if (!item || typeof item.theCode !== 'string' || typeof item.title !== 'string'
        || !/^[A-Z0-9][A-Z0-9.&/-]{0,31}$/.test(item.theCode)
        || !item.title || item.title !== item.title.trim().replace(/\s+/g, ' ')
        || unsafeDisplayText.test(item.title)
        || NULLABLE_ENTITY_STRINGS.some((key) => !optionalNullableString(item, key))
        || ENTITY_BOOLEANS.some((key) => !optionalBoolean(item, key))
        || !optionalEnum(item, 'postcoordinationAvailability', 2)
        || !optionalEnum(item, 'entityType', 2) || !optionalFiniteNumber(item, 'score')) return null;
    if (present(item, 'matchingPVs') && !matchingProperties(item.matchingPVs)) return null;
    if (present(item, 'descendants') && item.descendants !== null
        && !arrayValues(item.descendants, 0)) return null;
    return Object.freeze({ code: item.theCode, description: item.title });
}

export function parseIcd11WhoOfficialSearchBody(body: string) {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return null; }
    const result = dataRecord(parsed, RESULT_KEYS, RESULT_REQUIRED);
    if (!result || result.error !== false
        || (present(result, 'errorMessage') && result.errorMessage !== null)
        || typeof result.resultChopped !== 'boolean'
        || !optionalBoolean(result, 'wordSuggestionsChopped')
        || !optionalEnum(result, 'guessType', 2)
        || (present(result, 'uniqueSearchId') && (typeof result.uniqueSearchId !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(result.uniqueSearchId)))) return null;
    if (present(result, 'words') && result.words !== null && !arrayValues(result.words, 0)) return null;
    const rawEntries = arrayValues(result.destinationEntities, ICD11_WHO_BINDING.resultLimit);
    if (!rawEntries) return null;
    const seen = new Set<string>();
    const entries: Array<Readonly<{ code: string; description: string }>> = [];
    for (const rawEntry of rawEntries) {
        const parsedEntity = entity(rawEntry);
        if (!parsedEntity || seen.has(parsedEntity.code)) return null;
        seen.add(parsedEntity.code); entries.push(parsedEntity);
    }
    return Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-transport-result.v1' as const,
        releaseId: ICD11_WHO_BINDING.releaseId, language: ICD11_WHO_BINDING.language,
        entries: Object.freeze(entries),
    });
}
