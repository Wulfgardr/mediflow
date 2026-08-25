import 'server-only';

/* @Codex */
import { types } from 'node:util';

export const DOCUMENT_SYNTHESIS_OUTPUT_SCHEMA_VERSION = 'mediflow.ai.extract.v1' as const;

type Confidence = 'high' | 'medium' | 'low';
type Quality = 'green' | 'yellow' | 'red';
type Diagnosis = Readonly<{ code: string; description: string; system: 'ICD-9' | 'ICD-10' | 'ICD-11'; evidence?: string; confidence?: Confidence }>;
type Problem = Readonly<{ label: string; icdQuery: string; confidence: Confidence; evidence: string; sourceId?: string; explicitCode?: string }>;
type Therapy = Readonly<{ drugMention: string; drugQuery: string; confidence: Confidence; evidence: string; activePrinciple?: string; dosage?: string; motivation?: string; therapyState?: 'active' | 'transition' | 'uncertain' | 'inactive'; reviewNote?: string; sourceId?: string }>;
type ServiceItem = Readonly<{ serviceName: string; confidence: Confidence; evidence: string; category?: string; codeSystem?: string; serviceCode?: string; sourceId?: string }>;
type Service = Readonly<{ serviceName: string; confidence: Confidence; evidence: string; category?: string; priority?: string; codeSystem?: string; serviceCode?: string; clinicalQuestion?: string; provider?: string; prescribedAt?: string; requestReference?: string; sourceId?: string; items?: readonly ServiceItem[] }>;

export type DocumentSynthesisOutput = Readonly<{
    schemaVersion: typeof DOCUMENT_SYNTHESIS_OUTPUT_SCHEMA_VERSION;
    task: 'document_synthesis';
    summary: string;
    data: Readonly<{
        qualityLevel: Quality;
        qualityReason?: string;
        medications: readonly string[];
        diagnoses: readonly Diagnosis[];
        problemStatements: readonly Problem[];
        therapyCandidates: readonly Therapy[];
        servicePrescriptions: readonly Service[];
    }>;
}>;

type Available = Readonly<{ status: 'available'; code: null; value: DocumentSynthesisOutput; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
type Denied = Readonly<{ status: 'denied'; code: 'output_invalid'; value: null; reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>;
export type DocumentSynthesisOutputContractResult = Available | Denied;

const OBJECT = Object.prototype;
const ARRAY = Array.prototype;
const IS_PROXY = types.isProxy;
const GET_PROTOTYPE = Object.getPrototypeOf;
const GET_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OWN_KEYS = Reflect.ownKeys;
const HAS_OWN = Object.hasOwn;
const IS_ARRAY = Array.isArray;
const CREATE = Object.create;
const FREEZE = Object.freeze;
const DEFINE = Object.defineProperty;
const APPLY = Reflect.apply;
const SLICE = Array.prototype.slice;
const NORMALIZE = String.prototype.normalize;
const REPLACE = String.prototype.replace;
const TRIM = String.prototype.trim;
const TEST = RegExp.prototype.test;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const WHITESPACE = /\s+/gu;

function sealedRecord<T>(entries: readonly (readonly [string, unknown])[]): T {
    const result = CREATE(null) as Record<string, unknown>;
    for (const [key, value] of entries) result[key] = value;
    return FREEZE(result) as T;
}

function sealedList<T>(items: readonly T[]): readonly T[] {
    const result = APPLY(SLICE, items, []) as T[];
    DEFINE(result, 'toJSON', { value: null, enumerable: false, configurable: false, writable: false });
    return FREEZE(result);
}

const COMMON = sealedRecord<Readonly<{ reviewOnly: true; writesPerformed: 0; applyPolicy: 'none' }>>([
    ['reviewOnly', true], ['writesPerformed', 0], ['applyPolicy', 'none'],
]);

function allowed(value: string, values: readonly string[]): boolean {
    for (let index = 0; index < values.length; index += 1) if (value === values[index]) return true;
    return false;
}

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
    try {
        if (IS_PROXY(value) || typeof value !== 'object' || value === null || IS_ARRAY(value) || GET_PROTOTYPE(value) !== OBJECT) return null;
        const keys = OWN_KEYS(value);
        if (keys.length < required.length || keys.length > required.length + optional.length) return null;
        const copy = CREATE(null) as Record<string, unknown>;
        for (const key of keys) {
            if (typeof key !== 'string' || (!allowed(key, required) && !allowed(key, optional))) return null;
            const descriptor = GET_DESCRIPTOR(value, key);
            if (!descriptor || !descriptor.enumerable || !HAS_OWN(descriptor, 'value')) return null;
            copy[key] = descriptor.value;
        }
        for (const key of required) if (!HAS_OWN(copy, key)) return null;
        return copy;
    } catch { return null; }
}

function list<T>(value: unknown, maximum: number, parse: (value: unknown) => T | null): readonly T[] | null {
    try {
        if (IS_PROXY(value) || !IS_ARRAY(value) || GET_PROTOTYPE(value) !== ARRAY) return null;
        const length = GET_DESCRIPTOR(value, 'length');
        if (!length || !HAS_OWN(length, 'value') || typeof length.value !== 'number' || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > maximum) return null;
        const keys = OWN_KEYS(value);
        if (keys.length !== length.value + 1) return null;
        const result: T[] = [];
        for (let index = 0; index < length.value; index += 1) {
            const descriptor = GET_DESCRIPTOR(value, String(index));
            if (!descriptor || !descriptor.enumerable || !HAS_OWN(descriptor, 'value')) return null;
            const item = parse(descriptor.value);
            if (item === null) return null;
            result[index] = item;
        }
        return sealedList(result);
    } catch { return null; }
}

function text(value: unknown, maximum = 700): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || APPLY(TEST, CONTROL, [value])) return null;
    const normalized = APPLY(TRIM, APPLY(REPLACE, APPLY(NORMALIZE, value, ['NFC']), [WHITESPACE, ' ']), []);
    return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}
function confidence(value: unknown): Confidence | null { return typeof value === 'string' && allowed(value, ['high', 'medium', 'low']) ? value as Confidence : null; }
function optionalText(input: Record<string, unknown>, key: string, maximum = 700): string | undefined | null { return HAS_OWN(input, key) ? text(input[key], maximum) : undefined; }
function optionalEntries(input: Record<string, unknown>, keys: readonly string[], maximum: number): readonly (readonly [string, string])[] | null {
    const result: Array<readonly [string, string]> = [];
    for (const key of keys) {
        const value = optionalText(input, key, maximum);
        if (value === null) return null;
        if (value !== undefined) result[result.length] = [key, value];
    }
    return result;
}
function diagnosis(value: unknown): Diagnosis | null {
    const item = record(value, ['code', 'description', 'system'], ['evidence', 'confidence']);
    const code = item && text(item.code, 120); const description = item && text(item.description, 300); const evidence = item && optionalText(item, 'evidence', 400); const level = item && (HAS_OWN(item, 'confidence') ? confidence(item.confidence) : undefined);
    if (!item || !code || !description || typeof item.system !== 'string' || !allowed(item.system, ['ICD-9', 'ICD-10', 'ICD-11']) || evidence === null || level === null) return null;
    const entries: Array<readonly [string, unknown]> = [['code', code], ['description', description], ['system', item.system]];
    if (evidence !== undefined) entries[entries.length] = ['evidence', evidence]; if (level !== undefined) entries[entries.length] = ['confidence', level];
    return sealedRecord<Diagnosis>(entries);
}
function problem(value: unknown): Problem | null {
    const item = record(value, ['label', 'icdQuery', 'confidence', 'evidence'], ['sourceId', 'explicitCode']);
    const label = item && text(item.label, 180); const query = item && text(item.icdQuery, 160); const level = item && confidence(item.confidence); const evidence = item && text(item.evidence, 400); const optional = item && optionalEntries(item, ['sourceId', 'explicitCode'], 160);
    if (!item || !label || !query || !level || !evidence || optional === null) return null;
    return sealedRecord<Problem>([['label', label], ['icdQuery', query], ['confidence', level], ['evidence', evidence], ...(optional ?? [])]);
}
function therapy(value: unknown): Therapy | null {
    const item = record(value, ['drugMention', 'drugQuery', 'confidence', 'evidence'], ['activePrinciple', 'dosage', 'motivation', 'therapyState', 'reviewNote', 'sourceId']);
    const mention = item && text(item.drugMention, 180); const query = item && text(item.drugQuery, 180); const level = item && confidence(item.confidence); const evidence = item && text(item.evidence, 400); const optional = item && optionalEntries(item, ['activePrinciple', 'dosage', 'motivation', 'reviewNote', 'sourceId'], 400); const state = item && (HAS_OWN(item, 'therapyState') ? item.therapyState : undefined);
    if (!item || !mention || !query || !level || !evidence || optional === null || (state !== undefined && (typeof state !== 'string' || !allowed(state, ['active', 'transition', 'uncertain', 'inactive'])))) return null;
    const entries: Array<readonly [string, unknown]> = [['drugMention', mention], ['drugQuery', query], ['confidence', level], ['evidence', evidence], ...(optional ?? [])]; if (state !== undefined) entries[entries.length] = ['therapyState', state];
    return sealedRecord<Therapy>(entries);
}
function serviceItem(value: unknown): ServiceItem | null {
    const item = record(value, ['serviceName', 'confidence', 'evidence'], ['category', 'codeSystem', 'serviceCode', 'sourceId']);
    const name = item && text(item.serviceName, 180); const level = item && confidence(item.confidence); const evidence = item && text(item.evidence, 400); const optional = item && optionalEntries(item, ['codeSystem', 'serviceCode', 'sourceId'], 160); const category = item && (HAS_OWN(item, 'category') ? item.category : undefined);
    if (!item || !name || !level || !evidence || optional === null || (category !== undefined && (typeof category !== 'string' || !allowed(category, ['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other'])))) return null;
    const entries: Array<readonly [string, unknown]> = [['serviceName', name], ['confidence', level], ['evidence', evidence], ...(optional ?? [])]; if (category !== undefined) entries[entries.length] = ['category', category];
    return sealedRecord<ServiceItem>(entries);
}
function service(value: unknown): Service | null {
    const item = record(value, ['serviceName', 'confidence', 'evidence'], ['category', 'priority', 'codeSystem', 'serviceCode', 'clinicalQuestion', 'provider', 'prescribedAt', 'requestReference', 'sourceId', 'items']);
    const name = item && text(item.serviceName, 180); const level = item && confidence(item.confidence); const evidence = item && text(item.evidence, 400); const optional = item && optionalEntries(item, ['priority', 'codeSystem', 'serviceCode', 'clinicalQuestion', 'provider', 'prescribedAt', 'requestReference', 'sourceId'], 180); const category = item && (HAS_OWN(item, 'category') ? item.category : undefined); const items = item && (HAS_OWN(item, 'items') ? list(item.items, 32, serviceItem) : undefined);
    if (!item || !name || !level || !evidence || optional === null || items === null || (category !== undefined && (typeof category !== 'string' || !allowed(category, ['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other'])))) return null;
    const entries: Array<readonly [string, unknown]> = [['serviceName', name], ['confidence', level], ['evidence', evidence], ...(optional ?? [])]; if (category !== undefined) entries[entries.length] = ['category', category]; if (items !== undefined) entries[entries.length] = ['items', items];
    return sealedRecord<Service>(entries);
}

function denied(): Denied { return sealedRecord<Denied>([['status', 'denied'], ['code', 'output_invalid'], ['value', null], ['reviewOnly', true], ['writesPerformed', 0], ['applyPolicy', 'none']]); }

export function createDocumentSynthesisOutputContract(): Readonly<{ normalize(value: unknown): DocumentSynthesisOutputContractResult }> {
    return sealedRecord([['normalize', (value: unknown): DocumentSynthesisOutputContractResult => {
        const input = record(value, ['schemaVersion', 'task', 'summary', 'data']);
        const data = input && record(input.data, ['qualityLevel', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions'], ['qualityReason']);
        const summary = input && text(input.summary, 700); const reason = data && optionalText(data, 'qualityReason', 220); const medications = data && list(data.medications, 64, (item) => text(item, 180)); const diagnoses = data && list(data.diagnoses, 32, diagnosis); const problems = data && list(data.problemStatements, 32, problem); const therapies = data && list(data.therapyCandidates, 32, therapy); const services = data && list(data.servicePrescriptions, 32, service);
        if (!input || input.schemaVersion !== DOCUMENT_SYNTHESIS_OUTPUT_SCHEMA_VERSION || input.task !== 'document_synthesis' || !summary || !data || typeof data.qualityLevel !== 'string' || !allowed(data.qualityLevel, ['green', 'yellow', 'red']) || reason === null || !medications || !diagnoses || !problems || !therapies || !services) return denied();
        const dataEntries: Array<readonly [string, unknown]> = [['qualityLevel', data.qualityLevel]]; if (reason !== undefined) dataEntries[dataEntries.length] = ['qualityReason', reason]; dataEntries[dataEntries.length] = ['medications', medications]; dataEntries[dataEntries.length] = ['diagnoses', diagnoses]; dataEntries[dataEntries.length] = ['problemStatements', problems]; dataEntries[dataEntries.length] = ['therapyCandidates', therapies]; dataEntries[dataEntries.length] = ['servicePrescriptions', services];
        const normalized = sealedRecord<DocumentSynthesisOutput>([['schemaVersion', DOCUMENT_SYNTHESIS_OUTPUT_SCHEMA_VERSION], ['task', 'document_synthesis'], ['summary', summary], ['data', sealedRecord(dataEntries)]]);
        return sealedRecord<Available>([['status', 'available'], ['code', null], ['value', normalized], ['reviewOnly', COMMON.reviewOnly], ['writesPerformed', COMMON.writesPerformed], ['applyPolicy', COMMON.applyPolicy]]);
    }]]) as Readonly<{ normalize(value: unknown): DocumentSynthesisOutputContractResult }>;
}

const DEFAULT_CONTRACT = createDocumentSynthesisOutputContract();
export function normalizeDocumentSynthesisOutput(value: unknown): DocumentSynthesisOutputContractResult { return DEFAULT_CONTRACT.normalize(value); }
