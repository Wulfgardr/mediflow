/* @Codex */
import { types } from 'node:util';

import {
    ICD11_WHO_CREDENTIAL_TARGET,
    ICD11_WHO_SECRET_REFERENCE,
} from './icd11-who-credential-lease.ts';
import {
    ICD11_WHO_BINDING,
    Icd11WhoServiceError,
    type Icd11WhoSearchReceipt,
    type Icd11WhoSearchResult,
} from './icd11-who-service.ts';

export const ICD11_WHO_ENVIRONMENT_KEYS = Object.freeze({
    enabled: 'MEDIFLOW_ICD_WHO_ENABLED',
    network: 'MEDIFLOW_ICD_WHO_NETWORK',
    clientId: 'MEDIFLOW_ICD_WHO_CLIENT_ID',
    clientSecret: 'MEDIFLOW_ICD_WHO_CLIENT_SECRET',
} as const);

const SOURCE_KEYS = ['owner', 'now', 'readEnvironment', 'audit'] as const;
const OWNER_METHODS = ['bind', 'configure', 'search'] as const;
const RESOLVE_KEYS = ['target', 'secretRef', 'generation', 'signal'] as const;
type Callable = (...args: never[]) => unknown;
type ReadinessStatus = 'disabled' | 'credentials_absent' | 'offline'
    | 'configured' | 'available' | 'unavailable';
type Owner = Readonly<{
    bind(ports: unknown): boolean;
    configure(config: unknown): void;
    search(input: unknown): Promise<Icd11WhoSearchResult>;
}>;
type Sources = Readonly<{
    owner: Owner;
    now: () => unknown;
    readEnvironment: (name: string) => unknown;
    audit: (receipt: Icd11WhoSearchReceipt) => void | Promise<void>;
}>;

export type Icd11WhoProductionRuntime = Readonly<{
    readiness(): Readonly<{ schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1';
        status: ReadinessStatus; releaseId: '2026-01'; language: 'en' }>;
    search(query: string): Promise<Icd11WhoSearchResult>;
}>;

export type Icd11WhoProductionRuntimeErrorCode = 'input_invalid' | 'credential_unavailable'
    | 'initialization_failed';

export class Icd11WhoProductionRuntimeError extends Error {
    constructor(public readonly code: Icd11WhoProductionRuntimeErrorCode) {
        super(`ICD-11 WHO production runtime rejected: ${code}`);
        this.name = 'Icd11WhoProductionRuntimeError';
    }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !(keys as readonly string[]).includes(key))) return null;
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function safeFunction(value: unknown): value is Callable {
    try { return typeof value === 'function' && !types.isProxy(value); }
    catch { return false; }
}

function owner(value: unknown): Owner | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value)) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const method of OWNER_METHODS) {
            const descriptor = descriptors[method];
            if (!descriptor || !('value' in descriptor) || !safeFunction(descriptor.value)) return null;
        }
        return value as Owner;
    } catch { return null; }
}

function sources(value: unknown): Sources {
    const candidate = exactRecord(value, SOURCE_KEYS);
    const checkedOwner = owner(candidate?.owner);
    if (!candidate || !checkedOwner || !safeFunction(candidate.now)
        || !safeFunction(candidate.readEnvironment) || !safeFunction(candidate.audit)) {
        throw new Icd11WhoProductionRuntimeError('input_invalid');
    }
    return Object.freeze({
        owner: checkedOwner,
        now: candidate.now as () => unknown,
        readEnvironment: candidate.readEnvironment as (name: string) => unknown,
        audit: candidate.audit as (receipt: Icd11WhoSearchReceipt) => void | Promise<void>,
    });
}

function environment(source: Sources, name: string): string | undefined {
    let value: unknown;
    try { value = Reflect.apply(source.readEnvironment as unknown as Callable, undefined, [name]); }
    catch { return undefined; }
    return typeof value === 'string' ? value : undefined;
}

function credentialValues(source: Sources): { clientId: string; clientSecret: string } | null {
    const clientId = environment(source, ICD11_WHO_ENVIRONMENT_KEYS.clientId);
    const clientSecret = environment(source, ICD11_WHO_ENVIRONMENT_KEYS.clientSecret);
    if (!clientId || !clientSecret || !/^[A-Za-z0-9._~-]{8,512}$/u.test(clientId)
        || !/^[\x21-\x7e]{16,2048}$/u.test(clientSecret)) return null;
    return { clientId, clientSecret };
}

function readiness(status: ReadinessStatus) {
    return Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-readiness.v1' as const,
        status,
        releaseId: ICD11_WHO_BINDING.releaseId,
        language: ICD11_WHO_BINDING.language,
    });
}

export function createIcd11WhoProductionRuntime(sourceValue: unknown): Icd11WhoProductionRuntime {
    const source = sources(sourceValue);
    const enabled = environment(source, ICD11_WHO_ENVIRONMENT_KEYS.enabled) === '1';
    const network = enabled && environment(source, ICD11_WHO_ENVIRONMENT_KEYS.network) === 'online'
        ? 'online' as const : 'offline' as const;
    const credentialPresent = enabled ? credentialValues(source) !== null : false;
    let observed: 'configured' | 'available' | 'unavailable' | 'credentials_absent' = 'configured';

    const resolveSecretReference = async (requestValue: unknown) => {
        const request = exactRecord(requestValue, RESOLVE_KEYS);
        if (!request || request.target !== ICD11_WHO_CREDENTIAL_TARGET
            || request.secretRef !== ICD11_WHO_SECRET_REFERENCE || request.generation !== 1
            || !(request.signal instanceof AbortSignal) || request.signal.aborted) return undefined;
        const values = credentialValues(source);
        if (!values) return undefined;
        let clientId = values.clientId;
        let clientSecret = values.clientSecret;
        let active = true;
        return Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-resolved-secret.v1' as const,
            presentCredentials(sinkValue: unknown) {
                if (!active || request.signal instanceof AbortSignal && request.signal.aborted) {
                    throw new Icd11WhoProductionRuntimeError('credential_unavailable');
                }
                const sink = exactRecord(sinkValue, ['set']);
                if (!sink || !safeFunction(sink.set)) {
                    active = false; clientId = ''; clientSecret = '';
                    throw new Icd11WhoProductionRuntimeError('credential_unavailable');
                }
                active = false;
                try { Reflect.apply(sink.set, sinkValue, [clientId, clientSecret]); }
                catch {
                    clientId = ''; clientSecret = '';
                    throw new Icd11WhoProductionRuntimeError('credential_unavailable');
                }
                clientId = ''; clientSecret = '';
            },
        });
    };

    try {
        const bound = source.owner.bind(Object.freeze({
            now: source.now,
            resolveSecretReference,
            audit: source.audit,
        }));
        if (bound !== true) throw new Error('bind');
        source.owner.configure(Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-host-config.v1' as const,
            generation: 1,
            network,
            egress: enabled ? 'enabled' as const : 'disabled' as const,
            credential: credentialPresent ? 'enabled' as const : 'absent' as const,
        }));
    } catch { throw new Icd11WhoProductionRuntimeError('initialization_failed'); }

    const currentReadiness = () => {
        if (!enabled) return readiness('disabled');
        if (!credentialPresent || observed === 'credentials_absent') return readiness('credentials_absent');
        if (network === 'offline') return readiness('offline');
        return readiness(observed);
    };
    const search = async (query: string): Promise<Icd11WhoSearchResult> => {
        try {
            const result = await source.owner.search(Object.freeze({ query }));
            observed = 'available';
            return result;
        } catch (error) {
            if (error instanceof Icd11WhoServiceError) {
                if (error.code === 'credential_unavailable') observed = 'credentials_absent';
                else if (!['input_invalid', 'offline_unavailable', 'egress_disabled'].includes(error.code)) {
                    observed = 'unavailable';
                }
            } else observed = 'unavailable';
            throw error;
        }
    };
    return Object.freeze({ readiness: currentReadiness, search });
}
