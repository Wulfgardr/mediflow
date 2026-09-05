/* @Codex */
import { types } from 'node:util';

import {
    ICD11_WHO_SECRET_REFERENCE,
    createIcd11WhoCredentialLeaseManager,
} from './icd11-who-credential-lease.ts';
import type { Icd11WhoOfficialHttpsClient } from './icd11-who-official-https-client.ts';
import {
    Icd11WhoOfficialSearchTransportError,
    createIcd11WhoOfficialSearchTransport,
} from './icd11-who-official-search-transport.ts';
import { createIcd11WhoOfficialTokenIssuer } from './icd11-who-official-token-issuer.ts';
import {
    ICD11_WHO_BINDING,
    ICD11_WHO_SEARCH_OPERATION,
    Icd11WhoServiceError,
    type Icd11WhoSearchReceipt,
    type Icd11WhoServiceErrorCode,
    type Icd11WhoTransportRequest,
    createIcd11WhoReferenceDataService,
} from './icd11-who-service.ts';

const SOURCE_KEYS = ['now', 'resolveSecretReference', 'audit', 'client'] as const;
const CONFIG_KEYS = ['schemaVersion', 'generation', 'network', 'egress', 'credential'] as const;
const HOST_CONFIG_SCHEMA = 'mediflow.reference-data.icd11-who-host-config.v1' as const;
const HOST_STATUS_SCHEMA = 'mediflow.reference-data.icd11-who-host-status.v1' as const;
type Callable = (...args: never[]) => unknown;

type HostCredentialState = 'absent' | 'enabled' | 'disabled' | 'revoked_local';
type HostConfig = Readonly<{
    schemaVersion: typeof HOST_CONFIG_SCHEMA;
    generation: number;
    network: 'online' | 'offline';
    egress: 'enabled' | 'disabled';
    credential: HostCredentialState;
}>;
type HostSources = Readonly<{
    now: () => unknown;
    resolveSecretReference: Callable;
    audit: (receipt: Icd11WhoSearchReceipt) => void | Promise<void>;
    client: Icd11WhoOfficialHttpsClient;
}>;

export type Icd11WhoHostCompositionErrorCode = 'input_invalid' | 'config_invalid'
    | 'host_disposed' | 'restart_exhausted';

export class Icd11WhoHostCompositionError extends Error {
    constructor(public readonly code: Icd11WhoHostCompositionErrorCode) {
        super(`ICD-11 WHO host composition rejected: ${code}`);
        this.name = 'Icd11WhoHostCompositionError';
    }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
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

function sources(value: unknown): HostSources {
    const candidate = exactRecord(value, SOURCE_KEYS);
    if (!candidate || !safeFunction(candidate.now) || !safeFunction(candidate.resolveSecretReference)
        || !safeFunction(candidate.audit) || !safeFunction(candidate.client)) {
        throw new Icd11WhoHostCompositionError('input_invalid');
    }
    return Object.freeze({
        now: candidate.now as () => unknown,
        resolveSecretReference: candidate.resolveSecretReference as Callable,
        audit: candidate.audit as (receipt: Icd11WhoSearchReceipt) => void | Promise<void>,
        client: candidate.client as Icd11WhoOfficialHttpsClient,
    });
}

function config(value: unknown, minimumGeneration: number): HostConfig {
    const candidate = exactRecord(value, CONFIG_KEYS);
    if (!candidate || candidate.schemaVersion !== HOST_CONFIG_SCHEMA
        || !Number.isSafeInteger(candidate.generation) || (candidate.generation as number) <= minimumGeneration
        || (candidate.network !== 'online' && candidate.network !== 'offline')
        || (candidate.egress !== 'enabled' && candidate.egress !== 'disabled')
        || !['absent', 'enabled', 'disabled', 'revoked_local'].includes(candidate.credential as string)) {
        throw new Icd11WhoHostCompositionError('config_invalid');
    }
    return Object.freeze({
        schemaVersion: HOST_CONFIG_SCHEMA,
        generation: candidate.generation as number,
        network: candidate.network,
        egress: candidate.egress,
        credential: candidate.credential,
    }) as HostConfig;
}

function mapTransportError(error: unknown): Icd11WhoServiceError {
    if (!(error instanceof Icd11WhoOfficialSearchTransportError)) {
        return new Icd11WhoServiceError('upstream_unavailable');
    }
    let code: Icd11WhoServiceErrorCode;
    switch (error.code) {
        case 'credential_unavailable':
        case 'auth_rejected':
            code = 'credential_unavailable'; break;
        case 'request_cancelled':
            code = 'request_cancelled'; break;
        case 'request_timeout':
            code = 'request_timeout'; break;
        case 'redirect_rejected':
        case 'response_too_large':
        case 'response_invalid':
        case 'input_invalid':
            code = 'response_invalid'; break;
        case 'rate_limited':
        case 'upstream_unavailable':
            code = 'upstream_unavailable'; break;
        default: {
            const exhaustive: never = error.code;
            return exhaustive;
        }
    }
    return new Icd11WhoServiceError(code);
}

function defaultConfig(): HostConfig {
    return Object.freeze({ schemaVersion: HOST_CONFIG_SCHEMA, generation: 0,
        network: 'offline', egress: 'disabled', credential: 'absent' });
}

/** Host-owned composition. Endpoints, release binding and secret reference are compile-time constants. */
export function createIcd11WhoHostComposition(sourceValue: unknown) {
    const hostSources = sources(sourceValue);
    let currentConfig = defaultConfig();
    let restartGeneration = 0;
    let disposed = false;

    const build = () => {
        const issueToken = createIcd11WhoOfficialTokenIssuer({ client: hostSources.client });
        const credentials = createIcd11WhoCredentialLeaseManager({
            now: hostSources.now,
            resolveSecretReference: hostSources.resolveSecretReference,
            issueToken,
        });
        const officialTransport = createIcd11WhoOfficialSearchTransport({
            credentials,
            client: hostSources.client,
        });
        const transport = async (request: Icd11WhoTransportRequest) => {
            try { return await officialTransport(request); }
            catch (error) { throw mapTransportError(error); }
        };
        const service = createIcd11WhoReferenceDataService(Object.freeze({
            readRuntimeState: () => Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-who-runtime.v1' as const,
                network: currentConfig.network,
                egress: currentConfig.egress,
                credential: currentConfig.credential,
            }),
            now: hostSources.now,
            audit: hostSources.audit,
            transport,
        }));
        return Object.freeze({ credentials, service });
    };

    const applyConfig = (stack: ReturnType<typeof build>, value: HostConfig): void => {
        if (value.generation === 0) return;
        stack.credentials.configure(Object.freeze({
            schemaVersion: 'mediflow.reference-data.icd11-who-credential-config.v1' as const,
            generation: value.generation,
            enabled: value.credential === 'enabled',
            secretRef: ICD11_WHO_SECRET_REFERENCE,
        }));
        if (value.credential === 'revoked_local') stack.credentials.revoke();
    };

    let stack = build();
    const requireActive = (): void => {
        if (disposed) throw new Icd11WhoHostCompositionError('host_disposed');
    };
    const status = () => {
        requireActive();
        return Object.freeze({
            schemaVersion: HOST_STATUS_SCHEMA,
            generation: currentConfig.generation,
            restartGeneration,
            network: currentConfig.network,
            egress: currentConfig.egress,
            credential: currentConfig.credential,
            operation: ICD11_WHO_SEARCH_OPERATION,
            releaseId: ICD11_WHO_BINDING.releaseId,
            language: ICD11_WHO_BINDING.language,
        });
    };
    const configure = (value: unknown): void => {
        requireActive();
        const next = config(value, currentConfig.generation);
        applyConfig(stack, next);
        currentConfig = next;
    };
    const search = async (value: unknown) => {
        requireActive();
        return stack.service.search(value);
    };
    const restart = (): boolean => {
        requireActive();
        if (restartGeneration >= Number.MAX_SAFE_INTEGER) {
            throw new Icd11WhoHostCompositionError('restart_exhausted');
        }
        let replacement: ReturnType<typeof build>;
        try {
            replacement = build();
            applyConfig(replacement, currentConfig);
        } catch {
            throw new Icd11WhoHostCompositionError('restart_exhausted');
        }
        stack.service.dispose();
        stack.credentials.dispose();
        stack = replacement;
        restartGeneration += 1;
        return true;
    };
    const dispose = (): boolean => {
        if (disposed) return false;
        disposed = true;
        stack.service.dispose();
        stack.credentials.dispose();
        return true;
    };
    return Object.freeze({ configure, status, search, restart, dispose });
}
