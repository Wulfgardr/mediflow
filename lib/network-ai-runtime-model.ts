/* @Codex */
import type {
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
};

const NETWORK_AI_RUNTIME_SURFACES = [
    'patient-insight',
    'smart-import',
    'document-synthesis',
] as const;

const NETWORK_AI_RUNTIME_GUARDRAILS = [
    'AI plane separato dal data plane clinico.',
    'Solo LAN fidata paired: nessuna esposizione WAN o cloud.',
    'Nessun cloud o egress esterno di default.',
    'Attivazione reale solo dopo benchmark lane-specific e rollout governance.',
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
        },
        fallbackPolicy: 'client-local-runtime-else-ai-unavailable',
        rolloutGate: 'lane-benchmarks-and-rollout-governance-required',
        surfaces: [...NETWORK_AI_RUNTIME_SURFACES],
        guardrails: [...NETWORK_AI_RUNTIME_GUARDRAILS],
    };
}
