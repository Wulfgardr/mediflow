/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
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
type CanonicalPair = Readonly<{ patientId: string; ambulatoryId: string }>;
type SelectionSources = Readonly<{
    resolve(session: ServerSession, input: CanonicalPair): CanonicalPair;
    clock(): number;
    entropy(): Uint8Array;
}>;
type SelectionLease = Readonly<{
    sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string;
    leaseRef: string; expiresAt: number;
}>;
type SelectionState = CanonicalPair & SelectionLease & Readonly<{ consumed: boolean }>;

export type ServerSessionProjectionOwnerErrorCode =
    | 'epoch_conflict' | 'epoch_not_advanced' | 'input_invalid' | 'lease_expired' | 'owner_disposed'
    | 'owner_exists' | 'reference_unavailable' | 'selection_busy' | 'selection_unavailable'
    | 'session_ineligible' | 'session_unavailable' | 'stale_selection';

export class ServerSessionProjectionOwnerError extends Error {
    constructor(readonly code: ServerSessionProjectionOwnerErrorCode) {
        super(`Server session projection owner rejected: ${code}`);
        this.name = 'ServerSessionProjectionOwnerError';
    }
}

export type ServerSessionProjectionOwner = Readonly<{
    install(input: Readonly<{ leaseRef: string; selectionEpoch: number; control: BrokerControl }>): void;
    issueSelection(input: Readonly<{ expectedEpoch: number; patientId: string; ambulatoryId: string }>): SelectionLease;
    dereferenceSelection(session: ServerSession, input: Readonly<{
        sessionRef: string; selectionEpoch: number; patientRef: string; ambulatoryRef: string; leaseRef: string;
    }>): CanonicalPair;
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

const defaultSources: SelectionSources = Object.freeze({
    resolve: () => fail('selection_unavailable'),
    clock: () => Date.now(),
    entropy: () => randomBytes(16),
});

function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
        || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== keys.length) {
        return fail('input_invalid');
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !('value' in descriptor)) return fail('input_invalid');
        result[key] = descriptor.value;
    }
    return result;
}

export function createServerSessionProjectionOwnerRegistry(sourceOverrides: Partial<SelectionSources> = {}) {
    const sources = Object.freeze({ ...defaultSources, ...sourceOverrides });
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
            let epoch = 0;
            let selection: SelectionState | null = null;
            let selecting = false;
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
                selection = null;
                if (revokeActive) revoke(previous);
            };
            const issuedRefs = new Set<string>();
            const reference = (prefix: string) => {
                let bytes: Uint8Array;
                try { bytes = sources.entropy(); } catch { return fail('reference_unavailable'); }
                if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) return fail('reference_unavailable');
                let hex = ''; for (let index = 0; index < 16; index += 1) hex += bytes[index].toString(16).padStart(2, '0');
                const value = `${prefix}_${hex}`;
                if (issuedRefs.has(value)) return fail('reference_unavailable');
                issuedRefs.add(value); return value;
            };
            const sessionRef = reference('ssr');
            const readClock = () => {
                try { const now = sources.clock(); if (Number.isFinite(now)) return now; } catch { /* fixed error below */ }
                return fail('selection_unavailable');
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
                issueSelection(input) {
                    if (terminal) return fail('session_unavailable');
                    if (selecting) return fail('selection_busy');
                    selecting = true;
                    try {
                        const value = exact(input, ['expectedEpoch', 'patientId', 'ambulatoryId']);
                        if (!Number.isSafeInteger(value.expectedEpoch) || (value.expectedEpoch as number) < 0
                            || typeof value.patientId !== 'string' || typeof value.ambulatoryId !== 'string') fail('input_invalid');
                        const live = getSession(session.id);
                        if (session.authChannel !== 'web' || live !== session) fail('session_unavailable');
                        let pair: CanonicalPair;
                        try { pair = sources.resolve(session, { patientId: value.patientId, ambulatoryId: value.ambulatoryId }); }
                        catch { return fail('selection_unavailable'); }
                        const finalSession = getSession(session.id);
                        if (finalSession !== session || session.authChannel !== 'web') fail('session_unavailable');
                        if (value.expectedEpoch !== epoch) fail('epoch_conflict');
                        const now = readClock(); const expiresAt = finalSession.expiresAt;
                        if (now >= expiresAt) fail('lease_expired');
                        const next: SelectionState = Object.freeze({ ...pair, sessionRef, selectionEpoch: epoch + 1,
                            patientRef: reference('ptr'), ambulatoryRef: reference('abr'), leaseRef: reference('lsr'),
                            expiresAt, consumed: false });
                        const previous = active; active = null; revoke(previous);
                        epoch = next.selectionEpoch; selection = next;
                        return Object.freeze({ sessionRef, selectionEpoch: next.selectionEpoch, patientRef: next.patientRef,
                            ambulatoryRef: next.ambulatoryRef, leaseRef: next.leaseRef, expiresAt });
                    } finally { selecting = false; }
                },
                dereferenceSelection(presentedSession, input) {
                    const value = exact(input, ['sessionRef', 'selectionEpoch', 'patientRef', 'ambulatoryRef', 'leaseRef']);
                    if (terminal) return fail('session_unavailable');
                    if (!selection) return fail('stale_selection');
                    if (readClock() >= selection.expiresAt) {
                        const previous = active; active = null; selection = null; revoke(previous); return fail('lease_expired');
                    }
                    if (presentedSession !== session || getSession(session.id) !== session) fail('session_unavailable');
                    if (selection.consumed || value.sessionRef !== sessionRef || value.selectionEpoch !== selection.selectionEpoch
                        || value.patientRef !== selection.patientRef || value.ambulatoryRef !== selection.ambulatoryRef
                        || value.leaseRef !== selection.leaseRef) fail('stale_selection');
                    selection = Object.freeze({ ...selection, consumed: true });
                    return Object.freeze({ patientId: selection.patientId, ambulatoryId: selection.ambulatoryId });
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
