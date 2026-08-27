/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { authenticateNetworkPairedClient } from '@/lib/network-home-base-server';
import type { StoredNetworkPairedClient } from '@/lib/network-pairing-model';

export type NativeBootstrapAdmission = object;

export type NativeBootstrapRouteBinding = Readonly<{
    clientId: string;
    clientPlatform: StoredNetworkPairedClient['clientPlatform'];
}>;

type AdmissionEntry = NativeBootstrapRouteBinding;

const RequestConstructor = Request;
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
function requestFromEnvelope(value: unknown): Request | null {
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
        return !IsProxy(request) && request instanceof RequestConstructor ? request : null;
    } catch {
        return null;
    }
}

function bindingFromPairedClient(client: StoredNetworkPairedClient | null): NativeBootstrapRouteBinding | null {
    if (!client || typeof client.clientId !== 'string') return null;
    if (client.clientPlatform !== 'macos' && client.clientPlatform !== 'ios' && client.clientPlatform !== 'ipados') return null;
    return ObjectFreeze({ clientId: client.clientId, clientPlatform: client.clientPlatform });
}

/**
 * Authenticates only through the server-owned paired-client state and emits a
 * process-local, one-use token. Source-surface headers are intentionally not read.
 */
/* @Codex */
export async function admitNativeBootstrap(value: unknown): Promise<NativeBootstrapAdmission | null> {
    const request = requestFromEnvelope(value);
    if (!request) return null;

    const binding = bindingFromPairedClient(await authenticateNetworkPairedClient(request));
    if (!binding) return null;

    const token = ObjectFreeze(ObjectCreate(null));
    safeSet(admissions, token, binding);
    return token as NativeBootstrapAdmission;
}

/** Consume exactly once before a later route packet is assembled. */
/* @Codex */
export function consumeNativeBootstrapAdmission(value: unknown): NativeBootstrapRouteBinding | null {
    try {
        if (!value || typeof value !== 'object' || IsProxy(value)) return null;
        const binding = safeGet(admissions, value);
        if (!binding) return null;
        safeDelete(admissions, value);
        return binding;
    } catch {
        return null;
    }
}
