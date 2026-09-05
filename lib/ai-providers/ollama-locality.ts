/* @Codex */
import { normalizeOllamaBaseUrl } from './base-url';

export type OllamaLocalityFailure =
    | 'endpoint_not_loopback'
    | 'model_cloud_reference'
    | 'model_not_local'
    | 'model_pull_disabled'
    | 'provider_unready'
    | 'response_not_local';

export const OLLAMA_LOCAL_KEEP_ALIVE = '30m';
export const OLLAMA_LOCAL_MODEL_REFERENCE_MAX_UTF8_BYTES = 674;
const SUPPORTED_OLLAMA_LOCALITY_VERSION = /^0\.32\.\d+(?:[-+].+)?$/;

export class OllamaLocalityError extends Error {
    constructor(public readonly code: OllamaLocalityFailure) {
        super(`Ollama locality check failed: ${code}`);
        this.name = 'OllamaLocalityError';
    }
}

interface OllamaModelDescriptor {
    name?: unknown;
    model?: unknown;
    size?: unknown;
    digest?: unknown;
    remote_host?: unknown;
    remote_model?: unknown;
}

export interface OllamaLocalAttestation {
    authorityPlane: 'clinical_application';
    provider: 'ollama';
    executionMode: 'local';
    endpointClass: 'loopback';
    requestedModel: string;
    canonicalModel: string;
    digest: string;
    serverVersion: string;
    checkedAt: string;
}

function hasRemoteMarker(value: OllamaModelDescriptor): boolean {
    const isPresent = (field: unknown) => field !== undefined && field !== null && field !== '';
    return isPresent(value.remote_host) || isPresent(value.remote_model);
}

function modelName(value: OllamaModelDescriptor): string {
    return typeof value.model === 'string'
        ? value.model
        : typeof value.name === 'string' ? value.name : '';
}

function sameModel(left: string, right: string): boolean {
    const normalize = (value: string) => value.endsWith(':latest') ? value.slice(0, -7) : value;
    return normalize(left) === normalize(right);
}

export function assertLocalOllamaModelReference(model: unknown): asserts model is string {
    if (typeof model !== 'string') {
        throw new OllamaLocalityError('model_not_local');
    }
    const trimmed = model.trim();
    const normalized = trimmed.toLowerCase();
    if (
        normalized.includes('://')
        || normalized.startsWith('ollama.com/')
        || normalized.endsWith(':cloud')
        || normalized.endsWith('-cloud')
    ) {
        throw new OllamaLocalityError('model_cloud_reference');
    }
    if (!trimmed || new TextEncoder().encode(trimmed).byteLength > OLLAMA_LOCAL_MODEL_REFERENCE_MAX_UTF8_BYTES) {
        throw new OllamaLocalityError('model_not_local');
    }
}

export function strictOllamaLoopbackBaseUrl(rawBaseUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(normalizeOllamaBaseUrl(rawBaseUrl));
    } catch {
        throw new OllamaLocalityError('endpoint_not_loopback');
    }
    if (
        parsed.protocol !== 'http:'
        || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
        || parsed.username
        || parsed.password
    ) {
        throw new OllamaLocalityError('endpoint_not_loopback');
    }
    const pathname = parsed.pathname.replace(/\/$/, '');
    if (pathname && !/^\/api\/(chat|generate|tags|show|pull)$/.test(pathname)) {
        throw new OllamaLocalityError('endpoint_not_loopback');
    }
    parsed.hostname = '127.0.0.1';
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
}

export function isLocalOllamaModelDescriptor(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const descriptor = value as OllamaModelDescriptor;
    return modelName(descriptor).length > 0
        && typeof descriptor.size === 'number'
        && descriptor.size > 0
        && typeof descriptor.digest === 'string'
        && descriptor.digest.length > 0
        && !hasRemoteMarker(descriptor);
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(url, { ...init, redirect: 'error' });
    if (!response.ok) throw new OllamaLocalityError('provider_unready');
    return response.json() as Promise<Record<string, unknown>>;
}

export async function attestLocalOllamaModel(
    rawBaseUrl: string,
    requestedModel: string,
    signal?: AbortSignal,
): Promise<OllamaLocalAttestation> {
    assertLocalOllamaModelReference(requestedModel);
    const baseUrl = strictOllamaLoopbackBaseUrl(rawBaseUrl);
    const versionData = await fetchJson(`${baseUrl}/api/version`, { signal });
    const serverVersion = typeof versionData.version === 'string' ? versionData.version : '';
    if (!SUPPORTED_OLLAMA_LOCALITY_VERSION.test(serverVersion)) {
        throw new OllamaLocalityError('provider_unready');
    }

    const tagsData = await fetchJson(`${baseUrl}/api/tags`, { signal });
    const models = Array.isArray(tagsData.models) ? tagsData.models : [];
    const localModel = models.find((item) => {
        if (!isLocalOllamaModelDescriptor(item)) return false;
        return sameModel(modelName(item as OllamaModelDescriptor), requestedModel);
    }) as OllamaModelDescriptor | undefined;
    if (!localModel) throw new OllamaLocalityError('model_not_local');

    const canonicalModel = modelName(localModel);
    const showData = await fetchJson(`${baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: canonicalModel }),
        signal,
    });
    if (hasRemoteMarker(showData) || !showData.details || typeof showData.details !== 'object') {
        throw new OllamaLocalityError('model_not_local');
    }

    const preloadData = await fetchJson(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: canonicalModel,
            keep_alive: OLLAMA_LOCAL_KEEP_ALIVE,
        }),
        signal,
    });
    if (hasRemoteMarker(preloadData) || !sameModel(modelName(preloadData), canonicalModel)) {
        throw new OllamaLocalityError('model_not_local');
    }

    const runningData = await fetchJson(`${baseUrl}/api/ps`, { signal });
    const runningModels = Array.isArray(runningData.models) ? runningData.models : [];
    const loadedModel = runningModels.find((item) => {
        if (!isLocalOllamaModelDescriptor(item)) return false;
        const descriptor = item as OllamaModelDescriptor;
        return sameModel(modelName(descriptor), canonicalModel)
            && descriptor.digest === localModel.digest;
    });
    if (!loadedModel) throw new OllamaLocalityError('model_not_local');

    return {
        authorityPlane: 'clinical_application',
        provider: 'ollama',
        executionMode: 'local',
        endpointClass: 'loopback',
        requestedModel,
        canonicalModel,
        digest: localModel.digest as string,
        serverVersion,
        checkedAt: new Date().toISOString(),
    };
}

export function assertLocalOllamaResponse(
    value: unknown,
    attestation: OllamaLocalAttestation,
): void {
    if (!value || typeof value !== 'object') {
        throw new OllamaLocalityError('response_not_local');
    }
    const response = value as OllamaModelDescriptor;
    if (hasRemoteMarker(response) || !sameModel(modelName(response), attestation.canonicalModel)) {
        throw new OllamaLocalityError('response_not_local');
    }
}
