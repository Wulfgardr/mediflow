/* @Codex */
import { randomUUID } from 'node:crypto';
import { createClinicalProposal, declareUncertainty, type ClinicalProposal } from '../../ai-providers/fabric/clinical-interaction';
import { getFabricCapabilityDescriptor } from '../../ai-providers/fabric/catalog';
import { routeCandidateCapability, type CandidateRoutingDecision } from '../../ai-providers/fabric/candidate-router';
import type { FabricProvenanceRecord } from '../../ai-providers/fabric/contract';
import { advanceOnboarding, startOnboarding } from '../../ai-providers/fabric/onboarding';
import { admitProvider } from '../../ai-providers/fabric/provider-lifecycle';
import { observeVenue } from '../../ai-providers/fabric/routing-observability';
import { buildProvenanceRecord } from '../../ai-providers/fabric/resolver';

export const DOCUMENT_SYNTHESIS_FABRIC_METADATA = Symbol('document-synthesis-fabric-metadata');
export type DocumentSynthesisFabricMetadata = Readonly<{
    routing: CandidateRoutingDecision; provenance: FabricProvenanceRecord; proposal: ClinicalProposal; writesPerformed: 0;
}>;
export type DocumentSynthesisFabricAdmission =
    | Readonly<{ admitted: true; metadata: DocumentSynthesisFabricMetadata }>
    | Readonly<{ admitted: false; denial: CandidateRoutingDecision }>;

export class DocumentSynthesisFabricDeniedError extends Error {
    constructor(public readonly denial: CandidateRoutingDecision) {
        super(`Document synthesis denied by Fabric: ${denial.denialCode ?? 'unknown'}`);
        this.name = 'DocumentSynthesisFabricDeniedError';
    }
}

function localOnboarding() {
    return ['configure', 'credential_declared', 'attest_local', 'enable'].reduce(
        (state, type) => advanceOnboarding(state, { type } as Parameters<typeof advanceOnboarding>[1]),
        startOnboarding('ollama', 'local_model'),
    );
}

function modelInfo(value: unknown): Readonly<{
    provider: 'ollama'; model: string; baseUrl: string; receiptProvider: string; receiptModel: string;
}> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { provider, model, baseUrl, receipt } = value as Record<string, unknown>;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
    const { provider: receiptProvider, model: receiptModel } = receipt as Record<string, unknown>;
    return provider === 'ollama' && typeof model === 'string' && typeof baseUrl === 'string'
        && receiptProvider === provider && receiptModel === model
        ? Object.freeze({ provider, model, baseUrl, receiptProvider, receiptModel }) : null;
}

function denial(requestId: string, code: NonNullable<CandidateRoutingDecision['denialCode']>): DocumentSynthesisFabricAdmission {
    return Object.freeze({ admitted: false, denial: Object.freeze({
        schemaVersion: 'mediflow.ai.candidate-routing.v1', requestId, capability: 'document_synthesis',
        requestedVenue: 'local_process', outcome: 'denied', denialCode: code, fallback: 'denied_by_contract',
        observations: Object.freeze([]), receipt: null,
    }) });
}

/** Admission from caller-owned single snapshots; no provider call occurs here. */
export function admitDocumentSynthesisFabric(input: Readonly<{ modelInfo: unknown; health: unknown }>): DocumentSynthesisFabricAdmission {
    const requestId = randomUUID();
    const snapshot = modelInfo(input.modelInfo);
    if (!snapshot) return denial(requestId, 'provider_receipt_mismatch');
    const descriptor = getFabricCapabilityDescriptor('document_synthesis');
    const health = input.health as { status?: unknown } | null;
    const healthStatus = health?.status;
    const observation = observeVenue('local_process', healthStatus === 'ok' ? 'available' : 'offline', healthStatus === 'ok' ? null : 'daemon_unreachable');
    const onboarding = localOnboarding();
    const routing = routeCandidateCapability({
        policy: Object.freeze({
            schemaVersion: 'mediflow.ai.execution-policy.v1', requestId, capability: descriptor.id,
            authorityPlane: 'clinical_application', operation: descriptor.operation, dataClass: descriptor.dataClass,
            allowedVenues: Object.freeze(['local_process'] as const), egressProfileId: 'local_only', consentRef: null,
            retention: 'not_persisted', review: 'review_first', provenanceRequired: true, fallback: 'none',
        }),
        request: { descriptor, venue: 'local_process', generative: {
            task: 'reasoning', provider: snapshot.provider, models: { reasoning: snapshot.model }, endpoint: snapshot.baseUrl, chatTimeoutMs: 1_000,
        } },
        observations: [observation], onboarding, lifecycle: admitProvider(onboarding),
    });
    if (!routing.resolution || !routing.decision.receipt) return Object.freeze({ admitted: false, denial: routing.decision });
    const receipt = routing.decision.receipt;
    if (receipt.provider !== snapshot.receiptProvider || receipt.model !== snapshot.receiptModel
        || receipt.providerReceipt?.provider !== snapshot.receiptProvider || receipt.providerReceipt?.model !== snapshot.receiptModel) {
        return denial(requestId, 'provider_receipt_mismatch');
    }
    const provenance = buildProvenanceRecord(routing.resolution, ['context_minimization', 'ocr_normalization', 'envelope_validation']);
    return Object.freeze({ admitted: true, metadata: Object.freeze({
        routing: routing.decision, provenance,
        proposal: createClinicalProposal({ capability: 'document_synthesis', provenanceRef: `mediflow.ai.provenance.v1:${requestId}`,
            uncertainty: declareUncertainty(undefined), completeness: { unreadableFields: [], missingFields: [] }, pendingWork: [] }),
        writesPerformed: 0,
    }) });
}

export function getDocumentSynthesisFabricMetadata(result: object): DocumentSynthesisFabricMetadata | undefined {
    return (result as { [DOCUMENT_SYNTHESIS_FABRIC_METADATA]?: DocumentSynthesisFabricMetadata })[DOCUMENT_SYNTHESIS_FABRIC_METADATA];
}
