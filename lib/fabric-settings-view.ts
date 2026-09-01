/* @Codex */
import {
    DETERMINISTIC_CAPABILITY_IDS,
    EGRESS_PROFILES,
    FABRIC_SCHEMA_VERSION,
    FABRIC_VENUES,
    GENERATIVE_CAPABILITY_IDS,
    type CapabilityClass,
    type EgressProfileId,
    type FabricAvailabilityDisposition,
    type FabricCapabilityId,
    type FabricOperation,
    type FabricReviewPolicy,
    type FabricVenue,
} from './ai-providers/fabric/contract';
import {
    VENUE_OBSERVATION_REASONS,
    type FabricObservabilitySnapshot,
    type VenueObservation,
    type VenueObservationReason,
    type VenueObservationState,
} from './ai-providers/fabric/routing-observability';
import type { FabricStatusSnapshot } from './ai-providers/fabric/status';
import { FABRIC_CAPABILITY_DESCRIPTORS } from './ai-providers/fabric/catalog';
import {
    PROVIDER_DISCLOSURE_IDS,
    buildProviderDisclosureSnapshot,
    type ProviderDisclosureLifecycle,
    type ProviderDisclosureRow,
} from './ai-providers/fabric/provider-disclosure';

export type FabricStatusCapability = FabricStatusSnapshot['capabilities'][number];

export type FabricVenueCopy = Readonly<{
    title: string;
    description: string;
}>;

export const FABRIC_VENUE_COPY: Readonly<Record<FabricVenue, FabricVenueCopy>> = Object.freeze({
    local_process: Object.freeze({
        title: 'Questo Mac',
        description: 'Processi locali su questa postazione, incluso il daemon Ollama per le funzioni generative.',
    }),
    home_base: Object.freeze({
        title: 'Postazione principale',
        description: 'Il nodo host esegue il calcolo per un client accoppiato.',
    }),
    on_device: Object.freeze({
        title: 'Sul dispositivo',
        description: 'Calcolo eseguito direttamente sul client; oggi nessuna capacità usa questa sede.',
    }),
    cloud: Object.freeze({
        title: 'Fuori dalla postazione',
        description: 'Oggi nessuna capacità usa servizi esterni e il profilo di uscita resta chiuso.',
    }),
});

export const VENUE_OBSERVATION_REASON_LABELS: Readonly<Record<VenueObservationReason, string>> = Object.freeze({
    target_invalid: 'L’indirizzo del servizio locale non è valido.',
    daemon_unreachable: 'Il servizio Ollama non risponde.',
    mode_disabled: 'La modalità Postazione principale è disattivata.',
    egress_profile_closed: 'L’uscita dalla postazione è chiusa.',
    not_implemented: 'Questa modalità non è ancora disponibile.',
    not_probed: 'Lo stato non è stato verificato.',
});

export const VENUE_OBSERVATION_STATE_LABELS: Readonly<Record<VenueObservationState, string>> = Object.freeze({
    available: 'Disponibile',
    degraded: 'Disponibilità ridotta',
    offline: 'Non disponibile',
    unknown: 'Stato non verificato',
});

export const PROVIDER_DISCLOSURE_LIFECYCLE_LABELS: Readonly<
    Record<ProviderDisclosureLifecycle, string>
> = Object.freeze({
    available_unqualified: 'Lifecycle ammesso; readiness non qualificata',
    degraded: 'Lifecycle degradato',
    revoked: 'Lifecycle revocato',
    missing: 'Lifecycle assente',
    corrupt: 'Lifecycle non leggibile',
    unavailable: 'Lifecycle non disponibile',
    invalid: 'Lifecycle non valido',
    not_applicable: 'Non applicabile',
});

export type ProviderDisclosurePresentation = Readonly<{
    declaredLifecycle: string;
    declaredRuntimeObservation: string;
    declaredVenue: string;
    declaredEgress: string;
    declaredCredentialClass: string;
    declaredExecutionDisposition: string;
    lifecycle: string;
    runtimeObservation: string;
    effectiveVenue: string;
    effectiveEgress: string;
    effectiveCredentialClass: string;
    executionDisposition: string;
    accessBoundary: string;
}>;

export function describeProviderDisclosure(
    provider: ProviderDisclosureRow,
): ProviderDisclosurePresentation {
    return Object.freeze({
        declaredLifecycle: provider.declared.lifecycle === 'host_managed'
            ? 'Gestito dall’host'
            : 'Solo informativo',
        declaredRuntimeObservation: provider.declared.runtimeObservation === 'operation_receipt_required'
            ? 'Richiede la receipt dell’operazione corrente'
            : 'Disabilitata',
        declaredVenue: FABRIC_VENUE_COPY[provider.declared.venue].title,
        declaredEgress: provider.declared.egress === 'none' ? 'Nessuna' : 'Disabilitata',
        declaredCredentialClass: provider.declared.credentialClass === 'local_model'
            ? 'Modello locale'
            : 'Accesso API separato',
        declaredExecutionDisposition: provider.declared.executionDisposition === 'proposal_only_candidate'
            ? 'Candidato locale, massimo solo proposta'
            : 'Esecuzione disabilitata',
        lifecycle: PROVIDER_DISCLOSURE_LIFECYCLE_LABELS[provider.effective.lifecycle],
        runtimeObservation: 'Non osservata: serve una receipt dell’operazione corrente.',
        effectiveVenue: 'Non osservata',
        effectiveEgress: 'Non osservato',
        effectiveCredentialClass: provider.effective.credentialClass === 'local_model'
            ? 'Modello locale'
            : 'Non osservata',
        executionDisposition: provider.effective.executionDisposition === 'not_observed'
            ? 'Nessuna esecuzione corrente osservata'
            : provider.effective.executionDisposition === 'denied_by_contract'
                ? 'Negata dal contratto'
                : 'Esecuzione disabilitata',
        accessBoundary: provider.declared.accessBoundary === 'consumer_subscription_is_not_api_access'
            ? 'Un abbonamento consumer non equivale all’accesso API.'
            : 'Non applicabile.',
    });
}

export const FABRIC_CAPABILITY_LABELS: Readonly<Record<FabricCapabilityId, string>> = Object.freeze({
    patient_insight: 'Sintesi del quadro paziente',
    smart_import: 'Importazione assistita',
    document_synthesis: 'Sintesi dei documenti',
    ocr: 'Lettura di scansioni e immagini',
    treatment_reasoning: 'Revisione del trattamento',
    icd_lookup: 'Ricerca diagnosi ICD-11',
    aifa_drug_search: 'Ricerca farmaci AIFA',
    service_prescription_matching: 'Abbinamento delle prestazioni',
    evidence_absorption: 'Organizzazione delle evidenze',
    patient_open_loops: 'Attività cliniche in sospeso',
    fhir_export: 'Esportazione FHIR',
    document_classification: 'Classificazione dei documenti',
    document_identity_resolution: 'Riconoscimento dell’identità nel documento',
    pii_redaction_layer1: 'Riduzione dei dati identificativi',
    fse_document_validation: 'Controllo documenti FSE',
    observation_range_classification: 'Classificazione dei valori osservati',
});

export const FABRIC_OPERATION_LABELS: Readonly<Record<FabricOperation, string>> = Object.freeze({
    extraction: 'Estrazione',
    ocr: 'Lettura OCR',
    reasoning: 'Supporto al ragionamento',
    synthesis: 'Sintesi',
    classification: 'Classificazione',
    lookup: 'Consultazione',
    matching: 'Abbinamento',
    validation: 'Validazione',
    projection: 'Quadro informativo',
    export: 'Esportazione',
    redaction: 'Riduzione dei dati identificativi',
});

export const FABRIC_REVIEW_LABELS: Readonly<Record<FabricReviewPolicy, string>> = Object.freeze({
    review_first: 'Propone, decide il medico',
    informational: 'Solo lettura',
});

/* @Codex */
export type FabricAvailabilityCopy = Readonly<{
    title: string;
    description: string;
}>;

export const FABRIC_AVAILABILITY_COPY: Readonly<
    Record<FabricAvailabilityDisposition, FabricAvailabilityCopy>
> = Object.freeze({
    available: Object.freeze({
        title: 'Disponibile nell’app',
        description: 'Funzione applicativa disponibile; non attesta provider, modello o stato runtime.',
    }),
    proposal_only: Object.freeze({
        title: 'Solo proposta',
        description: 'Prepara una proposta da rivedere; non applica dati clinici.',
    }),
    manual_only: Object.freeze({
        title: 'Solo manuale',
        description: 'Il registro non espone un’esecuzione automatica.',
    }),
    unavailable: Object.freeze({
        title: 'Non disponibile',
        description: 'Classificata per trasparenza, ma non eseguibile.',
    }),
});

export const EGRESS_PROFILE_LABELS: Readonly<Record<EgressProfileId, Readonly<{
    title: string;
    description: string;
}>>> = Object.freeze({
    local_only: Object.freeze({
        title: 'Solo locale',
        description: 'Non produce uscita dalla postazione.',
    }),
    cloud_authorized_redacted: Object.freeze({
        title: 'Uscita esterna autorizzata e ridotta',
        description: 'Chiuso per costruzione: rende esplicito il percorso, ma non lo apre.',
    }),
});

export type FabricCapabilityAvailabilityPresentation = Readonly<{
    status: FabricAvailabilityCopy;
    venues: string;
    egress: string;
    terminalUnavailable: boolean;
}>;

export function describeFabricCapabilityAvailability(
    capability: FabricStatusCapability,
): FabricCapabilityAvailabilityPresentation {
    const terminalUnavailable = capability.availabilityDisposition === 'unavailable';
    return Object.freeze({
        status: FABRIC_AVAILABILITY_COPY[capability.availabilityDisposition],
        venues: terminalUnavailable
            ? 'Nessuna sede: funzione non eseguibile'
            : capability.venues.map((venue) => FABRIC_VENUE_COPY[venue].title).join(' · '),
        egress: terminalUnavailable
            ? 'Non applicabile'
            : EGRESS_PROFILE_LABELS[capability.egressProfile.id].title,
        terminalUnavailable,
    });
}

export type FabricCapabilityGroup = Readonly<{
    id: CapabilityClass;
    title: string;
    description: string;
    capabilities: readonly FabricStatusCapability[];
}>;

const CAPABILITY_ORDER: ReadonlyMap<FabricCapabilityId, number> = new Map([
    ...GENERATIVE_CAPABILITY_IDS,
    ...DETERMINISTIC_CAPABILITY_IDS,
].map((id, index) => [id, index]));

const VENUE_ORDER: ReadonlyMap<FabricVenue, number> = new Map(
    FABRIC_VENUES.map((venue, index) => [venue, index]),
);

export function groupFabricCapabilities(
    capabilities: readonly FabricStatusCapability[],
): readonly FabricCapabilityGroup[] {
    const sorted = [...capabilities].sort((left, right) => (
        (CAPABILITY_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (CAPABILITY_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));

    return Object.freeze([
        Object.freeze({
            id: 'generative' as const,
            title: 'Funzioni generative',
            description: 'Preparano testo o proposte da sottoporre alla revisione del medico.',
            capabilities: Object.freeze(sorted.filter((item) => item.class === 'generative')),
        }),
        Object.freeze({
            id: 'deterministic' as const,
            title: 'Funzioni deterministiche',
            description: 'Applicano regole e repertori locali senza dipendere da un modello generativo.',
            capabilities: Object.freeze(sorted.filter((item) => item.class === 'deterministic')),
        }),
    ]);
}

export function orderVenueObservations(
    observations: readonly VenueObservation[],
): readonly VenueObservation[] {
    return Object.freeze([...observations].sort((left, right) => (
        (VENUE_ORDER.get(left.venue) ?? Number.MAX_SAFE_INTEGER)
        - (VENUE_ORDER.get(right.venue) ?? Number.MAX_SAFE_INTEGER)
    )));
}

export type EgressProfileSummary = Readonly<{
    id: EgressProfileId;
    capabilityCount: number;
}>;

export function summarizeEgressProfiles(
    capabilities: readonly FabricStatusCapability[],
): readonly EgressProfileSummary[] {
    const counts: Record<EgressProfileId, number> = {
        local_only: 0,
        cloud_authorized_redacted: 0,
    };

    for (const capability of capabilities) {
        counts[capability.egressProfile.id] += 1;
    }

    return Object.freeze((Object.keys(EGRESS_PROFILES) as EgressProfileId[]).map((id) => Object.freeze({
        id,
        capabilityCount: counts[id],
    })));
}

export function venueReasonLabel(reason: VenueObservationReason | null): string {
    return reason === null ? 'Nessun limite rilevato dalla verifica corrente.' : VENUE_OBSERVATION_REASON_LABELS[reason];
}

const FABRIC_STATUS_KEYS = Object.freeze([
    'capabilities',
    'contractVersion',
    'egressGateOpen',
    'providerDisclosure',
    'readinessNote',
    'schemaVersion',
] as const);

const FABRIC_STATUS_CAPABILITY_KEYS = Object.freeze([
    'availabilityDisposition',
    'class',
    'contractSchema',
    'egressProfile',
    'id',
    'killSwitch',
    'operation',
    'review',
    'venues',
] as const);

const FABRIC_STATUS_EGRESS_PROFILE_KEYS = Object.freeze([
    'egress',
    'id',
    'version',
] as const);

const PROVIDER_DISCLOSURE_KEYS = Object.freeze(['providers', 'schemaVersion'] as const);
const PROVIDER_DISCLOSURE_ROW_KEYS = Object.freeze(['declared', 'effective', 'id', 'label'] as const);
const PROVIDER_DECLARED_KEYS = Object.freeze([
    'accessBoundary',
    'credentialClass',
    'egress',
    'executionDisposition',
    'lifecycle',
    'runtimeObservation',
    'venue',
] as const);
const PROVIDER_EFFECTIVE_KEYS = Object.freeze([
    'credentialClass',
    'egress',
    'executionDisposition',
    'lifecycle',
    'runtimeObservation',
    'venue',
] as const);
const CANONICAL_PROVIDER_DISCLOSURE = buildProviderDisclosureSnapshot({
    ollama: () => ({ status: 'denied', reason: 'unavailable' }),
    athena: () => ({ status: 'denied', reason: 'unavailable' }),
});

function hasExactKeys(value: object, expected: readonly string[]): boolean {
    const keys = Object.keys(value);
    return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function equalsStringArray(value: unknown, expected: readonly string[]): boolean {
    return Array.isArray(value)
        && value.length === expected.length
        && value.every((item, index) => item === expected[index]);
}

function isCanonicalProviderDisclosure(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !hasExactKeys(value, PROVIDER_DISCLOSURE_KEYS)) return false;
    const disclosure = value as Record<string, unknown>;
    if (disclosure.schemaVersion !== 'mediflow.ai.provider-disclosure.v1'
        || !Array.isArray(disclosure.providers)
        || disclosure.providers.length !== PROVIDER_DISCLOSURE_IDS.length) return false;

    return disclosure.providers.every((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
            || !hasExactKeys(candidate, PROVIDER_DISCLOSURE_ROW_KEYS)) return false;
        const row = candidate as Record<string, unknown>;
        const expected = CANONICAL_PROVIDER_DISCLOSURE.providers[index];
        const declared = row.declared;
        const effective = row.effective;
        if (row.id !== expected.id || row.label !== expected.label
            || !declared || typeof declared !== 'object' || Array.isArray(declared)
            || !hasExactKeys(declared, PROVIDER_DECLARED_KEYS)
            || !effective || typeof effective !== 'object' || Array.isArray(effective)
            || !hasExactKeys(effective, PROVIDER_EFFECTIVE_KEYS)) return false;
        const declaredRecord = declared as Record<string, unknown>;
        const expectedDeclared = expected.declared as Record<string, unknown>;
        if (PROVIDER_DECLARED_KEYS.some((key) => declaredRecord[key] !== expectedDeclared[key])) return false;

        const effectiveRecord = effective as Record<string, unknown>;
        if (effectiveRecord.runtimeObservation !== 'not_observed'
            || effectiveRecord.venue !== null
            || effectiveRecord.egress !== null) return false;
        const local = index < 2;
        if (!local) {
            return effectiveRecord.lifecycle === 'not_applicable'
                && effectiveRecord.credentialClass === null
                && effectiveRecord.executionDisposition === 'execution_disabled';
        }
        const lifecycle = effectiveRecord.lifecycle;
        const lifecycleObserved = lifecycle === 'available_unqualified'
            || lifecycle === 'degraded'
            || lifecycle === 'revoked';
        const denied = lifecycle !== 'available_unqualified';
        return (
            lifecycleObserved
            || lifecycle === 'missing'
            || lifecycle === 'corrupt'
            || lifecycle === 'unavailable'
            || lifecycle === 'invalid'
        )
            && effectiveRecord.credentialClass === (lifecycleObserved ? 'local_model' : null)
            && effectiveRecord.executionDisposition === (denied ? 'denied_by_contract' : 'not_observed');
    });
}

export function parseFabricSnapshotPair(
    status: unknown,
    observability: unknown,
): Readonly<{
    status: FabricStatusSnapshot;
    observability: FabricObservabilitySnapshot;
}> {
    if (
        !status
        || typeof status !== 'object'
        || !hasExactKeys(status, FABRIC_STATUS_KEYS)
        || !('schemaVersion' in status)
        || status.schemaVersion !== 'mediflow.ai.fabric-status.v1'
        || !('contractVersion' in status)
        || status.contractVersion !== FABRIC_SCHEMA_VERSION
        || !('egressGateOpen' in status)
        || typeof status.egressGateOpen !== 'boolean'
        || !('readinessNote' in status)
        || status.readinessNote !== 'available_unqualified'
        || !('capabilities' in status)
        || !Array.isArray(status.capabilities)
        || !('providerDisclosure' in status)
        || !observability
        || typeof observability !== 'object'
        || !('schemaVersion' in observability)
        || observability.schemaVersion !== 'mediflow.ai.fabric-observability.v1'
        || !('fallback' in observability)
        || observability.fallback !== 'denied_by_contract'
        || !('observations' in observability)
        || !Array.isArray(observability.observations)
    ) {
        throw new Error('Snapshot Fabric non conforme al contratto atteso.');
    }

    if (!isCanonicalProviderDisclosure(status.providerDisclosure)) {
        throw new Error('Disclosure provider Fabric non conforme.');
    }

    const capabilityIds = new Set<string>([
        ...GENERATIVE_CAPABILITY_IDS,
        ...DETERMINISTIC_CAPABILITY_IDS,
    ]);
    const venueIds = new Set<string>(FABRIC_VENUES);
    const reasons = new Set<string>(VENUE_OBSERVATION_REASONS);

    if (status.capabilities.some((capability) => {
        if (
            !capability
            || typeof capability !== 'object'
            || !('id' in capability)
            || typeof capability.id !== 'string'
            || !capabilityIds.has(capability.id)
            || !hasExactKeys(capability, FABRIC_STATUS_CAPABILITY_KEYS)
        ) return true;

        const expected = FABRIC_CAPABILITY_DESCRIPTORS[capability.id as FabricCapabilityId];
        const record = capability as Record<string, unknown>;
        const expectedProfile = EGRESS_PROFILES[expected.egressProfileId];
        const profile = record.egressProfile;
        return record.class !== expected.class
            || record.operation !== expected.operation
            || record.review !== expected.review
            || record.availabilityDisposition !== expected.availabilityDisposition
            || !equalsStringArray(record.venues, expected.venues)
            || record.killSwitch !== expected.killSwitch
            || record.contractSchema !== expected.contractSchema
            || !profile
            || typeof profile !== 'object'
            || Array.isArray(profile)
            || !hasExactKeys(profile, FABRIC_STATUS_EGRESS_PROFILE_KEYS)
            || !('id' in profile)
            || profile.id !== expectedProfile.id
            || !('version' in profile)
            || profile.version !== expectedProfile.version
            || !('egress' in profile)
            || profile.egress !== expectedProfile.egress;
    })) {
        throw new Error('Registro capability Fabric non conforme.');
    }
    const observedCapabilityIds = status.capabilities.map((capability) => capability.id as string);
    if (
        observedCapabilityIds.length !== capabilityIds.size
        || new Set(observedCapabilityIds).size !== capabilityIds.size
        || observedCapabilityIds.some((id) => !capabilityIds.has(id))
    ) {
        throw new Error('Registro capability Fabric incompleto o duplicato.');
    }

    if (observability.observations.some((observation) => (
        !observation
        || typeof observation !== 'object'
        || !('venue' in observation)
        || typeof observation.venue !== 'string'
        || !venueIds.has(observation.venue)
        || !('reason' in observation)
        || (observation.reason !== null && (typeof observation.reason !== 'string' || !reasons.has(observation.reason)))
    ))) {
        throw new Error('Osservazioni Fabric non conformi.');
    }
    const observedVenues = observability.observations.map((observation) => observation.venue as string);
    if (
        observedVenues.length !== venueIds.size
        || new Set(observedVenues).size !== venueIds.size
        || observedVenues.some((venue) => !venueIds.has(venue))
    ) {
        throw new Error('Osservazioni Fabric incomplete o duplicate.');
    }

    return Object.freeze({
        status: status as FabricStatusSnapshot,
        observability: observability as FabricObservabilitySnapshot,
    });
}
