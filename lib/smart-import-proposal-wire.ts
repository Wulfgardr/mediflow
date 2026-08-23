/* @Codex */
export const SMART_IMPORT_PROPOSAL_WIRE_LIMITS = Object.freeze({ text: 220, reference: 80, explicitCode: 32, priority: 16,
    diagnoses: 5, therapies: 10, services: 10, items: 20 });

type Confidence = 'high' | 'medium' | 'low'; type Category = 'lab' | 'imaging' | 'visit' | 'rehab' | 'screening' | 'procedure' | 'other';
type TherapyState = 'active' | 'transition' | 'uncertain' | 'inactive'; type Mode = 'domain' | 'wire'; const OMIT = Symbol('omit');
type Diagnosis = Readonly<{ label: string; icdQuery: string; confidence: Confidence; evidence: string; sourceId: string; explicitCode?: string }>;
type Therapy = Readonly<{ drugMention: string; drugQuery: string; confidence: Confidence; evidence: string; sourceId: string; activePrinciple?: string; dosage?: string; motivation?: string; therapyState?: TherapyState; reviewNote?: string }>;
type Item = Readonly<{ serviceName: string; confidence: Confidence; evidence: string; sourceId: string; category?: Category; codeSystem?: string; serviceCode?: string }>;
type Service = Readonly<{ serviceName: string; confidence: Confidence; evidence: string; sourceId: string; category?: Category; priority?: string; codeSystem?: string; serviceCode?: string; clinicalQuestion?: string; provider?: string; prescribedAt?: string; requestReference?: string; items?: readonly Item[] }>;
export type SmartImportProposalWireV1 = Readonly<{ schemaVersion: 'mediflow.smart-import.proposal.v1'; generatedAt: string;
    contract: Readonly<{ validJson: true; validTask: true; legacyContract: boolean }>; summary: string; diagnoses: readonly Diagnosis[];
    therapies: readonly Therapy[]; servicePrescriptions: readonly Service[]; writesPerformed: 0 }>;

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const keys = Reflect.ownKeys(value); const allowed = [...required, ...optional];
        if (keys.length < required.length || keys.some((key) => typeof key !== 'string' || !allowed.includes(key)) || required.some((key) => !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) return null; output[key as string] = descriptor.value; }
        return output;
    } catch { return null; }
}
function array(value: unknown, max: number, parse: (item: unknown) => unknown | null): readonly unknown[] | null {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return null;
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); const item = descriptor && 'value' in descriptor ? parse(descriptor.value) : null; if (!item) return null; output.push(item); }
        return Object.freeze(output);
    } catch { return null; }
}
function text(value: unknown, max: number, empty = false): string | null { return typeof value === 'string' && (empty || value.length > 0) && value.length <= max ? value : null; }
function iso(value: unknown): string | null { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null; }
function choice<T extends string>(value: unknown, values: readonly T[]): T | null { return typeof value === 'string' && values.includes(value as T) ? value as T : null; }
function optional(recordValue: Record<string, unknown>, key: string, parse: (value: unknown) => unknown | null, mode: Mode): unknown | typeof OMIT | null {
    if (!Object.hasOwn(recordValue, key)) return OMIT;
    if (recordValue[key] === undefined) return mode === 'domain' ? OMIT : null;
    return parse(recordValue[key]);
}
function assign(output: Record<string, unknown>, key: string, value: unknown | typeof OMIT | null): boolean { if (value === null) return false; if (value !== OMIT) output[key] = value; return true; }
function diagnosis(value: unknown, mode: Mode): Diagnosis | null {
    const input = record(value, ['label', 'icdQuery', 'confidence', 'evidence', 'sourceId'], ['explicitCode']); if (!input) return null;
    const output: Record<string, unknown> = { label: text(input.label, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), icdQuery: text(input.icdQuery, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), confidence: choice(input.confidence, ['high', 'medium', 'low']), evidence: text(input.evidence, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), sourceId: text(input.sourceId, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.reference) };
    if (Object.values(output).some((item) => item === null) || !assign(output, 'explicitCode', optional(input, 'explicitCode', (item) => text(item, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.explicitCode), mode))) return null;
    return Object.freeze(output) as Diagnosis;
}
function therapy(value: unknown, mode: Mode): Therapy | null {
    const optionalKeys = ['activePrinciple', 'dosage', 'motivation', 'therapyState', 'reviewNote']; const input = record(value, ['drugMention', 'drugQuery', 'confidence', 'evidence', 'sourceId'], optionalKeys); if (!input) return null;
    const output: Record<string, unknown> = { drugMention: text(input.drugMention, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), drugQuery: text(input.drugQuery, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), confidence: choice(input.confidence, ['high', 'medium', 'low']), evidence: text(input.evidence, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), sourceId: text(input.sourceId, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.reference) };
    for (const key of optionalKeys) if (!assign(output, key, optional(input, key, (item) => key === 'therapyState' ? choice(item, ['active', 'transition', 'uncertain', 'inactive']) : text(item, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), mode))) return null;
    return Object.values(output).some((item) => item === null) ? null : Object.freeze(output) as Therapy;
}
function item(value: unknown, mode: Mode): Item | null {
    const input = record(value, ['serviceName', 'confidence', 'evidence', 'sourceId'], ['category', 'codeSystem', 'serviceCode']); if (!input) return null;
    const output: Record<string, unknown> = { serviceName: text(input.serviceName, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), confidence: choice(input.confidence, ['high', 'medium', 'low']), evidence: text(input.evidence, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), sourceId: text(input.sourceId, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.reference) };
    for (const key of ['category', 'codeSystem', 'serviceCode']) if (!assign(output, key, optional(input, key, (entry) => key === 'category' ? choice(entry, ['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']) : text(entry, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.reference), mode))) return null;
    return Object.values(output).some((entry) => entry === null) ? null : Object.freeze(output) as Item;
}
function service(value: unknown, mode: Mode): Service | null {
    const optionalKeys = ['category', 'priority', 'codeSystem', 'serviceCode', 'clinicalQuestion', 'provider', 'prescribedAt', 'requestReference', 'items']; const input = record(value, ['serviceName', 'confidence', 'evidence', 'sourceId'], optionalKeys); if (!input) return null;
    const output: Record<string, unknown> = { serviceName: text(input.serviceName, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), confidence: choice(input.confidence, ['high', 'medium', 'low']), evidence: text(input.evidence, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), sourceId: text(input.sourceId, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.reference) };
    for (const key of optionalKeys) if (!assign(output, key, optional(input, key, (entry) => key === 'category' ? choice(entry, ['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']) : key === 'priority' ? text(entry, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.priority) : key === 'items' ? array(entry, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.items, (nested) => item(nested, mode)) : text(entry, key === 'prescribedAt' ? SMART_IMPORT_PROPOSAL_WIRE_LIMITS.explicitCode : key === 'codeSystem' || key === 'serviceCode' || key === 'requestReference' ? SMART_IMPORT_PROPOSAL_WIRE_LIMITS.reference : SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text), mode))) return null;
    return Object.values(output).some((entry) => entry === null) ? null : Object.freeze(output) as Service;
}
function parse(value: unknown, mode: Mode): SmartImportProposalWireV1 | null {
    const input = record(value, ['schemaVersion', 'generatedAt', 'contract', 'summary', 'diagnoses', 'therapies', 'servicePrescriptions', 'writesPerformed']); const contract = input && record(input.contract, ['validJson', 'validTask', 'legacyContract']); const generatedAt = input ? iso(input.generatedAt) : null; const summary = input ? text(input.summary, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.text, true) : null; if (!input || !contract || input.schemaVersion !== 'mediflow.smart-import.proposal.v1' || !generatedAt || summary === null || input.writesPerformed !== 0 || contract.validJson !== true || contract.validTask !== true || typeof contract.legacyContract !== 'boolean') return null;
    const diagnoses = array(input.diagnoses, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.diagnoses, (itemValue) => diagnosis(itemValue, mode)); const therapies = array(input.therapies, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.therapies, (itemValue) => therapy(itemValue, mode)); const services = array(input.servicePrescriptions, SMART_IMPORT_PROPOSAL_WIRE_LIMITS.services, (itemValue) => service(itemValue, mode));
    return !diagnoses || !therapies || !services ? null : Object.freeze({ schemaVersion: 'mediflow.smart-import.proposal.v1', generatedAt, contract: Object.freeze({ validJson: true, validTask: true, legacyContract: contract.legacyContract }), summary, diagnoses: diagnoses as readonly Diagnosis[], therapies: therapies as readonly Therapy[], servicePrescriptions: services as readonly Service[], writesPerformed: 0 });
}

/** Converts producer-domain optionals to JSON-safe wire semantics without stringifying. */
export function serializePatientSmartImportProposalWire(value: unknown): SmartImportProposalWireV1 | null { return parse(value, 'domain'); }
/** Snapshots an already-wire-valid proposal; present undefined is rejected. */
export function parsePatientSmartImportProposalWire(value: unknown): SmartImportProposalWireV1 | null { return parse(value, 'wire'); }
