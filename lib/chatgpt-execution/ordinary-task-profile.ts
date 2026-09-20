/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { scanJsonObject } from '../ai-json-lexical';
import { emissionPlan, emissionUnit, renderEmissionPlan, type EmissionPart, type EmissionPlan } from './ordinary-emission-plan';
import { buildPatientInsightExtractionPlan } from '../ai-task-contract-prompts';

import {
    isEnvelopeUsable,
    parsePatientInsightExtractionResponse,
    type PatientInsightExtraction,
} from '../ai-task-contracts';
import type { PatientInsightProjection } from '../ai-providers/fabric/patient-insight-host-boundary';
import { DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA } from '../ai-providers/document-synthesis-json-schema';
import { buildDocumentSynthesisMultiSourcePrompt, buildDocumentSynthesisMultiSourcePlan } from '../ai-providers/fabric/document-synthesis-multi-source-prompt';
import { composeDocumentSynthesisProviderProjection } from '../ai-providers/fabric/document-synthesis-source-set-contract';
import { parseDocumentSynthesisProviderEnvelope, resolveDocumentSynthesisProviderEnvelope } from '../ai-providers/fabric/document-synthesis-provider-envelope';
import { bindDocumentSynthesisProviderEnvelope } from '../ai-providers/fabric/document-synthesis-provider-envelope-binding';
import type { DocumentSynthesisClaimCitationsResult } from '../ai-providers/fabric/document-synthesis-claim-citations';
import { createTreatmentReasoningChatGptOutputContract, type TreatmentReasoningChatGptContent } from '../ai-providers/fabric/treatment-reasoning-athena-output-contract-v2';
import {
    buildPatientSmartImportCapabilityPrompt, buildPatientSmartImportCapabilityPlan,
    parsePatientSmartImportCapabilityProposal,
    type PatientSmartImportCapabilityProposal,
} from '../domain/documents/patient-smart-import-capability-contract';
import { snapshotSmartImportProjection, type SmartImportProjection } from '../smart-import-projection';
import {
    buildChatGptTreatmentReasoningPrompt, buildChatGptTreatmentReasoningPlan, type TreatmentReasoningPromptInput,
} from '../treatment-reasoning-contract';

export type OrdinaryTaskFunctionId = 'patient_insight' | 'smart_import' | 'document_synthesis' | 'treatment_reasoning';
export type OrdinaryTaskOutput = PatientInsightExtraction | PatientSmartImportCapabilityProposal | Extract<DocumentSynthesisClaimCitationsResult, { status: 'available' }> | TreatmentReasoningChatGptContent;
export const ORDINARY_PROFILE_VERSION = 'mediflow.ordinary-redacted-profile.v1' as const;
export type OrdinaryTaskProfile = object;
export type OrdinaryTaskProfileRead = Readonly<{
    functionId: OrdinaryTaskFunctionId;
    profileVersion: typeof ORDINARY_PROFILE_VERSION;
    emissionPlan: EmissionPlan;
    prompt: string;
    outputSchema: Readonly<Record<string, unknown>>;
    inputSha256: string;
    parseOutput: (text: string) => OrdinaryTaskOutput;
}>;

type StoredProfile = OrdinaryTaskProfileRead;
const profiles = new WeakMap<object, StoredProfile>();
const documentEnvelopes = new WeakMap<object, object>();
const object = Object.prototype;
const array = Array.prototype;
const MAX_CLONE_DEPTH = 12;
const MAX_CLONE_NODES = 4096;
const MAX_CLONE_STRING_CHARS = 400_000;

const text = (maxLength: number) => Object.freeze({ type: 'string', minLength: 1, maxLength });
const list = (items: Readonly<Record<string, unknown>>, maxItems: number) => Object.freeze({ type: 'array', items, minItems: 0, maxItems });
const record = (properties: Record<string, unknown>, required = Object.keys(properties)) => Object.freeze({ type: 'object', additionalProperties: false, required: Object.freeze(required), properties: Object.freeze(properties) });
const confidence = Object.freeze({ type: 'string', enum: Object.freeze(['high', 'medium', 'low']) });
const category = Object.freeze({ type: 'string', enum: Object.freeze(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']) });
const diagnosis = record({ label: text(240), icdQuery: text(240), confidence, evidence: text(240), sourceId: text(80), explicitCode: text(80) }, ['label', 'icdQuery', 'confidence', 'evidence']);
const therapy = record({ drugMention: text(240), drugQuery: text(240), activePrinciple: text(240), dosage: text(240), motivation: text(240), therapyState: Object.freeze({ type: 'string', enum: Object.freeze(['active', 'transition', 'uncertain', 'inactive']) }), reviewNote: text(240), confidence, evidence: text(240), sourceId: text(80) }, ['drugMention', 'drugQuery', 'confidence', 'evidence']);
const serviceItem = record({ serviceName: text(240), category, codeSystem: text(80), serviceCode: text(80), confidence, evidence: text(240), sourceId: text(80) }, ['serviceName', 'confidence', 'evidence']);
const service = record({ serviceName: text(240), category, priority: text(80), codeSystem: text(80), serviceCode: text(80), clinicalQuestion: text(240), provider: text(240), prescribedAt: text(32), requestReference: text(80), confidence, evidence: text(240), sourceId: text(80), items: list(serviceItem, 32) }, ['serviceName', 'confidence', 'evidence']);

const evidenceRefs = list(text(160), 12);
const remoteEvidence = record({ id: text(160), statement: text(400), evidenceRefs });
const remoteFlag = record({ id: text(160), severity: Object.freeze({ type: 'string', enum: Object.freeze(['info', 'caution', 'urgent_review']) }), label: text(180), rationale: text(400), evidenceRefs });
const remoteAction = record({ id: text(160), intent: Object.freeze({ type: 'string', enum: Object.freeze(['no_action', 'review_only', 'open_therapy_form_prefill', 'open_monitoring_form_prefill', 'open_diagnosis_review']) }), label: text(180), rationale: text(400), writePolicy: Object.freeze({ type: 'string', enum: Object.freeze(['no_write', 'review_only', 'form_prefill_only']) }), evidenceRefs });
const remoteBinding = record({ claimPath: text(400), claim: text(400), evidenceRefs });

const schemas: Readonly<Record<OrdinaryTaskFunctionId, Readonly<Record<string, unknown>>>> = Object.freeze({
    patient_insight: record({ schemaVersion: Object.freeze({ type: 'string', const: 'mediflow.ai.extract.v1' }), task: Object.freeze({ type: 'string', const: 'patient_insight' }), summary: text(220), data: record({ currentState: list(text(220), 2), alerts: list(text(220), 2), nextSteps: list(text(220), 3), gaps: list(text(220), 1) }) }),
    smart_import: record({ schemaVersion: Object.freeze({ type: 'string', const: 'mediflow.ai.extract.v1' }), task: Object.freeze({ type: 'string', const: 'smart_import' }), summary: text(220), data: record({ diagnoses: list(diagnosis, 32), therapies: list(therapy, 32), servicePrescriptions: list(service, 32) }) }),
    document_synthesis: DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA as Readonly<Record<string, unknown>>,
    treatment_reasoning: record({ schemaVersion: Object.freeze({ type: 'string', const: 'mediflow.treatment_reasoning.v1' }), task: Object.freeze({ type: 'string', const: 'treatment_reasoning' }), summary: text(480), data: record({ recommendation: text(900), keyEvidence: list(remoteEvidence, 10), reasoning: list(text(400), 8), caveats: list(text(400), 8), safetyFlags: list(remoteFlag, 8), suggestedActions: list(remoteAction, 8), trace: record({ mode: Object.freeze({ type: 'string', const: 'chatgpt_subscription' }), toolsUsed: list(text(160), 0), limitations: list(text(180), 8) }) }), sourceBindings: list(remoteBinding, 18) }),
});

// Structured Outputs requires every property to be required. Only canonically
// optional fields gain a null representation; required fields never do.
function strictSchema(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const result = { ...schema };
    delete result.uniqueItems; // Host parsers still enforce source-label uniqueness.
    if (schema.type === 'object') {
        const properties = schema.properties as Record<string, Readonly<Record<string, unknown>>>;
        const required = schema.required as readonly string[];
        result.properties = Object.freeze(Object.fromEntries(Object.entries(properties).map(([key, child]) => [key,
            required.includes(key) ? strictSchema(child) : Object.freeze({ anyOf: Object.freeze([strictSchema(child), Object.freeze({ type: 'null' })]) }),
        ])));
        result.required = Object.freeze(Object.keys(properties));
    } else if (schema.type === 'array') result.items = strictSchema(schema.items as Readonly<Record<string, unknown>>);
    return Object.freeze(result);
}
function canonicalOptionals(value: unknown, schema: Readonly<Record<string, unknown>>): unknown {
    if (schema.type === 'array' && Array.isArray(value)) {
        const result: unknown[] = [];
        for (let index = 0; index < value.length; index++) result.push(canonicalOptionals(value[index], schema.items as Readonly<Record<string, unknown>>));
        return result;
    }
    if (schema.type !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) return value;
    const properties = schema.properties as Record<string, Readonly<Record<string, unknown>>>;
    const required = schema.required as readonly string[];
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
        const field = Object.hasOwn(properties, key) ? properties[key] : undefined;
        if (field && child === null && !required.includes(key)) return [];
        return [[key, field ? canonicalOptionals(child, field) : child]];
    }));
}

function reject(message: 'ordinary_task_profile_invalid' | 'ordinary_task_input_invalid' | 'ordinary_task_output_invalid'): never { throw new Error(message); }
function clone(value: unknown, depth = 0, budget = { nodes: 0, stringChars: 0 }): unknown {
    try {
        if (depth > MAX_CLONE_DEPTH || (budget.nodes += 1) > MAX_CLONE_NODES) return reject('ordinary_task_input_invalid');
        if (typeof value === 'string') { budget.stringChars += value.length; return budget.stringChars <= MAX_CLONE_STRING_CHARS ? value : reject('ordinary_task_input_invalid'); }
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? value : reject('ordinary_task_input_invalid');
        if (typeof value === 'bigint') return reject('ordinary_task_input_invalid');
        if (typeof value !== 'object' || types.isProxy(value)) return reject('ordinary_task_input_invalid');
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== array || Reflect.ownKeys(value).length !== value.length + 1) return reject('ordinary_task_input_invalid');
            const result: unknown[] = [];
            for (let index = 0; index < value.length; index += 1) { const item = Object.getOwnPropertyDescriptor(value, String(index)); if (!item || !item.enumerable || !('value' in item)) return reject('ordinary_task_input_invalid'); result[index] = clone(item.value, depth + 1, budget); }
            return Object.freeze(result);
        }
        if (Object.getPrototypeOf(value) !== object) return reject('ordinary_task_input_invalid');
        const result: Record<string, unknown> = {};
        for (const key of Reflect.ownKeys(value)) { if (typeof key !== 'string' || key === '__proto__') return reject('ordinary_task_input_invalid'); const item = Object.getOwnPropertyDescriptor(value, key); if (!item || !item.enumerable || !('value' in item)) return reject('ordinary_task_input_invalid'); Object.defineProperty(result, key, { value: clone(item.value, depth + 1, budget), enumerable: true, writable: false, configurable: false }); }
        return Object.freeze(result);
    } catch { return reject('ordinary_task_input_invalid'); }
}
function digest(value: unknown): string { return `sha256_${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== object) return null;
    const found = Reflect.ownKeys(value); if (found.length !== keys.length || found.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    return value as Record<string, unknown>;
}
function boundedStrings(value: unknown, maximum: number, itemMaximum: number): boolean {
    return Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= itemMaximum);
}
function validPatientInsightInput(value: unknown): value is PatientInsightProjection {
    const input = exact(value, ['schemaVersion', 'clinicalFocus', 'activeConditions', 'currentTherapies', 'recentClinicalEvents']);
    return Boolean(input && input.schemaVersion === 'mediflow.patient-insight.projection.v1' && typeof input.clinicalFocus === 'string' && input.clinicalFocus.length > 0 && input.clinicalFocus.length <= 240 && boundedStrings(input.activeConditions, 12, 240) && boundedStrings(input.currentTherapies, 12, 240) && boundedStrings(input.recentClinicalEvents, 12, 240));
}
function validTreatmentInput(value: unknown): value is TreatmentReasoningPromptInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input);
    if (keys.some(key => !['question', 'patientContext', 'sources', 'activeTherapies', 'diagnoses', 'observations'].includes(key))
        || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 500
        || typeof input.patientContext !== 'string' || input.patientContext.length > 1200
        || !Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > 12) return false;
    for (const key of ['activeTherapies', 'diagnoses', 'observations']) {
        if (Object.hasOwn(input, key) && !boundedStrings(input[key], 20, 220)) return false;
    }
    const kinds = ['patient-profile', 'diagnosis', 'therapy', 'observation', 'clinical-entry', 'document-insight', 'attachment-evidence', 'clinician-question', 'external-tool-trace'];
    return input.sources.every(source => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
        if (Object.keys(source).some(key => !['id', 'sourceKind', 'label', 'excerpt', 'date'].includes(key))) return false;
        return typeof source.id === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{2,119}$/u.test(source.id)
            && kinds.includes(source.sourceKind) && typeof source.label === 'string' && Boolean(source.label.trim()) && source.label.length <= 180
            && (!Object.hasOwn(source, 'excerpt') || typeof source.excerpt === 'string' && source.excerpt.length <= 260)
            && (!Object.hasOwn(source, 'date') || typeof source.date === 'string' && source.date.length <= 80);
    });
}
function insightPlan(input: PatientInsightProjection): EmissionPlan {
    let index = 1;
    const parts: EmissionPart[] = [`[S${index++}] `, emissionUnit(input.clinicalFocus)];
    for (const [label, values] of [['Condizione attiva', input.activeConditions], ['Terapia corrente', input.currentTherapies], ['Evento clinico recente', input.recentClinicalEvents]] as const) {
        for (const value of values) parts.push(`\n[S${index++}] ${label}: `, emissionUnit(value));
    }
    return buildPatientInsightExtractionPlan(emissionPlan(parts));
}
function supportedInsight(value: PatientInsightExtraction, sourceCount: number): boolean {
    const claims = [value.summary, ...value.data.currentState, ...value.data.alerts, ...value.data.nextSteps, ...value.data.gaps].filter(Boolean);
    return claims.length > 0 && claims.every((claim) => {
        const groups = claim.match(/\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]/gu) ?? [];
        if (groups.length === 0) return false;
        return groups.flatMap((group) => group.slice(1, -1).split(',').map((token) => token.trim())).every((label) => {
            if (label === 'DATI-INCOMPLETI') return true;
            const source = Number(label.slice(1));
            return /^S\d+$/u.test(label) && Number.isSafeInteger(source) && source >= 1 && source <= sourceCount;
        });
    });
}
function register(functionId: OrdinaryTaskFunctionId, input: unknown, prompt: string, plan: EmissionPlan, parseOutput: (text: string) => OrdinaryTaskOutput): OrdinaryTaskProfile {
    if (typeof prompt !== 'string' || prompt.length === 0 || renderEmissionPlan(plan) !== prompt) return reject('ordinary_task_input_invalid');
    const token = Object.freeze(Object.create(null));
    const stored = Object.freeze({ functionId, profileVersion: ORDINARY_PROFILE_VERSION, emissionPlan: plan, prompt, outputSchema: strictSchema(schemas[functionId]), inputSha256: digest(input),
        parseOutput(text: string) {
            if (scanJsonObject(text) === null) return reject('ordinary_task_output_invalid');
            try { return parseOutput(text); } catch { return reject('ordinary_task_output_invalid'); }
        } });
    profiles.set(token, stored);
    return token;
}

/** Builds the fixed Patient Insight formatter/parser profile; it carries no admission or authority. */
export function createPatientInsightOrdinaryTaskProfile(input: PatientInsightProjection): OrdinaryTaskProfile {
    const snapshot = clone(input) as PatientInsightProjection;
    if (!validPatientInsightInput(snapshot)) return reject('ordinary_task_input_invalid');
    const sourceCount = 1 + snapshot.activeConditions.length + snapshot.currentTherapies.length + snapshot.recentClinicalEvents.length;
    const plan = insightPlan(snapshot);
    return register('patient_insight', snapshot, renderEmissionPlan(plan), plan, (text) => { const parsed = parsePatientInsightExtractionResponse(text); if (!isEnvelopeUsable(parsed) || !supportedInsight(parsed.value, sourceCount)) return reject('ordinary_task_output_invalid'); return parsed.value; });
}

/** Builds the fixed Smart Import formatter/parser profile from an already owner-acquired projection. */
export function createSmartImportOrdinaryTaskProfile(input: Readonly<{ projection: SmartImportProjection; generatedAt: string }>): OrdinaryTaskProfile {
    const inert = clone(input);
    const fields = exact(inert, ['projection', 'generatedAt']);
    if (!fields || typeof fields.generatedAt !== 'string') return reject('ordinary_task_input_invalid');
    let snapshot: Readonly<{ projection: SmartImportProjection; generatedAt: string }>;
    try { snapshot = Object.freeze({ projection: snapshotSmartImportProjection(fields.projection, fields.generatedAt), generatedAt: fields.generatedAt }); }
    catch { return reject('ordinary_task_input_invalid'); }
    return register('smart_import', snapshot, buildPatientSmartImportCapabilityPrompt(snapshot.projection), buildPatientSmartImportCapabilityPlan(snapshot.projection), (text) => { try { return parsePatientSmartImportCapabilityProposal(JSON.stringify(canonicalOptionals(JSON.parse(text), schemas.smart_import)), snapshot.projection, snapshot.generatedAt); } catch { return reject('ordinary_task_output_invalid'); } });
}

/** Captured source-set identity is a content binding, never session admission. */
export function createDocumentSynthesisOrdinaryTaskProfile(sourceSet: unknown): OrdinaryTaskProfile {
    const projection = composeDocumentSynthesisProviderProjection(sourceSet);
    const built = buildDocumentSynthesisMultiSourcePrompt(sourceSet);
    const plan = buildDocumentSynthesisMultiSourcePlan(sourceSet);
    if (!projection || !plan || built.status !== 'available') return reject('ordinary_task_input_invalid');
    return register('document_synthesis', projection, built.prompt, plan, (text) => {
        // First parse preserves the canonical duplicate-key and bounded-input checks.
        const parsed = parseDocumentSynthesisProviderEnvelope({ content: text });
        if (parsed.status !== 'available') return reject('ordinary_task_output_invalid');
        const envelope = resolveDocumentSynthesisProviderEnvelope(parsed.token);
        const normalized = canonicalOptionals(envelope, schemas.document_synthesis);
        const canonical = parseDocumentSynthesisProviderEnvelope({ content: JSON.stringify(normalized) });
        if (canonical.status !== 'available') return reject('ordinary_task_output_invalid');
        const bound = bindDocumentSynthesisProviderEnvelope({ sourceSet, envelopeToken: canonical.token });
        if (bound.status !== 'available') return reject('ordinary_task_output_invalid');
        documentEnvelopes.set(bound, canonical.token);
        return bound;
    });
}

/** Fixed remote prompt and source-bound content; no execution attestation. */
export function createTreatmentReasoningOrdinaryTaskProfile(input: TreatmentReasoningPromptInput): OrdinaryTaskProfile {
    const snapshot = clone(input) as TreatmentReasoningPromptInput;
    try {
        if (!validTreatmentInput(snapshot)) return reject('ordinary_task_input_invalid');
        const allowedEvidenceRefs = snapshot.sources.map(source => source.id);
        const contract = createTreatmentReasoningChatGptOutputContract({ allowedEvidenceRefs });
        const prompt = buildChatGptTreatmentReasoningPrompt(snapshot);
        return register('treatment_reasoning', snapshot, prompt, buildChatGptTreatmentReasoningPlan(snapshot), (text) => {
            let value: unknown;
            try { value = JSON.parse(text); } catch { return reject('ordinary_task_output_invalid'); }
            const result = contract.normalize(value);
            return result.status === 'accepted' ? result : reject('ordinary_task_output_invalid');
        });
    } catch { return reject('ordinary_task_input_invalid'); }
}

/** Resolves only a same-module registered opaque profile and returns immutable content details. */
export function readOrdinaryTaskProfile(profile: unknown): OrdinaryTaskProfileRead {
    try { if (!profile || typeof profile !== 'object' || types.isProxy(profile)) return reject('ordinary_task_profile_invalid'); const stored = profiles.get(profile); return stored ?? reject('ordinary_task_profile_invalid'); } catch { return reject('ordinary_task_profile_invalid'); }
}

/** Fixed profile path classification. Labels/IDs/policies are never rehydrated. */
export function ordinaryTextPath(profile: OrdinaryTaskProfile, path: readonly (string | number)[]): boolean {
    const read = readOrdinaryTaskProfile(profile);
    const last = path[path.length - 1];
    if (['sourceId', 'id', 'claimPath', 'mode'].includes(String(last)) || path.includes('evidenceRefs') || path.includes('toolsUsed')) return false;
    if (read.functionId === 'document_synthesis' && (path[0] === 'claims' || path[0] === 'citations' && last !== 'quote')) return false;
    let schema: Readonly<Record<string, unknown>> | undefined = schemas[read.functionId];
    for (const step of path) {
        if (!schema) return false;
        if (typeof step === 'number') schema = schema.type === 'array' ? schema.items as typeof schema : undefined;
        else {
            const properties = schema.properties as Record<string, typeof schema> | undefined;
            schema = schema.type === 'object' && properties && Object.hasOwn(properties, step) ? properties[step] : undefined;
        }
    }
    return schema?.type === 'string' && schema.enum === undefined && schema.const === undefined;
}

/** Checks canonical text bounds before legacy parsers can normalize/truncate them. */
export function ordinaryCanonicalTextBounds(profile: OrdinaryTaskProfile, value: unknown): boolean {
    const root = schemas[readOrdinaryTaskProfile(profile).functionId];
    function check(value: unknown, schema: Readonly<Record<string, unknown>>): boolean {
        if (typeof value === 'string') return typeof schema.maxLength !== 'number' || value.length <= schema.maxLength;
        if (Array.isArray(value) && schema.type === 'array') return value.every(item => check(item, schema.items as Readonly<Record<string, unknown>>));
        if (value && typeof value === 'object' && schema.type === 'object') {
            const properties = schema.properties as Record<string, Readonly<Record<string, unknown>>>;
            return Object.entries(value).every(([key, child]) => !Object.hasOwn(properties, key) || check(child, properties[key]));
        }
        return true;
    }
    return check(value, root);
}

/** Same-module token from canonical parsing, never reconstructed from a DTO. */
export function readOrdinaryDocumentEnvelope(output: unknown): object | null {
    return output && typeof output === 'object' && !types.isProxy(output) ? documentEnvelopes.get(output) ?? null : null;
}
