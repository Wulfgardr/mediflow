/* @Codex */
import { isEgressGateOpen } from '../../ai-egress-gate';
import { localProviderRegistry, type LocalProviderBindingInput, type LocalProviderResolution } from '../registry';
import {
    DETERMINISTIC_CAPABILITY_IDS, EGRESS_PROFILES, GENERATIVE_CAPABILITY_IDS, FabricPolicyError,
    type FabricCapabilityDescriptor, type FabricExecutionPolicy, type FabricProvenanceRecord,
    type FabricResolutionReceipt, type FabricVenue, type GenerativeCapabilityId,
} from './contract';

export interface FabricResolution {
    readonly receipt: FabricResolutionReceipt;
    readonly descriptor: FabricCapabilityDescriptor;
    readonly generative: LocalProviderResolution | null;
}

const GENERATIVE_TASKS: Readonly<Record<GenerativeCapabilityId, LocalProviderBindingInput['task']>> = {
    patient_insight: 'clinical',
    smart_import: 'clinical',
    document_synthesis: 'reasoning',
    ocr: 'ocr',
    treatment_reasoning: 'reasoning',
};

function isGenerative(id: string): id is GenerativeCapabilityId {
    return GENERATIVE_CAPABILITY_IDS.includes(id as GenerativeCapabilityId);
}

function isDeterministic(id: string): boolean {
    return DETERMINISTIC_CAPABILITY_IDS.includes(id as typeof DETERMINISTIC_CAPABILITY_IDS[number]);
}

export function resolveFabricCapability(
    policy: FabricExecutionPolicy,
    request: { descriptor: FabricCapabilityDescriptor; venue: FabricVenue; generative?: LocalProviderBindingInput },
): FabricResolution {
    const descriptor = request.descriptor;
    if (
        policy.schemaVersion !== 'mediflow.ai.execution-policy.v1'
        || policy.provenanceRequired !== true
        || policy.fallback !== 'none'
        || policy.authorityPlane !== 'clinical_application'
        || typeof policy.requestId !== 'string'
        || policy.requestId.trim().length === 0
    ) {
        throw new FabricPolicyError('policy_invalid');
    }

    const generativeCapability = isGenerative(descriptor.id);
    const deterministicCapability = isDeterministic(descriptor.id);
    if (policy.capability !== descriptor.id || (!generativeCapability && !deterministicCapability)) {
        throw new FabricPolicyError('capability_unknown');
    }

    if (
        descriptor.class !== (generativeCapability ? 'generative' : 'deterministic')
        || generativeCapability !== Boolean(request.generative)
    ) {
        throw new FabricPolicyError('class_mismatch');
    }
    if (
        policy.operation !== descriptor.operation
        || policy.dataClass !== descriptor.dataClass
        || policy.review !== descriptor.review
        || policy.egressProfileId !== descriptor.egressProfileId
    ) {
        throw new FabricPolicyError('policy_invalid');
    }

    if (request.venue === 'cloud') throw new FabricPolicyError('cloud_not_authorized');
    if (
        !descriptor.venues.includes(request.venue)
        || !policy.allowedVenues.includes(request.venue)
    ) {
        throw new FabricPolicyError('venue_not_allowed');
    }

    const profile = EGRESS_PROFILES[descriptor.egressProfileId as keyof typeof EGRESS_PROFILES];
    if (!profile) throw new FabricPolicyError('egress_profile_unknown');
    if (profile.id === 'cloud_authorized_redacted') {
        if (!isEgressGateOpen()) throw new FabricPolicyError('egress_profile_unsatisfied');
        throw new FabricPolicyError('egress_profile_unsatisfied');
    }

    const generative = generativeCapability ? localProviderRegistry.resolve({
        ...request.generative!,
        task: GENERATIVE_TASKS[descriptor.id],
    }) : null;
    const egressProfile = Object.freeze({
        id: profile.id,
        version: profile.version,
        egress: profile.egress,
    });
    const receipt: FabricResolutionReceipt = Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-resolution.v1',
        capability: descriptor.id,
        class: descriptor.class,
        venue: request.venue,
        egressProfile,
        provider: generative?.receipt.provider ?? 'in_house',
        model: generative?.receipt.model ?? null,
        providerReceipt: generative?.receipt ?? null,
        fallbackCount: 0,
    });

    return { receipt, descriptor, generative };
}

export function buildProvenanceRecord(resolution: FabricResolution, preprocessing: readonly string[]): FabricProvenanceRecord {
    return Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: resolution.receipt.capability,
        venue: resolution.receipt.venue,
        provider: resolution.receipt.provider,
        model: resolution.receipt.model,
        preprocessing: Object.freeze([...preprocessing]),
        receipt: resolution.receipt,
    });
}
