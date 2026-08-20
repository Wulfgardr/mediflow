/* @Codex */

export const AGENT_INTERFACE_MANIFEST_SCHEMA = 'mediflow.agent-interface.manifest.v2' as const;
export const AGENT_INTERFACE_CAPABILITY_SCHEMA = 'mediflow.agent-interface.capability.v1' as const;

export type AgentInterfaceStage = 'observe' | 'read' | 'compute' | 'propose' | 'preview' | 'apply';
export type AgentInterfaceHeadlessDisposition = 'available' | 'proposal_only' | 'manual_only' | 'unavailable';
export type AgentInterfaceAuthorityProfile = 'agent_session_context_lease' | 'not_grantable';
export type AgentInterfaceSourceKind = 'openApi' | 'paired' | 'fabric';
export type AgentInterfaceSourceClassifications = Readonly<Partial<Record<AgentInterfaceSourceKind, readonly string[]>>>;

export interface AgentInterfaceCapability {
    readonly id: string;
    readonly schemaVersion: typeof AGENT_INTERFACE_MANIFEST_SCHEMA;
    readonly capabilitySchemaVersion: typeof AGENT_INTERFACE_CAPABILITY_SCHEMA;
    readonly maximumStage: AgentInterfaceStage;
    readonly headlessDisposition: AgentInterfaceHeadlessDisposition;
    readonly authorityProfile: AgentInterfaceAuthorityProfile;
    readonly requiredContext: readonly string[];
    readonly venue: readonly string[];
    readonly egress: 'none';
    readonly fallback: 'denied_by_contract';
    readonly reason: string | null;
    readonly sources: AgentInterfaceSourceClassifications;
}

const OPENAPI_OPERATIONS = [
    'GET /api/v1/patients', 'GET /api/v1/patients/{id}', 'PUT /api/v1/patients/{id}', 'DELETE /api/v1/patients/{id}',
    'GET /api/v1/network/node', 'GET /api/v1/network/session', 'GET /api/v1/network/capabilities', 'GET /api/v1/network/identity', 'GET /api/v1/network/revision', 'GET /api/v1/network/ai-runtime', 'POST /api/v1/network/visit-draft',
    'GET /api/v1/network/pairing-intents', 'POST /api/v1/network/pairing-intents', 'POST /api/v1/network/pairing-intents/{intentId}/confirm', 'DELETE /api/v1/network/pairing-clients/{clientId}',
    'GET /api/v1/network/ambulatories', 'POST /api/v1/network/ambulatories', 'PUT /api/v1/network/ambulatories/{id}', 'DELETE /api/v1/network/ambulatories/{id}', 'POST /api/v1/network/ambulatories/clear',
    'GET /api/v1/network/drugs', 'GET /api/v1/network/exemptions', 'GET /api/v1/network/terminology/search', 'GET /api/v1/network/terminology/resolve', 'GET /api/v1/network/terminology/systems',
    'GET /api/v1/network/service-prescriptions', 'POST /api/v1/network/service-prescriptions', 'PUT /api/v1/network/service-prescriptions/{id}', 'GET /api/v1/network/service-prescription-items', 'POST /api/v1/network/service-prescription-items', 'PUT /api/v1/network/service-prescription-items/{id}', 'GET /api/v1/network/service-catalog',
    'GET /api/v1/network/prosthetic-prescriptions', 'POST /api/v1/network/prosthetic-prescriptions', 'PUT /api/v1/network/prosthetic-prescriptions/{id}',
    'GET /api/v1/network/patients', 'POST /api/v1/network/patients', 'GET /api/v1/network/checkups', 'GET /api/v1/network/entries', 'GET /api/v1/network/patients/{id}', 'PUT /api/v1/network/patients/{id}', 'DELETE /api/v1/network/patients/{id}', 'POST /api/v1/network/patients/{id}/restore',
    'GET /api/v1/network/patients/{id}/entries', 'POST /api/v1/network/patients/{id}/entries', 'GET /api/v1/network/patients/{id}/entries/{entryId}', 'PUT /api/v1/network/patients/{id}/entries/{entryId}',
    'GET /api/v1/network/patients/{id}/therapies', 'POST /api/v1/network/patients/{id}/therapies', 'GET /api/v1/network/patients/{id}/therapies/{therapyId}', 'PUT /api/v1/network/patients/{id}/therapies/{therapyId}',
    'GET /api/v1/network/patients/{id}/checkups', 'POST /api/v1/network/patients/{id}/checkups', 'GET /api/v1/network/patients/{id}/checkups/{checkupId}', 'PUT /api/v1/network/patients/{id}/checkups/{checkupId}',
    'GET /api/v1/network/patients/{id}/observations', 'POST /api/v1/network/patients/{id}/observations', 'GET /api/v1/network/patients/{id}/observations/{observationId}', 'PUT /api/v1/network/patients/{id}/observations/{observationId}',
    'GET /api/v1/network/patients/{id}/attachments', 'POST /api/v1/network/patients/{id}/attachments', 'GET /api/v1/network/patients/{id}/attachments/{attachmentId}', 'GET /api/v1/network/fse/validate-patient', 'POST /api/v1/network/fse/validate-document',
] as const;

const PAIRED_CAPABILITIES = [
    'network.pairing.bootstrap', 'network.ambulatories.write', 'network.replica.readonly-patients', 'network.replica.readonly-clinical-diary', 'network.replica.write-patient-profile', 'network.replica.write-patient-lifecycle', 'network.replica.write-clinical-diary', 'network.replica.readonly-therapies', 'network.replica.write-therapies', 'network.replica.readonly-checkups', 'network.replica.readonly-agenda', 'network.replica.readonly-clinical-diary-global', 'network.replica.write-checkups', 'network.replica.readonly-observations', 'network.replica.write-observations', 'network.replica.readonly-service-prescriptions', 'network.replica.write-service-prescriptions', 'network.replica.readonly-prosthetic-prescriptions', 'network.replica.write-prosthetic-prescriptions', 'network.fse.validate', 'network.catalogs.readonly', 'network.replica.readonly-documents', 'network.replica.write-documents', 'network.compute.visit-draft', 'network.replica.sync', 'network.ai.central-runtime', 'network.catalogs.sync', 'local.backup.artifact.v1', 'local.backup.scheduler.macos',
] as const;

const FABRIC_CAPABILITIES = [
    'patient_insight', 'smart_import', 'document_synthesis', 'ocr', 'treatment_reasoning',
    'icd_lookup', 'aifa_drug_search', 'service_prescription_matching', 'evidence_absorption', 'patient_open_loops', 'fhir_export', 'document_classification', 'document_identity_resolution', 'pii_redaction_layer1', 'fse_document_validation', 'observation_range_classification',
] as const;

const MANUAL_REASON = 'ADR 0093 remains Proposed: no agent session, context lease, or adapter authorizes this capability.';

function classified(kind: AgentInterfaceSourceKind, identifiers: readonly string[]): AgentInterfaceCapability[] {
    return identifiers.map((identifier) => Object.freeze({
        id: `agent.interface.${kind}.${identifier.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.v1`,
        schemaVersion: AGENT_INTERFACE_MANIFEST_SCHEMA,
        capabilitySchemaVersion: AGENT_INTERFACE_CAPABILITY_SCHEMA,
        maximumStage: 'observe',
        headlessDisposition: 'manual_only',
        authorityProfile: 'not_grantable',
        requiredContext: Object.freeze([]),
        venue: Object.freeze(['local_process']),
        egress: 'none',
        fallback: 'denied_by_contract',
        reason: MANUAL_REASON,
        sources: Object.freeze({ [kind]: Object.freeze([identifier]) }),
    }));
}

export const AGENT_INTERFACE_MANIFEST: readonly AgentInterfaceCapability[] = Object.freeze([
    ...classified('openApi', OPENAPI_OPERATIONS),
    ...classified('paired', PAIRED_CAPABILITIES),
    ...classified('fabric', FABRIC_CAPABILITIES),
]);

const STAGES = new Set<AgentInterfaceStage>(['observe', 'read', 'compute', 'propose', 'preview', 'apply']);
const DISPOSITIONS = new Set<AgentInterfaceHeadlessDisposition>(['available', 'proposal_only', 'manual_only', 'unavailable']);
const SOURCE_KINDS = new Set<AgentInterfaceSourceKind>(['openApi', 'paired', 'fabric']);
const CAPABILITY_KEYS = new Set(['id', 'schemaVersion', 'capabilitySchemaVersion', 'maximumStage', 'headlessDisposition', 'authorityProfile', 'requiredContext', 'venue', 'egress', 'fallback', 'reason', 'sources']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isTextArray(value: unknown, allowEmpty: boolean): value is readonly string[] {
    return Array.isArray(value) && Object.keys(value).length === value.length && Object.keys(value).every((key, index) => key === String(index)) && (allowEmpty || value.length > 0)
        && value.every(isText) && new Set(value).size === value.length;
}

function isSources(value: unknown): value is AgentInterfaceSourceClassifications {
    if (!isRecord(value)) return false;
    const entries = Object.entries(value);
    return entries.length > 0 && entries.every(([kind, identifiers]) =>
        SOURCE_KINDS.has(kind as AgentInterfaceSourceKind) && isTextArray(identifiers, false));
}

// @Codex: validates untrusted manifest data before any grant resolution or copy.
export function validateAgentInterfaceManifest(manifest: unknown): string[] {
    try {
        if (!Array.isArray(manifest)) return ['manifest: must be an array'];
        const errors: string[] = [];
        const capabilityIds = new Set<string>();
        for (const [index, value] of manifest.entries()) {
            const label = isRecord(value) && isText(value.id) ? value.id : `manifest[${index}]`;
            if (!isRecord(value)) { errors.push(`${label}: capability must be an object`); continue; }
            if (Object.keys(value).some((key) => !CAPABILITY_KEYS.has(key))) errors.push(`${label}: unknown capability field`);
            if (!isText(value.id)) errors.push(`${label}: id must be non-empty text`);
            else if (capabilityIds.has(value.id)) errors.push(`${label}: duplicated capability id`);
            else capabilityIds.add(value.id);
            if (value.schemaVersion !== AGENT_INTERFACE_MANIFEST_SCHEMA) errors.push(`${label}: schemaVersion must be ${AGENT_INTERFACE_MANIFEST_SCHEMA}`);
            if (value.capabilitySchemaVersion !== AGENT_INTERFACE_CAPABILITY_SCHEMA) errors.push(`${label}: capabilitySchemaVersion must be ${AGENT_INTERFACE_CAPABILITY_SCHEMA}`);
            if (!STAGES.has(value.maximumStage as AgentInterfaceStage)) errors.push(`${label}: maximumStage is invalid`);
            if (!DISPOSITIONS.has(value.headlessDisposition as AgentInterfaceHeadlessDisposition)) errors.push(`${label}: headlessDisposition is invalid`);
            if (value.authorityProfile !== 'agent_session_context_lease' && value.authorityProfile !== 'not_grantable') errors.push(`${label}: authorityProfile is invalid`);
            if (value.headlessDisposition === 'available' && value.authorityProfile !== 'agent_session_context_lease') errors.push(`${label}: available requires agent_session_context_lease`);
            if (value.headlessDisposition !== 'available' && DISPOSITIONS.has(value.headlessDisposition as AgentInterfaceHeadlessDisposition) && value.authorityProfile !== 'not_grantable') errors.push(`${label}: ${value.headlessDisposition} must remain not_grantable`);
            if (value.headlessDisposition === 'available' && value.maximumStage === 'apply') errors.push(`${label}: apply cannot be granted by ADR 0093`);
            if (!isTextArray(value.requiredContext, true)) errors.push(`${label}: requiredContext must be a unique text array`);
            if (!isTextArray(value.venue, false)) errors.push(`${label}: venue must be a non-empty unique text array`);
            if (value.egress !== 'none') errors.push(`${label}: egress must be none`);
            if (value.fallback !== 'denied_by_contract') errors.push(`${label}: fallback must be denied_by_contract`);
            if (value.reason !== null && !isText(value.reason)) errors.push(`${label}: reason must be null or non-empty text`);
            if (value.headlessDisposition === 'available' && value.reason !== null) errors.push(`${label}: reason must be null for available`);
            if (value.headlessDisposition !== 'available' && DISPOSITIONS.has(value.headlessDisposition as AgentInterfaceHeadlessDisposition) && !isText(value.reason)) errors.push(`${label}: reason is required for ${value.headlessDisposition}`);
            if (!isSources(value.sources)) errors.push(`${label}: sources must use known kinds and non-empty unique text arrays`);
        }
        return errors;
    } catch {
        return ['manifest: invalid'];
    }
}
