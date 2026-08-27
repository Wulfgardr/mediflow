/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { authenticateNetworkPairedClient, loadNetworkPairingState } from '@/lib/network-home-base-server';
import {
    NETWORK_PAIRED_CLIENT_ID_HEADER,
    NETWORK_PAIRED_CLIENT_TOKEN_HEADER,
    type StoredNetworkPairedClient,
} from '@/lib/network-pairing-model';

export type NativeBootstrapAdmission = object;

export type NativeBootstrapRouteBinding = Readonly<{
    clientId: string;
    clientPlatform: StoredNetworkPairedClient['clientPlatform'];
}>;

type AdmissionEntry = NativeBootstrapRouteBinding & Readonly<{ tokenHash: string }>;

const RequestConstructor = Request;
const RequestPrototype = RequestConstructor.prototype;
const HeadersPrototype = Headers.prototype;
const ObjectPrototype = Object.prototype;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectCreate = Object.create;
const ObjectFreeze = Object.freeze;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const weakMapDelete = WeakMap.prototype.delete;
const apply = Reflect.apply;
const IsProxy = types.isProxy;
const admissions = new WeakMap<object, AdmissionEntry>();
const RequestHeadersGetter = ObjectGetOwnPropertyDescriptor(RequestPrototype, 'headers')?.get ?? null;
const HeadersGet = HeadersPrototype.get;

function safeGet<K extends WeakKey, V>(map: WeakMap<K, V>, key: K): V | undefined {
    return apply(weakMapGet, map, [key]);
}

function safeSet<K extends WeakKey, V>(map: WeakMap<K, V>, key: K, value: V): void {
    apply(weakMapSet, map, [key, value]);
}

function safeDelete<K extends WeakKey, V>(map: WeakMap<K, V>, key: K): boolean {
    return apply(weakMapDelete, map, [key]);
}

/* The single caller input is a fixed-key, ordinary data envelope. */
function canonicalPairedRequest(value: unknown): Request | null {
    try {
        if (!value || typeof value !== 'object' || IsProxy(value)) return null;
        const prototype = ObjectGetPrototypeOf(value);
        if (prototype !== ObjectPrototype && prototype !== null) return null;
        if (ObjectGetOwnPropertySymbols(value).length !== 0) return null;
        const keys = ObjectGetOwnPropertyNames(value);
        if (keys.length !== 1 || keys[0] !== 'request') return null;
        const descriptor = ObjectGetOwnPropertyDescriptor(value, 'request');
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null;
        const request = descriptor.value;
        if (!request || typeof request !== 'object' || IsProxy(request)) return null;
        if (ObjectGetOwnPropertyNames(request).length !== 0 || ObjectGetOwnPropertySymbols(request).length !== 0) return null;
        if (ObjectGetPrototypeOf(request) !== RequestPrototype || ObjectGetOwnPropertyDescriptor(request, 'headers') || !RequestHeadersGetter) return null;
        const headers = apply(RequestHeadersGetter, request, []) as Headers;
        if (IsProxy(headers) || ObjectGetPrototypeOf(headers) !== HeadersPrototype || ObjectGetOwnPropertyDescriptor(headers, 'get')) return null;
        const clientId = apply(HeadersGet, headers, [NETWORK_PAIRED_CLIENT_ID_HEADER]);
        const pairedClientToken = apply(HeadersGet, headers, [NETWORK_PAIRED_CLIENT_TOKEN_HEADER]);
        if (typeof clientId !== 'string' || typeof pairedClientToken !== 'string') return null;
        return new RequestConstructor('https://127.0.0.1/native-bootstrap', {
            headers: {
                [NETWORK_PAIRED_CLIENT_ID_HEADER]: clientId,
                [NETWORK_PAIRED_CLIENT_TOKEN_HEADER]: pairedClientToken,
            },
        });
    } catch {
        return null;
    }
}

function entryFromPairedClient(client: StoredNetworkPairedClient | null): AdmissionEntry | null {
    if (!client || typeof client.clientId !== 'string' || typeof client.tokenHash !== 'string') return null;
    if (client.clientPlatform !== 'macos' && client.clientPlatform !== 'ios' && client.clientPlatform !== 'ipados') return null;
    return ObjectFreeze({ clientId: client.clientId, clientPlatform: client.clientPlatform, tokenHash: client.tokenHash });
}

/**
 * Authenticates only through the server-owned paired-client state and emits a
 * process-local, one-use token. Source-surface headers are intentionally not read.
 */
/* @Codex */
export async function admitNativeBootstrap(value: unknown): Promise<NativeBootstrapAdmission | null> {
    const request = canonicalPairedRequest(value);
    if (!request) return null;

    const entry = entryFromPairedClient(await authenticateNetworkPairedClient(request));
    if (!entry) return null;

    const token = ObjectFreeze(ObjectCreate(null));
    safeSet(admissions, token, entry);
    return token as NativeBootstrapAdmission;
}

/** Consume exactly once before a later route packet is assembled. */
/* @Codex */
export async function consumeNativeBootstrapAdmission(value: unknown): Promise<NativeBootstrapRouteBinding | null> {
    try {
        if (!value || typeof value !== 'object' || IsProxy(value)) return null;
        const entry = safeGet(admissions, value);
        if (!entry) return null;
        safeDelete(admissions, value);
        const current = (await loadNetworkPairingState()).clients.find((client) =>
            client.clientId === entry.clientId
            && client.clientPlatform === entry.clientPlatform
            && client.tokenHash === entry.tokenHash
        );
        return current ? ObjectFreeze({ clientId: entry.clientId, clientPlatform: entry.clientPlatform }) : null;
    } catch {
        return null;
    }
}
