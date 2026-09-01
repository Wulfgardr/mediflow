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

function hasExactKeys(value: object, expected: readonly string[]): boolean {
    const keys = Object.keys(value);
    return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function equalsStringArray(value: unknown, expected: readonly string[]): boolean {
    return Array.isArray(value)
        && value.length === expected.length
        && value.every((item, index) => item === expected[index]);
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
