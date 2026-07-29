/* @Codex */
import { OllamaProviderAdapter } from './ollama';
import {
    assertLocalOllamaModelReference,
    strictOllamaLoopbackBaseUrl,
} from './ollama-locality';
import type { AIProvider, ProviderAdapter } from './provider';

export const AI_SERVICE_TASKS = ['clinical', 'reasoning', 'ocr'] as const;
export type AIServiceTask = typeof AI_SERVICE_TASKS[number];
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

export type ProviderRegistryErrorCode =
    | 'invalid_task'
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
}

export const localProviderRegistry = new LocalProviderRegistry();
