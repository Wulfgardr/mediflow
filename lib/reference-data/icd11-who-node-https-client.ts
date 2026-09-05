/* @Codex */
import { Buffer } from 'node:buffer';
import https from 'node:https';
import { types } from 'node:util';

import {
    ICD11_WHO_TOKEN_TARGET,
} from './icd11-who-credential-lease.ts';
import type {
    Icd11WhoOfficialHttpsClient,
    Icd11WhoOfficialHttpsClientRequest,
} from './icd11-who-official-https-client.ts';
import {
    ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES,
    ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES,
} from './icd11-who-official-token-issuer.ts';
import {
    ICD11_WHO_BINDING,
    ICD11_WHO_TRANSPORT_TARGET,
} from './icd11-who-service.ts';

const TOKEN_KEYS = ['target', 'protocol', 'hostname', 'path', 'method', 'redirect', 'headers', 'form',
    'signal', 'maxRequestBytes', 'maxResponseBytes'] as const;
const SEARCH_KEYS = ['target', 'protocol', 'hostname', 'path', 'method', 'redirect', 'headers', 'query',
    'signal', 'maxResponseBytes'] as const;
const TOKEN_HEADER_NAMES = ['accept', 'authorization', 'content-type', 'user-agent'] as const;
const SEARCH_HEADER_NAMES = ['api-version', 'accept', 'accept-language', 'authorization'] as const;
const TOKEN_FORM_NAMES = ['grant_type', 'scope'] as const;
const SEARCH_QUERY_NAMES = ['q', 'flatResults', 'highlightingEnabled', 'medicalCodingMode',
    'includeKeywordResult'] as const;
const TOKEN_FINAL_URL = 'https://icdaccessmanagement.who.int/connect/token' as const;
const SEARCH_PATH = '/icd/release/11/2026-01/mms/search' as const;
const SIGNAL_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export type Icd11WhoNodeHttpsClientErrorCode = 'input_invalid' | 'request_cancelled'
    | 'upstream_unavailable' | 'response_invalid' | 'response_too_large';

export class Icd11WhoNodeHttpsClientError extends Error {
    constructor(public readonly code: Icd11WhoNodeHttpsClientErrorCode) {
        super(`ICD-11 WHO Node HTTPS client rejected: ${code}`);
        this.name = 'Icd11WhoNodeHttpsClientError';
    }
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
            || !Object.isFrozen(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length) return null;
        const copy: Record<string, unknown> = Object.create(null);
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index]!;
            const descriptor = descriptors[key];
            if (ownKeys[index] !== key || !descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
            copy[key] = descriptor.value;
        }
        return copy;
    } catch { return null; }
}

function safeGet(value: unknown): ((name: string) => unknown) | null {
    const candidate = exact(value, ['get']);
    try {
        return candidate && typeof candidate.get === 'function' && !types.isProxy(candidate.get)
            ? candidate.get as (name: string) => unknown : null;
    } catch { return null; }
}

function values(value: unknown, names: readonly string[]): Record<string, string> | null {
    const get = safeGet(value);
    if (!get) return null;
    const output: Record<string, string> = Object.create(null);
    try {
        for (const name of names) {
            const item = Reflect.apply(get, value, [name]);
            if (typeof item !== 'string') return null;
            output[name] = item;
        }
    } catch { return null; }
    return output;
}

function checkedSignal(value: unknown): AbortSignal | null {
    try {
        if (typeof SIGNAL_ABORTED !== 'function' || !value || typeof value !== 'object' || types.isProxy(value)
            || Object.getPrototypeOf(value) !== AbortSignal.prototype) return null;
        Reflect.apply(SIGNAL_ABORTED, value, []);
        return value as AbortSignal;
    } catch { return null; }
}

function aborted(signal: AbortSignal): boolean {
    try { return Reflect.apply(SIGNAL_ABORTED as () => boolean, signal, []) === true; }
    catch { throw new Icd11WhoNodeHttpsClientError('input_invalid'); }
}

type Materialized = Readonly<{
    hostname: 'icdaccessmanagement.who.int' | 'id.who.int';
    path: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body: string | null;
    maxResponseBytes: number;
    finalUrl: string;
    signal: AbortSignal;
}>;

function materializeToken(value: unknown): Materialized | null {
    const input = exact(value, TOKEN_KEYS);
    const headers = values(input?.headers, TOKEN_HEADER_NAMES);
    const form = values(input?.form, TOKEN_FORM_NAMES);
    const signal = checkedSignal(input?.signal);
    if (!input || input.target !== ICD11_WHO_TOKEN_TARGET || input.protocol !== 'https:'
        || input.hostname !== 'icdaccessmanagement.who.int' || input.path !== '/connect/token'
        || input.method !== 'POST' || input.redirect !== 'error'
        || input.maxRequestBytes !== ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES
        || input.maxResponseBytes !== ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES || !headers || !form || !signal
        || headers.accept !== 'application/json'
        || !/^Basic [A-Za-z0-9+/]{16,4096}={0,2}$/u.test(headers.authorization)
        || headers['content-type'] !== 'application/x-www-form-urlencoded'
        || headers['user-agent'] !== 'MediFlow/0.8.5 ICD11-WHO'
        || form.grant_type !== 'client_credentials' || form.scope !== 'icdapi_access') return null;
    const body = new URLSearchParams(form).toString();
    if (Buffer.byteLength(body, 'utf8') > ICD11_WHO_OFFICIAL_TOKEN_MAX_REQUEST_BYTES) return null;
    return Object.freeze({ hostname: 'icdaccessmanagement.who.int', path: '/connect/token', method: 'POST',
        headers, body, maxResponseBytes: ICD11_WHO_OFFICIAL_TOKEN_MAX_RESPONSE_BYTES,
        finalUrl: TOKEN_FINAL_URL, signal });
}

function materializeSearch(value: unknown): Materialized | null {
    const input = exact(value, SEARCH_KEYS);
    const headers = values(input?.headers, SEARCH_HEADER_NAMES);
    const query = values(input?.query, SEARCH_QUERY_NAMES);
    const signal = checkedSignal(input?.signal);
    if (!input || input.target !== ICD11_WHO_TRANSPORT_TARGET || input.protocol !== 'https:'
        || input.hostname !== 'id.who.int' || input.path !== SEARCH_PATH || input.method !== 'GET'
        || input.redirect !== 'error' || input.maxResponseBytes !== ICD11_WHO_BINDING.maxResponseBytes
        || !headers || !query || !signal || headers['api-version'] !== 'v2'
        || headers.accept !== 'application/json' || headers['accept-language'] !== 'en'
        || !/^Bearer [\x21-\x7e]{16,4096}$/u.test(headers.authorization)
        || !query.q || query.q !== query.q.trim().replace(/\s+/g, ' ')
        || Buffer.byteLength(query.q, 'utf8') > ICD11_WHO_BINDING.queryMaxBytes
        || query.flatResults !== 'true' || query.highlightingEnabled !== 'false'
        || query.medicalCodingMode !== 'true' || query.includeKeywordResult !== 'false') return null;
    const suffix = new URLSearchParams(query).toString();
    const path = `${SEARCH_PATH}?${suffix}`;
    return Object.freeze({ hostname: 'id.who.int', path, method: 'GET', headers, body: null,
        maxResponseBytes: ICD11_WHO_BINDING.maxResponseBytes, finalUrl: `https://id.who.int${path}`, signal });
}

function materialize(value: unknown): Materialized {
    const candidate = materializeToken(value) ?? materializeSearch(value);
    if (!candidate) throw new Icd11WhoNodeHttpsClientError('input_invalid');
    if (aborted(candidate.signal)) throw new Icd11WhoNodeHttpsClientError('request_cancelled');
    return candidate;
}

export function createIcd11WhoNodeHttpsClient(): Icd11WhoOfficialHttpsClient {
    return async (requestValue: Icd11WhoOfficialHttpsClientRequest) => {
        const request = materialize(requestValue);
        return new Promise((resolve, reject) => {
            let settled = false;
            let removeAbort = (): void => undefined;
            const finish = (action: () => void): void => {
                if (settled) return;
                settled = true;
                removeAbort();
                for (const key of Object.keys(request.headers)) {
                    request.headers[key] = '';
                    delete request.headers[key];
                }
                action();
            };
            const fail = (code: Icd11WhoNodeHttpsClientErrorCode): void =>
                finish(() => reject(new Icd11WhoNodeHttpsClientError(code)));
            let nativeRequest: ReturnType<typeof https.request>;
            try {
                nativeRequest = https.request({
                    protocol: 'https:', hostname: request.hostname, port: 443, path: request.path,
                    method: request.method, agent: false, headers: request.headers, signal: request.signal,
                }, (response) => {
                    const status = response.statusCode;
                    if (!Number.isSafeInteger(status) || (status as number) < 100 || (status as number) > 599) {
                        response.destroy();
                        nativeRequest.destroy();
                        fail('response_invalid');
                        return;
                    }
                    const chunks: Buffer[] = [];
                    let byteLength = 0;
                    response.on('data', (chunk: unknown) => {
                        if (settled) return;
                        if (!Buffer.isBuffer(chunk)) {
                            response.destroy(); nativeRequest.destroy(); fail('response_invalid'); return;
                        }
                        byteLength += chunk.byteLength;
                        if (byteLength > request.maxResponseBytes) {
                            chunks.length = 0; response.destroy(); nativeRequest.destroy(); fail('response_too_large'); return;
                        }
                        chunks.push(chunk);
                    });
                    response.once('error', () => fail(aborted(request.signal)
                        ? 'request_cancelled' : 'upstream_unavailable'));
                    response.once('end', () => {
                        if (settled) return;
                        let body: string;
                        try { body = textDecoder.decode(Buffer.concat(chunks, byteLength)); }
                        catch { fail('response_invalid'); return; }
                        chunks.length = 0;
                        finish(() => resolve(Object.freeze({ status: status as number, finalUrl: request.finalUrl,
                            redirected: false as const, body })));
                    });
                });
            } catch { fail('upstream_unavailable'); return; }
            nativeRequest.once('error', () => fail(aborted(request.signal)
                ? 'request_cancelled' : 'upstream_unavailable'));
            const onAbort = (): void => {
                nativeRequest.destroy();
                fail('request_cancelled');
            };
            Reflect.apply(ADD_EVENT_LISTENER, request.signal, ['abort', onAbort, { once: true }]);
            removeAbort = () => Reflect.apply(REMOVE_EVENT_LISTENER, request.signal, ['abort', onAbort]);
            if (aborted(request.signal)) onAbort();
            if (settled) return;
            try { nativeRequest.end(request.body ?? undefined); }
            catch { nativeRequest.destroy(); fail('upstream_unavailable'); }
        });
    };
}
