/* @Codex */
import { isEgressGateOpen } from '../../ai-egress-gate';
import {
    localProviderRegistry,
    ProviderRegistryError,
    type LocalProviderBindingInput,
    type LocalProviderResolution,
} from '../registry';
import {
    assertLocalOllamaModelReference,
    strictOllamaLoopbackBaseUrl,
} from '../ollama-locality';
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

type HostResolutionSnapshot = Readonly<{
    resolution: LocalProviderResolution;
    receipt: LocalProviderResolution['receipt'];
    task: LocalProviderResolution['receipt']['task'];
    provider: LocalProviderResolution['receipt']['provider'];
    model: string;
}>;

function snapshotHostResolution(value: unknown): HostResolutionSnapshot {
    let snapshot: Record<string, unknown>;
    try {
        const resolution = value as LocalProviderResolution;
        const adapter = resolution.adapter;
        const manifest = resolution.manifest;
        const receipt = resolution.receipt;
        const fallback = resolution.fallback;
        const getBaseUrl = adapter.getBaseUrl;
        const getModel = adapter.getModel;
        const adapterCapabilities = adapter.capabilities;
        const manifestCapabilities = manifest.capabilities;
        snapshot = {
            resolution, adapter, manifest, receipt, fallback,
            adapterId: adapter.id,
            adapterKind: adapter.kind,
            adapterModel: getModel.call(adapter),
            baseUrl: getBaseUrl.call(adapter),
            adapterCapabilities: Object.freeze({ ...adapterCapabilities }),
            manifestCapabilities: Object.freeze({ ...manifestCapabilities }),
            candidates: Array.isArray(fallback.candidates) ? Array.from(fallback.candidates) : null,
        };
    } catch {
        throw new ProviderRegistryError('provider_not_local');
    }

    const { resolution, adapter, manifest, receipt, fallback } = snapshot as {
        resolution: LocalProviderResolution;
        adapter: LocalProviderResolution['adapter'];
        manifest: LocalProviderResolution['manifest'];
        receipt: LocalProviderResolution['receipt'];
        fallback: LocalProviderResolution['fallback'];
    };
    if (
        receipt.schemaVersion !== 'mediflow.ai.provider-selection.v1'
        || receipt.authorityPlane !== 'clinical_application'
        || receipt.provider !== 'ollama'
        || manifest.provider !== receipt.provider
        || snapshot.adapterId !== receipt.provider
    ) {
        throw new ProviderRegistryError('provider_not_registered');
    }
    if (
        receipt.execution !== 'local'
        || receipt.endpointClass !== 'loopback'
        || receipt.egress !== 'none'
        || receipt.runtimeReadiness !== 'required'
        || receipt.fallbackCount !== 0
        || manifest.authorityPlane !== 'clinical_application'
        || manifest.execution !== 'local'
        || manifest.endpointClass !== 'loopback'
        || manifest.egress !== 'none'
        || manifest.retention !== 'not_persisted_by_registry'
        || manifest.capabilityEvidence !== 'provider_transport_only'
        || manifest.modelCapabilityReadiness !== 'runtime_attestation_required'
        || snapshot.adapterKind !== 'local'
        || fallback.strategy !== 'none'
        || !Array.isArray(snapshot.candidates)
        || snapshot.candidates.length !== 0
        || typeof adapter.chat !== 'function'
        || typeof adapter.listModels !== 'function'
        || JSON.stringify(snapshot.adapterCapabilities) !== JSON.stringify(snapshot.manifestCapabilities)
    ) {
        throw new ProviderRegistryError('provider_not_local');
    }
    try {
        assertLocalOllamaModelReference(receipt.model);
        if (receipt.model.trim() !== receipt.model || snapshot.adapterModel !== receipt.model) {
            throw new Error('invalid');
        }
    } catch {
        throw new ProviderRegistryError('invalid_model');
    }
    try {
        if (
            typeof snapshot.baseUrl !== 'string'
            || strictOllamaLoopbackBaseUrl(snapshot.baseUrl) !== snapshot.baseUrl
        ) {
            throw new Error('invalid');
        }
    } catch {
        throw new ProviderRegistryError('endpoint_not_local');
    }

    return Object.freeze({
        resolution,
        receipt,
        task: receipt.task,
        provider: receipt.provider,
        model: receipt.model,
    });
}

export function resolveFabricCapability(
    policy: FabricExecutionPolicy,
    request: { descriptor: FabricCapabilityDescriptor; venue: FabricVenue; generative?: LocalProviderBindingInput },
): FabricResolution {
    const descriptor = request.descriptor;
    // Snapshot unico e normale dell'array del chiamante: validazione e
    // membership successiva usano SOLO questa copia reale, mai i metodi
    // dell'oggetto originale (un includes ridefinito o un iteratore stateful
    // non devono poter mentire tra check e uso). Array.from normalizza anche
    // i buchi degli array sparsi in undefined, che falliscono la validazione.
    const allowedVenues = Array.isArray(policy.allowedVenues)
        ? Array.from(policy.allowedVenues)
        : null;
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
        || allowedVenues === null
        || allowedVenues.length === 0
        || !allowedVenues.every((venue) => VENUE_VALUES.has(venue))
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
    if (descriptor.availabilityDisposition === 'unavailable') {
        throw new FabricPolicyError('venue_not_allowed');
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
    // descriptor.venues e' il singleton canonico congelato (nostro);
    // allowedVenues e' lo snapshot validato sopra, mai l'array del chiamante.
    if (
        !descriptor.venues.includes(request.venue)
        || !allowedVenues.includes(request.venue)
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

export type HostResolvedFabricRequest = Readonly<{
    descriptor: FabricCapabilityDescriptor;
    venue: FabricVenue;
    generative: LocalProviderResolution;
}>;

export function resolveFabricCapabilityWithHostResolution(
    policy: FabricExecutionPolicy,
    request: HostResolvedFabricRequest,
): FabricResolution {
    const descriptor = request.descriptor;
    const allowedVenues = Array.isArray(policy.allowedVenues)
        ? Array.from(policy.allowedVenues)
        : null;
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
        || allowedVenues === null
        || allowedVenues.length === 0
        || !allowedVenues.every((venue) => VENUE_VALUES.has(venue))
    ) {
        throw new FabricPolicyError('policy_invalid');
    }
    if (
        policy.capability !== descriptor.id
        || FABRIC_CAPABILITY_DESCRIPTORS[descriptor.id] !== descriptor
    ) {
        throw new FabricPolicyError('capability_unknown');
    }
    if (descriptor.availabilityDisposition === 'unavailable') {
        throw new FabricPolicyError('venue_not_allowed');
    }
    const rawGenerative = request.generative;
    const expectedTask = GENERATIVE_TASKS[
        descriptor.id as Exclude<GenerativeCapabilityId, 'treatment_reasoning'>
    ];
    const generative = snapshotHostResolution(rawGenerative);
    if (!expectedTask || generative.task !== expectedTask) {
        throw new ProviderRegistryError('invalid_task');
    }
    if (
        descriptor.class !== 'generative'
        || policy.operation !== descriptor.operation
        || policy.dataClass !== descriptor.dataClass
        || policy.review !== descriptor.review
        || policy.egressProfileId !== descriptor.egressProfileId
    ) {
        throw new FabricPolicyError('policy_invalid');
    }
    if (request.venue === 'cloud') throw new FabricPolicyError('cloud_not_authorized');
    if (!descriptor.venues.includes(request.venue) || !allowedVenues.includes(request.venue)) {
        throw new FabricPolicyError('venue_not_allowed');
    }
    const profile = EGRESS_PROFILES[descriptor.egressProfileId as keyof typeof EGRESS_PROFILES];
    if (!profile) throw new FabricPolicyError('egress_profile_unknown');
    if (profile.id !== 'local_only' || profile.egress !== 'none') {
        throw new FabricPolicyError('egress_profile_unsatisfied');
    }
    const receipt: FabricResolutionReceipt = Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-resolution.v1',
        capability: descriptor.id,
        class: descriptor.class,
        venue: request.venue,
        egressProfile: Object.freeze({
            id: profile.id,
            version: profile.version,
            egress: profile.egress,
        }),
        provider: generative.provider,
        model: generative.model,
        providerReceipt: generative.receipt,
        fallbackCount: 0,
    });

    return Object.freeze({ receipt, descriptor, generative: generative.resolution });
}

export function buildProvenanceRecord(resolution: FabricResolution, preprocessing: readonly string[]): FabricProvenanceRecord {
    // Solo il vocabolario chiuso del contratto: la forma sintattica non basta
    // a escludere contenuto clinico normalizzato (es. una diagnosi snake_case).
    // Una SOLA copia dell'input: validare e materializzare la stessa copia,
    // cosi' un iteratore stateful non puo' cambiare valori tra check e uso.
    if (!Array.isArray(preprocessing)) {
        throw new FabricPolicyError('provenance_label_invalid');
    }
    const labels = Array.from(preprocessing) as FabricPreprocessingLabel[];
    for (const label of labels) {
        if (!PREPROCESSING_VOCABULARY.has(label)) {
            throw new FabricPolicyError('provenance_label_invalid');
        }
    }
    return Object.freeze({
        schemaVersion: 'mediflow.ai.fabric-provenance.v1',
        capability: resolution.receipt.capability,
        venue: resolution.receipt.venue,
        provider: resolution.receipt.provider,
        model: resolution.receipt.model,
        preprocessing: Object.freeze(labels),
        receipt: resolution.receipt,
    });
}
