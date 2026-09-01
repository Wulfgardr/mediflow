/* @Codex */
import { types } from 'node:util';
import {
    ANTHROPIC_MESSAGES_V2_MAX_TOKENS,
    ANTHROPIC_MESSAGES_V2_TARGET,
    ANTHROPIC_MESSAGES_V2_VERSION,
    type AnthropicMessagesTransportV2,
} from './anthropic-messages-adapter';
import {
    bindProviderLifecycleToInstanceProfileV2,
    snapshotProviderInstanceProfileV2,
} from './provider-instance-profile';
import { PROVIDER_BINDING_V2_LIMITS } from './provider-lifecycle';

export const ANTHROPIC_MESSAGES_OFFICIAL_URL = 'https://api.anthropic.com/v1/messages' as const;
export const ANTHROPIC_MESSAGES_OFFICIAL_MAX_REQUEST_BYTES = 1_048_576 as const;
export const ANTHROPIC_WORKSPACE_AUTHORITY_V1_SCHEMA = 'mediflow.ai.anthropic-workspace-authority.v1' as const;

const FACTORY_KEYS = ['instanceBinding', 'workspaceAuthority', 'fetch'] as const;
const INSTANCE_BINDING_KEYS = ['schemaVersion', 'providerInstanceRef', 'profile', 'lifecycle'] as const;
const WORKSPACE_KEYS = ['schemaVersion', 'workspaceRef', 'keyScope', 'workspaceId'] as const;
const REQUEST_KEYS = ['target', 'method', 'headers', 'body', 'signal', 'maxResponseBytes'] as const;
const BODY_KEYS = ['model', 'max_tokens', 'messages'] as const;
const MESSAGE_KEYS = ['role', 'content'] as const;
const HEADER_NAMES = ['anthropic-version', 'content-type', 'user-agent', 'x-api-key'] as const;
const FORBIDDEN_REQUEST_HEADERS = ['anthropic-beta', 'anthropic-workspace-id', 'authorization'] as const;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder('utf-8', { fatal: true });
const SIGNAL_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const HEADERS_GET = Headers.prototype.get;
const HEADERS_DELETE = Headers.prototype.delete;
const RESPONSE_STATUS = Object.getOwnPropertyDescriptor(Response.prototype, 'status')?.get;
const RESPONSE_REDIRECTED = Object.getOwnPropertyDescriptor(Response.prototype, 'redirected')?.get;
const RESPONSE_HEADERS = Object.getOwnPropertyDescriptor(Response.prototype, 'headers')?.get;
const RESPONSE_BODY = Object.getOwnPropertyDescriptor(Response.prototype, 'body')?.get;
const STREAM_GET_READER = ReadableStream.prototype.getReader;
const READER_READ = ReadableStreamDefaultReader.prototype.read;
const READER_CANCEL = ReadableStreamDefaultReader.prototype.cancel;
const READER_RELEASE = ReadableStreamDefaultReader.prototype.releaseLock;
const PROMISE_THEN = Promise.prototype.then;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type WorkspaceAuthority = Readonly<{
    workspaceRef: string; keyScope: 'workspace_scoped' | 'multi_workspace'; workspaceId: string;
}>;

export class AnthropicMessagesOfficialHttpsTransportError extends Error {
    constructor(public readonly code: 'input_invalid' | 'request_cancelled' | 'upstream_unavailable' | 'response_invalid') {
        super(`Anthropic official HTTPS transport rejected: ${code}`);
        this.name = 'AnthropicMessagesOfficialHttpsTransportError';
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
    catch { throw new AnthropicMessagesOfficialHttpsTransportError('input_invalid'); }
}

function workspaceAuthority(value: unknown, expectedRef: string): WorkspaceAuthority | null {
    const authority = exact(value, WORKSPACE_KEYS, true);
    if (!authority || authority.schemaVersion !== ANTHROPIC_WORKSPACE_AUTHORITY_V1_SCHEMA
        || authority.workspaceRef !== expectedRef || !/^pws_[0-9a-f]{32}$/u.test(expectedRef)
        || (authority.keyScope !== 'workspace_scoped' && authority.keyScope !== 'multi_workspace')
        || typeof authority.workspaceId !== 'string'
        || !/^wrkspc_[A-Za-z0-9]{20,64}$/u.test(authority.workspaceId)) return null;
    return Object.freeze({ workspaceRef: expectedRef, keyScope: authority.keyScope,
        workspaceId: authority.workspaceId }) as WorkspaceAuthority;
}

function checkedFactory(value: unknown) {
    const factory = exact(value, FACTORY_KEYS, true);
    const binding = exact(factory?.instanceBinding, INSTANCE_BINDING_KEYS, true);
    if (!factory || !binding || !safeFunction(factory.fetch)) {
        throw new AnthropicMessagesOfficialHttpsTransportError('input_invalid');
    }
    let profile; let link;
    try {
        profile = snapshotProviderInstanceProfileV2(binding.profile);
        link = bindProviderLifecycleToInstanceProfileV2(factory.instanceBinding);
    } catch { throw new AnthropicMessagesOfficialHttpsTransportError('input_invalid'); }
    const expectedWorkspace = profile.providerInstance.workspaceRef;
    const authority = typeof expectedWorkspace === 'string'
        ? workspaceAuthority(factory.workspaceAuthority, expectedWorkspace) : null;
    if (!authority || profile.providerType !== 'anthropic' || profile.model !== 'claude-sonnet-4-6'
        || profile.auth.credentialClass !== 'api_key' || profile.auth.authRef === null
        || link.providerType !== 'anthropic' || link.providerInstanceRef !== profile.providerInstance.instanceRef
        || link.operation !== 'document_synthesis' || link.model !== profile.model
        || link.venue !== 'cloud' || link.egress !== 'official_provider_api'
        || link.dataUse !== 'synthetic_nonclinical' || link.functionAllowlist.length !== 0) {
        throw new AnthropicMessagesOfficialHttpsTransportError('input_invalid');
    }
    return Object.freeze({ fetch: factory.fetch, authority });
}

function checkedHeaders(value: unknown, authority: WorkspaceAuthority): Headers | null {
    const facade = exact(value, ['get'], true);
    if (!facade || !safeFunction(facade.get)) return null;
    const values: Record<string, string> = Object.create(null);
    try {
        for (const name of HEADER_NAMES) {
            const item = Reflect.apply(facade.get, value, [name]);
            if (typeof item !== 'string') return null;
            values[name] = item;
        }
        for (const name of FORBIDDEN_REQUEST_HEADERS) {
            if (Reflect.apply(facade.get, value, [name]) !== null) return null;
        }
    } catch { return null; }
    if (values['anthropic-version'] !== ANTHROPIC_MESSAGES_V2_VERSION
        || values['content-type'] !== 'application/json'
        || values['user-agent'] !== 'MediFlow/0.8.5 provider-v2'
        || !/^sk-ant-api[0-9A-Za-z._:-]{16,4096}$/u.test(values['x-api-key'] ?? '')) return null;
    const headers = new Headers(values);
    if (authority.keyScope === 'multi_workspace') headers.set('anthropic-workspace-id', authority.workspaceId);
    return headers;
}

function checkedBody(value: unknown): string | null {
    if (typeof value !== 'string' || ENCODER.encode(value).byteLength > ANTHROPIC_MESSAGES_OFFICIAL_MAX_REQUEST_BYTES) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return null; }
    const body = exact(parsed, BODY_KEYS);
    if (!body || body.model !== 'claude-sonnet-4-6' || body.max_tokens !== ANTHROPIC_MESSAGES_V2_MAX_TOKENS
        || !Array.isArray(body.messages) || body.messages.length !== 1) return null;
    const message = exact(body.messages[0], MESSAGE_KEYS);
    if (!message || message.role !== 'user' || typeof message.content !== 'string' || !message.content
        || ENCODER.encode(message.content).byteLength > PROVIDER_BINDING_V2_LIMITS.maxInputBytes) return null;
    return value;
}

function checkedRequest(value: unknown, authority: WorkspaceAuthority) {
    const request = exact(value, REQUEST_KEYS, true);
    const headers = checkedHeaders(request?.headers, authority);
    const body = checkedBody(request?.body);
    const signal = checkedSignal(request?.signal);
    if (!request || request.target !== ANTHROPIC_MESSAGES_V2_TARGET || request.method !== 'POST' || !headers || !body
        || !signal || !Number.isSafeInteger(request.maxResponseBytes) || (request.maxResponseBytes as number) <= 0
        || (request.maxResponseBytes as number) > PROVIDER_BINDING_V2_LIMITS.maxOutputBytes) {
        throw new AnthropicMessagesOfficialHttpsTransportError('input_invalid');
    }
    return Object.freeze({ headers, body, signal, maxResponseBytes: request.maxResponseBytes as number });
}

function checkedResponse(value: unknown, authority: WorkspaceAuthority) {
    try {
        if (typeof RESPONSE_STATUS !== 'function' || typeof RESPONSE_REDIRECTED !== 'function'
            || typeof RESPONSE_HEADERS !== 'function' || typeof RESPONSE_BODY !== 'function'
            || !value || typeof value !== 'object' || types.isProxy(value)
            || Object.getPrototypeOf(value) !== Response.prototype) throw new Error('response');
        const status = Reflect.apply(RESPONSE_STATUS, value, []);
        const redirected = Reflect.apply(RESPONSE_REDIRECTED, value, []);
        const headers = Reflect.apply(RESPONSE_HEADERS, value, []);
        const body = Reflect.apply(RESPONSE_BODY, value, []);
        if (!Number.isSafeInteger(status) || status < 100 || status > 599 || redirected !== false
            || !headers || Object.getPrototypeOf(headers) !== Headers.prototype || types.isProxy(headers)
            || (body !== null && (typeof body !== 'object' || types.isProxy(body)
                || Object.getPrototypeOf(body) !== ReadableStream.prototype))) throw new Error('response');
        if (status >= 200 && status < 300
            && Reflect.apply(HEADERS_GET, headers, ['anthropic-workspace-id']) !== authority.workspaceId) {
            throw new Error('workspace');
        }
        return { status, body: body as ReadableStream<Uint8Array> | null };
    } catch { throw new AnthropicMessagesOfficialHttpsTransportError('response_invalid'); }
}

async function boundedBody(stream: ReadableStream<Uint8Array> | null, maximum: number): Promise<string> {
    if (!stream) return '';
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
        const candidate: unknown = Reflect.apply(STREAM_GET_READER, stream, []);
        if (!candidate || typeof candidate !== 'object' || types.isProxy(candidate)
            || Object.getPrototypeOf(candidate) !== ReadableStreamDefaultReader.prototype) throw new Error('reader');
        reader = candidate as ReadableStreamDefaultReader<Uint8Array>;
    } catch { throw new AnthropicMessagesOfficialHttpsTransportError('response_invalid'); }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const pending = Reflect.apply(READER_READ, reader, []);
            const result = nativePromise(pending) ? await pending : null;
            const snapshot = exact(result, ['value', 'done']);
            if (!snapshot || typeof snapshot.done !== 'boolean') throw new Error('chunk');
            if (snapshot.done) break;
            if (!(snapshot.value instanceof Uint8Array) || types.isProxy(snapshot.value)) throw new Error('chunk');
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
        try { return DECODER.decode(joined); } catch { throw new Error('utf8'); }
    } catch (error) {
        if (error instanceof AnthropicMessagesOfficialHttpsTransportError) throw error;
        throw new AnthropicMessagesOfficialHttpsTransportError('response_invalid');
    } finally {
        chunks.length = 0;
        try { Reflect.apply(READER_RELEASE, reader, []); } catch { /* no retained reader */ }
    }
}

function clearHeaders(headers: Headers): void {
    for (const name of [...HEADER_NAMES, 'anthropic-workspace-id']) {
        try { Reflect.apply(HEADERS_DELETE, headers, [name]); } catch { /* best effort after request */ }
    }
}

export function createAnthropicMessagesOfficialHttpsTransport(factoryValue: unknown): AnthropicMessagesTransportV2 {
    const factory = checkedFactory(factoryValue);
    return async (requestValue) => {
        const request = checkedRequest(requestValue, factory.authority);
        let retired = false;
        const retire = () => { if (!retired) { retired = true; clearHeaders(request.headers); } };
        try { Reflect.apply(ADD_EVENT_LISTENER, request.signal, ['abort', retire, { once: true }]); }
        catch {
            retire();
            throw new AnthropicMessagesOfficialHttpsTransportError('input_invalid');
        }
        try {
            if (aborted(request.signal)) throw new AnthropicMessagesOfficialHttpsTransportError('request_cancelled');
            let returned: unknown;
            try {
                returned = Reflect.apply(factory.fetch, undefined, [ANTHROPIC_MESSAGES_OFFICIAL_URL, Object.freeze({
                    method: 'POST', headers: request.headers, body: request.body, signal: request.signal,
                    redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
                    keepalive: false,
                }) satisfies RequestInit]);
            } catch { throw new AnthropicMessagesOfficialHttpsTransportError('upstream_unavailable'); }
            const pending = nativePromise(returned);
            if (!pending) throw new AnthropicMessagesOfficialHttpsTransportError('response_invalid');
            let responseValue: unknown;
            try { responseValue = await pending; }
            catch {
                throw new AnthropicMessagesOfficialHttpsTransportError(aborted(request.signal)
                    ? 'request_cancelled' : 'upstream_unavailable');
            }
            const response = checkedResponse(responseValue, factory.authority);
            const body = await boundedBody(response.body, request.maxResponseBytes);
            return Object.freeze({ status: response.status, body });
        } finally {
            try { Reflect.apply(REMOVE_EVENT_LISTENER, request.signal, ['abort', retire]); } catch { /* native signal validated */ }
            retire();
        }
    };
}
