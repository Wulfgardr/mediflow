// Codex: created 2026-02-01

import type { DocumentOcrQueueReason, DocumentOcrQueueState } from '../../domain/documents/document-ocr-queue';

export type PatientSummary = {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    taxCode: string;
    isAdi: boolean | null;
    isArchived: boolean | null;
    deletedAt?: string | null;
    deletionReason?: string | null;
    version: number;
    updatedAt: string | null;
    diagnoses?: string | null;
};

export type PatientDetail = {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    taxCode: string;
    address: string | null;
    phone: string | null;
    caregiver: string | null;
    exemptions: string | null;
    diagnoses: string | null;
    monitoringProfile: string | null;
    statusReason: string | null;
    archiveReason: string | null;
    archiveNote: string | null;
    notes: string | null;
    aiSummary: string | null;
    aiSummaryGeneratedAt: string | null;
    aiSummaryContextHash: string | null;
    documentInsights: string | null;
    isAdi: boolean | null;
    isArchived: boolean | null;
    deletedAt?: string | null;
    deletionReason?: string | null;
    version: number;
    ambulatoryId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

export type AmbulatorySummary = {
    id: string;
    name: string;
    address: string | null;
    parentId: string | null;
    type: string | null;
    description: string | null;
    isDefault: boolean | null;
    version: number;
    createdAt: string | null;
};

export type EntrySummary = {
    id: string;
    patientId: string;
    type: string;
    title: string;
    date: string;
    content: string;
    setting: string | null;
    metadata: string | null;
    attachments: string | null;
    deletedAt: string | null;
    deletionReason: string | null;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
};

export type TherapySummary = {
    id: string;
    patientId: string;
    drugName: string;
    aic: string | null;
    atc: string | null;
    activePrinciple: string | null;
    dosage: string;
    motivation: string | null;
    diagnosisCode: string | null;
    diagnosisName: string | null;
    status: string;
    startDate: string;
    endDate: string | null;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
    deletionReason: string | null;
};

export type CheckupSummary = {
    id: string;
    patientId: string;
    date: string;
    title: string;
    notes: string | null;
    status: string;
    source: string | null;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
    deletionReason: string | null;
};

export type ObservationSummary = {
    id: string;
    patientId: string;
    codeSystem: string;
    code: string;
    display: string;
    unitSystem: string;
    unitCode: string;
    value: string;
    notes: string | null;
    refLow: string | null;
    refHigh: string | null;
    refText: string | null;
    observedAt: string;
    source: string | null;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
    deletionReason: string | null;
};

export type AttachmentSummary = {
    id: string;
    patientId: string;
    name: string;
    type: string;
    size: number;
    path: string;
    summarySnapshot: string | null;
    parseEvidenceArtifactSnapshot: string | null;
    ocrQueueState: DocumentOcrQueueState | null;
    ocrQueueReason: DocumentOcrQueueReason | null;
    ocrQueueUpdatedAt: string | null;
    ocrReplayArtifactSnapshot: string | null;
    createdAt: string | null;
};

export type AttachmentDetail = AttachmentSummary & {
    data: string | null;
};

export type DrugSummary = {
    aic: string;
    name: string;
    activePrinciple: string | null;
    company: string | null;
    packaging: string | null;
    class: string | null;
    price: number | null;
    atc: string | null;
};

export type ExemptionSummary = {
    code: string;
    description: string;
    type: string | null;
    source: string | null;
    startDate: string | null;
    endDate: string | null;
    isPharma: boolean | null;
    isSpecialist: boolean | null;
    isNational: boolean | null;
    updatedAt: string | null;
};

export type ServicePrescriptionSummary = {
    id: string;
    patientId: string;
    prescribedAt: string;
    status: string;
    category: string;
    priority: string | null;
    codeSystem: string | null;
    serviceCode: string | null;
    serviceName: string;
    clinicalQuestion: string | null;
    provider: string | null;
    scheduledAt: string | null;
    performedAt: string | null;
    reportReceivedAt: string | null;
    outcomeNote: string | null;
    requestReference: string | null;
    source: string;
    documentRefs: string | null;
    notes: string | null;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
};

export type ServicePrescriptionItemSummary = {
    id: string;
    patientId: string;
    prescriptionId: string;
    ordinal: number;
    status: string;
    category: string | null;
    codeSystem: string | null;
    serviceCode: string | null;
    serviceName: string;
    catalogEntryId: string | null;
    catalogDisplayName: string | null;
    matchStatus: string;
    confidence: string | null;
    evidence: string | null;
    notes: string | null;
    scheduledAt: string | null;
    performedAt: string | null;
    reportReceivedAt: string | null;
    outcomeNote: string | null;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
};

export type ProstheticPrescriptionSummary = {
    id: string;
    patientId: string;
    prescribedAt: string;
    status: string;
    category: string;
    isoCode: string | null;
    description: string;
    measures: string | null;
    clinicalReason: string | null;
    regionalPrescriptionId: string | null;
    supplier: string | null;
    collaudoAt: string | null;
    collaudoOutcome: string | null;
    source: string;
    documentRefs: string | null;
    notes: string | null;
    version: number;
    createdAt: string | null;
    updatedAt: string | null;
};

export type ServiceCatalogEntrySummary = {
    id: string;
    codeSystem: string;
    serviceCode: string;
    displayName: string;
    category: string;
    branchCode: string | null;
    synonyms: string | null;
    source: string;
    version: string | null;
    active: boolean;
    importedAt: string | null;
    updatedAt: string | null;
};

export type NetworkOperatingMode = 'local-only' | 'network-home-base';

export type NetworkSessionState =
    | 'local-only'
    | 'network-unpaired'
    | 'network-paired-online'
    | 'network-paired-offline-degraded';

export type NetworkReplicaState =
    | 'local-only'
    | 'unpaired'
    | 'online'
    | 'offline-deferred'
    | 'conflict-review';

export type NetworkReplicaAuthority = 'local-device' | 'paired-home-base';

export type NetworkReplicaPendingAction =
    | 'none'
    | 'pairing-required'
    | 'queue-snapshot'
    | 'manual-review';

export type NetworkReplicaSummary = {
    strategy: 'encrypted-snapshot-mirror';
    state: NetworkReplicaState;
    authority: NetworkReplicaAuthority;
    pendingAction: NetworkReplicaPendingAction;
    conflictMode: 'restore-preflight-plus-version-check';
    backupBoundary: 'artifact-v1-remains-backup-only';
    lastSnapshotAt: string | null;
    lastReconciledAt: string | null;
};

export type NetworkIdentityCredentialState = 'session-bound' | 'node-credentials-required';

export type NetworkIdentityLoginMode = 'single-local-user-default' | 'explicit-username-required';

export type NetworkIdentityAuthChannel = 'web' | 'native' | 'system' | 'none';

export type NetworkIdentityScopeSource = 'session-context' | 'node-default' | 'none';

export type NetworkIdentityOperatorSummary = {
    userId: string | null;
    username: string | null;
    displayName: string | null;
    role: string | null;
    authChannel: NetworkIdentityAuthChannel;
};

export type NetworkIdentityScopeSummary = {
    policy: 'session-context-else-node-default';
    effectiveAmbulatoryId: string | null;
    effectiveAmbulatoryName: string | null;
    defaultAmbulatoryId: string | null;
    defaultAmbulatoryName: string | null;
    source: NetworkIdentityScopeSource;
};

export type NetworkIdentityAuditSummary = {
    actorType: 'user' | 'system';
    actorBinding: 'session-user' | 'token-only';
};

export type NetworkIdentitySummary = {
    identityModel: 'paired-device-plus-node-credentials';
    pairingBoundary: 'device-pairing-separate-from-operator-login';
    credentialState: NetworkIdentityCredentialState;
    loginMode: NetworkIdentityLoginMode;
    usernameHint: string | null;
    displayNameHint: string | null;
    operator: NetworkIdentityOperatorSummary;
    scope: NetworkIdentityScopeSummary;
    audit: NetworkIdentityAuditSummary;
    limitations: string[];
};

export type NetworkAiRuntimeMode =
    | 'local-ai'
    | 'centralized-available'
    | 'centralized-unavailable';

export type NetworkAiRuntimeLocalState = 'configured' | 'misconfigured';

export type NetworkAiRuntimeCentralState = 'disabled' | 'available' | 'unavailable';

export type NetworkAiRuntimeHardwareProfile = 'low' | 'medium' | 'high' | 'custom' | 'unknown';

export type NetworkAiRuntimeSurface =
    | 'patient-insight'
    | 'smart-import'
    | 'document-synthesis'
    | 'treatment-reasoning';

export type NetworkAiRuntimeKillSwitches = {
    patientInsight: 'enabled' | 'disabled';
    documentSynthesis: 'enabled' | 'disabled';
    smartImport: 'enabled' | 'disabled';
    treatmentReasoning: 'enabled' | 'disabled';
};

export type NetworkAiRuntimeFabricProjection = {
    schemaVersion: 'mediflow.ai.network-fabric-status.v1';
    contractVersion: 'mediflow.ai.fabric.v1';
    access: 'status_only';
    pairedExecution: 'not_authorized';
    egressGateOpen: false;
    readinessNote: 'available_unqualified';
    fallback: 'denied_by_contract';
    venues: {
        local_process: 'configured' | 'misconfigured';
        home_base: 'host_configured' | 'host_unavailable' | 'disabled';
        on_device: 'not_implemented';
        cloud: 'egress_profile_closed';
    };
};

export type NetworkAiRuntimeSummary = {
    plane: 'ai-plane-separate-from-data-plane';
    mode: NetworkAiRuntimeMode;
    localRuntime: {
        provider: 'ollama';
        state: NetworkAiRuntimeLocalState;
        targetPolicy: 'loopback-only';
        hardwareProfile: NetworkAiRuntimeHardwareProfile;
        clinicalModel: string | null;
        reasoningModel: string | null;
        ocrModel: string | null;
    };
    centralRuntime: {
        state: NetworkAiRuntimeCentralState;
        capabilityStatus: NetworkCapabilityStatus;
        requiresPairing: true;
        executionTarget: 'paired-home-base';
        accessMode: 'status-only';
        executionAuthorized: false;
    };
    fabric: NetworkAiRuntimeFabricProjection;
    fallbackPolicy: 'ai-unavailable-no-automatic-fallback';
    rolloutGate: 'lane-benchmarks-and-rollout-governance-required';
    surfaces: NetworkAiRuntimeSurface[];
    killSwitches: NetworkAiRuntimeKillSwitches;
    guardrails: string[];
};

export type NetworkCapabilityStatus = 'available' | 'disabled' | 'planned' | 'unavailable';

export type NetworkCapabilityKey =
    | 'network.pairing.bootstrap'
    | 'network.ambulatories.write'
    | 'network.replica.readonly-patients'
    | 'network.replica.readonly-clinical-diary'
    | 'network.replica.write-patient-profile'
    | 'network.replica.write-patient-lifecycle'
    | 'network.replica.write-clinical-diary'
    | 'network.replica.readonly-therapies'
    | 'network.replica.write-therapies'
    | 'network.replica.readonly-checkups'
    | 'network.replica.readonly-agenda'
    | 'network.replica.readonly-clinical-diary-global'
    | 'network.replica.write-checkups'
    | 'network.replica.readonly-observations'
    | 'network.replica.write-observations'
    | 'network.replica.readonly-service-prescriptions'
    | 'network.replica.write-service-prescriptions'
    | 'network.replica.readonly-prosthetic-prescriptions'
    | 'network.replica.write-prosthetic-prescriptions'
    | 'network.fse.validate'
    | 'network.catalogs.readonly'
    | 'network.replica.readonly-documents'
    | 'network.replica.write-documents'
    | 'network.compute.visit-draft'
    | 'network.replica.sync'
    | 'network.ai.central-runtime'
    | 'network.catalogs.sync'
    | 'local.backup.artifact.v1'
    | 'local.backup.scheduler.macos';

export type NetworkNodeSummary = {
    nodeId: string;
    displayName: string;
    role: 'home-base-candidate';
    operatingMode: NetworkOperatingMode;
    protocolVersion: string;
    transport: {
        apiBasePath: '/api/v1';
        tlsRequired: true;
        localTlsPort: 3443;
    };
};

export type NetworkSessionSummary = {
    nodeId: string;
    operatingMode: NetworkOperatingMode;
    sessionState: NetworkSessionState;
    pairingState: 'disabled' | 'required' | 'paired';
    trustedSession: boolean;
    degradedReason: string | null;
    authMode: 'bearer-token' | 'paired-client-plus-session';
    protocolVersion: string;
    replica: NetworkReplicaSummary;
};

export type NetworkCapability = {
    key: NetworkCapabilityKey;
    status: NetworkCapabilityStatus;
    requiresPairing: boolean;
    description: string;
};

export type NetworkCapabilitiesResponse = {
    nodeId: string;
    operatingMode: NetworkOperatingMode;
    protocolVersion: string;
    capabilities: NetworkCapability[];
};

export type NetworkPairingIntentRequest = {
    deviceName: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
    appVersion?: string | null;
    requestedCapabilities?: string[];
};

export type NetworkPairingIntentResponse = {
    intentId: string;
    status: 'pending-home-base-confirmation';
    nodeId: string;
    nodeDisplayName: string;
    protocolVersion: string;
    requestedAt: string;
    expiresAt: string;
    requestedBy: {
        deviceName: string;
        clientPlatform: 'macos' | 'ios' | 'ipados';
        appVersion: string | null;
    };
    requestedCapabilities: string[];
};

export type NetworkPairedClientSummary = {
    clientId: string;
    deviceName: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
    appVersion: string | null;
    grantedCapabilities: string[];
    pairedAt: string;
    lastSeenAt: string | null;
};

export type NetworkPairingConfirmationResponse = {
    intentId: string;
    status: 'paired';
    nodeId: string;
    nodeDisplayName: string;
    protocolVersion: string;
    pairedAt: string;
    pairedClientToken: string;
    pairedClient: NetworkPairedClientSummary;
    authHeaders: {
        clientIdHeader: 'x-mediflow-paired-client-id';
        clientTokenHeader: 'x-mediflow-paired-client-token';
        sessionCookie: 'mediflow_session';
    };
};

export type NetworkErrorResponse = {
    error: 'Bad Request' | 'Conflict' | 'Not Found';
    code:
        | 'PAIRING_REQUEST_INVALID'
        | 'NETWORK_MODE_DISABLED'
        | 'PAIRING_INTENT_NOT_FOUND'
        | 'PAIRING_INTENT_EXPIRED'
        | 'PAIRING_CLIENT_NOT_FOUND'
        | 'PAIRING_STATE_CONFLICT';
    message: string;
};
