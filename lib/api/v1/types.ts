// Codex: created 2026-02-01

export type PatientSummary = {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    taxCode: string;
    isAdi: boolean | null;
    isArchived: boolean | null;
    /* @Codex */
    version: number;
    updatedAt: string | null;
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
    /* @Codex */
    exemptions: string | null;
    /* @Codex */
    diagnoses: string | null;
    /* @Codex */
    monitoringProfile: string | null;
    /* @Codex */
    statusReason: string | null;
    notes: string | null;
    /* @Codex */
    aiSummary: string | null;
    /* @Codex */
    aiSummaryGeneratedAt: string | null;
    /* @Codex */
    aiSummaryContextHash: string | null;
    /* @Codex */
    documentInsights: string | null;
    isAdi: boolean | null;
    isArchived: boolean | null;
    /* @Codex */
    version: number;
    ambulatoryId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

export type AmbulatorySummary = {
    id: string;
    name: string;
    address: string | null;
    type: string | null;
    isDefault: boolean | null;
    createdAt: string | null;
};

export type EntrySummary = {
    id: string;
    patientId: string;
    type: string;
    /* @Codex */
    title: string;
    date: string;
    content: string;
    /* @Codex */
    setting: string | null;
    /* @Codex */
    metadata: string | null;
    /* @Codex */
    attachments: string | null;
    /* @Codex */
    deletedAt: string | null;
    /* @Codex */
    deletionReason: string | null;
    /* @Codex */
    version: number;
    createdAt: string | null;
    /* @Codex */
    updatedAt: string | null;
};

export type TherapySummary = {
    id: string;
    patientId: string;
    drugName: string;
    /* @Codex */
    aic: string | null;
    /* @Codex */
    atc: string | null;
    activePrinciple: string | null;
    dosage: string;
    motivation: string | null;
    diagnosisCode: string | null;
    diagnosisName: string | null;
    status: string;
    startDate: string;
    endDate: string | null;
    /* @Codex */
    version: number;
    createdAt: string | null;
    /* @Codex */
    updatedAt: string | null;
    /* @Codex */
    deletedAt: string | null;
    /* @Codex */
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
    /* @Codex */
    version: number;
    createdAt: string | null;
    /* @Codex */
    updatedAt: string | null;
    /* @Codex */
    deletedAt: string | null;
    /* @Codex */
    deletionReason: string | null;
};

/* @Codex */
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
    /* @Codex */
    refLow: string | null;
    /* @Codex */
    refHigh: string | null;
    /* @Codex */
    refText: string | null;
    observedAt: string;
    source: string | null;
    /* @Codex */
    version: number;
    createdAt: string | null;
    /* @Codex */
    updatedAt: string | null;
    /* @Codex */
    deletedAt: string | null;
    /* @Codex */
    deletionReason: string | null;
};

/* @Codex */
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

/* @Codex */
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

/* @Codex */
export type NetworkOperatingMode = 'local-only' | 'network-home-base';

/* @Codex */
export type NetworkSessionState =
    | 'local-only'
    | 'network-unpaired'
    | 'network-paired-online'
    | 'network-paired-offline-degraded';

/* @Codex */
export type NetworkReplicaState =
    | 'local-only'
    | 'unpaired'
    | 'online'
    | 'offline-deferred'
    | 'conflict-review';

/* @Codex */
export type NetworkReplicaAuthority = 'local-device' | 'paired-home-base';

/* @Codex */
export type NetworkReplicaPendingAction =
    | 'none'
    | 'pairing-required'
    | 'queue-snapshot'
    | 'manual-review';

/* @Codex */
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

/* @Codex */
export type NetworkIdentityCredentialState = 'session-bound' | 'node-credentials-required';

/* @Codex */
export type NetworkIdentityLoginMode = 'single-local-user-default' | 'explicit-username-required';

/* @Codex */
export type NetworkIdentityAuthChannel = 'web' | 'native' | 'system' | 'none';

/* @Codex */
export type NetworkIdentityScopeSource = 'session-context' | 'node-default' | 'none';

/* @Codex */
export type NetworkIdentityOperatorSummary = {
    userId: string | null;
    username: string | null;
    displayName: string | null;
    role: string | null;
    authChannel: NetworkIdentityAuthChannel;
};

/* @Codex */
export type NetworkIdentityScopeSummary = {
    policy: 'session-context-else-node-default';
    effectiveAmbulatoryId: string | null;
    effectiveAmbulatoryName: string | null;
    defaultAmbulatoryId: string | null;
    defaultAmbulatoryName: string | null;
    source: NetworkIdentityScopeSource;
};

/* @Codex */
export type NetworkIdentityAuditSummary = {
    actorType: 'user' | 'system';
    actorBinding: 'session-user' | 'token-only';
};

/* @Codex */
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

/* @Codex */
export type NetworkAiRuntimeMode =
    | 'local-ai'
    | 'centralized-available'
    | 'centralized-unavailable';

/* @Codex */
export type NetworkAiRuntimeLocalState = 'configured' | 'misconfigured';

/* @Codex */
export type NetworkAiRuntimeCentralState = 'disabled' | 'available' | 'unavailable';

/* @Codex */
export type NetworkAiRuntimeHardwareProfile = 'low' | 'medium' | 'high' | 'custom' | 'unknown';

/* @Codex */
export type NetworkAiRuntimeSurface =
    | 'patient-insight'
    | 'smart-import'
    | 'document-synthesis';

/* @Codex */
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
    };
    fallbackPolicy: 'client-local-runtime-else-ai-unavailable';
    rolloutGate: 'lane-benchmarks-and-rollout-governance-required';
    surfaces: NetworkAiRuntimeSurface[];
    guardrails: string[];
};

/* @Codex */
export type NetworkCapabilityStatus = 'available' | 'disabled' | 'planned' | 'unavailable';

/* @Codex */
export type NetworkCapabilityKey =
    | 'network.pairing.bootstrap'
    | 'network.replica.readonly-patients'
    /* @Codex */
    | 'network.replica.readonly-clinical-diary'
    /* @Codex */
    | 'network.replica.write-patient-profile'
    /* @Codex */
    | 'network.replica.write-clinical-diary'
    /* @Codex */
    | 'network.replica.readonly-therapies'
    /* @Codex */
    | 'network.replica.write-therapies'
    /* @Codex */
    | 'network.replica.readonly-checkups'
    /* @Codex */
    | 'network.replica.write-checkups'
    /* @Codex */
    | 'network.replica.readonly-observations'
    /* @Codex */
    | 'network.replica.write-observations'
    | 'network.replica.sync'
    | 'network.ai.central-runtime'
    | 'network.catalogs.sync'
    | 'local.backup.artifact.v1'
    | 'local.backup.scheduler.macos';

/* @Codex */
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

/* @Codex */
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

/* @Codex */
export type NetworkCapability = {
    key: NetworkCapabilityKey;
    status: NetworkCapabilityStatus;
    requiresPairing: boolean;
    description: string;
};

/* @Codex */
export type NetworkCapabilitiesResponse = {
    nodeId: string;
    operatingMode: NetworkOperatingMode;
    protocolVersion: string;
    capabilities: NetworkCapability[];
};

/* @Codex */
export type NetworkPairingIntentRequest = {
    deviceName: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
    appVersion?: string | null;
    requestedCapabilities?: string[];
};

/* @Codex */
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

/* @Codex */
export type NetworkPairedClientSummary = {
    clientId: string;
    deviceName: string;
    clientPlatform: 'macos' | 'ios' | 'ipados';
    appVersion: string | null;
    grantedCapabilities: string[];
    pairedAt: string;
    lastSeenAt: string | null;
};

/* @Codex */
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

/* @Codex */
export type NetworkErrorResponse = {
    error: 'Bad Request' | 'Conflict' | 'Not Found';
    code:
        | 'PAIRING_REQUEST_INVALID'
        | 'NETWORK_MODE_DISABLED'
        | 'PAIRING_INTENT_NOT_FOUND'
        | 'PAIRING_INTENT_EXPIRED';
    message: string;
};
