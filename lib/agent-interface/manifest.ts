/* @Codex */

export const AGENT_INTERFACE_MANIFEST_SCHEMA = 'mediflow.agent-interface.manifest.v1' as const;

type SourceKind = 'openApi' | 'paired' | 'fabric';
type SourceClassifications = Partial<Record<SourceKind, readonly string[]>>;
type HeadlessDisposition = 'available' | 'proposal_only' | 'manual_only' | 'unavailable';

export interface AgentInterfaceCapability {
    readonly id: string;
    readonly schemaVersion: typeof AGENT_INTERFACE_MANIFEST_SCHEMA;
    readonly maximumStage: 'observe' | 'read' | 'compute' | 'propose' | 'preview' | 'apply';
    readonly headlessDisposition: HeadlessDisposition;
    readonly requiredContext: readonly string[];
    readonly venue: readonly string[];
    readonly egress: 'none';
    readonly fallback: 'denied_by_contract';
    readonly reason: string | null;
    readonly sources: SourceClassifications;
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

function classified(kind: SourceKind, identifiers: readonly string[]): AgentInterfaceCapability[] {
    return identifiers.map((identifier) => Object.freeze({
        id: `agent.interface.${kind}.${identifier.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.v1`,
        schemaVersion: AGENT_INTERFACE_MANIFEST_SCHEMA,
        maximumStage: 'observe',
        headlessDisposition: 'manual_only',
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

export function validateAgentInterfaceManifest(manifest: readonly AgentInterfaceCapability[]): string[] {
    const errors: string[] = [];
    const capabilityIds = new Set<string>();
    for (const capability of manifest) {
        if (capabilityIds.has(capability.id)) errors.push(`${capability.id}: duplicated capability id`);
        capabilityIds.add(capability.id);
        if (!capability.id || !capability.schemaVersion || !capability.maximumStage || !capability.headlessDisposition) errors.push(`${capability.id}: required declaration is missing`);
        if (capability.schemaVersion !== AGENT_INTERFACE_MANIFEST_SCHEMA) errors.push(`${capability.id}: schemaVersion must be ${AGENT_INTERFACE_MANIFEST_SCHEMA}`);
        if (capability.headlessDisposition !== 'available' && !capability.reason) errors.push(`${capability.id}: reason is required for ${capability.headlessDisposition}`);
        if (!Object.values(capability.sources).some((identifiers) => identifiers?.length)) errors.push(`${capability.id}: at least one source classification is required`);
    }
    return errors;
}
