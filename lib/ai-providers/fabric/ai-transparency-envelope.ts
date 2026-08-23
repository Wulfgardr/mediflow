/* @Codex */
import { CLINICAL_REVIEW_STATES, type ClinicalReviewState } from './clinical-interaction';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './catalog';
import {
    FABRIC_PREPROCESSING_LABELS,
    type FabricCapabilityId,
    type FabricProvenanceRecord,
    type FabricProviderRef,
    type FabricResolutionReceipt,
    type FabricVenue,
} from './contract';

export const AI_TRANSPARENCY_ENVELOPE_SCHEMA_VERSION =
    'mediflow.ai.transparency-envelope.v1' as const;

export type AiTransparencyEnvelope = Readonly<{
    schemaVersion: typeof AI_TRANSPARENCY_ENVELOPE_SCHEMA_VERSION;
    disclosure: 'ai_generated_review_only';
    claimCeiling: 'ai_act_informed_technical_contract_candidate';
    capability: FabricCapabilityId;
    provider: FabricProviderRef;
    model: string | null;
    venue: FabricVenue;
    egress: 'none';
    generatedAt: string;
    reviewState: ClinicalReviewState;
    applyPolicy: 'none';
    writesPerformed: 0;
    provenance: FabricProvenanceRecord;
}>;

export class AiTransparencyEnvelopeError extends Error {
    readonly code = 'invalid_envelope' as const;

    constructor() {
        super('AI transparency envelope rejected: invalid_envelope');
        this.name = 'AiTransparencyEnvelopeError';
    }
}

const PROVIDERS = new Set<FabricProviderRef>(['ollama', 'athena_mlx', 'in_house']);
const PREPROCESSING = new Set<string>(FABRIC_PREPROCESSING_LABELS);
const REVIEW_STATES = new Set<string>(CLINICAL_REVIEW_STATES);
const OLLAMA_TASKS = new Set(['clinical', 'reasoning', 'ocr']);
const OLLAMA_TASK_BY_CAPABILITY: Readonly<Partial<Record<FabricCapabilityId, string>>> = Object.freeze({
    patient_insight: 'clinical', smart_import: 'clinical', document_synthesis: 'reasoning', ocr: 'ocr',
});
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function closedRecord(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length || !keys.every((key) => typeof key === 'string' && expected.includes(key))) return null;
    const snapshot: Record<string, unknown> = {};
    for (const key of expected) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

function closedArray(value: unknown): unknown[] | null {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
        snapshot.push(descriptor.value);
    }
    return snapshot;
}

function validTimestamp(value: unknown): value is string {
    return typeof value === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && !Number.isNaN(Date.parse(value))
        && new Date(value).toISOString() === value;
}

function expectedProvider(capability: FabricCapabilityId): FabricProviderRef {
    if (FABRIC_CAPABILITY_DESCRIPTORS[capability].class === 'deterministic') return 'in_house';
    return capability === 'treatment_reasoning' ? 'athena_mlx' : 'ollama';
}

function snapshotReceipt(value: unknown, capability: FabricCapabilityId): FabricResolutionReceipt | null {
    const receipt = closedRecord(value, ['schemaVersion', 'capability', 'class', 'venue', 'egressProfile', 'provider', 'model', 'providerReceipt', 'fallbackCount']);
    if (!receipt || receipt.schemaVersion !== 'mediflow.ai.fabric-resolution.v1' || receipt.capability !== capability || receipt.fallbackCount !== 0) return null;
    const descriptor = FABRIC_CAPABILITY_DESCRIPTORS[capability];
    if (receipt.class !== descriptor.class || receipt.provider !== expectedProvider(capability) || !PROVIDERS.has(receipt.provider as FabricProviderRef)) return null;
    if (typeof receipt.venue !== 'string' || !descriptor.venues.includes(receipt.venue as FabricVenue) || receipt.model !== null && (typeof receipt.model !== 'string' || !MODEL_PATTERN.test(receipt.model))) return null;
    if ((receipt.provider === 'ollama') !== (typeof receipt.model === 'string')) return null;
    const profile = closedRecord(receipt.egressProfile, ['id', 'version', 'egress']);
    if (!profile || profile.id !== 'local_only' || profile.version !== 'mediflow.ai.egress-profile.v1' || profile.egress !== 'none') return null;
    if (receipt.provider !== 'ollama') return receipt.providerReceipt === null ? Object.freeze({ ...receipt, egressProfile: Object.freeze(profile) }) as FabricResolutionReceipt : null;
    const providerReceipt = closedRecord(receipt.providerReceipt, ['schemaVersion', 'authorityPlane', 'task', 'provider', 'model', 'execution', 'endpointClass', 'egress', 'runtimeReadiness', 'fallbackCount']);
    if (!providerReceipt || providerReceipt.schemaVersion !== 'mediflow.ai.provider-selection.v1' || providerReceipt.authorityPlane !== 'clinical_application' || !OLLAMA_TASKS.has(providerReceipt.task as string) || providerReceipt.task !== OLLAMA_TASK_BY_CAPABILITY[capability] || providerReceipt.provider !== 'ollama' || providerReceipt.model !== receipt.model || providerReceipt.execution !== 'local' || providerReceipt.endpointClass !== 'loopback' || providerReceipt.egress !== 'none' || providerReceipt.runtimeReadiness !== 'required' || providerReceipt.fallbackCount !== 0) return null;
    return Object.freeze({ ...receipt, egressProfile: Object.freeze(profile), providerReceipt: Object.freeze(providerReceipt) }) as unknown as FabricResolutionReceipt;
}

function snapshotProvenance(value: unknown, capability: FabricCapabilityId): FabricProvenanceRecord | null {
    const provenance = closedRecord(value, ['schemaVersion', 'capability', 'venue', 'provider', 'model', 'preprocessing', 'receipt']);
    if (!provenance || provenance.schemaVersion !== 'mediflow.ai.fabric-provenance.v1' || provenance.capability !== capability) return null;
    const labels = closedArray(provenance.preprocessing);
    const receipt = snapshotReceipt(provenance.receipt, capability);
    if (!labels || labels.length === 0 || labels.some((label) => typeof label !== 'string' || !PREPROCESSING.has(label)) || new Set(labels).size !== labels.length || !receipt || provenance.venue !== receipt.venue || provenance.provider !== receipt.provider || provenance.model !== receipt.model) return null;
    return Object.freeze({ ...provenance, preprocessing: Object.freeze([...labels]), receipt }) as FabricProvenanceRecord;
}

export function createAiTransparencyEnvelope(value: unknown): AiTransparencyEnvelope {
    const envelope = closedRecord(value, ['schemaVersion', 'disclosure', 'claimCeiling', 'capability', 'provider', 'model', 'venue', 'egress', 'generatedAt', 'reviewState', 'applyPolicy', 'writesPerformed', 'provenance']);
    const capability = typeof envelope?.capability === 'string' && Object.hasOwn(FABRIC_CAPABILITY_DESCRIPTORS, envelope.capability)
        ? envelope.capability as FabricCapabilityId : null;
    const provenance = capability ? snapshotProvenance(envelope?.provenance, capability) : null;
    if (!envelope || !capability || envelope.schemaVersion !== AI_TRANSPARENCY_ENVELOPE_SCHEMA_VERSION || envelope.disclosure !== 'ai_generated_review_only' || envelope.claimCeiling !== 'ai_act_informed_technical_contract_candidate' || envelope.provider !== expectedProvider(capability) || envelope.model !== provenance?.model || envelope.venue !== provenance?.venue || envelope.egress !== 'none' || !validTimestamp(envelope.generatedAt) || !REVIEW_STATES.has(envelope.reviewState as string) || envelope.applyPolicy !== 'none' || envelope.writesPerformed !== 0 || !provenance) throw new AiTransparencyEnvelopeError();
    return Object.freeze({ ...envelope, capability, provider: provenance.provider, model: provenance.model, venue: provenance.venue, generatedAt: envelope.generatedAt as string, reviewState: envelope.reviewState as ClinicalReviewState, provenance }) as AiTransparencyEnvelope;
}
