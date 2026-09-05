/* @Codex */
import type { PatientInsightCanonicalHostSources } from './patient-insight-host-projection';

export type PatientInsightPreviewRequest = Readonly<{
    schemaVersion: 'mediflow.patient-insight.preview-request.v1';
    requestId: string;
    patientId: string;
    ambulatoryId: string;
    patientRevision: number;
    capturedAt: string;
    sources: PatientInsightCanonicalHostSources;
}>;

export type PatientInsightProposalCurrentness = Readonly<{
    selectionEpoch: number;
    patientRevision: number;
    projectionDigest: string;
    capturedAt: string;
    verifiedAt: string;
}>;

export type PatientInsightReviewProposal = Readonly<{
    schemaVersion: 'mediflow.patient-insight.review-proposal.v2';
    reviewOnly: true;
    summary: string;
    currentState: readonly string[];
    alerts: readonly string[];
    nextSteps: readonly string[];
    gaps: readonly string[];
    generatedAt: string;
    currentness: PatientInsightProposalCurrentness;
}>;

export type PatientInsightReceiptWire = Readonly<{
    schemaVersion: 'mediflow.ai.fabric-resolution.v1';
    capability: 'patient_insight';
    venue: 'local_process';
    provider: 'ollama';
    model: string;
    egress: 'none';
}>;

export type PatientInsightProvenanceWire = Readonly<{
    schemaVersion: 'mediflow.ai.fabric-provenance.v1';
    capability: 'patient_insight';
    venue: 'local_process';
    provider: 'ollama';
    model: string;
    preprocessing: readonly ['context_minimization', 'envelope_validation'];
}>;

export type PatientInsightDenialCode =
    | 'input_invalid' | 'kill_switch_disabled' | 'kill_switch_unavailable' | 'projection_unavailable'
    | 'source_stale' | 'lifecycle_missing' | 'lifecycle_corrupt' | 'lifecycle_unavailable'
    | 'provider_binding_denied' | 'provider_unready' | 'model_unavailable' | 'fabric_denied' | 'source_invalid';
export type PatientInsightFailureCode = 'provider_failed' | 'proposal_invalid' | 'source_stale';
type Common = Readonly<{ writesPerformed: 0; apply: 'denied' }>;
export type PatientInsightPreviewWire =
    | (Common & Readonly<{ status: 'available'; code: null; proposal: PatientInsightReviewProposal; receipt: PatientInsightReceiptWire; provenance: PatientInsightProvenanceWire; reviewRef: string }>)
    | (Common & Readonly<{ status: 'denied'; code: PatientInsightDenialCode; proposal: null; receipt: null; provenance: null; reviewRef: null }>)
    | (Common & Readonly<{ status: 'failed'; code: PatientInsightFailureCode; proposal: null; receipt: PatientInsightReceiptWire; provenance: PatientInsightProvenanceWire; reviewRef: null }>);
export type PatientInsightPreviewWireRoot = Readonly<{ preview: PatientInsightPreviewWire }>;

type CaptureInput = Readonly<{
    patient: Readonly<{ id?: string; ambulatoryId?: string; version?: number; diagnoses?: readonly Readonly<{ code?: string; description?: string }>[] }>;
    therapies: readonly Readonly<{ drugName?: string; dosage?: string; status?: string }>[];
    entries: readonly Readonly<{ title?: string; content?: string }>[];
    requestId: string;
    capturedAt: string;
}>;

const REQUEST_ID = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const DIGEST = /^sha256_[0-9a-f]{64}$/u;
const REVIEW_REF = /^review_[0-9a-f]{32}$/u;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,127}$/u;
const DENIAL_CODES: readonly PatientInsightDenialCode[] = ['input_invalid', 'kill_switch_disabled', 'kill_switch_unavailable', 'projection_unavailable', 'source_stale', 'lifecycle_missing', 'lifecycle_corrupt', 'lifecycle_unavailable', 'provider_binding_denied', 'provider_unready', 'model_unavailable', 'fabric_denied', 'source_invalid'];
const FAILURE_CODES: readonly PatientInsightFailureCode[] = ['provider_failed', 'proposal_invalid', 'source_stale'];

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = {};
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor?.enumerable || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function iso(value: unknown): string | null {
    return typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value ? value : null;
}

function boundedText(value: unknown, max = 240): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized ? normalized.slice(0, max).trim() : null;
}

function wireText(value: unknown, max = 1_200): string | null {
    return typeof value === 'string' && value.length <= max && value.trim() === value ? value : null;
}

function itemArray(value: unknown, key: 'label' | 'summary'): readonly Readonly<Record<'label' | 'summary', string>>[] | null {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 12
            || Reflect.ownKeys(value).length !== value.length + 1) return null;
        const output: Readonly<Record<'label' | 'summary', string>>[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            const record = descriptor && 'value' in descriptor ? exact(descriptor.value, [key]) : null;
            const text = record && boundedText(record[key]);
            if (!text) return null;
            output.push(Object.freeze({ [key]: text }) as Readonly<Record<'label' | 'summary', string>>);
        }
        return Object.freeze(output);
    } catch { return null; }
}

function sources(value: unknown): PatientInsightCanonicalHostSources | null {
    const input = exact(value, ['focus', 'conditions', 'activeTherapies', 'recentEvents']);
    const focus = input && exact(input.focus, ['summary']);
    const summary = focus && boundedText(focus.summary);
    const conditions = input && itemArray(input.conditions, 'label');
    const therapies = input && itemArray(input.activeTherapies, 'label');
    const events = input && itemArray(input.recentEvents, 'summary');
    if (!input || !summary || !conditions || !therapies || !events) return null;
    return Object.freeze({
        focus: Object.freeze({ summary }),
        conditions: conditions as readonly Readonly<{ label: string }>[] ,
        activeTherapies: therapies as readonly Readonly<{ label: string }>[] ,
        recentEvents: events as readonly Readonly<{ summary: string }>[] ,
    });
}

function labels(values: readonly unknown[], render: (value: Record<string, unknown>) => string | null): readonly Readonly<{ label: string }>[] {
    const output: Readonly<{ label: string }>[] = [];
    for (const value of values) {
        if (output.length >= 12 || !value || typeof value !== 'object' || Array.isArray(value)) break;
        const label = render(value as Record<string, unknown>);
        if (label) output.push(Object.freeze({ label }));
    }
    return Object.freeze(output);
}

/** Browser-side minimization for an explicit, manual Patient Insight request. */
export function buildPatientInsightPreviewRequest(input: CaptureInput): PatientInsightPreviewRequest {
    const patientId = typeof input.patient.id === 'string' && ENTITY_ID.test(input.patient.id) ? input.patient.id : null;
    const ambulatoryId = typeof input.patient.ambulatoryId === 'string' && ENTITY_ID.test(input.patient.ambulatoryId) ? input.patient.ambulatoryId : null;
    if (!patientId || !ambulatoryId || !Number.isSafeInteger(input.patient.version) || (input.patient.version as number) < 1
        || !REQUEST_ID.test(input.requestId) || !iso(input.capturedAt)) throw new Error('Patient Insight preview input is unavailable.');
    const conditions = labels(input.patient.diagnoses ?? [], (value) => {
        const description = boundedText(value.description, 200); const code = boundedText(value.code, 32);
        return description ? boundedText(`${description}${code ? ` (${code})` : ''}`) : null;
    });
    const activeTherapies = labels(input.therapies.filter((item) => item.status === 'active'), (value) => {
        const drug = boundedText(value.drugName, 160); const dosage = boundedText(value.dosage, 72);
        return drug ? boundedText(`${drug}${dosage ? ` — ${dosage}` : ''}`) : null;
    });
    const recentEvents = Object.freeze(input.entries.slice(0, 12).flatMap((value) => {
        const title = boundedText(value.title, 96); const content = boundedText(value.content, 220);
        const summary = title || content ? boundedText(`${title ?? 'Evento clinico'}${content ? `: ${content}` : ''}`) : null;
        return summary ? [Object.freeze({ summary })] : [];
    }));
    return Object.freeze({
        schemaVersion: 'mediflow.patient-insight.preview-request.v1', requestId: input.requestId,
        patientId, ambulatoryId, patientRevision: input.patient.version as number, capturedAt: input.capturedAt,
        sources: Object.freeze({
            focus: Object.freeze({ summary: 'Valutazione manuale del follow-up clinico attuale' }),
            conditions, activeTherapies, recentEvents,
        }),
    });
}

export function parsePatientInsightPreviewRequest(value: unknown): PatientInsightPreviewRequest | null {
    const input = exact(value, ['schemaVersion', 'requestId', 'patientId', 'ambulatoryId', 'patientRevision', 'capturedAt', 'sources']);
    const parsedSources = input && sources(input.sources);
    const capturedAt = input && iso(input.capturedAt);
    if (!input || !parsedSources || input.schemaVersion !== 'mediflow.patient-insight.preview-request.v1'
        || typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)
        || typeof input.patientId !== 'string' || !ENTITY_ID.test(input.patientId)
        || typeof input.ambulatoryId !== 'string' || !ENTITY_ID.test(input.ambulatoryId)
        || !Number.isSafeInteger(input.patientRevision) || (input.patientRevision as number) < 1 || !capturedAt) return null;
    return Object.freeze({ schemaVersion: 'mediflow.patient-insight.preview-request.v1', requestId: input.requestId,
        patientId: input.patientId, ambulatoryId: input.ambulatoryId, patientRevision: input.patientRevision as number,
        capturedAt, sources: parsedSources });
}

function stringArray(value: unknown, maxItems: number): readonly string[] | null {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxItems
            || Reflect.ownKeys(value).length !== value.length + 1) return null;
        const output: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            const text = descriptor && 'value' in descriptor ? wireText(descriptor.value) : null;
            if (!text) return null;
            output.push(text);
        }
        return Object.freeze(output);
    } catch { return null; }
}

function currentness(value: unknown): PatientInsightProposalCurrentness | null {
    const input = exact(value, ['selectionEpoch', 'patientRevision', 'projectionDigest', 'capturedAt', 'verifiedAt']);
    const capturedAt = input && iso(input.capturedAt); const verifiedAt = input && iso(input.verifiedAt);
    return !input || !Number.isSafeInteger(input.selectionEpoch) || (input.selectionEpoch as number) < 1
        || !Number.isSafeInteger(input.patientRevision) || (input.patientRevision as number) < 1
        || typeof input.projectionDigest !== 'string' || !DIGEST.test(input.projectionDigest) || !capturedAt || !verifiedAt
        ? null : Object.freeze({ selectionEpoch: input.selectionEpoch as number, patientRevision: input.patientRevision as number,
            projectionDigest: input.projectionDigest, capturedAt, verifiedAt });
}

function proposal(value: unknown): PatientInsightReviewProposal | null {
    const input = exact(value, ['schemaVersion', 'reviewOnly', 'summary', 'currentState', 'alerts', 'nextSteps', 'gaps', 'generatedAt', 'currentness']);
    const summary = input && wireText(input.summary); const currentState = input && stringArray(input.currentState, 2);
    const alerts = input && stringArray(input.alerts, 2); const nextSteps = input && stringArray(input.nextSteps, 3);
    const gaps = input && stringArray(input.gaps, 1); const generatedAt = input && iso(input.generatedAt);
    const fresh = input && currentness(input.currentness);
    if (!input || input.schemaVersion !== 'mediflow.patient-insight.review-proposal.v2' || input.reviewOnly !== true
        || summary === null || !currentState || !alerts || !nextSteps || !gaps || !generatedAt || !fresh
        || !(summary || currentState.length || alerts.length || nextSteps.length || gaps.length)) return null;
    return Object.freeze({ schemaVersion: 'mediflow.patient-insight.review-proposal.v2', reviewOnly: true, summary,
        currentState, alerts, nextSteps, gaps, generatedAt, currentness: fresh });
}

function receipt(value: unknown): PatientInsightReceiptWire | null {
    const input = exact(value, ['schemaVersion', 'capability', 'class', 'venue', 'egressProfile', 'provider', 'model', 'providerReceipt', 'fallbackCount']);
    const profile = input && exact(input.egressProfile, ['id', 'version', 'egress']);
    const providerReceipt = input && exact(input.providerReceipt, ['schemaVersion', 'authorityPlane', 'task', 'provider', 'model', 'execution', 'endpointClass', 'egress', 'runtimeReadiness', 'fallbackCount']);
    if (!input || !profile || !providerReceipt || input.schemaVersion !== 'mediflow.ai.fabric-resolution.v1' || input.capability !== 'patient_insight'
        || input.class !== 'generative' || input.venue !== 'local_process' || input.provider !== 'ollama' || typeof input.model !== 'string' || !MODEL.test(input.model)
        || input.fallbackCount !== 0 || profile.id !== 'local_only' || profile.version !== 'mediflow.ai.egress-profile.v1' || profile.egress !== 'none'
        || providerReceipt.schemaVersion !== 'mediflow.ai.provider-selection.v1' || providerReceipt.authorityPlane !== 'clinical_application'
        || providerReceipt.task !== 'clinical' || providerReceipt.provider !== 'ollama' || providerReceipt.model !== input.model
        || providerReceipt.execution !== 'local' || providerReceipt.endpointClass !== 'loopback' || providerReceipt.egress !== 'none'
        || providerReceipt.runtimeReadiness !== 'required' || providerReceipt.fallbackCount !== 0) return null;
    return Object.freeze({ schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'patient_insight', venue: 'local_process',
        provider: 'ollama', model: input.model, egress: 'none' });
}

function receiptWire(value: unknown): PatientInsightReceiptWire | null {
    const input = exact(value, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'egress']);
    return !input || input.schemaVersion !== 'mediflow.ai.fabric-resolution.v1' || input.capability !== 'patient_insight'
        || input.venue !== 'local_process' || input.provider !== 'ollama' || typeof input.model !== 'string' || !MODEL.test(input.model)
        || input.egress !== 'none' ? null : Object.freeze({ schemaVersion: 'mediflow.ai.fabric-resolution.v1', capability: 'patient_insight',
            venue: 'local_process', provider: 'ollama', model: input.model, egress: 'none' });
}

function provenance(value: unknown, expected: PatientInsightReceiptWire): PatientInsightProvenanceWire | null {
    const input = exact(value, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'preprocessing', 'receipt']);
    const labels = input && stringArray(input.preprocessing, 2);
    const nested = input && receipt(input.receipt);
    return !input || !labels || labels.length !== 2 || labels[0] !== 'context_minimization' || labels[1] !== 'envelope_validation'
        || !nested || nested.model !== expected.model || input.schemaVersion !== 'mediflow.ai.fabric-provenance.v1'
        || input.capability !== 'patient_insight' || input.venue !== 'local_process' || input.provider !== 'ollama' || input.model !== expected.model
        ? null : Object.freeze({ schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'patient_insight', venue: 'local_process',
            provider: 'ollama', model: expected.model, preprocessing: Object.freeze(['context_minimization', 'envelope_validation'] as const) });
}

function provenanceWire(value: unknown, expected: PatientInsightReceiptWire): PatientInsightProvenanceWire | null {
    const input = exact(value, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'preprocessing']);
    const labels = input && stringArray(input.preprocessing, 2);
    return !input || !labels || labels[0] !== 'context_minimization' || labels[1] !== 'envelope_validation'
        || input.schemaVersion !== 'mediflow.ai.fabric-provenance.v1' || input.capability !== 'patient_insight'
        || input.venue !== 'local_process' || input.provider !== 'ollama' || input.model !== expected.model
        ? null : Object.freeze({ schemaVersion: 'mediflow.ai.fabric-provenance.v1', capability: 'patient_insight', venue: 'local_process',
            provider: 'ollama', model: expected.model, preprocessing: Object.freeze(['context_minimization', 'envelope_validation'] as const) });
}

function statusCode<T extends string>(value: unknown, allowed: readonly T[]): T | null {
    return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}

function preview(value: unknown, mode: 'host' | 'wire'): PatientInsightPreviewWire | null {
    const input = exact(value, ['writesPerformed', 'apply', 'status', 'code', 'proposal', 'receipt', 'provenance', 'reviewRef']);
    if (!input || input.writesPerformed !== 0 || input.apply !== 'denied') return null;
    if (input.status === 'denied') {
        const code = statusCode(input.code, DENIAL_CODES);
        return !code || input.proposal !== null || input.receipt !== null || input.provenance !== null || input.reviewRef !== null ? null
            : Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'denied', code, proposal: null, receipt: null, provenance: null, reviewRef: null });
    }
    const fabricReceipt = mode === 'host' ? receipt(input.receipt) : receiptWire(input.receipt);
    const fabricProvenance = fabricReceipt && (mode === 'host' ? provenance(input.provenance, fabricReceipt) : provenanceWire(input.provenance, fabricReceipt));
    if (!fabricReceipt || !fabricProvenance) return null;
    if (input.status === 'failed') {
        const code = statusCode(input.code, FAILURE_CODES);
        return !code || input.proposal !== null || input.reviewRef !== null ? null
            : Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'failed', code, proposal: null, receipt: fabricReceipt, provenance: fabricProvenance, reviewRef: null });
    }
    const parsedProposal = proposal(input.proposal);
    return input.status !== 'available' || input.code !== null || !parsedProposal || typeof input.reviewRef !== 'string' || !REVIEW_REF.test(input.reviewRef)
        ? null : Object.freeze({ writesPerformed: 0, apply: 'denied', status: 'available', code: null, proposal: parsedProposal,
            receipt: fabricReceipt, provenance: fabricProvenance, reviewRef: input.reviewRef });
}

function root(value: unknown, mode: 'host' | 'wire'): PatientInsightPreviewWireRoot | null {
    const input = exact(value, ['preview']); const parsed = input && preview(input.preview, mode);
    return parsed ? Object.freeze({ preview: parsed }) : null;
}

export function serializePatientInsightPreviewWireRoot(value: unknown): PatientInsightPreviewWireRoot | null { return root(value, 'host'); }
export function parsePatientInsightPreviewWireRoot(value: unknown): PatientInsightPreviewWireRoot | null { return root(value, 'wire'); }
