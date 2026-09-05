/* @Codex */
import { types } from 'node:util';

import { createIcd11WhoHostComposition } from './icd11-who-host-composition.ts';
import { createIcd11WhoNodeHttpsClient } from './icd11-who-node-https-client.ts';
import type { Icd11WhoSearchReceipt } from './icd11-who-service.ts';

const PORT_KEYS = ['now', 'resolveSecretReference', 'audit'] as const;
type Callable = (...args: never[]) => unknown;
type HostPorts = Readonly<{
    now: () => unknown;
    resolveSecretReference: Callable;
    audit: (receipt: Icd11WhoSearchReceipt) => void | Promise<void>;
}>;

export type Icd11WhoServerOwnerErrorCode = 'input_invalid' | 'ports_unbound'
    | 'ports_already_bound' | 'owner_disposed';

export class Icd11WhoServerOwnerError extends Error {
    constructor(public readonly code: Icd11WhoServerOwnerErrorCode) {
        super(`ICD-11 WHO server owner rejected: ${code}`);
        this.name = 'Icd11WhoServerOwnerError';
    }
}

function exactRecord(value: unknown): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        const ownKeys = Reflect.ownKeys(value);
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== PORT_KEYS.length
            || ownKeys.some((key) => typeof key !== 'string'
                || !(PORT_KEYS as readonly string[]).includes(key))) return null;
        const output: Record<string, unknown> = Object.create(null);
        for (const key of PORT_KEYS) {
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

function ports(value: unknown): HostPorts {
    const candidate = exactRecord(value);
    if (!candidate || !safeFunction(candidate.now) || !safeFunction(candidate.resolveSecretReference)
        || !safeFunction(candidate.audit)) throw new Icd11WhoServerOwnerError('input_invalid');
    return Object.freeze({
        now: candidate.now as () => unknown,
        resolveSecretReference: candidate.resolveSecretReference as Callable,
        audit: candidate.audit as (receipt: Icd11WhoSearchReceipt) => void | Promise<void>,
    });
}

function compose(value: HostPorts) {
    return createIcd11WhoHostComposition(Object.freeze({
        now: value.now,
        resolveSecretReference: value.resolveSecretReference,
        audit: value.audit,
        client: createIcd11WhoNodeHttpsClient(),
    }));
}

function dormantPorts(): HostPorts {
    return Object.freeze({
        now: () => Date.now(),
        resolveSecretReference: async () => undefined,
        audit: async () => undefined,
    });
}

/** Process owner used by the server-only facade; the live HTTPS client is never caller supplied. */
export function createIcd11WhoServerProcessOwner() {
    let host = compose(dormantPorts());
    let bound = false;
    let disposed = false;
    const requireActive = (): void => {
        if (disposed) throw new Icd11WhoServerOwnerError('owner_disposed');
    };
    const bind = (value: unknown): boolean => {
        requireActive();
        if (bound) throw new Icd11WhoServerOwnerError('ports_already_bound');
        const replacement = compose(ports(value));
        host.dispose();
        host = replacement;
        bound = true;
        return true;
    };
    const configure = (value: unknown): void => {
        requireActive();
        if (!bound) throw new Icd11WhoServerOwnerError('ports_unbound');
        host.configure(value);
    };
    const status = () => {
        requireActive();
        return host.status();
    };
    const search = async (value: unknown) => {
        requireActive();
        return host.search(value);
    };
    const restart = (): boolean => {
        requireActive();
        if (!bound) throw new Icd11WhoServerOwnerError('ports_unbound');
        return host.restart();
    };
    const dispose = (): boolean => {
        if (disposed) return false;
        disposed = true;
        host.dispose();
        return true;
    };
    return Object.freeze({ bind, configure, status, search, restart, dispose });
}
