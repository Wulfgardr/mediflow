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
const COMMON = Object.freeze({ reviewOnly: true as const, writesPerformed: 0 as const, applyPolicy: 'none' as const });
const CONFIDENCE = new Set<Confidence>(['high', 'medium', 'low']);
const QUALITY = new Set<Quality>(['green', 'yellow', 'red']);
const SYSTEMS = new Set(['ICD-9', 'ICD-10', 'ICD-11']);
const STATES = new Set(['active', 'transition', 'uncertain', 'inactive']);
const CATEGORIES = new Set(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']);

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
    try {
        if (types.isProxy(value) || typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const allowed = new Set([...required, ...optional]); const keys = Reflect.ownKeys(value);
        if (keys.length < required.length || keys.length > allowed.size || keys.some((key) => typeof key !== 'string' || !allowed.has(key)) || required.some((key) => !keys.includes(key))) return null;
        const copy: Record<string, unknown> = {};
        for (const key of keys) {
            if (typeof key !== 'string') return null;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function list<T>(value: unknown, maximum: number, parse: (value: unknown) => T | null): readonly T[] | null {
    try {
        if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || !keys.includes('length')) return null;
        const result: T[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            const item = parse(descriptor.value); if (item === null) return null; result.push(item);
        }
        return Object.freeze(result);
    } catch { return null; }
}

function text(value: unknown, maximum = 700): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) return null;
    const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
    return normalized.length > 0 && normalized.length <= maximum ? normalized : null;
}
function confidence(value: unknown): Confidence | null { return typeof value === 'string' && CONFIDENCE.has(value as Confidence) ? value as Confidence : null; }
function optionalText(input: Record<string, unknown>, key: string, maximum = 700): string | undefined | null { return Object.hasOwn(input, key) ? text(input[key], maximum) : undefined; }
function diagnosis(value: unknown): Diagnosis | null {
    const item = record(value, ['code', 'description', 'system'], ['evidence', 'confidence']);
    const evidence = item && optionalText(item, 'evidence', 400); const level = item && (Object.hasOwn(item, 'confidence') ? confidence(item.confidence) : undefined);
    if (!item || !text(item.code, 120) || !text(item.description, 300) || typeof item.system !== 'string' || !SYSTEMS.has(item.system) || evidence === null || level === null) return null;
    return Object.freeze({ code: text(item.code, 120)!, description: text(item.description, 300)!, system: item.system as Diagnosis['system'], ...(evidence === undefined ? {} : { evidence }), ...(level === undefined ? {} : { confidence: level }) });
}
function problem(value: unknown): Problem | null {
    const item = record(value, ['label', 'icdQuery', 'confidence', 'evidence'], ['sourceId', 'explicitCode']);
    const sourceId = item && optionalText(item, 'sourceId', 160); const explicitCode = item && optionalText(item, 'explicitCode', 120);
    if (!item || !text(item.label, 180) || !text(item.icdQuery, 160) || !confidence(item.confidence) || !text(item.evidence, 400) || sourceId === null || explicitCode === null) return null;
    return Object.freeze({ label: text(item.label, 180)!, icdQuery: text(item.icdQuery, 160)!, confidence: item.confidence as Confidence, evidence: text(item.evidence, 400)!, ...(sourceId === undefined ? {} : { sourceId }), ...(explicitCode === undefined ? {} : { explicitCode }) });
}
function therapy(value: unknown): Therapy | null {
    const item = record(value, ['drugMention', 'drugQuery', 'confidence', 'evidence'], ['activePrinciple', 'dosage', 'motivation', 'therapyState', 'reviewNote', 'sourceId']);
    const optional = ['activePrinciple', 'dosage', 'motivation', 'reviewNote', 'sourceId'].map((key) => [key, item && optionalText(item, key, 400)] as const);
    if (!item || !text(item.drugMention, 180) || !text(item.drugQuery, 180) || !confidence(item.confidence) || !text(item.evidence, 400) || optional.some(([, value]) => value === null) || (Object.hasOwn(item, 'therapyState') && (typeof item.therapyState !== 'string' || !STATES.has(item.therapyState)))) return null;
    return Object.freeze({ drugMention: text(item.drugMention, 180)!, drugQuery: text(item.drugQuery, 180)!, confidence: item.confidence as Confidence, evidence: text(item.evidence, 400)!, ...Object.fromEntries(optional.filter(([, value]) => value !== undefined)), ...(Object.hasOwn(item, 'therapyState') ? { therapyState: item.therapyState } : {}) }) as Therapy;
}
function serviceItem(value: unknown): ServiceItem | null {
    const item = record(value, ['serviceName', 'confidence', 'evidence'], ['category', 'codeSystem', 'serviceCode', 'sourceId']);
    const optional = ['codeSystem', 'serviceCode', 'sourceId'].map((key) => [key, item && optionalText(item, key, 160)] as const); const category = item && (Object.hasOwn(item, 'category') ? item.category : undefined);
    if (!item || !text(item.serviceName, 180) || !confidence(item.confidence) || !text(item.evidence, 400) || optional.some(([, value]) => value === null) || (category !== undefined && (typeof category !== 'string' || !CATEGORIES.has(category)))) return null;
    return Object.freeze({ serviceName: text(item.serviceName, 180)!, confidence: item.confidence as Confidence, evidence: text(item.evidence, 400)!, ...Object.fromEntries(optional.filter(([, value]) => value !== undefined)), ...(category === undefined ? {} : { category }) }) as ServiceItem;
}
function service(value: unknown): Service | null {
    const item = record(value, ['serviceName', 'confidence', 'evidence'], ['category', 'priority', 'codeSystem', 'serviceCode', 'clinicalQuestion', 'provider', 'prescribedAt', 'requestReference', 'sourceId', 'items']);
    if (!item) return null;
    const optional = ['priority', 'codeSystem', 'serviceCode', 'clinicalQuestion', 'provider', 'prescribedAt', 'requestReference', 'sourceId'].map((key) => [key, optionalText(item, key, 180)] as const);
    const category = Object.hasOwn(item, 'category') ? item.category : undefined; const items = Object.hasOwn(item, 'items') ? list(item.items, 32, serviceItem) : undefined;
    if (!text(item.serviceName, 180) || !confidence(item.confidence) || !text(item.evidence, 400) || optional.some(([, value]) => value === null) || items === null || (category !== undefined && (typeof category !== 'string' || !CATEGORIES.has(category)))) return null;
    return Object.freeze({ serviceName: text(item.serviceName, 180)!, confidence: item.confidence as Confidence, evidence: text(item.evidence, 400)!, ...Object.fromEntries(optional.filter(([, value]) => value !== undefined)), ...(category === undefined ? {} : { category }), ...(items === undefined ? {} : { items }) }) as Service;
}

function denied(): Denied { return Object.freeze({ status: 'denied', code: 'output_invalid', value: null, ...COMMON }); }

export function createDocumentSynthesisOutputContract(): Readonly<{ normalize(value: unknown): DocumentSynthesisOutputContractResult }> {
    return Object.freeze({ normalize(value: unknown): DocumentSynthesisOutputContractResult {
        const input = record(value, ['schemaVersion', 'task', 'summary', 'data']);
        const data = input && record(input.data, ['qualityLevel', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions'], ['qualityReason']);
        const qualityReason = data && optionalText(data, 'qualityReason', 220);
        const medications = data && list(data.medications, 64, (item) => text(item, 180));
        const diagnoses = data && list(data.diagnoses, 32, diagnosis); const problems = data && list(data.problemStatements, 32, problem);
        const therapies = data && list(data.therapyCandidates, 32, therapy); const services = data && list(data.servicePrescriptions, 32, service);
        if (!input || input.schemaVersion !== DOCUMENT_SYNTHESIS_OUTPUT_SCHEMA_VERSION || input.task !== 'document_synthesis' || !text(input.summary, 700) || !data || typeof data.qualityLevel !== 'string' || !QUALITY.has(data.qualityLevel as Quality) || qualityReason === null || !medications || !diagnoses || !problems || !therapies || !services) return denied();
        const normalized = Object.freeze({ schemaVersion: DOCUMENT_SYNTHESIS_OUTPUT_SCHEMA_VERSION, task: 'document_synthesis' as const, summary: text(input.summary, 700)!, data: Object.freeze({ qualityLevel: data.qualityLevel as Quality, ...(qualityReason === undefined ? {} : { qualityReason }), medications, diagnoses, problemStatements: problems, therapyCandidates: therapies, servicePrescriptions: services }) });
        return Object.freeze({ status: 'available' as const, code: null, value: normalized, ...COMMON });
    } });
}

const DEFAULT_CONTRACT = createDocumentSynthesisOutputContract();
export function normalizeDocumentSynthesisOutput(value: unknown): DocumentSynthesisOutputContractResult { return DEFAULT_CONTRACT.normalize(value); }
