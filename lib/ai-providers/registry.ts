/* @Codex */
import type {
    CapabilityAttestation,
    CapabilityAttestationFailure,
} from './capability-attestation';
import { OllamaProviderAdapter } from './ollama';
import {
    assertLocalOllamaModelReference,
    strictOllamaLoopbackBaseUrl,
} from './ollama-locality';
import type { AiLane, AIProvider, ProviderAdapter } from './provider';
import { assessAiLaneReadiness, type AiLaneReadiness } from './readiness';

export const AI_SERVICE_TASKS = ['clinical', 'reasoning', 'ocr'] as const;
export type AIServiceTask = typeof AI_SERVICE_TASKS[number];
export const AI_LANE_TASK_BINDINGS = Object.freeze({
    patient_insight: 'clinical',
    smart_import: 'clinical',
    document_synthesis: 'reasoning',
    ocr: 'ocr',
} as const satisfies Partial<Record<AiLane, AIServiceTask>>);
export interface ProviderCapabilityManifest {
    readonly provider: AIProvider;
    readonly authorityPlane: 'clinical_application';
    readonly execution: 'local';
    readonly endpointClass: 'loopback';
    readonly egress: 'none';
    readonly retention: 'not_persisted_by_registry';
    readonly costClass: 'local_compute';
    readonly latencyClass: 'runtime_measured';
    readonly capabilityEvidence: 'provider_transport_only';
    readonly modelCapabilityReadiness: 'runtime_attestation_required';
    readonly capabilities: ProviderAdapter['capabilities'];
}

export interface ProviderSelectionReceipt {
    readonly schemaVersion: 'mediflow.ai.provider-selection.v1';
    readonly authorityPlane: 'clinical_application';
    readonly task: AIServiceTask;
    readonly provider: AIProvider;
    readonly model: string;
    readonly execution: 'local';
    readonly endpointClass: 'loopback';
    readonly egress: 'none';
    readonly runtimeReadiness: 'required';
    readonly fallbackCount: 0;
}

export interface LocalProviderResolution {
    readonly adapter: ProviderAdapter;
    readonly manifest: ProviderCapabilityManifest;
    readonly receipt: ProviderSelectionReceipt;
    readonly fallback: Readonly<{
        readonly strategy: 'none';
        readonly candidates: readonly [];
    }>;
}

export type LocalProviderBindingInput = {
    task: string;
    provider?: string | null;
    models: Partial<Record<AIServiceTask, string>>;
    endpoint: string;
    disableThinking?: boolean;
    chatTimeoutMs: number;
};

export type LocalProviderLaneBindingInput = Omit<LocalProviderBindingInput, 'task'> & {
    lane: string;
    expectedModelDigest: string;
    attestation?: CapabilityAttestation | null;
    now?: Date;
    locallyVerifiedEvidenceRefs?: ReadonlySet<string>;
};
interface AiLaneSelectionReceiptBase {
    readonly schemaVersion: 'mediflow.ai.lane-selection.v1';
    readonly lane: AiLane;
    readonly task: AIServiceTask;
    readonly provider: AIProvider;
    readonly model: string;
    readonly modelDigest: string;
    readonly authorityPlane: 'clinical_application';
    readonly execution: 'local';
    readonly endpointClass: 'loopback';
    readonly egress: 'none';
    readonly fallbackCount: 0;
}
export type AiLaneSelectionReceipt =
    | Readonly<AiLaneSelectionReceiptBase & { readonly readiness: 'ready' }>
    | Readonly<AiLaneSelectionReceiptBase & {
        readonly readiness: 'blocked'; readonly reason: CapabilityAttestationFailure;
    }>;
export type LocalProviderLaneResolution =
    | Readonly<{
        readiness: Extract<AiLaneReadiness, { status: 'ready' }>;
        transport: LocalProviderResolution;
        laneReceipt: Extract<AiLaneSelectionReceipt, { readiness: 'ready' }>;
    }>
    | Readonly<{
        readiness: Extract<AiLaneReadiness, { status: 'blocked' }>;
        laneReceipt: Extract<AiLaneSelectionReceipt, { readiness: 'blocked' }>;
    }>;
export type ProviderRegistryErrorCode =
    | 'invalid_task'
    | 'invalid_lane'
    | 'lane_not_registry_servable'
    | 'invalid_model_digest'
    | 'provider_not_registered'
    | 'provider_not_local'
    | 'invalid_model'
    | 'endpoint_not_local';

export class ProviderRegistryError extends Error {
    constructor(public readonly code: ProviderRegistryErrorCode) {
        super(`Provider binding rejected: ${code}`);
        this.name = 'ProviderRegistryError';
    }
}

const TASK_PROVIDER_BINDINGS: Readonly<Record<AIServiceTask, AIProvider>> = {
    clinical: 'ollama',
    reasoning: 'ollama',
    ocr: 'ollama',
};

const AI_LANES: readonly AiLane[] = [
    'patient_insight', 'smart_import', 'document_synthesis', 'ocr', 'treatment_reasoning',
];
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OLLAMA_MANIFEST_BASE: Omit<ProviderCapabilityManifest, 'capabilities'> = Object.freeze({
    provider: 'ollama',
    authorityPlane: 'clinical_application',
    execution: 'local',
    endpointClass: 'loopback',
    egress: 'none',
    retention: 'not_persisted_by_registry',
    costClass: 'local_compute',
    latencyClass: 'runtime_measured',
    capabilityEvidence: 'provider_transport_only',
    modelCapabilityReadiness: 'runtime_attestation_required',
});

function isAIServiceTask(value: string): value is AIServiceTask {
    return AI_SERVICE_TASKS.includes(value as AIServiceTask);
}

function isAiLane(value: unknown): value is AiLane {
    return typeof value === 'string' && AI_LANES.includes(value as AiLane);
}
function normalizeProvider(task: AIServiceTask, value?: string | null): AIProvider {
    const provider = value == null ? TASK_PROVIDER_BINDINGS[task] : value.trim();
    if (provider !== 'ollama') throw new ProviderRegistryError('provider_not_registered');
    if (OLLAMA_MANIFEST_BASE.execution !== 'local' || OLLAMA_MANIFEST_BASE.egress !== 'none') {
        throw new ProviderRegistryError('provider_not_local');
    }
    return provider;
}
function normalizeModel(model: string): string {
    try {
        assertLocalOllamaModelReference(model);
        return model.trim();
    } catch {
        throw new ProviderRegistryError('invalid_model');
    }
}

function normalizeEndpoint(endpoint: string): string {
    try {
        return strictOllamaLoopbackBaseUrl(endpoint);
    } catch {
        throw new ProviderRegistryError('endpoint_not_local');
    }
}

export class LocalProviderRegistry {
    resolve(input: LocalProviderBindingInput): LocalProviderResolution {
        if (!isAIServiceTask(input.task)) {
            throw new ProviderRegistryError('invalid_task');
        }

        const provider = normalizeProvider(input.task, input.provider);
        const model = normalizeModel(input.models[input.task] ?? '');
        const endpoint = normalizeEndpoint(input.endpoint);
        const adapter = new OllamaProviderAdapter({
            baseUrl: endpoint,
            model,
            disableThinking: input.disableThinking,
            chatTimeoutMs: input.chatTimeoutMs,
        });

        return {
            adapter,
            manifest: Object.freeze({
                ...OLLAMA_MANIFEST_BASE,
                capabilities: adapter.capabilities,
            }),
            receipt: Object.freeze({
                schemaVersion: 'mediflow.ai.provider-selection.v1',
                authorityPlane: 'clinical_application',
                task: input.task,
                provider,
                model,
                execution: 'local',
                endpointClass: 'loopback',
                egress: 'none',
                runtimeReadiness: 'required',
                fallbackCount: 0,
            }),
            fallback: Object.freeze({
                strategy: 'none',
                candidates: Object.freeze([] as const),
            }),
        };
    }

    resolveForLane(input: LocalProviderLaneBindingInput): LocalProviderLaneResolution {
        if (!isAiLane(input.lane)) throw new ProviderRegistryError('invalid_lane');
        if (input.lane === 'treatment_reasoning') {
            throw new ProviderRegistryError('lane_not_registry_servable');
        }
        if (typeof input.expectedModelDigest !== 'string'
            || !SHA256_PATTERN.test(input.expectedModelDigest)) {
            throw new ProviderRegistryError('invalid_model_digest');
        }

        const task = AI_LANE_TASK_BINDINGS[input.lane];
        const provider = normalizeProvider(task, input.provider);
        const model = normalizeModel(input.models[task] ?? '');
        normalizeEndpoint(input.endpoint);
        const readiness = assessAiLaneReadiness({
            binding: {
                lane: input.lane,
                modelDigest: input.expectedModelDigest,
                authorityPlane: 'clinical_application',
            },
            attestation: input.attestation,
            now: input.now,
            locallyVerifiedEvidenceRefs: input.locallyVerifiedEvidenceRefs,
        });
        const receiptBase: AiLaneSelectionReceiptBase = {
            schemaVersion: 'mediflow.ai.lane-selection.v1',
            lane: input.lane,
            task,
            provider,
            model,
            modelDigest: input.expectedModelDigest,
            authorityPlane: 'clinical_application',
            execution: 'local',
            endpointClass: 'loopback',
            egress: 'none',
            fallbackCount: 0,
        };
        if (readiness.status === 'blocked') {
            const laneReceipt = Object.freeze({
                ...receiptBase, readiness: 'blocked' as const, reason: readiness.reason,
            });
            return Object.freeze({ readiness, laneReceipt });
        }
        const transport = this.resolve({
            task, provider, models: input.models, endpoint: input.endpoint,
            disableThinking: input.disableThinking, chatTimeoutMs: input.chatTimeoutMs,
        });
        const laneReceipt = Object.freeze({ ...receiptBase, readiness: 'ready' as const });
        return Object.freeze({ transport, readiness, laneReceipt });
    }
}

export const localProviderRegistry = new LocalProviderRegistry();
