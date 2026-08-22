/* @Codex */
import 'server-only';

import type { createTypedProjectionBroker } from '../typed-projection-broker';
import { bindProjectionBrokerToServerSession } from './server-session-projection-broker';
import { getSession, registerServerSessionResource, type ServerSession } from './server-session';

type BrokerControl = ReturnType<typeof createTypedProjectionBroker>['control'];
type ActiveBinding = {
    leaseRef: string;
    selectionEpoch: number;
    control: BrokerControl;
    unregister: () => void;
};

export type ServerSessionProjectionOwnerErrorCode =
    | 'epoch_not_advanced' | 'input_invalid' | 'owner_disposed' | 'owner_exists' | 'session_ineligible';

export class ServerSessionProjectionOwnerError extends Error {
    constructor(readonly code: ServerSessionProjectionOwnerErrorCode) {
        super(`Server session projection owner rejected: ${code}`);
        this.name = 'ServerSessionProjectionOwnerError';
    }
}

export type ServerSessionProjectionOwner = Readonly<{
    install(input: Readonly<{ leaseRef: string; selectionEpoch: number; control: BrokerControl }>): void;
    dispose(): void;
}>;

function fail(code: ServerSessionProjectionOwnerErrorCode): never {
    throw new ServerSessionProjectionOwnerError(code);
}

function parseInstall(input: unknown) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
        || Object.getPrototypeOf(input) !== Object.prototype) fail('input_invalid');
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 3 || keys.some((key) => !['leaseRef', 'selectionEpoch', 'control'].includes(String(key)))) {
        fail('input_invalid');
    }
    const value = input as { leaseRef?: unknown; selectionEpoch?: unknown; control?: unknown };
    if (typeof value.leaseRef !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u.test(value.leaseRef)) {
        fail('input_invalid');
    }
    if (!Number.isSafeInteger(value.selectionEpoch) || (value.selectionEpoch as number) < 1) fail('input_invalid');
    const control = value.control as Partial<BrokerControl> | null;
    if (!control || typeof control.lock !== 'function' || typeof control.revoke !== 'function'
        || typeof control.changeSelection !== 'function') fail('input_invalid');
    return { leaseRef: value.leaseRef, selectionEpoch: value.selectionEpoch as number, control: control as BrokerControl };
}

function revoke(binding: ActiveBinding | null): void {
    if (!binding) return;
    binding.unregister();
    try { binding.control.revoke(); } catch { /* Authority remains removed and cleanup detail stays opaque. */ }
}

export function createServerSessionProjectionOwnerRegistry() {
    const owners = new Map<string, ServerSessionProjectionOwner>();
    const retired = new Set<string>();

    return Object.freeze({
        lookup(sessionId: string): ServerSessionProjectionOwner | null {
            return owners.get(sessionId) ?? null;
        },
        create(session: ServerSession): ServerSessionProjectionOwner {
            if (session.authChannel !== 'web' || session.id === 'local-api' || getSession(session.id) !== session) {
                return fail('session_ineligible');
            }
            if (owners.has(session.id)) return fail('owner_exists');
            if (retired.has(session.id)) return fail('owner_disposed');

            let active: ActiveBinding | null = null;
            let terminal = false;
            let unregisterOwner: (() => void) | null = null;
            const finish = (revokeActive: boolean) => {
                if (terminal) return;
                terminal = true;
                retired.add(session.id);
                owners.delete(session.id);
                unregisterOwner?.();
                unregisterOwner = null;
                const previous = active;
                active = null;
                if (revokeActive) revoke(previous);
            };
            const owner: ServerSessionProjectionOwner = Object.freeze({
                install(input) {
                    if (terminal) return fail('owner_disposed');
                    const next = parseInstall(input);
                    if (active && next.selectionEpoch <= active.selectionEpoch) return fail('epoch_not_advanced');
                    const previous = active;
                    active = null;
                    revoke(previous);
                    const unregister = bindProjectionBrokerToServerSession(session.id, next.control);
                    active = { ...next, unregister };
                },
                dispose() { finish(true); },
            });

            unregisterOwner = registerServerSessionResource(session.id, () => finish(false));
            if (!unregisterOwner) return fail('session_ineligible');
            owners.set(session.id, owner);
            return owner;
        },
    });
}

declare global {
    // eslint-disable-next-line no-var
    var __mediflowServerSessionProjectionOwnerRegistry: ReturnType<typeof createServerSessionProjectionOwnerRegistry> | undefined;
}

export const serverSessionProjectionOwnerRegistry = globalThis.__mediflowServerSessionProjectionOwnerRegistry
    ?? createServerSessionProjectionOwnerRegistry();
globalThis.__mediflowServerSessionProjectionOwnerRegistry = serverSessionProjectionOwnerRegistry;
