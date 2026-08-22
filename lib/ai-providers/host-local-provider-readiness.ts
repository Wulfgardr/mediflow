/* @Codex */
import 'server-only';
import {
    assertLocalOllamaModelReference,
    attestLocalOllamaModel,
    OllamaLocalityError,
    strictOllamaLoopbackBaseUrl,
} from './ollama-locality';
import type { LocalProviderResolution } from './registry';

const READINESS_TIMEOUT_MS = 300_000;
const AVAILABLE = Object.freeze({ venue: 'local_process', state: 'available', reason: null } as const);
const OFFLINE = Object.freeze({ venue: 'local_process', state: 'offline', reason: 'daemon_unreachable' } as const);
const DEGRADED = Object.freeze({ venue: 'local_process', state: 'degraded', reason: null } as const);

export type HostLocalProviderReadinessResult =
    | Readonly<{ status: 'available'; code: null; observation: typeof AVAILABLE }>
    | Readonly<{ status: 'denied'; code: 'provider_unready' | 'model_unavailable'; observation: typeof OFFLINE | typeof DEGRADED }>;

type Attestor = typeof attestLocalOllamaModel;
type Snapshot = Readonly<{ baseUrl: string; model: string }>;

function deny(code: 'provider_unready' | 'model_unavailable'): HostLocalProviderReadinessResult {
    return Object.freeze({
        status: 'denied',
        code,
        observation: code === 'provider_unready' ? OFFLINE : DEGRADED,
    });
}

function snapshotResolution(resolution: LocalProviderResolution): Snapshot | HostLocalProviderReadinessResult {
    let provider: unknown, task: unknown, receiptModel: unknown, adapterId: unknown, adapterKind: unknown;
    let baseUrl: unknown, adapterModel: unknown;
    try {
        const receipt = resolution.receipt;
        const adapter = resolution.adapter;
        provider = receipt.provider;
        task = receipt.task;
        receiptModel = receipt.model;
        adapterId = adapter.id;
        adapterKind = adapter.kind;
        const getBaseUrl = adapter.getBaseUrl;
        const getModel = adapter.getModel;
        baseUrl = getBaseUrl.call(adapter);
        adapterModel = getModel.call(adapter);
    } catch {
        return deny('provider_unready');
    }
    if (provider !== 'ollama' || task !== 'clinical' || adapterId !== 'ollama' || adapterKind !== 'local'
        || typeof baseUrl !== 'string') {
        return deny('provider_unready');
    }
    try {
        if (strictOllamaLoopbackBaseUrl(baseUrl) !== baseUrl) throw new Error();
    } catch {
        return deny('provider_unready');
    }
    try {
        assertLocalOllamaModelReference(receiptModel);
        if (receiptModel !== adapterModel) throw new Error();
    } catch {
        return deny('model_unavailable');
    }
    return Object.freeze({ baseUrl, model: receiptModel });
}

async function observe(resolution: LocalProviderResolution, attestor: Attestor): Promise<HostLocalProviderReadinessResult> {
    const snapshot = snapshotResolution(resolution);
    if ('status' in snapshot) return snapshot;
    try {
        await attestor(snapshot.baseUrl, snapshot.model, AbortSignal.timeout(READINESS_TIMEOUT_MS));
    } catch (error) {
        if (error instanceof OllamaLocalityError && !['endpoint_not_loopback', 'provider_unready'].includes(error.code)) {
            return deny('model_unavailable');
        }
        return deny('provider_unready');
    }
    return Object.freeze({ status: 'available', code: null, observation: AVAILABLE });
}

export const observeClinical = (resolution: LocalProviderResolution): Promise<HostLocalProviderReadinessResult> =>
    observe(resolution, attestLocalOllamaModel);

export const createHostLocalProviderReadinessForTest = (attestor: Attestor) => Object.freeze({
    observeClinical: (resolution: LocalProviderResolution) => observe(resolution, attestor),
});
