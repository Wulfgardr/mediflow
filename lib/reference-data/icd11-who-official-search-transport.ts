/* @Codex */
import { types } from 'node:util';
import {
    ICD11_WHO_BINDING,
    ICD11_WHO_TRANSPORT_TARGET,
    type Icd11WhoTransportRequest,
} from './icd11-who-service.ts';
import {
    Icd11WhoCredentialLeaseError,
    type Icd11WhoTokenLease,
} from './icd11-who-credential-lease.ts';
import type {
    Icd11WhoOfficialHeaders,
    Icd11WhoOfficialHttpsClient,
    Icd11WhoOfficialQuery,
    Icd11WhoOfficialSearchHttpsClientRequest,
} from './icd11-who-official-https-client.ts';
import { parseIcd11WhoOfficialSearchBody } from './icd11-who-official-search-parser.ts';

export const ICD11_WHO_OFFICIAL_SEARCH_PATH = '/icd/release/11/2026-01/mms/search' as const;
const URL_AUTHORITY_SEPARATOR = '//';
export const ICD11_WHO_OFFICIAL_SEARCH_FINAL_URL_PREFIX =
    `https:${URL_AUTHORITY_SEPARATOR}id.who.int${ICD11_WHO_OFFICIAL_SEARCH_PATH}?q=`;

const FACTORY_KEYS = ['credentials', 'client'] as const;
const REQUEST_KEYS = ['target', 'releaseId', 'linearization', 'language', 'query', 'limit',
    'maxResponseBytes', 'signal'] as const;
const ENVELOPE_KEYS = ['status', 'finalUrl', 'redirected', 'body'] as const;
const MANAGER_METHODS = ['acquire', 'consume'] as const;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const PROMISE_THEN = Promise.prototype.then;
const encoder = new TextEncoder();
type Callable = (...args: never[]) => unknown;
type HeaderInjector = (sink: { set(name: string, value: string): unknown }) => void;
type CredentialManager = Readonly<{
    acquire(): Promise<Icd11WhoTokenLease>;
    consume<T>(lease: unknown, run: (inject: HeaderInjector) => T | Promise<T>): Promise<T>;
}>;
type ClientOutcome = Readonly<{ ok: true; value: unknown }> | Readonly<{
    ok: false; code: 'credential_unavailable' | 'request_cancelled' | 'upstream_unavailable' | 'response_invalid';
}>;

export type Icd11WhoOfficialSearchTransportErrorCode = 'input_invalid' | 'credential_unavailable'
    | 'request_cancelled' | 'request_timeout' | 'redirect_rejected' | 'response_too_large' | 'auth_rejected'
    | 'rate_limited' | 'upstream_unavailable' | 'response_invalid';

export class Icd11WhoOfficialSearchTransportError extends Error {
    constructor(public readonly code: Icd11WhoOfficialSearchTransportErrorCode) {
        super(`ICD-11 WHO official search transport rejected: ${code}`);
        this.name = 'Icd11WhoOfficialSearchTransportError';
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

function manager(value: unknown): CredentialManager | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value)) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const key of MANAGER_METHODS) {
            const descriptor = descriptors[key];
            if (!descriptor || !('value' in descriptor) || !safeFunction(descriptor.value)) return null;
        }
        return value as CredentialManager;
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
    catch { throw new Icd11WhoOfficialSearchTransportError('input_invalid'); }
}

function createFacades(queryText: string) {
    const headersMap = new Map<string, string>([
        ['api-version', 'v2'], ['accept', 'application/json'], ['accept-language', 'en'],
    ]);
    const queryMap = new Map<string, string>([
        ['q', queryText], ['flatResults', 'true'], ['highlightingEnabled', 'false'],
        ['medicalCodingMode', 'true'], ['includeKeywordResult', 'false'],
    ]);
    let active = true; let authorizationWritten = false;
    const headers: Icd11WhoOfficialHeaders = Object.freeze({ get(name: string) {
        return active && typeof name === 'string' ? headersMap.get(name.toLowerCase()) ?? null : null;
    } });
    const query: Icd11WhoOfficialQuery = Object.freeze({ get(name: string) {
        return active && typeof name === 'string' ? queryMap.get(name) ?? null : null;
    } });
    const sink = Object.freeze({ set(name: string, value: string) {
        if (!active || authorizationWritten || name !== 'Authorization' || typeof value !== 'string'
            || !/^Bearer [\x21-\x7e]{16,4096}$/.test(value)) {
            throw new Icd11WhoOfficialSearchTransportError('credential_unavailable');
        }
        authorizationWritten = true; headersMap.set('authorization', value);
    } });
    return Object.freeze({ headers, query, sink, ready: () => authorizationWritten, clear() {
        active = false; headersMap.clear(); queryMap.clear();
    } });
}

function checkedRequest(value: unknown): { input: Icd11WhoTransportRequest; signal: AbortSignal } {
    const input = dataRecord(value, REQUEST_KEYS);
    const signal = checkedSignal(input?.signal);
    if (!input || input.target !== ICD11_WHO_TRANSPORT_TARGET
        || input.releaseId !== ICD11_WHO_BINDING.releaseId
        || input.linearization !== ICD11_WHO_BINDING.linearization
        || input.language !== ICD11_WHO_BINDING.language
        || typeof input.query !== 'string' || !input.query
        || input.query !== input.query.trim().replace(/\s+/g, ' ')
        || /[\u0000-\u001f\u007f<>\u061c\u200e\u200f\ud800-\udfff\u202a-\u202e\u2066-\u2069]/u.test(input.query)
        || encoder.encode(input.query).byteLength > ICD11_WHO_BINDING.queryMaxBytes
        || input.limit !== ICD11_WHO_BINDING.resultLimit
        || input.maxResponseBytes !== ICD11_WHO_BINDING.maxResponseBytes || !signal) {
        throw new Icd11WhoOfficialSearchTransportError('input_invalid');
    }
    return { input: input as unknown as Icd11WhoTransportRequest, signal };
}

async function retireLease(credentials: CredentialManager, lease: unknown): Promise<void> {
    try {
        const retired = Reflect.apply(credentials.consume as unknown as Callable, credentials, [lease,
            (inject: HeaderInjector) => { inject({ set() { return undefined; } }); }]);
        const pending = nativePromise(retired);
        if (pending) await Reflect.apply(PROMISE_THEN, pending, [(value: unknown) => value, () => undefined]);
    } catch { /* best-effort consume after caller cancellation */ }
}

function statusCode(status: number): Icd11WhoOfficialSearchTransportErrorCode | null {
    if (status === 200) return null;
    if (status === 401 || status === 403) return 'auth_rejected';
    if (status === 408) return 'request_timeout';
    if (status === 429) return 'rate_limited';
    return status >= 500 ? 'upstream_unavailable' : 'response_invalid';
}

function expectedFinalUrl(query: string): string {
    return `${ICD11_WHO_OFFICIAL_SEARCH_FINAL_URL_PREFIX}${encodeURIComponent(query)}`
        + '&flatResults=true&highlightingEnabled=false&medicalCodingMode=true&includeKeywordResult=false';
}

export function createIcd11WhoOfficialSearchTransport(factoryValue: unknown) {
    const factory = dataRecord(factoryValue, FACTORY_KEYS);
    const credentials = manager(factory?.credentials);
    if (!factory || !credentials || !safeFunction(factory.client)) {
        throw new Icd11WhoOfficialSearchTransportError('input_invalid');
    }
    const client = factory.client as unknown as Icd11WhoOfficialHttpsClient;
    return async (requestValue: unknown) => {
        const { input, signal } = checkedRequest(requestValue);
        if (isAborted(signal)) throw new Icd11WhoOfficialSearchTransportError('request_cancelled');
        let leaseValue: unknown;
        try { leaseValue = Reflect.apply(credentials.acquire as unknown as Callable, credentials, []); }
        catch { throw new Icd11WhoOfficialSearchTransportError('credential_unavailable'); }
        const leasePending = nativePromise(leaseValue);
        if (!leasePending) throw new Icd11WhoOfficialSearchTransportError('credential_unavailable');
        let cancelAcquire!: () => void;
        const acquireCancelled = new Promise<Readonly<{ cancelled: true }>>((resolve) => {
            cancelAcquire = () => resolve(Object.freeze({ cancelled: true as const }));
        });
        Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', cancelAcquire, { once: true }]);
        if (isAborted(signal)) cancelAcquire();
        const acquired = await Promise.race([
            Reflect.apply(PROMISE_THEN, leasePending, [
                (lease: unknown) => Object.freeze({ cancelled: false as const, lease }),
                () => Object.freeze({ cancelled: false as const, failed: true as const }),
            ]),
            acquireCancelled,
        ]);
        Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', cancelAcquire]);
        if (acquired.cancelled) {
            void Reflect.apply(PROMISE_THEN, leasePending, [
                (lease: unknown) => retireLease(credentials, lease), () => undefined,
            ]);
            throw new Icd11WhoOfficialSearchTransportError('request_cancelled');
        }
        if ('failed' in acquired) throw new Icd11WhoOfficialSearchTransportError('credential_unavailable');
        const lease = acquired.lease;
        if (isAborted(signal)) {
            await retireLease(credentials, lease);
            throw new Icd11WhoOfficialSearchTransportError('request_cancelled');
        }

        const facades = createFacades(input.query);
        let cancelClient!: () => void;
        const clientCancelled = new Promise<ClientOutcome>((resolve) => {
            cancelClient = () => resolve(Object.freeze({ ok: false as const, code: 'request_cancelled' as const }));
        });
        Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', cancelClient, { once: true }]);
        if (isAborted(signal)) cancelClient();
        let consumedValue: unknown;
        try {
            consumedValue = Reflect.apply(credentials.consume as unknown as Callable, credentials, [lease,
                (inject: HeaderInjector) => {
                    inject(facades.sink);
                    if (!facades.ready()) return Promise.resolve(Object.freeze({ ok: false as const,
                        code: 'credential_unavailable' as const }));
                    const request = Object.freeze({
                        target: ICD11_WHO_TRANSPORT_TARGET,
                        protocol: 'https:' as const, hostname: 'id.who.int' as const,
                        path: ICD11_WHO_OFFICIAL_SEARCH_PATH, method: 'GET' as const, redirect: 'error' as const,
                        headers: facades.headers, query: facades.query, signal,
                        maxResponseBytes: ICD11_WHO_BINDING.maxResponseBytes,
                    }) satisfies Icd11WhoOfficialSearchHttpsClientRequest;
                    let returned: unknown;
                    try { returned = Reflect.apply(client as unknown as Callable, undefined, [request]); }
                    catch { return Promise.resolve(Object.freeze({ ok: false as const,
                        code: 'upstream_unavailable' as const })); }
                    const pending = nativePromise(returned);
                    if (!pending) return Promise.resolve(Object.freeze({ ok: false as const,
                        code: 'response_invalid' as const }));
                    const settled = Reflect.apply(PROMISE_THEN, pending, [
                        (value: unknown) => Object.freeze({ ok: true as const, value }),
                        () => Object.freeze({ ok: false as const, code: 'upstream_unavailable' as const }),
                    ]);
                    return Promise.race([settled, clientCancelled]);
                }]);
            const consumed = nativePromise(consumedValue);
            if (!consumed) throw new Icd11WhoOfficialSearchTransportError('credential_unavailable');
            consumedValue = await consumed;
        } catch (error) {
            if (isAborted(signal)) throw new Icd11WhoOfficialSearchTransportError('request_cancelled');
            if (error instanceof Icd11WhoOfficialSearchTransportError) throw error;
            if (error instanceof Icd11WhoCredentialLeaseError) {
                throw new Icd11WhoOfficialSearchTransportError('credential_unavailable');
            }
            throw new Icd11WhoOfficialSearchTransportError('credential_unavailable');
        } finally {
            Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', cancelClient]);
            facades.clear();
        }
        const outcome = consumedValue as ClientOutcome;
        if (!outcome || outcome.ok !== true) {
            throw new Icd11WhoOfficialSearchTransportError(outcome?.code ?? 'response_invalid');
        }
        if (isAborted(signal)) throw new Icd11WhoOfficialSearchTransportError('request_cancelled');
        const envelope = dataRecord(outcome.value, ENVELOPE_KEYS);
        if (!envelope || !Number.isSafeInteger(envelope.status) || (envelope.status as number) < 100
            || (envelope.status as number) > 599 || typeof envelope.finalUrl !== 'string'
            || typeof envelope.redirected !== 'boolean' || typeof envelope.body !== 'string') {
            throw new Icd11WhoOfficialSearchTransportError('response_invalid');
        }
        if (envelope.redirected || envelope.finalUrl !== expectedFinalUrl(input.query)
            || ((envelope.status as number) >= 300 && (envelope.status as number) < 400)) {
            throw new Icd11WhoOfficialSearchTransportError('redirect_rejected');
        }
        if (envelope.body.length > ICD11_WHO_BINDING.maxResponseBytes
            || encoder.encode(envelope.body).byteLength > ICD11_WHO_BINDING.maxResponseBytes) {
            throw new Icd11WhoOfficialSearchTransportError('response_too_large');
        }
        const status = statusCode(envelope.status as number);
        if (status) throw new Icd11WhoOfficialSearchTransportError(status);
        const parsed = parseIcd11WhoOfficialSearchBody(envelope.body);
        if (!parsed) throw new Icd11WhoOfficialSearchTransportError('response_invalid');
        return parsed;
    };
}
