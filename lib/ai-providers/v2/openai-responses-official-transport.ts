/* @Codex */
import { types } from 'node:util';
import {
    OPENAI_RESPONSES_V2_TARGET,
    type OpenAIResponsesTransportV2,
} from './openai-responses-adapter';
import {
    bindProviderLifecycleToInstanceProfileV2,
    snapshotProviderInstanceProfileV2,
} from './provider-instance-profile';
import { PROVIDER_BINDING_V2_LIMITS, snapshotProviderLifecycleV2 } from './provider-lifecycle';

export const OPENAI_RESPONSES_OFFICIAL_URL = 'https://api.openai.com/v1/responses' as const;
export const OPENAI_RESPONSES_OFFICIAL_MAX_REQUEST_BYTES = 1_048_576 as const;

const FACTORY_KEYS = ['instanceBinding', 'fetch'] as const;
const INSTANCE_BINDING_KEYS = ['schemaVersion', 'providerInstanceRef', 'profile', 'lifecycle'] as const;
const REQUEST_KEYS = ['target', 'method', 'headers', 'body', 'signal', 'maxResponseBytes'] as const;
const BODY_KEYS = ['model', 'input', 'store', 'background'] as const;
const HEADER_NAMES = ['authorization', 'content-type', 'user-agent'] as const;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const SIGNAL_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const HEADERS_ENTRIES = Headers.prototype.entries;
const HEADERS_DELETE = Headers.prototype.delete;
const RESPONSE_STATUS = Object.getOwnPropertyDescriptor(Response.prototype, 'status')?.get;
const RESPONSE_REDIRECTED = Object.getOwnPropertyDescriptor(Response.prototype, 'redirected')?.get;
const RESPONSE_BODY = Object.getOwnPropertyDescriptor(Response.prototype, 'body')?.get;
const STREAM_GET_READER = ReadableStream.prototype.getReader;
const READER_READ = ReadableStreamDefaultReader.prototype.read;
const READER_CANCEL = ReadableStreamDefaultReader.prototype.cancel;
const READER_RELEASE = ReadableStreamDefaultReader.prototype.releaseLock;
const PROMISE_THEN = Promise.prototype.then;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class OpenAIResponsesOfficialHttpsTransportError extends Error {
    constructor(public readonly code: 'input_invalid' | 'request_cancelled' | 'upstream_unavailable' | 'response_invalid') {
        super(`OpenAI official HTTPS transport rejected: ${code}`);
        this.name = 'OpenAIResponsesOfficialHttpsTransportError';
    }
}

function exact(value: unknown, keys: readonly string[], frozen = false): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
            || (frozen && !Object.isFrozen(value))) return null;
        const prototype = Object.getPrototypeOf(value);
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length
            || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = descriptors[key];
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
            output[key] = descriptor.value;
        }
        return output;
    } catch { return null; }
}

function safeFunction(value: unknown): value is FetchLike {
    try { return typeof value === 'function' && !types.isProxy(value); }
    catch { return false; }
}

function checkedFactory(value: unknown) {
    const factory = exact(value, FACTORY_KEYS, true);
    const instanceBinding = exact(factory?.instanceBinding, INSTANCE_BINDING_KEYS, true);
    if (!factory || !instanceBinding || !safeFunction(factory.fetch)) {
        throw new OpenAIResponsesOfficialHttpsTransportError('input_invalid');
    }
    let profile; let link; let lifecycle;
    try {
        profile = snapshotProviderInstanceProfileV2(instanceBinding.profile);
        link = bindProviderLifecycleToInstanceProfileV2(factory.instanceBinding);
        lifecycle = snapshotProviderLifecycleV2(instanceBinding.lifecycle);
    } catch { throw new OpenAIResponsesOfficialHttpsTransportError('input_invalid'); }
    if (lifecycle.status !== 'enabled' || profile.providerType !== 'openai' || profile.model !== 'gpt-5.4-mini'
        || profile.auth.credentialClass !== 'api_key' || profile.auth.authRef === null
        || link.providerType !== 'openai' || link.providerInstanceRef !== profile.providerInstance.instanceRef
        || link.operation !== 'document_synthesis' || link.model !== profile.model
        || link.groupRef !== 'group.review-only.v1' || link.venue !== 'cloud'
        || link.egress !== 'official_provider_api' || link.egressProfileRef !== 'egress.synthetic.v1'
        || link.retention !== 'provider_declared' || link.retentionProfileRef !== 'retention.standard.v1'
        || link.dataUse !== 'synthetic_nonclinical' || link.dataUseProfileRef !== 'data-use.synthetic-nonclinical.v1'
        || link.functionAllowlist.length !== 0) {
        throw new OpenAIResponsesOfficialHttpsTransportError('input_invalid');
    }
    return Object.freeze({ fetch: factory.fetch });
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
        if (typeof SIGNAL_ABORTED !== 'function' || !value || typeof value !== 'object' || types.isProxy(value)
            || Object.getPrototypeOf(value) !== AbortSignal.prototype) return null;
        Reflect.apply(SIGNAL_ABORTED, value, []);
        return value as AbortSignal;
    } catch { return null; }
}

function aborted(signal: AbortSignal): boolean {
    try { return Reflect.apply(SIGNAL_ABORTED as () => boolean, signal, []) === true; }
    catch { throw new OpenAIResponsesOfficialHttpsTransportError('input_invalid'); }
}

function checkedHeaders(value: unknown): { source: Headers; copy: Headers } | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value)
            || Object.getPrototypeOf(value) !== Headers.prototype) return null;
        const entries = Array.from(Reflect.apply(HEADERS_ENTRIES, value, [])) as [string, string][];
        if (entries.length !== HEADER_NAMES.length
            || entries.some(([name], index) => name !== HEADER_NAMES[index])) return null;
        const values = Object.fromEntries(entries) as Record<string, string>;
        if (!/^Bearer [\x21-\x7e]{16,4096}$/u.test(values.authorization ?? '')
            || values['content-type'] !== 'application/json'
            || values['user-agent'] !== 'MediFlow/0.8.5 provider-v2') return null;
        return { source: value as Headers, copy: new Headers(entries) };
    } catch { return null; }
}

function checkedBody(value: unknown): string | null {
    if (typeof value !== 'string' || ENCODER.encode(value).byteLength > OPENAI_RESPONSES_OFFICIAL_MAX_REQUEST_BYTES) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return null; }
    const body = exact(parsed, BODY_KEYS);
    if (!body || body.model !== 'gpt-5.4-mini' || typeof body.input !== 'string' || !body.input
        || ENCODER.encode(body.input).byteLength > PROVIDER_BINDING_V2_LIMITS.maxInputBytes
        || body.store !== false || body.background !== false) return null;
    return value;
}

function checkedRequest(value: unknown) {
    const request = exact(value, REQUEST_KEYS, true);
    const headers = checkedHeaders(request?.headers);
    const body = checkedBody(request?.body);
    const signal = checkedSignal(request?.signal);
    if (!request || request.target !== OPENAI_RESPONSES_V2_TARGET || request.method !== 'POST' || !headers || !body
        || !signal || !Number.isSafeInteger(request.maxResponseBytes) || (request.maxResponseBytes as number) <= 0
        || (request.maxResponseBytes as number) > PROVIDER_BINDING_V2_LIMITS.maxOutputBytes) {
        throw new OpenAIResponsesOfficialHttpsTransportError('input_invalid');
    }
    return Object.freeze({ headers, body, signal, maxResponseBytes: request.maxResponseBytes as number });
}

function checkedResponse(value: unknown): { status: number; body: ReadableStream<Uint8Array> | null } {
    try {
        if (typeof RESPONSE_STATUS !== 'function' || typeof RESPONSE_REDIRECTED !== 'function'
            || typeof RESPONSE_BODY !== 'function' || !value || typeof value !== 'object' || types.isProxy(value)
            || Object.getPrototypeOf(value) !== Response.prototype) {
            throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid');
        }
        const status = Reflect.apply(RESPONSE_STATUS, value, []);
        const redirected = Reflect.apply(RESPONSE_REDIRECTED, value, []);
        const body = Reflect.apply(RESPONSE_BODY, value, []);
        if (!Number.isSafeInteger(status) || status < 100 || status > 599 || redirected !== false
            || (body !== null && (typeof body !== 'object' || types.isProxy(body)
                || Object.getPrototypeOf(body) !== ReadableStream.prototype))) {
            throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid');
        }
        return { status, body };
    } catch (error) {
        if (error instanceof OpenAIResponsesOfficialHttpsTransportError) throw error;
        throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid');
    }
}

async function boundedBody(stream: ReadableStream<Uint8Array> | null, maximum: number): Promise<string> {
    if (!stream) return '';
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
        const candidate: unknown = Reflect.apply(STREAM_GET_READER, stream, []);
        if (!candidate || typeof candidate !== 'object' || types.isProxy(candidate)
            || Object.getPrototypeOf(candidate) !== ReadableStreamDefaultReader.prototype) {
            throw new Error('reader');
        }
        reader = candidate as ReadableStreamDefaultReader<Uint8Array>;
    }
    catch { throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid'); }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const pending = Reflect.apply(READER_READ, reader, []);
            const result = nativePromise(pending) ? await pending : null;
            const snapshot = exact(result, ['value', 'done']);
            if (!snapshot || typeof snapshot.done !== 'boolean') {
                throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid');
            }
            if (snapshot.done) break;
            if (!(snapshot.value instanceof Uint8Array) || types.isProxy(snapshot.value)) {
                throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid');
            }
            length += snapshot.value.byteLength;
            if (length > maximum) {
                try { await Reflect.apply(READER_CANCEL, reader, []); } catch { /* bounded best effort */ }
                return 'x'.repeat(maximum + 1);
            }
            chunks.push(Uint8Array.from(snapshot.value));
        }
        const joined = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
        try { return DECODER.decode(joined); }
        catch { throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid'); }
    } finally {
        chunks.length = 0;
        try { Reflect.apply(READER_RELEASE, reader, []); } catch { /* no retained reader */ }
    }
}

function clearHeaders(headers: Headers): void {
    for (const name of HEADER_NAMES) {
        try { Reflect.apply(HEADERS_DELETE, headers, [name]); } catch { /* best effort after request */ }
    }
}

export function createOpenAIResponsesOfficialHttpsTransport(factoryValue: unknown): OpenAIResponsesTransportV2 {
    const factory = checkedFactory(factoryValue);
    const fetchImpl = factory.fetch;
    return async (requestValue) => {
        const request = checkedRequest(requestValue);
        let retired = false;
        const retire = () => {
            if (retired) return;
            retired = true;
            clearHeaders(request.headers.source); clearHeaders(request.headers.copy);
        };
        try { Reflect.apply(ADD_EVENT_LISTENER, request.signal, ['abort', retire, { once: true }]); }
        catch {
            retire();
            throw new OpenAIResponsesOfficialHttpsTransportError('input_invalid');
        }
        try {
            if (aborted(request.signal)) throw new OpenAIResponsesOfficialHttpsTransportError('request_cancelled');
            let returned: unknown;
            try {
                returned = Reflect.apply(fetchImpl, undefined, [OPENAI_RESPONSES_OFFICIAL_URL, Object.freeze({
                    method: 'POST', headers: request.headers.copy, body: request.body, signal: request.signal,
                    redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
                    keepalive: false,
                }) satisfies RequestInit]);
            } catch { throw new OpenAIResponsesOfficialHttpsTransportError('upstream_unavailable'); }
            const pending = nativePromise(returned);
            if (!pending) throw new OpenAIResponsesOfficialHttpsTransportError('response_invalid');
            let responseValue: unknown;
            try { responseValue = await pending; }
            catch {
                throw new OpenAIResponsesOfficialHttpsTransportError(aborted(request.signal)
                    ? 'request_cancelled' : 'upstream_unavailable');
            }
            const response = checkedResponse(responseValue);
            const body = await boundedBody(response.body, request.maxResponseBytes);
            return Object.freeze({ status: response.status, body });
        } finally {
            try { Reflect.apply(REMOVE_EVENT_LISTENER, request.signal, ['abort', retire]); } catch { /* native signal validated */ }
            retire();
        }
    };
}
