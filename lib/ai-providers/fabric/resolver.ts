/* @Codex */
import { isEgressGateOpen } from '../../ai-egress-gate';
import { localProviderRegistry, type LocalProviderBindingInput, type LocalProviderResolution } from '../registry';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './catalog';
import {
    DETERMINISTIC_CAPABILITY_IDS, EGRESS_PROFILES, FABRIC_PREPROCESSING_LABELS,
    FABRIC_VENUES, GENERATIVE_CAPABILITY_IDS, FabricPolicyError,
    type FabricCapabilityDescriptor, type FabricExecutionPolicy,
    type FabricPreprocessingLabel, type FabricProvenanceRecord,
    type FabricResolutionReceipt, type FabricVenue, type GenerativeCapabilityId,
} from './contract';

const PREPROCESSING_VOCABULARY: ReadonlySet<string> = new Set(FABRIC_PREPROCESSING_LABELS);
const VENUE_VALUES: ReadonlySet<string> = new Set(FABRIC_VENUES);
const RETENTION_VALUES: ReadonlySet<string> = new Set(['not_persisted', 'local_only']);

export interface FabricResolution {
    readonly receipt: FabricResolutionReceipt;
    readonly descriptor: FabricCapabilityDescriptor;
    readonly generative: LocalProviderResolution | null;
}

const GENERATIVE_TASKS: Readonly<Record<Exclude<GenerativeCapabilityId, 'treatment_reasoning'>, LocalProviderBindingInput['task']>> = {
    patient_insight: 'clinical',
    smart_import: 'clinical',
    document_synthesis: 'reasoning',
    ocr: 'ocr',
};

// Lane generative con runtime autogestito fuori dal registry Ollama: la
// ricevuta nomina il provider effettivo della lane, il modello resta risolto
// dalla lane stessa (matrice serving: ATHENA MLX non eredita il registry).
const SELF_MANAGED_GENERATIVE: Readonly<Partial<Record<GenerativeCapabilityId, 'athena_mlx'>>> = {
    treatment_reasoning: 'athena_mlx',
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
    // I tipi TypeScript non sono enforcement runtime: ogni campo della policy
    // viene convalidato qui, anche quelli oggi sempre nulli o costanti.
    if (
        policy.schemaVersion !== 'mediflow.ai.execution-policy.v1'
        || policy.provenanceRequired !== true
        || policy.fallback !== 'none'
        || policy.authorityPlane !== 'clinical_application'
        || typeof policy.requestId !== 'string'
        || policy.requestId.trim().length === 0
        || !RETENTION_VALUES.has(policy.retention)
        || !(policy.consentRef === null
            || (typeof policy.consentRef === 'string' && policy.consentRef.trim().length > 0))
        || !Array.isArray(policy.allowedVenues)
        || policy.allowedVenues.length === 0
        || !policy.allowedVenues.every((venue) => VENUE_VALUES.has(venue))
    ) {
        throw new FabricPolicyError('policy_invalid');
    }

    const generativeCapability = isGenerative(descriptor.id);
    const deterministicCapability = isDeterministic(descriptor.id);
    if (policy.capability !== descriptor.id || (!generativeCapability && !deterministicCapability)) {
        throw new FabricPolicyError('capability_unknown');
    }

    // Solo il descriptor canonico del catalogo e' autorevole: un oggetto
    // fabbricato con lo stesso id ma venue, review o profili diversi viene
    // respinto per identita' di riferimento (i descrittori sono singleton
    // congelati).
    if (FABRIC_CAPABILITY_DESCRIPTORS[descriptor.id] !== descriptor) {
        throw new FabricPolicyError('capability_unknown');
    }

    const selfManagedProvider = generativeCapability
        ? SELF_MANAGED_GENERATIVE[descriptor.id as GenerativeCapabilityId] ?? null
        : null;
    const requiresRegistryBinding = generativeCapability && selfManagedProvider === null;
    if (
        descriptor.class !== (generativeCapability ? 'generative' : 'deterministic')
        || requiresRegistryBinding !== Boolean(request.generative)
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

    const generative = requiresRegistryBinding ? localProviderRegistry.resolve({
        ...request.generative!,
        task: GENERATIVE_TASKS[descriptor.id as Exclude<GenerativeCapabilityId, 'treatment_reasoning'>],
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
        provider: generative?.receipt.provider ?? selfManagedProvider ?? 'in_house',
        model: generative?.receipt.model ?? null,
        providerReceipt: generative?.receipt ?? null,
        fallbackCount: 0,
    });

    return { receipt, descriptor, generative };
}

export function buildProvenanceRecord(resolution: FabricResolution, preprocessing: readonly string[]): FabricProvenanceRecord {
    // Solo il vocabolario chiuso del contratto: la forma sintattica non basta
    // a escludere contenuto clinico normalizzato (es. una diagnosi snake_case).
    for (const label of preprocessing) {
        if (!PREPROCESSING_VOCABULARY.has(label)) {
            throw new FabricPolicyError('provenance_label_invalid');
        }
    }
    const labels = preprocessing as readonly FabricPreprocessingLabel[];
    return Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: resolution.receipt.capability,
        venue: resolution.receipt.venue,
        provider: resolution.receipt.provider,
        model: resolution.receipt.model,
        preprocessing: Object.freeze([...labels]),
        receipt: resolution.receipt,
    });
}
