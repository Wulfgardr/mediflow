/* @Codex */
import { normalizeOllamaBaseUrl } from './base-url';

export type OllamaLocalityFailure =
    | 'endpoint_not_loopback'
    | 'model_cloud_reference'
    | 'model_not_local'
    | 'provider_unready'
    | 'response_not_local';

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
    return typeof value.remote_host === 'string' && value.remote_host.length > 0
        || typeof value.remote_model === 'string' && value.remote_model.length > 0;
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
    if (typeof model !== 'string' || model.trim().length === 0) {
        throw new OllamaLocalityError('model_not_local');
    }
    const normalized = model.trim().toLowerCase();
    if (
        normalized.includes('://')
        || normalized.startsWith('ollama.com/')
        || normalized.endsWith(':cloud')
        || normalized.endsWith('-cloud')
    ) {
        throw new OllamaLocalityError('model_cloud_reference');
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
    if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(serverVersion)) {
        throw new OllamaLocalityError('provider_unready');
    }

    const tagsData = await fetchJson(`${baseUrl}/api/tags`, { signal });
    const models = Array.isArray(tagsData.models) ? tagsData.models : [];
    const localModel = models.find((item) => {
        if (!isLocalOllamaModelDescriptor(item)) return false;
        return sameModel(modelName(item as OllamaModelDescriptor), requestedModel);
    }) as OllamaModelDescriptor | undefined;
    if (!localModel) throw new OllamaLocalityError('model_not_local');

    const showData = await fetchJson(`${baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: requestedModel }),
        signal,
    });
    if (hasRemoteMarker(showData) || !showData.details || typeof showData.details !== 'object') {
        throw new OllamaLocalityError('model_not_local');
    }

    return {
        authorityPlane: 'clinical_application',
        provider: 'ollama',
        executionMode: 'local',
        endpointClass: 'loopback',
        requestedModel,
        canonicalModel: modelName(localModel),
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
