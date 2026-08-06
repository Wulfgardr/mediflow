/* @Codex */
import { createClinicalProposal, declareUncertainty, type ClinicalProposal } from './ai-providers/fabric/clinical-interaction';
import { getFabricCapabilityDescriptor } from './ai-providers/fabric/catalog';
import { routeCandidateCapability, type CandidateRoutingDecision } from './ai-providers/fabric/candidate-router';
import {
    EGRESS_PROFILES,
    type FabricProvenanceRecord,
    type FabricResolutionReceipt,
} from './ai-providers/fabric/contract';
import { advanceOnboarding, startOnboarding } from './ai-providers/fabric/onboarding';
import { admitProvider } from './ai-providers/fabric/provider-lifecycle';
import { observeVenue } from './ai-providers/fabric/routing-observability';
import { buildProvenanceRecord, type FabricResolution } from './ai-providers/fabric/resolver';
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

// Snapshot strutturale unico della receipt di risoluzione Fabric: ogni campo
// viene letto esattamente una volta e materializzato in una copia congelata,
// cosi' un getter stateful non puo' cambiare esito tra ammissione, provenance
// e metadato. Shape malformate (incluso egressProfile assente o non-oggetto)
// diventano null, mai un'eccezione.
function fabricResolutionReceipt(
    value: unknown,
    expected: Readonly<{ class: FabricResolutionReceipt['class']; providerReceipt: ProviderSelectionReceipt }>,
): FabricResolutionReceipt | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const {
        schemaVersion,
        capability,
        class: capabilityClass,
        venue,
        egressProfile,
        provider,
        model,
        providerReceipt,
        fallbackCount,
    } = value as Record<string, unknown>;
    if (!egressProfile || typeof egressProfile !== 'object' || Array.isArray(egressProfile)) return null;
    const { id, version, egress } = egressProfile as Record<string, unknown>;
    const localOnly = EGRESS_PROFILES.local_only;
    const nested = providerSelectionReceipt(providerReceipt);
    if (
        schemaVersion !== 'mediflow.ai.fabric-resolution.v1'
        || capability !== 'patient_insight'
        || capabilityClass !== expected.class
        || venue !== 'local_process'
        || id !== localOnly.id
        || version !== localOnly.version
        || egress !== localOnly.egress
        || provider !== expected.providerReceipt.provider
        || model !== expected.providerReceipt.model
        || fallbackCount !== 0
        || nested === null
        || !sameProviderSelectionReceipt(nested, expected.providerReceipt)
    ) return null;

    // I campi union-typed vengono materializzati dal lato canonico tipizzato:
    // la validazione sopra ne ha gia' provato l'uguaglianza con la lettura
    // singola del raw, quindi lo snapshot resta fedele alla prima lettura.
    return Object.freeze({
        schemaVersion,
        capability,
        class: expected.class,
        venue,
        egressProfile: Object.freeze({ id: localOnly.id, version: localOnly.version, egress: localOnly.egress }),
        provider,
        model,
        providerReceipt: nested,
        fallbackCount,
    });
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
    // Runtime isomorfo (browser + Node): niente node:crypto nel seam client.
    const requestId = globalThis.crypto.randomUUID();
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
    const decision = routing.decision;
    const resolution = routing.resolution;
    if (!resolution) {
        return Object.freeze({ admitted: false, denial: decision });
    }
    const decisionReceipt = decision.receipt;
    if (!decisionReceipt) {
        return Object.freeze({ admitted: false, denial: decision });
    }

    // Candidate routing preserves the resolver receipt by identity. Reject a
    // wrapper that separates routing evidence from the resolution it names.
    if (decisionReceipt !== resolution.receipt) {
        return denial(requestId, 'provider_receipt_mismatch');
    }

    const receiptSnapshot = fabricResolutionReceipt(decisionReceipt, {
        class: descriptor.class,
        providerReceipt: snapshot.receipt,
    });
    if (!receiptSnapshot) {
        return denial(requestId, 'provider_receipt_mismatch');
    }

    // Decision, resolution e provenance vengono ricostruite attorno allo
    // snapshot congelato: l'oggetto receipt fornito dal router non viene mai
    // riletto ne' incorporato nel metadato.
    const verifiedResolution: FabricResolution = Object.freeze({
        receipt: receiptSnapshot,
        descriptor: resolution.descriptor,
        generative: resolution.generative,
    });
    const verifiedDecision: CandidateRoutingDecision = Object.freeze({
        schemaVersion: decision.schemaVersion,
        requestId: decision.requestId,
        capability: decision.capability,
        requestedVenue: decision.requestedVenue,
        outcome: decision.outcome,
        denialCode: decision.denialCode,
        fallback: decision.fallback,
        observations: decision.observations,
        receipt: receiptSnapshot,
    });
    const provenance = buildProvenanceRecord(verifiedResolution, [
        'context_minimization',
        'envelope_validation',
    ]);
    return Object.freeze({ admitted: true, metadata: Object.freeze({
        routing: verifiedDecision,
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
