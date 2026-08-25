/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { inArray } from 'drizzle-orm';

import { resolveTextModel } from '@/lib/ai-model-selection';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { DEFAULT_OLLAMA_BASE_URL, resolveOllamaBaseUrl } from '../base-url';
import { assertLocalOllamaModelReference, attestLocalOllamaModel, strictOllamaLoopbackBaseUrl, type OllamaLocalAttestation } from '../ollama-locality';
import { localProviderRegistry, ProviderRegistryError, type LocalProviderResolution } from '../registry';
import type { AIChatOptions, AIModel, AIStats, ChatMessage } from '../provider';

export const DOCUMENT_SYNTHESIS_PROVIDER_BINDING_SCHEMA_VERSION = 'mediflow.document-synthesis.provider-binding.v1' as const;
export const DOCUMENT_SYNTHESIS_PROVIDER_READINESS_SCHEMA_VERSION = 'mediflow.document-synthesis.provider-readiness.v1' as const;

const SETTING_KEYS = ['aiProvider', 'aiModel_reasoning', 'aiModel', 'aiUrl', 'ollamaUrl'] as const;
const OBJECT = Object.prototype;
const TIMEOUT_MS = 300_000;
const privateBindings = new WeakMap<object, LocalProviderResolution>();

type SettingKey = typeof SETTING_KEYS[number];
type SettingsSnapshot = Readonly<Partial<Record<SettingKey, string>>>;
type SettingsReader = () => Promise<unknown> | unknown;
type Attestor = (endpoint: string, model: string, signal: AbortSignal) => Promise<OllamaLocalAttestation>;
export type DocumentSynthesisProviderBindingToken = object;

export type DocumentSynthesisProviderBindingResult = Readonly<{
    status: 'available'; code: null;
    receipt: Readonly<{ schemaVersion: typeof DOCUMENT_SYNTHESIS_PROVIDER_BINDING_SCHEMA_VERSION; capability: 'document_synthesis'; registryTask: 'reasoning'; provider: 'ollama'; model: string; venue: 'local_process'; egress: 'none'; fallback: 'none'; runtimeReadiness: 'required' }>;
    readiness: Readonly<{ schemaVersion: typeof DOCUMENT_SYNTHESIS_PROVIDER_READINESS_SCHEMA_VERSION; state: 'available_unqualified'; modelAttestation: 'observed_not_causal' }>;
    token: DocumentSynthesisProviderBindingToken;
}> | Readonly<{
    status: 'denied'; code: 'settings_unavailable' | 'settings_corrupt' | 'provider_invalid' | 'model_invalid' | 'endpoint_invalid' | 'provider_unready' | 'model_unavailable';
    receipt: null; readiness: null; token: null;
}>;

type Dependencies = Readonly<{ readSettings: SettingsReader; attest: Attestor }>;

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function isSettingKey(value: PropertyKey): value is SettingKey {
    return typeof value === 'string' && SETTING_KEYS.includes(value as SettingKey);
}

function snapshotSettings(value: unknown): SettingsSnapshot | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== OBJECT) return null;
        const result: Partial<Record<SettingKey, string>> = {};
        for (const key of Reflect.ownKeys(value)) {
            if (!isSettingKey(key)) return null;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return null;
            result[key] = descriptor.value;
        }
        return Object.freeze(result);
    } catch { return null; }
}

function snapshotDependencies(value: unknown): Dependencies | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== OBJECT) return null;
        if (Reflect.ownKeys(value).length !== 2) return null;
        const read = Object.getOwnPropertyDescriptor(value, 'readSettings');
        const attest = Object.getOwnPropertyDescriptor(value, 'attest');
        if (!read || !attest || !read.enumerable || !attest.enumerable || !Object.hasOwn(read, 'value') || !Object.hasOwn(attest, 'value') || typeof read.value !== 'function' || typeof attest.value !== 'function' || types.isProxy(read.value) || types.isProxy(attest.value)) return null;
        return Object.freeze({ readSettings: read.value as SettingsReader, attest: attest.value as Attestor });
    } catch { return null; }
}

function denied(code: Extract<DocumentSynthesisProviderBindingResult, { status: 'denied' }>['code']): DocumentSynthesisProviderBindingResult {
    return frozen({ status: 'denied' as const, code, receipt: null, readiness: null, token: null });
}

function mapBindingError(error: unknown): Extract<DocumentSynthesisProviderBindingResult, { status: 'denied' }>['code'] {
    if (!(error instanceof ProviderRegistryError)) return 'settings_corrupt';
    switch (error.code) {
        case 'provider_not_registered': case 'provider_not_local': return 'provider_invalid';
        case 'invalid_model': return 'model_invalid';
        case 'endpoint_not_local': return 'endpoint_invalid';
        case 'invalid_task': return 'settings_corrupt';
    }
}

function resolutionMatches(value: unknown): value is LocalProviderResolution {
    try {
        const resolution = value as LocalProviderResolution; const { receipt, adapter, manifest, fallback } = resolution;
        const baseUrl = adapter.getBaseUrl.call(adapter); const model = adapter.getModel.call(adapter);
        assertLocalOllamaModelReference(receipt.model);
        return receipt.schemaVersion === 'mediflow.ai.provider-selection.v1' && receipt.authorityPlane === 'clinical_application' && receipt.task === 'reasoning' && receipt.provider === 'ollama' && receipt.model === model && receipt.execution === 'local' && receipt.endpointClass === 'loopback' && receipt.egress === 'none' && receipt.runtimeReadiness === 'required' && receipt.fallbackCount === 0 && adapter.id === 'ollama' && adapter.kind === 'local' && strictOllamaLoopbackBaseUrl(baseUrl) === baseUrl && manifest.provider === 'ollama' && manifest.execution === 'local' && manifest.endpointClass === 'loopback' && manifest.egress === 'none' && fallback.strategy === 'none' && Array.isArray(fallback.candidates) && fallback.candidates.length === 0;
    } catch { return false; }
}

function sameModel(left: string, right: string): boolean {
    const normalize = (value: string) => value.endsWith(':latest') ? value.slice(0, -7) : value;
    return normalize(left) === normalize(right);
}

function attestationMatches(value: unknown, resolution: LocalProviderResolution): boolean {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== OBJECT) return false;
        const keys = ['authorityPlane', 'provider', 'executionMode', 'endpointClass', 'requestedModel', 'canonicalModel', 'digest', 'serverVersion', 'checkedAt'];
        if (Reflect.ownKeys(value).length !== keys.length || !keys.every((key) => Reflect.ownKeys(value).includes(key))) return false;
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false; snapshot[key] = descriptor.value; }
        return snapshot.authorityPlane === 'clinical_application' && snapshot.provider === 'ollama' && snapshot.executionMode === 'local' && snapshot.endpointClass === 'loopback'
            && typeof snapshot.requestedModel === 'string' && snapshot.requestedModel === resolution.receipt.model
            && typeof snapshot.canonicalModel === 'string' && sameModel(snapshot.canonicalModel, resolution.receipt.model)
            && typeof snapshot.digest === 'string' && snapshot.digest.length > 0 && typeof snapshot.serverVersion === 'string' && snapshot.serverVersion.length > 0
            && typeof snapshot.checkedAt === 'string' && new Date(snapshot.checkedAt).toISOString() === snapshot.checkedAt;
    } catch { return false; }
}

function sealResolution(value: LocalProviderResolution): LocalProviderResolution | null {
    try {
        const raw = value.adapter; const baseUrl = raw.getBaseUrl.call(raw); const model = raw.getModel.call(raw);
        const authentic = () => resolutionMatches(value) && raw === value.adapter && raw.getBaseUrl.call(raw) === baseUrl && raw.getModel.call(raw) === model;
        const adapter: LocalProviderResolution['adapter'] = Object.freeze({
            id: 'ollama', kind: 'local' as const, capabilities: Object.freeze({ ...raw.capabilities }), getBaseUrl: () => baseUrl, getModel: () => model,
            async chat(messages: ChatMessage[], signal?: AbortSignal, maxTokens?: number, options?: AIChatOptions): Promise<{ content: string; stats: AIStats }> { if (!authentic()) throw new ProviderRegistryError('provider_not_local'); return raw.chat.call(raw, messages, signal, maxTokens, options); },
            async listModels(): Promise<AIModel[]> { if (!authentic()) throw new ProviderRegistryError('provider_not_local'); return raw.listModels.call(raw); },
        });
        return Object.freeze({ adapter, manifest: Object.freeze({ ...value.manifest, capabilities: Object.freeze({ ...value.manifest.capabilities }) }), receipt: Object.freeze({ ...value.receipt }), fallback: Object.freeze({ strategy: 'none' as const, candidates: Object.freeze([] as const) }) });
    } catch { return null; }
}

async function readProductionSettings(): Promise<unknown> {
    const rows = await dbServer.select({ key: settings.key, value: settings.value }).from(settings).where(inArray(settings.key, [...SETTING_KEYS]));
    return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}

function createBinding(dependenciesValue: unknown): Readonly<{ bind(): Promise<DocumentSynthesisProviderBindingResult> }> {
    const dependencies = snapshotDependencies(dependenciesValue);
    if (!dependencies) throw new TypeError('Document synthesis provider binding configuration rejected');
    let binding = false;
    return Object.freeze({
        async bind(): Promise<DocumentSynthesisProviderBindingResult> {
            if (binding) return denied('settings_unavailable');
            binding = true;
            try {
                let rawSettings: unknown;
                try { rawSettings = await dependencies.readSettings(); } catch { return denied('settings_unavailable'); }
                const snapshot = snapshotSettings(rawSettings);
                if (!snapshot) return denied('settings_corrupt');
                let resolution: LocalProviderResolution;
                try {
                    resolution = localProviderRegistry.resolve({ task: 'reasoning', provider: snapshot.aiProvider ?? 'ollama', models: { reasoning: resolveTextModel(snapshot.aiModel_reasoning, snapshot.aiModel) }, endpoint: resolveOllamaBaseUrl(snapshot.aiUrl, snapshot.ollamaUrl, DEFAULT_OLLAMA_BASE_URL), disableThinking: true, chatTimeoutMs: TIMEOUT_MS });
                } catch (error) { return denied(mapBindingError(error)); }
                if (!resolutionMatches(resolution)) return denied('provider_invalid');
                let attestation: unknown;
                try { attestation = await dependencies.attest(resolution.adapter.getBaseUrl(), resolution.receipt.model, AbortSignal.timeout(TIMEOUT_MS)); } catch { return denied('provider_unready'); }
                if (!attestationMatches(attestation, resolution)) return denied('model_unavailable');
                const sealed = sealResolution(resolution); if (!sealed) return denied('provider_invalid');
                const token = Object.freeze(Object.create(null)); privateBindings.set(token, sealed);
                return frozen({ status: 'available' as const, code: null, receipt: frozen({ schemaVersion: DOCUMENT_SYNTHESIS_PROVIDER_BINDING_SCHEMA_VERSION, capability: 'document_synthesis' as const, registryTask: 'reasoning' as const, provider: 'ollama' as const, model: resolution.receipt.model, venue: 'local_process' as const, egress: 'none' as const, fallback: 'none' as const, runtimeReadiness: 'required' as const }), readiness: frozen({ schemaVersion: DOCUMENT_SYNTHESIS_PROVIDER_READINESS_SCHEMA_VERSION, state: 'available_unqualified' as const, modelAttestation: 'observed_not_causal' as const }), token });
            } finally { binding = false; }
        },
    });
}

const productionBinding = createBinding({ readSettings: readProductionSettings, attest: attestLocalOllamaModel });

/** Host-only production entry point. It never accepts caller settings, endpoints, or execution callbacks. */
export const bindDocumentSynthesisProvider = (): Promise<DocumentSynthesisProviderBindingResult> => productionBinding.bind();

/** Narrow internal handoff for C3b. A forged or transformed token has no provider authority. */
export function resolveDocumentSynthesisProviderBinding(token: unknown): LocalProviderResolution | null {
    try { return typeof token === 'object' && token !== null && !types.isProxy(token) ? privateBindings.get(token) ?? null : null; } catch { return null; }
}

/** Test-only dependency seam; it is not used by the host-owned production binding. */
export const createDocumentSynthesisProviderBindingForTest = (dependencies: unknown) => createBinding(dependencies);
