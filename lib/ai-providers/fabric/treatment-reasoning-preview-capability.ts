import 'server-only';

/* @Codex */
import { types } from 'node:util';

import { createTreatmentReasoningAthenaAdmission } from './treatment-reasoning-athena-admission';
import { buildTreatmentReasoningReviewProposal } from './treatment-reasoning-host-boundary';
import { snapshotProviderLifecycle } from './provider-lifecycle';

export const TREATMENT_REASONING_PREVIEW_ENVELOPE_SCHEMA = 'mediflow.ai.treatment-reasoning-preview-envelope.v1' as const;
type Admission = ReturnType<typeof createTreatmentReasoningAthenaAdmission>;
type DenialCode = 'lifecycle_invalid' | 'lifecycle_not_available' | 'lifecycle_unavailable';
type LifecycleGate = 'available' | 'invalid' | 'not_available' | 'unavailable';
export type TreatmentReasoningPreviewCapabilityResult = Readonly<{ status: 'admitted'; code: null; preview: Readonly<{ schema: typeof TREATMENT_REASONING_PREVIEW_ENVELOPE_SCHEMA; capability: 'treatment_reasoning'; stage: 'preview'; review: 'required'; uncertainty: Readonly<{ level: 'low'; source: 'degraded_default' }>; evidence: Readonly<{ source: 'host_minimized'; count: number }>; provenanceRef: string; receiptRef: string }>; writesPerformed: 0; applyPolicy: 'none' }> | Readonly<{ status: 'denied'; code: DenialCode; preview: null; writesPerformed: 0; applyPolicy: 'none' }>;

export class TreatmentReasoningPreviewCapabilityConfigurationError extends Error {
    constructor() { super('Treatment reasoning preview capability configuration rejected'); this.name = 'TreatmentReasoningPreviewCapabilityConfigurationError'; }
}

const COMMON = Object.freeze({ writesPerformed: 0 as const, applyPolicy: 'none' as const });
const ACTOR = /^actor_[0-9a-f]{32,64}$/u;
const RECEIPT = /^receipt_[0-9a-f]{32,64}$/u;

function record(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (!expected.every((key) => descriptors[key]?.enumerable && 'value' in descriptors[key])) return null;
        return value as Record<string, unknown>;
    } catch { return null; }
}

function lifecycleGate(value: unknown): LifecycleGate {
    const response = record(value, ['status', 'record']) ?? record(value, ['status', 'reason']);
    if (!response) return 'invalid';
    if (response.status === 'denied') return response.reason === 'missing' || response.reason === 'corrupt' || response.reason === 'unavailable' ? 'unavailable' : 'invalid';
    if (response.status !== 'available') return 'invalid';
    const envelope = record(response.record, ['schemaVersion', 'lifecycle', 'actorClass', 'actorRef', 'version', 'hostTimestamp', 'receiptRef']);
    const state = envelope && record(envelope.lifecycle, ['schemaVersion', 'provider', 'credentialClass', 'status']);
    if (!envelope || !state || envelope.schemaVersion !== 'mediflow.ai.provider-lifecycle-record.v1'
        || (envelope.actorClass !== 'physician' && envelope.actorClass !== 'host_service') || typeof envelope.actorRef !== 'string' || !ACTOR.test(envelope.actorRef)
        || !Number.isSafeInteger(envelope.version) || (envelope.version as number) < 1 || typeof envelope.hostTimestamp !== 'string'
        || new Date(envelope.hostTimestamp).toISOString() !== envelope.hostTimestamp || typeof envelope.receiptRef !== 'string' || !RECEIPT.test(envelope.receiptRef)) return 'invalid';
    try {
        const canonical = snapshotProviderLifecycle(Object.freeze({ schemaVersion: state.schemaVersion, provider: state.provider, credentialClass: state.credentialClass, status: state.status }));
        if (canonical.provider !== 'athena_mlx' || canonical.credentialClass !== 'local_model') return 'invalid';
        return canonical.status === 'available_unqualified' ? 'available' : 'not_available';
    } catch { return 'invalid'; }
}

function deny(code: DenialCode): TreatmentReasoningPreviewCapabilityResult {
    return Object.freeze({ status: 'denied' as const, code, preview: null, ...COMMON });
}

function admit(result: Extract<ReturnType<Admission['admit']>, { status: 'admitted' }>): TreatmentReasoningPreviewCapabilityResult {
    const admission = result.admission;
    const preview = Object.freeze({ schema: TREATMENT_REASONING_PREVIEW_ENVELOPE_SCHEMA, capability: admission.capability, stage: admission.stage, review: admission.review, uncertainty: Object.freeze({ ...admission.uncertainty }), evidence: Object.freeze({ ...admission.evidence }), provenanceRef: admission.provenanceRef, receiptRef: admission.receiptRef });
    return Object.freeze({ status: 'admitted' as const, code: null, preview, ...COMMON });
}

/** Server-only, host-fixed, review-only preview. It neither accepts caller input nor invokes a provider. */
export function createTreatmentReasoningPreviewCapability(configuration: unknown): Readonly<{ preview(): TreatmentReasoningPreviewCapabilityResult }> {
    const input = record(configuration, ['proposalHost', 'admissionHost', 'lifecycle']);
    const lifecycle = input && record(input.lifecycle, ['read']);
    const read = lifecycle && Object.getOwnPropertyDescriptor(lifecycle, 'read')?.value;
    if (!input || !lifecycle || typeof read !== 'function' || types.isProxy(read)) throw new TreatmentReasoningPreviewCapabilityConfigurationError();
    let proposal: ReturnType<typeof buildTreatmentReasoningReviewProposal>; let admission: Admission;
    try { proposal = buildTreatmentReasoningReviewProposal(input.proposalHost); admission = createTreatmentReasoningAthenaAdmission(input.admissionHost); } catch { throw new TreatmentReasoningPreviewCapabilityConfigurationError(); }
    const host = Object.freeze({ read: read as () => unknown });
    return Object.freeze({ preview(): TreatmentReasoningPreviewCapabilityResult {
        let gate: LifecycleGate;
        try { gate = lifecycleGate(host.read()); } catch { return deny('lifecycle_unavailable'); }
        if (gate === 'unavailable') return deny('lifecycle_unavailable');
        if (gate === 'not_available') return deny('lifecycle_not_available');
        if (gate === 'invalid') return deny('lifecycle_invalid');
        try { const result = admission.admit(proposal); return result.status === 'admitted' ? admit(result) : deny('lifecycle_invalid'); } catch { return deny('lifecycle_invalid'); }
    } });
}
