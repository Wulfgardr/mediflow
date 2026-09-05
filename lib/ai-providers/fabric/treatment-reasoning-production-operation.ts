import 'server-only';

/* @Codex */
import { types } from 'node:util';

import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity';
import type { FabricExecutionPolicy, FabricProvenanceRecord, FabricResolutionReceipt } from './contract';
import { GENERATIVE_CAPABILITY_DESCRIPTORS } from './generative-catalog';
import { buildProvenanceRecord, resolveFabricCapability } from './resolver';
import { createTreatmentReasoningAthenaExecution, type TreatmentReasoningAthenaExecutionResult } from './treatment-reasoning-athena-execution';
import type { TreatmentReasoningProjectionExecution } from './treatment-reasoning-authenticated-projection';
import { createTreatmentReasoningPreviewCapability, type TreatmentReasoningPreviewCapabilityResult } from './treatment-reasoning-preview-capability';
import type { TreatmentReasoningProjectionAttachment } from './treatment-reasoning-projection';

const descriptor = GENERATIVE_CAPABILITY_DESCRIPTORS.treatment_reasoning;
const HANDLE = /^trp_[0-9a-f]{32}$/u;
const REQUEST = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const EXECUTION_TIMEOUT_MS = 425_000;

type KillSwitchRead = Readonly<{ status: 'enabled' }> | Readonly<{ status: 'denied'; code: 'disabled' | 'unavailable' }>;
type IngestOperation = Readonly<{ ingest(input: unknown): string }>;
type PreviewProjectionOperation = Readonly<{ begin(input: unknown): TreatmentReasoningProjectionExecution }>;
type ProjectionBroker = Readonly<{
    acquireIngest(): Promise<IngestOperation>;
    acquirePreview(): Promise<PreviewProjectionOperation>;
}>;
type Runtime = Readonly<{
    available(): boolean;
    invoke(input: Readonly<{ instruction: string; signal: Readonly<{ isAborted(): boolean }> }>): unknown;
}>;
type Sources = Readonly<{
    projectionBroker: ProjectionBroker;
    killSwitch: Readonly<{ read(): Promise<KillSwitchRead> }>;
    lifecycle: Readonly<{ read(): unknown }>;
    runtime: Runtime;
    entropy(): Uint8Array;
}>;

export type TreatmentReasoningPublication = Readonly<{
    schemaVersion: 'mediflow.ai.treatment-reasoning-publication.v1';
    capability: 'treatment_reasoning';
    stage: 'preview';
    review: 'required';
    status: 'available';
    value: Extract<TreatmentReasoningAthenaExecutionResult, { status: 'completed' }>['value'];
    sourceBindings: Extract<TreatmentReasoningAthenaExecutionResult, { status: 'completed' }>['sourceBindings'];
    attestation: Extract<TreatmentReasoningAthenaExecutionResult, { status: 'completed' }>['attestation'];
    fabricReceipt: FabricResolutionReceipt;
    provenance: FabricProvenanceRecord;
    sourceRevision: string;
    capturedAt: string;
    writesPerformed: 0;
    applyPolicy: 'none';
}>;

export type TreatmentReasoningProductionDenialCode =
    | 'fabric_denied'
    | 'input_invalid'
    | 'lane_disabled'
    | 'lane_unavailable'
    | 'lifecycle_invalid'
    | 'lifecycle_not_available'
    | 'lifecycle_unavailable'
    | 'provider_failed'
    | 'provider_invalid'
    | 'runtime_unavailable'
    | 'source_stale'
    | 'execution_timeout';

export type TreatmentReasoningProductionResult =
    | Readonly<{ status: 'available'; code: null; publication: TreatmentReasoningPublication; writesPerformed: 0; applyPolicy: 'none' }>
    | Readonly<{ status: 'denied'; code: TreatmentReasoningProductionDenialCode; publication: null; writesPerformed: 0; applyPolicy: 'none' }>;

const COMMON = Object.freeze({ writesPerformed: 0 as const, applyPolicy: 'none' as const });

function deny(code: TreatmentReasoningProductionDenialCode): TreatmentReasoningProductionResult {
    return Object.freeze({ status: 'denied' as const, code, publication: null, ...COMMON });
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (typeof value !== 'object' || value === null || Array.isArray(value) || types.isProxy(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || !keys.every((key) => own.includes(key))) return null;
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const item = Object.getOwnPropertyDescriptor(value, key);
            if (!item?.enumerable || !('value' in item)) return null;
            output[key] = item.value;
        }
        return output;
    } catch { return null; }
}

function previewRequest(value: unknown): Readonly<{ handle: string; requestId: string }> | null {
    const input = exact(value, ['handle', 'requestId']);
    return input && typeof input.handle === 'string' && HANDLE.test(input.handle)
        && typeof input.requestId === 'string' && REQUEST.test(input.requestId)
        ? Object.freeze({ handle: input.handle, requestId: input.requestId }) : null;
}

function policy(requestId: string): FabricExecutionPolicy {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.execution-policy.v1', requestId, capability: 'treatment_reasoning',
        authorityPlane: 'clinical_application', operation: descriptor.operation, dataClass: descriptor.dataClass,
        allowedVenues: Object.freeze(['local_process'] as const), egressProfileId: descriptor.egressProfileId,
        consentRef: null, retention: 'not_persisted', review: descriptor.review, provenanceRequired: true, fallback: 'none',
    });
}

function references(entropy: () => Uint8Array): Readonly<{ receiptRef: string; provenanceRef: string }> | null {
    try {
        const bytes = entropy();
        if (!(bytes instanceof Uint8Array) || types.isProxy(bytes) || bytes.byteLength !== 32) return null;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return Object.freeze({ receiptRef: `receipt_${hex.slice(0, 32)}`, provenanceRef: `provenance_${hex.slice(32)}` });
    } catch { return null; }
}

function hostPreview(
    projection: TreatmentReasoningProjectionAttachment,
    refs: Readonly<{ receiptRef: string; provenanceRef: string }>,
    lifecycle: Sources['lifecycle'],
): TreatmentReasoningPreviewCapabilityResult {
    const projectionHost = Object.freeze({
        schema: 'mediflow.ai.treatment-reasoning-projection.v1' as const,
        capability: 'treatment_reasoning' as const,
        stage: 'preview' as const,
        sourceRevision: projection.sourceRevision,
        therapyRefs: projection.therapyRefs,
        evidenceRefs: projection.evidenceRefs,
    });
    const receipt = Object.freeze({
        schema: 'mediflow.ai.treatment-reasoning-host-receipt.v1' as const,
        reference: refs.receiptRef,
        capability: 'treatment_reasoning' as const,
        provider: 'athena_mlx' as const,
        venue: 'local_process' as const,
        egress: 'none' as const,
        fallback: 'denied_by_contract' as const,
    });
    const provenance = Object.freeze({
        schema: 'mediflow.ai.treatment-reasoning-host-provenance.v1' as const,
        reference: refs.provenanceRef,
        capability: 'treatment_reasoning' as const,
        provider: 'athena_mlx' as const,
        receiptRef: refs.receiptRef,
    });
    return createTreatmentReasoningPreviewCapability({
        proposalHost: Object.freeze({ projection: projectionHost, provenanceRef: refs.provenanceRef, receiptRef: refs.receiptRef }),
        admissionHost: Object.freeze({
            readiness: Object.freeze({ provider: 'athena_mlx' as const, locality: 'local_process' as const, status: 'available_unqualified' as const }),
            receipt,
            provenance,
            evidenceRefs: projection.evidenceRefs,
        }),
        lifecycle: Object.freeze({ read: () => lifecycle.read() }),
    }).preview();
}

function publication(
    projection: TreatmentReasoningProjectionAttachment,
    execution: Extract<TreatmentReasoningAthenaExecutionResult, { status: 'completed' }>,
    fabricReceipt: FabricResolutionReceipt,
    provenance: FabricProvenanceRecord,
): TreatmentReasoningPublication {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.treatment-reasoning-publication.v1' as const,
        capability: 'treatment_reasoning' as const,
        stage: 'preview' as const,
        review: 'required' as const,
        status: 'available' as const,
        value: execution.value,
        sourceBindings: execution.sourceBindings,
        attestation: execution.attestation,
        fabricReceipt,
        provenance,
        sourceRevision: projection.sourceRevision,
        capturedAt: projection.capturedAt,
        writesPerformed: 0 as const,
        applyPolicy: 'none' as const,
    });
}

/** Authenticated production composition. It publishes a proposal only after the real host CAS commits. */
export function createTreatmentReasoningProductionService(sources: Sources) {
    return Object.freeze({
        async acquireIngest(): Promise<IngestOperation> {
            return sources.projectionBroker.acquireIngest();
        },
        async acquirePreview(): Promise<Readonly<{ preview(input: unknown): Promise<TreatmentReasoningProductionResult> }>> {
            const operation = await sources.projectionBroker.acquirePreview();
            return Object.freeze({
                async preview(value: unknown): Promise<TreatmentReasoningProductionResult> {
                    const request = previewRequest(value);
                    if (!request) return deny('input_invalid');
                    const lease = operation.begin(value);
                    let committed = false;
                    try {
                        let killSwitch: KillSwitchRead;
                        try { killSwitch = await sources.killSwitch.read(); }
                        catch { return deny('lane_unavailable'); }
                        if (killSwitch.status !== 'enabled') return deny(killSwitch.code === 'disabled' ? 'lane_disabled' : 'lane_unavailable');
                        const refs = references(sources.entropy);
                        if (!refs) return deny('fabric_denied');
                        let resolution: ReturnType<typeof resolveFabricCapability>;
                        let provenance: FabricProvenanceRecord;
                        try {
                            resolution = resolveFabricCapability(policy(request.requestId), { descriptor, venue: 'local_process' });
                            provenance = buildProvenanceRecord(resolution, ['context_minimization', 'envelope_validation']);
                        } catch { return deny('fabric_denied'); }
                        let preview: TreatmentReasoningPreviewCapabilityResult;
                        try { preview = hostPreview(lease.projection, refs, sources.lifecycle); }
                        catch { return deny('lifecycle_invalid'); }
                        if (preview.status !== 'admitted') return deny(preview.code);
                        let runtimeAvailable = false;
                        try { runtimeAvailable = sources.runtime.available() === true; } catch { runtimeAvailable = false; }
                        if (!runtimeAvailable) return deny('runtime_unavailable');
                        const execution = await createTreatmentReasoningAthenaExecution({
                            host: Object.freeze({
                                policy: () => Object.freeze({
                                    readiness: 'available_unqualified' as const,
                                    provider: 'athena_mlx' as const,
                                    venue: 'local_process' as const,
                                    egress: 'none' as const,
                                    credentialClass: 'local_model' as const,
                                    model: ATHENA_R1_QWEN3_8B_MODEL_ID,
                                    receiptRef: refs.receiptRef,
                                    provenanceRef: refs.provenanceRef,
                                }),
                                invoke: sources.runtime.invoke,
                            }),
                            timeoutMs: EXECUTION_TIMEOUT_MS,
                        }).execute({ preview: preview.preview, evidenceRefs: lease.projection.evidenceRefs, projection: lease.projection });
                        if (execution.status !== 'completed') {
                            return deny(execution.code === 'host_invalid' ? 'fabric_denied' : execution.code);
                        }
                        if (!lease.commit()) return deny('source_stale');
                        committed = true;
                        return Object.freeze({ status: 'available' as const, code: null,
                            publication: publication(lease.projection, execution, resolution.receipt, provenance), ...COMMON });
                    } finally {
                        if (!committed) lease.abort();
                    }
                },
            });
        },
    });
}
