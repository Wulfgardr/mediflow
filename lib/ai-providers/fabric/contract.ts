/* @Claude */
// Contratto Intelligence Fabric v1 (ADR 0089, WUL-522).
//
// Questo file e' la superficie normativa condivisa: tipi e costanti congelate,
// nessuna logica di risoluzione. La risoluzione vive in resolver.ts; il
// catalogo delle capability deterministiche vive in deterministic-catalog.ts.
//
// Invarianti non negoziabili (ADR 0077, 0086, 0088):
// - routing per capability, mai per brand del provider;
// - venue esplicita in ogni ricevuta; nessun fallback implicito;
// - egress solo attraverso profili versionati; nessun profilo soddisfatto
//   implica gate aperto (isEgressGateOpen() resta l'autorita' runtime);
// - una ricevuta o un tipo non autorizzano mai un consumer;
// - nessuna capability deriva dal nome del modello (A3 observed_not_causal);
// - il piano engineering_operator resta fuori dalla fabric clinica.

import type { AIProvider } from '../provider';
import type { ProviderSelectionReceipt } from '../registry';

export const FABRIC_SCHEMA_VERSION = 'mediflow.ai.fabric.v1' as const;

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

export const GENERATIVE_CAPABILITY_IDS = [
    'patient_insight',
    'smart_import',
    'document_synthesis',
    'ocr',
    'treatment_reasoning',
] as const;

export const DETERMINISTIC_CAPABILITY_IDS = [
    'icd_lookup',
    'aifa_drug_search',
    'service_prescription_matching',
    'evidence_absorption',
    'patient_open_loops',
    'fhir_export',
    'document_classification',
    'document_identity_resolution',
    'pii_redaction_layer1',
    'fse_document_validation',
    'observation_range_classification',
] as const;

export type GenerativeCapabilityId = typeof GENERATIVE_CAPABILITY_IDS[number];
export type DeterministicCapabilityId = typeof DETERMINISTIC_CAPABILITY_IDS[number];
export type FabricCapabilityId = GenerativeCapabilityId | DeterministicCapabilityId;

export type CapabilityClass = 'generative' | 'deterministic';

export type FabricOperation =
    | 'extraction'
    | 'ocr'
    | 'reasoning'
    | 'synthesis'
    | 'classification'
    | 'lookup'
    | 'matching'
    | 'validation'
    | 'projection'
    | 'export'
    | 'redaction';

export type FabricDataClass =
    | 'clinical'
    | 'administrative'
    | 'model_metadata'
    | 'synthetic_fixture';

// La review resta una proprieta' della lane applicativa. 'review_first'
// significa che l'output propone e un umano decide; 'informational' copre le
// proiezioni deterministiche che non producono candidati di scrittura.
export type FabricReviewPolicy = 'review_first' | 'informational';

// ---------------------------------------------------------------------------
// Venue
// ---------------------------------------------------------------------------

// La venue descrive la classe di nodo che esegue il calcolo:
// - local_process: processo host localhost, incluso il daemon loopback;
// - home_base: nodo host che esegue per conto di un client paired;
// - on_device: esecuzione locale del client (nessuna capability oggi);
// - cloud: provider remoto esplicitamente autorizzato (nessuno oggi).
export const FABRIC_VENUES = ['local_process', 'home_base', 'on_device', 'cloud'] as const;
export type FabricVenue = typeof FABRIC_VENUES[number];

// ---------------------------------------------------------------------------
// Profili egress versionati
// ---------------------------------------------------------------------------

export const EGRESS_PROFILE_VERSION = 'mediflow.ai.egress-profile.v1' as const;

export type EgressProfileId = 'local_only' | 'cloud_authorized_redacted';

export type EgressRequirement =
    | 'redaction_lane_promoted'
    | 'explicit_consent'
    | 'retention_declared'
    | 'provider_authorized';

export interface EgressProfile {
    readonly id: EgressProfileId;
    readonly version: typeof EGRESS_PROFILE_VERSION;
    readonly egress: 'none' | 'redacted_explicit_consent';
    readonly requires: readonly EgressRequirement[];
}

// closed-by-construction: cloud_authorized_redacted elenca requisiti che oggi
// nessun runtime soddisfa (la lane redaction e' benchmark_only e il gate
// egress risponde sempre chiuso). Il profilo esiste per rendere esplicito il
// percorso, non per aprirlo.
export const EGRESS_PROFILES: Readonly<Record<EgressProfileId, EgressProfile>> = Object.freeze({
    local_only: Object.freeze({
        id: 'local_only',
        version: EGRESS_PROFILE_VERSION,
        egress: 'none',
        requires: Object.freeze([]) as readonly EgressRequirement[],
    }),
    cloud_authorized_redacted: Object.freeze({
        id: 'cloud_authorized_redacted',
        version: EGRESS_PROFILE_VERSION,
        egress: 'redacted_explicit_consent',
        requires: Object.freeze([
            'redaction_lane_promoted',
            'explicit_consent',
            'retention_declared',
            'provider_authorized',
        ]) as readonly EgressRequirement[],
    }),
});

// ---------------------------------------------------------------------------
// Classi di credenziale (dichiarative, nessun segreto nella fabric)
// ---------------------------------------------------------------------------

// Distinzione richiesta dal contratto WUL-522: un login consumer non e' un
// abbonamento, un abbonamento non e' una API key, una API key non e' OAuth e
// nessuno di questi equivale a un modello locale senza credenziale.
export type CredentialClass =
    | 'local_model'
    | 'consumer_login'
    | 'subscription'
    | 'api_key'
    | 'oauth';

// ---------------------------------------------------------------------------
// Descrittore di capability
// ---------------------------------------------------------------------------

export interface FabricCapabilityDescriptor {
    readonly id: FabricCapabilityId;
    readonly class: CapabilityClass;
    readonly operation: FabricOperation;
    readonly authorityPlane: 'clinical_application';
    readonly dataClass: FabricDataClass;
    // Venue ammesse per la capability. L'assenza di 'cloud' e 'on_device' e'
    // lo stato corrente, non un vincolo permanente (ADR 0088).
    readonly venues: readonly FabricVenue[];
    readonly egressProfileId: EgressProfileId;
    readonly review: FabricReviewPolicy;
    // Chiave del kill switch esistente quando la lane ne ha uno; null per le
    // capability deterministiche senza interruttore dedicato.
    readonly killSwitch: string | null;
    // Identificatore del contratto dati versionato quando esiste
    // (es. 'mediflow.evidence_queue.v1'); null quando il modulo non espone
    // ancora uno schema versionato.
    readonly contractSchema: string | null;
    // Punto di ingresso principale nel repository, per audit e provenance
    // (path relativo, non usato a runtime per il dispatch).
    readonly entryPoint: string;
}

// ---------------------------------------------------------------------------
// Policy di esecuzione immutabile (seme WUL-499)
// ---------------------------------------------------------------------------

// Costruita dalla lane applicativa PRIMA della risoluzione. Non contiene
// credenziali, non concede autorita' clinica, non contiene mai
// 'clinical.write': ogni scrittura resta un comando applicativo successivo.
export interface FabricExecutionPolicy {
    readonly schemaVersion: 'mediflow.ai.execution-policy.v1';
    readonly requestId: string;
    readonly capability: FabricCapabilityId;
    readonly authorityPlane: 'clinical_application';
    readonly operation: FabricOperation;
    readonly dataClass: FabricDataClass;
    readonly allowedVenues: readonly FabricVenue[];
    readonly egressProfileId: EgressProfileId;
    // Riferimento opaco al consenso quando il profilo lo richiede; null oggi.
    readonly consentRef: string | null;
    readonly retention: 'not_persisted' | 'local_only';
    readonly review: FabricReviewPolicy;
    readonly provenanceRequired: true;
    // Il fallback resta chiuso per default contrattuale. Un valore diverso da
    // 'none' richiede un ADR dedicato (invarianti audit OpenMinis 3-7).
    readonly fallback: 'none';
}

// ---------------------------------------------------------------------------
// Ricevuta di risoluzione
// ---------------------------------------------------------------------------

export interface FabricResolutionReceipt {
    readonly schemaVersion: 'mediflow.ai.fabric-resolution.v1';
    readonly capability: FabricCapabilityId;
    readonly class: CapabilityClass;
    readonly venue: FabricVenue;
    readonly egressProfile: Readonly<Pick<EgressProfile, 'id' | 'version' | 'egress'>>;
    // 'in_house' identifica le pipeline deterministiche senza provider AI.
    readonly provider: AIProvider | 'in_house';
    readonly model: string | null;
    // Ricevuta del registry provider per le capability generative; null per
    // le deterministiche. La ricevuta non autorizza alcun consumer.
    readonly providerReceipt: ProviderSelectionReceipt | null;
    readonly fallbackCount: 0;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

// Record di provenienza allegabile agli output di lane: nomina provider,
// preprocessing e venue senza contenere prompt, payload o dati clinici.
export interface FabricProvenanceRecord {
    readonly schemaVersion: 'mediflow.ai.fabric-provenance.v1';
    readonly capability: FabricCapabilityId;
    readonly venue: FabricVenue;
    readonly provider: AIProvider | 'in_house';
    readonly model: string | null;
    // Nomi dei passi di preprocessing applicati (es. 'layer1_redaction');
    // solo etichette, mai contenuto.
    readonly preprocessing: readonly string[];
    readonly receipt: FabricResolutionReceipt;
}

// ---------------------------------------------------------------------------
// Errori fail-closed
// ---------------------------------------------------------------------------

export type FabricPolicyErrorCode =
    | 'capability_unknown'
    | 'class_mismatch'
    | 'venue_not_allowed'
    | 'egress_profile_unknown'
    | 'egress_profile_unsatisfied'
    | 'cloud_not_authorized'
    | 'policy_invalid';

export class FabricPolicyError extends Error {
    constructor(public readonly code: FabricPolicyErrorCode) {
        super(`Fabric resolution rejected: ${code}`);
        this.name = 'FabricPolicyError';
    }
}
