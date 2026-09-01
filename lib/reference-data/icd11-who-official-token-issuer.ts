/* @Codex */
import { Buffer } from 'node:buffer';
import { types } from 'node:util';
import {
    ICD11_WHO_TOKEN_MAX_TTL_MS,
    ICD11_WHO_TOKEN_TARGET,
} from './icd11-who-credential-lease.ts';
import type {
    Icd11WhoOfficialForm,
    Icd11WhoOfficialHeaders,
    Icd11WhoOfficialHttpsClient,
    Icd11WhoOfficialHttpsClientRequest,
} from './icd11-who-official-https-client.ts';

export type { Icd11WhoOfficialHttpsClientRequest } from './icd11-who-official-https-client.ts';

export const ICD11_WHO_OFFICIAL_TOKEN_FINAL_URL =
    'https://icdaccessmanagement.who.int/connect/token' as const;
export const ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES = 8_192 as const;
export const ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES = 8_192 as const;

const FACTORY_KEYS = ['client'] as const;
const ISSUE_KEYS = ['target', 'generation', 'presentCredentials', 'signal'] as const;
const ENVELOPE_KEYS = ['status', 'finalUrl', 'redirected', 'body'] as const;
const TOKEN_KEYS = ['access_token', 'expires_in', 'token_type', 'scope'] as const;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const PROMISE_THEN = Promise.prototype.then;
const encoder = new TextEncoder();
type Callable = (...args: never[]) => unknown;

export type Icd11WhoOfficialTokenIssuerErrorCode =
    | 'input_invalid'
    | 'credential_invalid'
    | 'request_cancelled'
    | 'request_timeout'
    | 'redirect_rejected'
    | 'response_too_large'
    | 'auth_rejected'
    | 'rate_limited'
    | 'upstream_unavailable'
    | 'response_invalid';

export class Icd11WhoOfficialTokenIssuerError extends Error {
    constructor(public readonly code: Icd11WhoOfficialTokenIssuerErrorCode) {
        super(`ICD-11 WHO official token issuer rejected: ${code}`);
        this.name = 'Icd11WhoOfficialTokenIssuerError';
    }
}

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function safeFunction(value: unknown): value is Callable {
    try { return typeof value === 'function' && !types.isProxy(value); }
    catch { return false; }
}

function nativePromise(value: unknown): Promise<unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || !types.isPromise(value)
            || Object.getPrototypeOf(value) !== Promise.prototype || Object.hasOwn(value, 'constructor')) return null;
        return Reflect.apply(PROMISE_THEN, value, [(result: unknown) => result]);
    } catch { return null; }
}

function checkedSignal(value: unknown): AbortSignal | null {
    try {
        if (typeof ABORTED_GETTER !== 'function' || !value || typeof value !== 'object' || types.isProxy(value)
            || Object.getPrototypeOf(value) !== AbortSignal.prototype) return null;
        Reflect.apply(ABORTED_GETTER, value, []);
        return value as AbortSignal;
    } catch { return null; }
}

function isAborted(signal: AbortSignal): boolean {
    try { return Reflect.apply(ABORTED_GETTER as () => boolean, signal, []) === true; }
    catch { throw new Icd11WhoOfficialTokenIssuerError('input_invalid'); }
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
    Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
}

function createSecretFacades(presentCredentials: Callable): Readonly<{
    headers: Icd11WhoOfficialHeaders;
    form: Icd11WhoOfficialForm;
    clear(): void;
}> {
    let clientId = '';
    let clientSecret = '';
    let written = false;
    const sink = Object.freeze({ set(id: string, secret: string) {
        if (written || typeof id !== 'string' || typeof secret !== 'string'
            || !/^[A-Za-z0-9._~-]{8,512}$/.test(id)
            || !/^[\x21-\x7e]{16,2048}$/.test(secret)) {
            throw new Icd11WhoOfficialTokenIssuerError('credential_invalid');
        }
        written = true;
        clientId = id;
        clientSecret = secret;
    } });
    let outcome: unknown;
    try { outcome = Reflect.apply(presentCredentials, undefined, [sink]); }
    catch {
        clientId = ''; clientSecret = '';
        throw new Icd11WhoOfficialTokenIssuerError('credential_invalid');
    }
    if (outcome !== undefined || !written) {
        clientId = ''; clientSecret = '';
        throw new Icd11WhoOfficialTokenIssuerError('credential_invalid');
    }

    const authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
    const requestBytes = encoder.encode(authorization).byteLength + 128;
    if (requestBytes > ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES) {
        clientId = ''; clientSecret = '';
        throw new Icd11WhoOfficialTokenIssuerError('credential_invalid');
    }
    const headerValues = new Map<string, string>([
        ['accept', 'application/json'],
        ['authorization', authorization],
        ['content-type', 'application/x-www-form-urlencoded'],
        ['user-agent', 'MediFlow/0.8.5 ICD11-WHO'],
    ]);
    const formValues = new Map<string, string>([
        ['grant_type', 'client_credentials'], ['scope', 'icdapi_access'],
    ]);
    let active = true;
    const headers = Object.freeze({ get(name: string) {
        return active && typeof name === 'string' ? headerValues.get(name.toLowerCase()) ?? null : null;
    } });
    const form = Object.freeze({ get(name: string) {
        return active && typeof name === 'string' ? formValues.get(name) ?? null : null;
    } });
    return Object.freeze({ headers, form, clear() {
        active = false;
        headerValues.clear();
        formValues.clear();
        clientId = '';
        clientSecret = '';
    } });
}

function statusCode(status: number): Icd11WhoOfficialTokenIssuerErrorCode | null {
    if (status === 200) return null;
    if (status === 401 || status === 403) return 'auth_rejected';
    if (status === 408) return 'request_timeout';
    if (status === 429) return 'rate_limited';
    return status >= 500 ? 'upstream_unavailable' : 'response_invalid';
}

function parseToken(body: string): Readonly<{
    schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1';
    tokenType: 'Bearer';
    accessToken: string;
    expiresInMs: number;
}> | null {
    let value: unknown;
    try { value = JSON.parse(body); } catch { return null; }
    const token = dataRecord(value, TOKEN_KEYS);
    if (!token || typeof token.access_token !== 'string'
        || !/^[\x21-\x7e]{16,4096}$/.test(token.access_token)
        || !Number.isSafeInteger(token.expires_in) || (token.expires_in as number) <= 90
        || (token.expires_in as number) > ICD11_WHO_TOKEN_MAX_TTL_MS / 1_000
        || token.token_type !== 'Bearer' || token.scope !== 'icdapi_access') return null;
    return Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-who-token-result.v1',
        tokenType: 'Bearer', accessToken: token.access_token,
        expiresInMs: (token.expires_in as number) * 1_000,
    });
}

export function createIcd11WhoOfficialTokenIssuer(factoryValue: unknown) {
    const factory = dataRecord(factoryValue, FACTORY_KEYS);
    if (!factory || !safeFunction(factory.client)) throw new Icd11WhoOfficialTokenIssuerError('input_invalid');
    const client = factory.client as unknown as Icd11WhoOfficialHttpsClient;

    return async (requestValue: unknown) => {
        const input = dataRecord(requestValue, ISSUE_KEYS);
        const signal = checkedSignal(input?.signal);
        if (!input || input.target !== ICD11_WHO_TOKEN_TARGET
            || !Number.isSafeInteger(input.generation) || (input.generation as number) < 1
            || !safeFunction(input.presentCredentials) || !signal) {
            throw new Icd11WhoOfficialTokenIssuerError('input_invalid');
        }
        if (isAborted(signal)) throw new Icd11WhoOfficialTokenIssuerError('request_cancelled');
        const secretFacades = createSecretFacades(input.presentCredentials);
        if (isAborted(signal)) {
            secretFacades.clear();
            throw new Icd11WhoOfficialTokenIssuerError('request_cancelled');
        }
        const request = Object.freeze({
            target: ICD11_WHO_TOKEN_TARGET,
            protocol: 'https:' as const,
            hostname: 'icdaccessmanagement.who.int' as const,
            path: '/connect/token' as const,
            method: 'POST' as const,
            redirect: 'error' as const,
            headers: secretFacades.headers,
            form: secretFacades.form,
            signal,
            maxRequestBytes: ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES,
            maxResponseBytes: ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES,
        }) satisfies Icd11WhoOfficialHttpsClientRequest;
        let aborted = false;
        let rejectCancelled!: (error: Icd11WhoOfficialTokenIssuerError) => void;
        const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
        const onAbort = () => {
            aborted = true;
            rejectCancelled(new Icd11WhoOfficialTokenIssuerError('request_cancelled'));
        };
        addAbortListener(signal, onAbort);
        if (isAborted(signal)) onAbort();
        void cancelled.catch(() => undefined);
        let response: unknown;
        try {
            let returned: unknown;
            try { returned = Reflect.apply(client as unknown as Callable, undefined, [request]); }
            catch { throw new Icd11WhoOfficialTokenIssuerError('upstream_unavailable'); }
            const pending = nativePromise(returned);
            if (!pending) throw new Icd11WhoOfficialTokenIssuerError('response_invalid');
            try { response = await Promise.race([cancelled, pending]); }
            catch (error) {
                if (aborted || isAborted(signal)) throw new Icd11WhoOfficialTokenIssuerError('request_cancelled');
                if (error instanceof Icd11WhoOfficialTokenIssuerError) throw error;
                throw new Icd11WhoOfficialTokenIssuerError('upstream_unavailable');
            }
            if (aborted || isAborted(signal)) throw new Icd11WhoOfficialTokenIssuerError('request_cancelled');
        } finally {
            removeAbortListener(signal, onAbort);
            secretFacades.clear();
        }

        const envelope = dataRecord(response, ENVELOPE_KEYS);
        if (!envelope || !Number.isSafeInteger(envelope.status) || (envelope.status as number) < 100
            || (envelope.status as number) > 599 || typeof envelope.finalUrl !== 'string'
            || typeof envelope.redirected !== 'boolean' || typeof envelope.body !== 'string') {
            throw new Icd11WhoOfficialTokenIssuerError('response_invalid');
        }
        if (envelope.redirected || envelope.finalUrl !== ICD11_WHO_OFFICIAL_TOKEN_FINAL_URL
            || ((envelope.status as number) >= 300 && (envelope.status as number) < 400)) {
            throw new Icd11WhoOfficialTokenIssuerError('redirect_rejected');
        }
        if (envelope.body.length > ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES
            || encoder.encode(envelope.body).byteLength > ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES) {
            throw new Icd11WhoOfficialTokenIssuerError('response_too_large');
        }
        const status = statusCode(envelope.status as number);
        if (status) throw new Icd11WhoOfficialTokenIssuerError(status);
        const token = parseToken(envelope.body);
        if (!token) throw new Icd11WhoOfficialTokenIssuerError('response_invalid');
        return token;
    };
}
