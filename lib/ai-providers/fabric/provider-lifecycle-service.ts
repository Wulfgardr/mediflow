/* @Codex */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { admitProvider, type ProviderLifecycleEvent, type ProviderLifecycleState } from './provider-lifecycle';
import {
    createProviderLifecycleStore,
    ProviderLifecycleStoreError,
    type ProviderLifecycleRecord,
} from './provider-lifecycle-store';
import type { ProviderOnboardingState } from './onboarding';

export type ProviderLifecycleRead =
    | Readonly<{ status: 'available'; record: ProviderLifecycleRecord }>
    | Readonly<{ status: 'denied'; reason: 'missing' | 'corrupt' | 'unavailable' }>;
export type ProviderLifecycleServiceErrorCode = 'input_invalid' | 'source_invalid';
export class ProviderLifecycleServiceError extends Error {
    constructor(public readonly code: ProviderLifecycleServiceErrorCode) {
        super(`Provider lifecycle service rejected: ${code}`);
        this.name = 'ProviderLifecycleServiceError';
    }
}

type HostSources = Readonly<{ entropy: () => unknown; now: () => unknown }>;
type FactoryOptions = Readonly<{ appDataDir?: string; provider?: string; sources?: unknown }>;
const PROVIDER_REF = /^[a-z][a-z0-9_-]{0,63}$/u;
const PRODUCTION_SOURCES: HostSources = Object.freeze({
    entropy: () => randomBytes(32).toString('hex'),
    now: () => new Date().toISOString(),
});

function dataRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ProviderLifecycleServiceError('input_invalid');
    }
    const keys = Reflect.ownKeys(value);
    if (!keys.every((key) => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
        || !required.every((key) => keys.includes(key))) {
        throw new ProviderLifecycleServiceError('input_invalid');
    }
    const result: Record<string, unknown> = {};
    for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) throw new ProviderLifecycleServiceError('input_invalid');
        result[key] = descriptor.value;
    }
    return result;
}

function snapshotSources(value: unknown): HostSources {
    if (value === undefined) return PRODUCTION_SOURCES;
    let record: Record<string, unknown>;
    try { record = dataRecord(value, ['entropy', 'now']); }
    catch { throw new ProviderLifecycleServiceError('source_invalid'); }
    if (typeof record.entropy !== 'function' || typeof record.now !== 'function') {
        throw new ProviderLifecycleServiceError('source_invalid');
    }
    return Object.freeze({ entropy: record.entropy as () => unknown, now: record.now as () => unknown });
}

function operationMetadata(sources: HostSources) {
    let entropy: unknown;
    let timestamp: unknown;
    try { entropy = sources.entropy(); timestamp = sources.now(); }
    catch { throw new ProviderLifecycleServiceError('source_invalid'); }
    try {
        if (typeof entropy !== 'string' || !/^[0-9a-f]{64}$/.test(entropy)
            || typeof timestamp !== 'string' || new Date(timestamp).toISOString() !== timestamp) throw new Error();
    } catch { throw new ProviderLifecycleServiceError('source_invalid'); }
    return Object.freeze({
        actorRef: `actor_${entropy.slice(0, 32)}`,
        receiptRef: `receipt_${entropy.slice(32)}`,
        timestamp,
    });
}

function expectedVersion(value: unknown, extraKey?: string) {
    const keys = extraKey ? ['expectedVersion', extraKey] : ['expectedVersion'];
    const input = dataRecord(value, keys);
    if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) {
        throw new ProviderLifecycleServiceError('input_invalid');
    }
    return input;
}

function snapshotOnboarding(value: unknown): ProviderOnboardingState {
    const input = dataRecord(value, ['schemaVersion', 'provider', 'credentialClass', 'step', 'attestation']);
    return Object.freeze({ ...input }) as ProviderOnboardingState;
}

export function createHostProviderLifecycleService(options: FactoryOptions = {}) {
    const config = dataRecord(options, [], ['appDataDir', 'provider', 'sources']);
    if (config.appDataDir !== undefined
        && (typeof config.appDataDir !== 'string' || !path.isAbsolute(config.appDataDir))) {
        throw new ProviderLifecycleServiceError('input_invalid');
    }
    const appDataDir = config.appDataDir as string | undefined;
    const provider = config.provider === undefined ? 'ollama' : config.provider;
    if (typeof provider !== 'string' || !PROVIDER_REF.test(provider)) {
        throw new ProviderLifecycleServiceError('input_invalid');
    }
    const sources = snapshotSources(config.sources);
    const read = (): ProviderLifecycleRead => {
        try {
            return Object.freeze({ status: 'available', record: createProviderLifecycleStore(appDataDir, undefined, provider).load() });
        } catch (error) {
            const reason = error instanceof ProviderLifecycleStoreError && error.code === 'missing'
                ? 'missing' : error instanceof ProviderLifecycleStoreError && error.code === 'corrupt'
                    ? 'corrupt' : 'unavailable';
            return Object.freeze({ status: 'denied', reason });
        }
    };
    const save = (expected: number, lifecycle: ProviderLifecycleState | ProviderLifecycleEvent) => {
        const metadata = operationMetadata(sources);
        const store = createProviderLifecycleStore(appDataDir, () => new Date(metadata.timestamp), provider);
        return typeof lifecycle === 'string'
            ? store.save({ kind: 'transition', expectedVersion: expected, event: lifecycle,
                actorClass: 'host_service', actorRef: metadata.actorRef, receiptRef: metadata.receiptRef })
            : store.save({ kind: 'admit', expectedVersion: expected, lifecycle,
                actorClass: 'host_service', actorRef: metadata.actorRef, receiptRef: metadata.receiptRef });
    };
    const admit = (value: unknown) => {
        const input = expectedVersion(value, 'onboarding');
        const lifecycle = admitProvider(snapshotOnboarding(input.onboarding));
        if (lifecycle.provider !== provider) throw new ProviderLifecycleServiceError('input_invalid');
        return save(input.expectedVersion as number, lifecycle);
    };
    const transition = (event: ProviderLifecycleEvent) => (value: unknown) => {
        const input = expectedVersion(value);
        return save(input.expectedVersion as number, event);
    };
    const service = Object.freeze({ read });
    const control = Object.freeze({ admit, degrade: transition('degrade'), recover: transition('recover'),
        revoke: transition('revoke') });
    return Object.freeze({ service, control });
}
