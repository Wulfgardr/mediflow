/* @Codex */
import { getFabricCapabilityDescriptor } from '../../ai-providers/fabric/catalog';
import {
    routeCandidateCapability,
    type CandidateRoutingDecision,
} from '../../ai-providers/fabric/candidate-router';
import type { FabricProvenanceRecord } from '../../ai-providers/fabric/contract';
import { advanceOnboarding, startOnboarding, type ProviderOnboardingState } from '../../ai-providers/fabric/onboarding';
import { admitProvider, type ProviderLifecycleState } from '../../ai-providers/fabric/provider-lifecycle';
import type { ProviderSelectionReceipt } from '../../ai-providers/registry';
import { observeVenue, type VenueObservation } from '../../ai-providers/fabric/routing-observability';
import { buildProvenanceRecord } from '../../ai-providers/fabric/resolver';

export const PATIENT_SMART_IMPORT_FABRIC_METADATA = Symbol('patient-smart-import-fabric-metadata');

export type PatientSmartImportFabricHostSnapshot = Readonly<{
    capabilityAvailable: boolean;
    observation: VenueObservation;
    onboarding: ProviderOnboardingState;
    lifecycle: ProviderLifecycleState;
}>;

export type PatientSmartImportFabricMetadata = Readonly<{
    routing: CandidateRoutingDecision; provenance: FabricProvenanceRecord; reviewRef: string; writesPerformed: 0;
}>;

export class PatientSmartImportFabricDeniedError extends Error {
    constructor(public readonly denial: CandidateRoutingDecision) {
        super(`Smart Import denied by Fabric: ${denial.denialCode ?? 'unknown'}`);
        this.name = 'PatientSmartImportFabricDeniedError';
    }
}

export function createPatientSmartImportLocalHostSnapshot(health: unknown): PatientSmartImportFabricHostSnapshot {
    const onboarding = ['configure', 'credential_declared', 'attest_local', 'enable'].reduce(
        (state, type) => advanceOnboarding(state, { type } as Parameters<typeof advanceOnboarding>[1]),
        startOnboarding('ollama', 'local_model'),
    );
    const healthStatus = health && typeof health === 'object' ? (health as Record<string, unknown>).status : null;
    return Object.freeze({
        capabilityAvailable: true,
        observation: observeVenue('local_process', healthStatus === 'ok' ? 'available' : 'offline',
            healthStatus === 'ok' ? null : 'daemon_unreachable'),
        onboarding,
        lifecycle: admitProvider(onboarding),
    });
}

type SmartImportModelInfo = Readonly<{
    provider: 'ollama'; model: string; baseUrl: string; receipt: ProviderSelectionReceipt;
}>;

function snapshotModelInfo(value: unknown): SmartImportModelInfo | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { provider, model, baseUrl, receipt } = value as Record<string, unknown>;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
    const snapshot = { ...receipt } as ProviderSelectionReceipt;
    if (
        provider !== 'ollama'
        || typeof model !== 'string'
        || typeof baseUrl !== 'string'
        || snapshot.schemaVersion !== 'mediflow.ai.provider-selection.v1'
        || snapshot.authorityPlane !== 'clinical_application'
        || snapshot.task !== 'clinical'
        || snapshot.provider !== provider
        || snapshot.model !== model
        || snapshot.execution !== 'local'
        || snapshot.endpointClass !== 'loopback'
        || snapshot.egress !== 'none'
        || snapshot.runtimeReadiness !== 'required'
        || snapshot.fallbackCount !== 0
    ) return null;
    return Object.freeze({ provider, model, baseUrl, receipt: Object.freeze(snapshot) });
}

function denied(
    requestId: string,
    code: NonNullable<CandidateRoutingDecision['denialCode']>,
): CandidateRoutingDecision {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.candidate-routing.v1',
        requestId,
        capability: 'smart_import',
        requestedVenue: 'local_process',
        outcome: 'denied',
        denialCode: code,
        fallback: 'denied_by_contract',
        observations: Object.freeze([]),
        receipt: null,
    });
}

function receiptMatchesModel(
    receipt: NonNullable<CandidateRoutingDecision['receipt']>,
    modelInfo: SmartImportModelInfo,
): boolean {
    const providerReceipt = receipt.providerReceipt;
    return receipt.capability === 'smart_import'
        && receipt.class === 'generative'
        && receipt.venue === 'local_process'
        && receipt.egressProfile.id === 'local_only'
        && receipt.egressProfile.egress === 'none'
        && receipt.provider === modelInfo.provider
        && receipt.model === modelInfo.model
        && providerReceipt !== null
        && providerReceipt.schemaVersion === modelInfo.receipt.schemaVersion
        && providerReceipt.task === modelInfo.receipt.task
        && providerReceipt.provider === modelInfo.receipt.provider
        && providerReceipt.model === modelInfo.receipt.model
        && providerReceipt.egress === modelInfo.receipt.egress
        && providerReceipt.fallbackCount === 0
        && receipt.fallbackCount === 0;
}

export async function executePatientSmartImportFabricPreview<T>(
    input: Readonly<{ modelInfo: unknown; host: PatientSmartImportFabricHostSnapshot }>,
    invokeProvider: () => Promise<T>,
): Promise<Readonly<{ output: T; metadata: PatientSmartImportFabricMetadata }>> {
    const requestId = globalThis.crypto.randomUUID();
    const modelInfo = snapshotModelInfo(input.modelInfo);
    const host = input.host;
    if (!modelInfo) throw new PatientSmartImportFabricDeniedError(denied(requestId, 'provider_receipt_mismatch'));
    if (host.capabilityAvailable !== true) {
        throw new PatientSmartImportFabricDeniedError(denied(requestId, 'fabric_resolution_denied'));
    }

    const descriptor = getFabricCapabilityDescriptor('smart_import');
    const routed = routeCandidateCapability({
        policy: Object.freeze({
            schemaVersion: 'mediflow.ai.execution-policy.v1', requestId, capability: descriptor.id,
            authorityPlane: 'clinical_application', operation: descriptor.operation, dataClass: descriptor.dataClass,
            allowedVenues: Object.freeze(['local_process'] as const), egressProfileId: descriptor.egressProfileId,
            consentRef: null, retention: 'not_persisted', review: descriptor.review,
            provenanceRequired: true, fallback: 'none',
        }),
        request: { descriptor, venue: 'local_process', generative: {
            task: 'clinical', provider: modelInfo.provider, models: { clinical: modelInfo.model },
            endpoint: modelInfo.baseUrl, chatTimeoutMs: 1_000,
        } },
        observations: [host.observation],
        onboarding: host.onboarding,
        lifecycle: host.lifecycle,
    });
    const receipt = routed.decision.receipt;
    if (!routed.resolution || !receipt) {
        throw new PatientSmartImportFabricDeniedError(routed.decision);
    }
    if (receipt !== routed.resolution.receipt || !receiptMatchesModel(receipt, modelInfo)) {
        throw new PatientSmartImportFabricDeniedError(denied(requestId, 'provider_receipt_mismatch'));
    }

    const metadata = Object.freeze({
        routing: routed.decision,
        provenance: buildProvenanceRecord(routed.resolution, ['context_minimization', 'envelope_validation']),
        reviewRef: `mediflow.smart-import.review.v1:${requestId}`,
        writesPerformed: 0 as const,
    });
    const output = await invokeProvider();
    return Object.freeze({ output, metadata });
}

export function getPatientSmartImportFabricMetadata(
    result: object,
): PatientSmartImportFabricMetadata | undefined {
    return (result as { [PATIENT_SMART_IMPORT_FABRIC_METADATA]?: PatientSmartImportFabricMetadata })[
        PATIENT_SMART_IMPORT_FABRIC_METADATA
    ];
}
