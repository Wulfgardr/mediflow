/* @Codex */
import { randomUUID } from 'node:crypto';
import { createClinicalProposal, declareUncertainty, type ClinicalProposal } from './ai-providers/fabric/clinical-interaction';
import { getFabricCapabilityDescriptor } from './ai-providers/fabric/catalog';
import { routeCandidateCapability, type CandidateRoutingDecision } from './ai-providers/fabric/candidate-router';
import {
    EGRESS_PROFILES,
    type FabricProvenanceRecord,
} from './ai-providers/fabric/contract';
import { advanceOnboarding, startOnboarding } from './ai-providers/fabric/onboarding';
import { admitProvider } from './ai-providers/fabric/provider-lifecycle';
import { observeVenue } from './ai-providers/fabric/routing-observability';
import { buildProvenanceRecord } from './ai-providers/fabric/resolver';
import type { ProviderSelectionReceipt } from './ai-providers/registry';

export const PATIENT_INSIGHT_FABRIC_METADATA = Symbol('patient-insight-fabric-metadata');

export type PatientInsightFabricMetadata = Readonly<{
    routing: CandidateRoutingDecision;
    provenance: FabricProvenanceRecord;
    proposal: ClinicalProposal;
}>;

export type PatientInsightFabricAdmission =
    | Readonly<{ admitted: true; metadata: PatientInsightFabricMetadata }>
    | Readonly<{ admitted: false; denial: CandidateRoutingDecision }>;

export class PatientInsightFabricDeniedError extends Error {
    constructor(public readonly denial: CandidateRoutingDecision) {
        super(`Patient Insight denied by Fabric: ${denial.denialCode ?? 'unknown'}`);
        this.name = 'PatientInsightFabricDeniedError';
    }
}

export class PatientInsightFabricMetadataAttachmentError extends Error {
    constructor() {
        super('Patient Insight Fabric metadata could not be attached to model info.');
        this.name = 'PatientInsightFabricMetadataAttachmentError';
    }
}

function localOnboarding() {
    return ['configure', 'credential_declared', 'attest_local', 'enable'].reduce(
        (state, type) => advanceOnboarding(state, { type } as Parameters<typeof advanceOnboarding>[1]),
        startOnboarding('ollama', 'local_model'),
    );
}

function providerSelectionReceipt(value: unknown): ProviderSelectionReceipt | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    // The registry exports these literal values through ProviderSelectionReceipt;
    // it has no runtime guard or constants to reuse at this boundary.
    const {
        schemaVersion,
        authorityPlane,
        task,
        provider,
        model,
        execution,
        endpointClass,
        egress,
        runtimeReadiness,
        fallbackCount,
    } = value as Record<string, unknown>;
    if (
        schemaVersion !== 'mediflow.ai.provider-selection.v1'
        || authorityPlane !== 'clinical_application'
        || task !== 'clinical'
        || provider !== 'ollama'
        || typeof model !== 'string'
        || execution !== 'local'
        || endpointClass !== 'loopback'
        || egress !== 'none'
        || runtimeReadiness !== 'required'
        || fallbackCount !== 0
    ) return null;

    return Object.freeze({
        schemaVersion,
        authorityPlane,
        task,
        provider,
        model,
        execution,
        endpointClass,
        egress,
        runtimeReadiness,
        fallbackCount,
    });
}

function sameProviderSelectionReceipt(
    left: ProviderSelectionReceipt,
    right: ProviderSelectionReceipt,
): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.authorityPlane === right.authorityPlane
        && left.task === right.task
        && left.provider === right.provider
        && left.model === right.model
        && left.execution === right.execution
        && left.endpointClass === right.endpointClass
        && left.egress === right.egress
        && left.runtimeReadiness === right.runtimeReadiness
        && left.fallbackCount === right.fallbackCount;
}

function modelInfo(value: unknown): Readonly<{
    provider: 'ollama'; model: string; baseUrl: string; receipt: ProviderSelectionReceipt;
}> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { provider, model, baseUrl, receipt } = value as Record<string, unknown>;
    const receiptSnapshot = providerSelectionReceipt(receipt);
    return provider === 'ollama' && typeof model === 'string' && typeof baseUrl === 'string'
        && receiptSnapshot !== null
        && receiptSnapshot.provider === provider
        && receiptSnapshot.model === model
        ? Object.freeze({ provider, model, baseUrl, receipt: receiptSnapshot }) : null;
}

function denial(
    requestId: string,
    code: NonNullable<CandidateRoutingDecision['denialCode']>,
): PatientInsightFabricAdmission {
    return Object.freeze({ admitted: false, denial: Object.freeze({
        schemaVersion: 'mediflow.ai.candidate-routing.v1', requestId, capability: 'patient_insight',
        requestedVenue: 'local_process', outcome: 'denied', denialCode: code, fallback: 'denied_by_contract',
        observations: Object.freeze([]), receipt: null,
    }) });
}

/** Admission from caller-owned single snapshots; it never invokes a provider. */
export function admitPatientInsightFabric(
    input: Readonly<{ modelInfo: unknown; health: unknown }>,
    routeCandidate: typeof routeCandidateCapability = routeCandidateCapability,
): PatientInsightFabricAdmission {
    const requestId = randomUUID();
    const snapshot = modelInfo(input.modelInfo);
    if (!snapshot) return denial(requestId, 'provider_receipt_mismatch');

    const descriptor = getFabricCapabilityDescriptor('patient_insight');
    const health = input.health as { status?: unknown } | null;
    const healthStatus = health?.status;
    const observation = observeVenue(
        'local_process',
        healthStatus === 'ok' ? 'available' : 'offline',
        healthStatus === 'ok' ? null : 'daemon_unreachable',
    );
    const onboarding = localOnboarding();
    const routing = routeCandidate({
        policy: Object.freeze({
            schemaVersion: 'mediflow.ai.execution-policy.v1', requestId, capability: descriptor.id,
            authorityPlane: 'clinical_application', operation: descriptor.operation, dataClass: descriptor.dataClass,
            allowedVenues: Object.freeze(['local_process'] as const), egressProfileId: 'local_only', consentRef: null,
            retention: 'not_persisted', review: 'review_first', provenanceRequired: true, fallback: 'none',
        }),
        request: { descriptor, venue: 'local_process', generative: {
            task: 'clinical', provider: snapshot.provider, models: { clinical: snapshot.model }, endpoint: snapshot.baseUrl, chatTimeoutMs: 1_000,
        } },
        observations: [observation], onboarding, lifecycle: admitProvider(onboarding),
    });
    if (!routing.resolution || !routing.decision.receipt) {
        return Object.freeze({ admitted: false, denial: routing.decision });
    }

    // Candidate routing preserves the resolver receipt by identity. Reject a
    // wrapper that separates routing evidence from the resolution it names.
    if (routing.decision.receipt !== routing.resolution.receipt) {
        return denial(requestId, 'provider_receipt_mismatch');
    }

    const receipt = routing.decision.receipt;
    const localOnly = EGRESS_PROFILES.local_only;
    const nestedReceipt = providerSelectionReceipt(receipt.providerReceipt);
    if (receipt.schemaVersion !== 'mediflow.ai.fabric-resolution.v1'
        || receipt.capability !== 'patient_insight'
        || receipt.class !== descriptor.class
        || receipt.venue !== 'local_process'
        || receipt.egressProfile.id !== localOnly.id
        || receipt.egressProfile.version !== localOnly.version
        || receipt.egressProfile.egress !== localOnly.egress
        || receipt.provider !== snapshot.receipt.provider || receipt.model !== snapshot.receipt.model
        || receipt.fallbackCount !== 0
        || nestedReceipt === null
        || !sameProviderSelectionReceipt(nestedReceipt, snapshot.receipt)) {
        return denial(requestId, 'provider_receipt_mismatch');
    }

    const provenance = buildProvenanceRecord(routing.resolution, [
        'context_minimization',
        'envelope_validation',
    ]);
    return Object.freeze({ admitted: true, metadata: Object.freeze({
        routing: routing.decision,
        provenance,
        proposal: createClinicalProposal({
            capability: 'patient_insight',
            provenanceRef: `mediflow.ai.provenance.v1:${requestId}`,
            uncertainty: declareUncertainty(undefined),
            completeness: { unreadableFields: [], missingFields: [] },
            pendingWork: [],
        }),
    }) });
}

export function attachPatientInsightFabricMetadata<T extends object>(
    result: T,
    metadata: PatientInsightFabricMetadata,
): T {
    try {
        Object.defineProperty(result, PATIENT_INSIGHT_FABRIC_METADATA, {
            value: metadata,
            enumerable: false,
        });
    } catch {
        throw new PatientInsightFabricMetadataAttachmentError();
    }
    return result;
}

export function getPatientInsightFabricMetadata(result: object): PatientInsightFabricMetadata | undefined {
    return (result as { [PATIENT_INSIGHT_FABRIC_METADATA]?: PatientInsightFabricMetadata })[
        PATIENT_INSIGHT_FABRIC_METADATA
    ];
}
