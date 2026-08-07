/* @Codex */
import type {
    NetworkAiRuntimeKillSwitches,
    NetworkAiRuntimeHardwareProfile,
    NetworkAiRuntimeSummary,
    NetworkOperatingMode,
} from './api/v1/types';

export type NetworkAiRuntimeInput = {
    operatingMode: NetworkOperatingMode;
    provider: string | null;
    localTargetValid: boolean;
    hardwareProfile: string | null;
    clinicalModel: string | null;
    reasoningModel: string | null;
    ocrModel: string | null;
    killSwitches: NetworkAiRuntimeKillSwitches;
};

const NETWORK_AI_RUNTIME_SURFACES = [
    'patient-insight',
    'smart-import',
    'document-synthesis',
    'treatment-reasoning',
] as const;

const NETWORK_AI_RUNTIME_GUARDRAILS = [
    'Lo stato descrive la configurazione host e non prova un daemon attivo o una inferenza.',
    'Il client paired legge solo lo stato e non riceve un grant di esecuzione AI.',
    'Nessun cloud o egress esterno di default.',
    'Nessun fallback automatico tra venue.',
] as const;

function normalizeHardwareProfile(value: string | null): NetworkAiRuntimeHardwareProfile {
    switch (value) {
        case 'low':
        case 'medium':
        case 'high':
        case 'custom':
            return value;
        default:
            return 'unknown';
    }
}

export function deriveNetworkAiRuntimeSummary(input: NetworkAiRuntimeInput): NetworkAiRuntimeSummary {
    const normalizedProvider = input.provider?.trim().toLowerCase() ?? 'ollama';
    const localRuntimeConfigured = normalizedProvider === 'ollama' && input.localTargetValid;
    const centralRuntimeState = input.operatingMode !== 'network-home-base'
        ? 'disabled'
        : localRuntimeConfigured
            ? 'available'
            : 'unavailable';

    return {
        plane: 'ai-plane-separate-from-data-plane',
        mode: centralRuntimeState === 'available'
            ? 'centralized-available'
            : input.operatingMode === 'network-home-base'
                ? 'centralized-unavailable'
                : 'local-ai',
        localRuntime: {
            provider: 'ollama',
            state: localRuntimeConfigured ? 'configured' : 'misconfigured',
            targetPolicy: 'loopback-only',
            hardwareProfile: normalizeHardwareProfile(input.hardwareProfile),
            clinicalModel: input.clinicalModel,
            reasoningModel: input.reasoningModel,
            ocrModel: input.ocrModel,
        },
        centralRuntime: {
            state: centralRuntimeState,
            capabilityStatus: centralRuntimeState,
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
                local_process: localRuntimeConfigured ? 'configured' : 'misconfigured',
                home_base: input.operatingMode !== 'network-home-base'
                    ? 'disabled'
                    : localRuntimeConfigured
                        ? 'host_configured'
                        : 'host_unavailable',
                on_device: 'not_implemented',
                cloud: 'egress_profile_closed',
            },
        },
        fallbackPolicy: 'ai-unavailable-no-automatic-fallback',
        rolloutGate: 'lane-benchmarks-and-rollout-governance-required',
        surfaces: [...NETWORK_AI_RUNTIME_SURFACES],
        killSwitches: input.killSwitches,
        guardrails: [...NETWORK_AI_RUNTIME_GUARDRAILS],
    };
}
