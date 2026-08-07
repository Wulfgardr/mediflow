import test from 'node:test';
import assert from 'node:assert/strict';
/* @Codex */
import { deriveNetworkOperatingModeViewModel, type NetworkOverviewPayload } from './network-operating-mode.ts';

function createOverview(overrides: Partial<NetworkOverviewPayload> = {}): NetworkOverviewPayload {
    return {
        node: {
            nodeId: 'node-1',
            displayName: 'MediFlow Studio',
            role: 'home-base-candidate',
            operatingMode: 'local-only',
            protocolVersion: '1.11.0',
            transport: {
                apiBasePath: '/api/v1',
                tlsRequired: true,
                localTlsPort: 3443,
            },
        },
        session: {
            nodeId: 'node-1',
            operatingMode: 'local-only',
            sessionState: 'local-only',
            pairingState: 'disabled',
            trustedSession: false,
            degradedReason: null,
            authMode: 'bearer-token',
            protocolVersion: '1.11.0',
            replica: {
                strategy: 'encrypted-snapshot-mirror',
                state: 'local-only',
                authority: 'local-device',
                pendingAction: 'none',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            },
        },
        aiRuntime: {
            plane: 'ai-plane-separate-from-data-plane',
            mode: 'local-ai',
            localRuntime: {
                provider: 'ollama',
                state: 'configured',
                targetPolicy: 'loopback-only',
                hardwareProfile: 'medium',
                clinicalModel: 'qwen3.5:35b-a3b',
                reasoningModel: 'qwen3.5:35b-a3b',
                ocrModel: 'deepseek-ocr',
            },
            centralRuntime: {
                state: 'disabled',
                capabilityStatus: 'disabled',
                requiresPairing: true,
                executionTarget: 'paired-home-base',
                accessMode: 'status-only',
                executionAuthorized: false,
            },
            fabric: {
                schemaVersion: 'mediflow.ai.network-fabric-status.v1',
                contractVersion: 'mediflow.ai.fabric.v1',
                access: 'status_only',
                pairedExecution: 'not_authorized',
                egressGateOpen: false,
                readinessNote: 'available_unqualified',
                fallback: 'denied_by_contract',
                venues: {
                    local_process: 'configured',
                    home_base: 'disabled',
                    on_device: 'not_implemented',
                    cloud: 'egress_profile_closed',
                },
            },
            fallbackPolicy: 'ai-unavailable-no-automatic-fallback',
            rolloutGate: 'lane-benchmarks-and-rollout-governance-required',
            surfaces: [
                'patient-insight',
                'smart-import',
                'document-synthesis',
            ],
            killSwitches: {
                patientInsight: 'disabled',
                documentSynthesis: 'disabled',
                smartImport: 'disabled',
                treatmentReasoning: 'disabled',
            },
            guardrails: [
                'AI plane separato dal data plane clinico.',
            ],
        },
        identity: {
            identityModel: 'paired-device-plus-node-credentials',
            pairingBoundary: 'device-pairing-separate-from-operator-login',
            credentialState: 'node-credentials-required',
            loginMode: 'single-local-user-default',
            usernameHint: 'admin',
            displayNameHint: 'Dr. Rossi',
            operator: {
                userId: null,
                username: null,
                displayName: null,
                role: null,
                authChannel: 'none',
            },
            scope: {
                policy: 'session-context-else-node-default',
                effectiveAmbulatoryId: 'amb-1',
                effectiveAmbulatoryName: 'Studio Centrale',
                defaultAmbulatoryId: 'amb-1',
                defaultAmbulatoryName: 'Studio Centrale',
                source: 'node-default',
            },
            audit: {
                actorType: 'system',
                actorBinding: 'token-only',
            },
            limitations: [
                'Pairing device e login operatore restano separati.',
            ],
        },
        capabilities: [
            {
                key: 'network.ai.central-runtime',
                status: 'disabled',
                requiresPairing: true,
                description: 'local-only',
            },
        ],
        activationReason: 'default-local',
        lastContactAt: null,
        lastSyncAt: null,
        ...overrides,
    };
}

test('deriveNetworkOperatingModeViewModel maps local-only into the real local state', () => {
    const viewModel = deriveNetworkOperatingModeViewModel(createOverview());

    assert.equal(viewModel.currentState.code, 'local');
    assert.equal(viewModel.currentState.badge, 'Reale');
    assert.equal(viewModel.activationReasonLabel, 'Default locale');
    assert.equal(viewModel.nodeStatusLabel, 'Locale');
    assert.equal(viewModel.pairingLabel, 'Disabilitato');
    assert.equal(viewModel.aiRuntimeLabel, 'AI locale');
    assert.equal(viewModel.aiLocalRuntimeLabel, 'Ollama locale pronto, profilo medium');
    assert.equal(viewModel.aiFallbackLabel, 'Fallback automatico negato: se l AI non e disponibile, la richiesta fallisce');
    assert.equal(viewModel.currentReplicaState.code, 'local-only');
    assert.equal(viewModel.replicaPendingActionLabel, 'Nessuna');
    assert.equal(viewModel.backupBoundaryLabel, 'Il backup v1 resta separato dal mirror di rete');
    assert.equal(viewModel.identityCredentialLabel, 'Credenziali nodo richieste');
    assert.equal(viewModel.identityLoginModeLabel, 'PIN-only se esiste un solo account locale');
    assert.equal(viewModel.identityOperatorLabel, 'Dr. Rossi');
    assert.equal(viewModel.identityScopeLabel, 'Studio Centrale');
    assert.equal(viewModel.lastContactLabel, 'Non ancora disponibile');
});

test('deriveNetworkOperatingModeViewModel maps network-unpaired into the available-not-active state', () => {
    const viewModel = deriveNetworkOperatingModeViewModel(createOverview({
        node: {
            nodeId: 'node-1',
            displayName: 'MediFlow Studio',
            role: 'home-base-candidate',
            operatingMode: 'network-home-base',
            protocolVersion: '1.11.0',
            transport: {
                apiBasePath: '/api/v1',
                tlsRequired: true,
                localTlsPort: 3443,
            },
        },
        session: {
            nodeId: 'node-1',
            operatingMode: 'network-home-base',
            sessionState: 'network-unpaired',
            pairingState: 'required',
            trustedSession: false,
            degradedReason: null,
            authMode: 'paired-client-plus-session',
            protocolVersion: '1.11.0',
            replica: {
                strategy: 'encrypted-snapshot-mirror',
                state: 'unpaired',
                authority: 'local-device',
                pendingAction: 'pairing-required',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            },
        },
        aiRuntime: {
            plane: 'ai-plane-separate-from-data-plane',
            mode: 'centralized-available',
            localRuntime: {
                provider: 'ollama',
                state: 'configured',
                targetPolicy: 'loopback-only',
                hardwareProfile: 'high',
                clinicalModel: 'qwen3.5:35b-a3b',
                reasoningModel: 'qwen3.5:35b-a3b',
                ocrModel: 'deepseek-ocr',
            },
            centralRuntime: {
                state: 'available',
                capabilityStatus: 'available',
                requiresPairing: true,
                executionTarget: 'paired-home-base',
                accessMode: 'status-only',
                executionAuthorized: false,
            },
            fabric: {
                schemaVersion: 'mediflow.ai.network-fabric-status.v1',
                contractVersion: 'mediflow.ai.fabric.v1',
                access: 'status_only',
                pairedExecution: 'not_authorized',
                egressGateOpen: false,
                readinessNote: 'available_unqualified',
                fallback: 'denied_by_contract',
                venues: {
                    local_process: 'configured',
                    home_base: 'host_configured',
                    on_device: 'not_implemented',
                    cloud: 'egress_profile_closed',
                },
            },
            fallbackPolicy: 'ai-unavailable-no-automatic-fallback',
            rolloutGate: 'lane-benchmarks-and-rollout-governance-required',
            surfaces: [
                'patient-insight',
                'smart-import',
                'document-synthesis',
            ],
            killSwitches: {
                patientInsight: 'enabled',
                documentSynthesis: 'enabled',
                smartImport: 'enabled',
                treatmentReasoning: 'enabled',
            },
            guardrails: [
                'AI plane separato dal data plane clinico.',
            ],
        },
        identity: {
            identityModel: 'paired-device-plus-node-credentials',
            pairingBoundary: 'device-pairing-separate-from-operator-login',
            credentialState: 'session-bound',
            loginMode: 'explicit-username-required',
            usernameHint: 'paired-user',
            displayNameHint: 'Dr. Rossi',
            operator: {
                userId: 'user-1',
                username: 'paired-user',
                displayName: 'Dr. Rossi',
                role: 'admin',
                authChannel: 'web',
            },
            scope: {
                policy: 'session-context-else-node-default',
                effectiveAmbulatoryId: 'amb-2',
                effectiveAmbulatoryName: 'Ambulatorio Nord',
                defaultAmbulatoryId: 'amb-1',
                defaultAmbulatoryName: 'Studio Centrale',
                source: 'session-context',
            },
            audit: {
                actorType: 'user',
                actorBinding: 'session-user',
            },
            limitations: [
                'Pairing device e login operatore restano separati.',
            ],
        },
        activationReason: 'manual',
    }));

    assert.equal(viewModel.currentState.code, 'network-available-not-active');
    assert.equal(viewModel.currentState.badge, 'Reale');
    assert.equal(viewModel.currentReplicaState.code, 'unpaired');
    assert.equal(viewModel.activationReasonLabel, 'Manuale');
    assert.equal(viewModel.nodeStatusLabel, 'Disponibile');
    assert.equal(viewModel.pairingLabel, 'Richiesto');
    assert.equal(viewModel.replicaPendingActionLabel, 'Serve pairing');
    assert.equal(viewModel.aiRuntimeLabel, 'Stato AI host disponibile');
    assert.match(viewModel.aiRuntimeDescription, /non autorizza esecuzione AI/);
    assert.equal(viewModel.aiCapabilityStatus, 'available');
    assert.equal(viewModel.identityCredentialLabel, 'Sessione operatore attiva');
    assert.equal(viewModel.identityScopeSourceLabel, 'Contesto sessione');
    assert.equal(viewModel.identityAuditLabel, 'Audit legato alla sessione utente');
    assert.equal(viewModel.stateCatalog.length, 4);
    assert.equal(viewModel.replicaStateCatalog.length, 5);
});

test('deriveNetworkOperatingModeViewModel marks centralized AI unavailable when the node runtime is not exposable', () => {
    const viewModel = deriveNetworkOperatingModeViewModel(createOverview({
        session: {
            nodeId: 'node-1',
            operatingMode: 'network-home-base',
            sessionState: 'network-unpaired',
            pairingState: 'required',
            trustedSession: false,
            degradedReason: null,
            authMode: 'paired-client-plus-session',
            protocolVersion: '1.11.0',
            replica: {
                strategy: 'encrypted-snapshot-mirror',
                state: 'unpaired',
                authority: 'local-device',
                pendingAction: 'pairing-required',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            },
        },
        aiRuntime: {
            plane: 'ai-plane-separate-from-data-plane',
            mode: 'centralized-unavailable',
            localRuntime: {
                provider: 'ollama',
                state: 'misconfigured',
                targetPolicy: 'loopback-only',
                hardwareProfile: 'custom',
                clinicalModel: null,
                reasoningModel: null,
                ocrModel: null,
            },
            centralRuntime: {
                state: 'unavailable',
                capabilityStatus: 'unavailable',
                requiresPairing: true,
                executionTarget: 'paired-home-base',
                accessMode: 'status-only',
                executionAuthorized: false,
            },
            fabric: {
                schemaVersion: 'mediflow.ai.network-fabric-status.v1',
                contractVersion: 'mediflow.ai.fabric.v1',
                access: 'status_only',
                pairedExecution: 'not_authorized',
                egressGateOpen: false,
                readinessNote: 'available_unqualified',
                fallback: 'denied_by_contract',
                venues: {
                    local_process: 'misconfigured',
                    home_base: 'host_unavailable',
                    on_device: 'not_implemented',
                    cloud: 'egress_profile_closed',
                },
            },
            fallbackPolicy: 'ai-unavailable-no-automatic-fallback',
            rolloutGate: 'lane-benchmarks-and-rollout-governance-required',
            surfaces: [
                'patient-insight',
                'smart-import',
                'document-synthesis',
            ],
            killSwitches: {
                patientInsight: 'disabled',
                documentSynthesis: 'disabled',
                smartImport: 'disabled',
                treatmentReasoning: 'disabled',
            },
            guardrails: [
                'AI plane separato dal data plane clinico.',
            ],
        },
    }));

    assert.equal(viewModel.aiRuntimeLabel, 'Stato AI host non disponibile');
    assert.equal(viewModel.aiCapabilityStatus, 'unavailable');
    assert.equal(viewModel.aiLocalRuntimeLabel, 'Ollama locale non valido, profilo custom');
    assert.equal(viewModel.aiRolloutGateLabel, 'Benchmark per area AI e governance prima dell attivazione reale');
});

test('deriveNetworkOperatingModeViewModel treats paired-online as a real active state', () => {
    const viewModel = deriveNetworkOperatingModeViewModel(createOverview({
        node: {
            nodeId: 'node-1',
            displayName: 'MediFlow Studio',
            role: 'home-base-candidate',
            operatingMode: 'network-home-base',
            protocolVersion: '1.11.0',
            transport: {
                apiBasePath: '/api/v1',
                tlsRequired: true,
                localTlsPort: 3443,
            },
        },
        session: {
            nodeId: 'node-1',
            operatingMode: 'network-home-base',
            sessionState: 'network-paired-online',
            pairingState: 'paired',
            trustedSession: true,
            degradedReason: null,
            authMode: 'paired-client-plus-session',
            protocolVersion: '1.11.0',
            replica: {
                strategy: 'encrypted-snapshot-mirror',
                state: 'online',
                authority: 'paired-home-base',
                pendingAction: 'none',
                conflictMode: 'restore-preflight-plus-version-check',
                backupBoundary: 'artifact-v1-remains-backup-only',
                lastSnapshotAt: null,
                lastReconciledAt: null,
            },
        },
    }));

    assert.equal(viewModel.currentState.code, 'network-active');
    assert.equal(viewModel.currentState.badge, 'Reale');
    assert.equal(viewModel.currentReplicaState.code, 'online');
    assert.equal(viewModel.currentReplicaState.badge, 'Reale');
    assert.equal(viewModel.nodeStatusLabel, 'Online');
    assert.equal(viewModel.pairingLabel, 'Completato');
});
