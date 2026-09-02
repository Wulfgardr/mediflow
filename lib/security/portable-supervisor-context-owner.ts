/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

import type { Context } from '../headless/authenticated-agent-launcher-contract.ts';
import {
    acquireAuthenticatedWebSessionProjectionOwnerContext,
    type AuthenticatedWebSessionProjectionOwnerContext,
} from './server-auth';
import type {
    ServerSessionSelectionBindingControllerV1,
    ServerSessionSelectionBindingSnapshotV1,
    ServerSessionSelectionCommitBindingControllerV1,
    ServerSessionSelectionCommitBindingV1,
    ServerSessionSelectionDependentRegistrationV1,
    ServerSessionSelectionLifecycleControllerV1,
    ServerSessionSelectionScopeV1,
} from './server-session-projection-owner.ts';
import { serverSessionProjectionOwnerProductionOwner } from './server-session-projection-owner-production-internal';

export const PORTABLE_SUPERVISOR_CONTEXT_TTL_MS = 15 * 60_000;
export const PORTABLE_SUPERVISOR_BOOTSTRAP_TTL_MS = 5_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;

type Scheduler = (delayMs: number, operation: () => void) => () => void;
type Sources = Readonly<{
    acquireAuthenticatedContext(): Promise<AuthenticatedWebSessionProjectionOwnerContext | null>;
    selectionLifecycle: ServerSessionSelectionLifecycleControllerV1;
    selectionBinding: ServerSessionSelectionBindingControllerV1;
    selectionCommitBinding: ServerSessionSelectionCommitBindingControllerV1;
    clock(): number;
    hashRef(value: string): string;
    scheduler: Scheduler;
}>;
type RecordState = {
    active: boolean; scope: ServerSessionSelectionScopeV1;
    registration: ServerSessionSelectionDependentRegistrationV1;
    binding: ServerSessionSelectionBindingSnapshotV1;
    expected: Readonly<Record<string, unknown>>; userRef: string; parentRef: string;
    generation: number; revocationGeneration: number; restartGeneration: number;
    parentGeneration: number; policyGeneration: number; expiresAt: number;
    cancel: (() => void) | null;
};

export type PortableSupervisorContextOwnerV1 = Readonly<{
    readHostContext(): Context;
    stop(): boolean;
    restart(): boolean;
    dispose(): boolean;
}>;

export class PortableSupervisorContextOwnerError extends Error {
    readonly code = 'context_unavailable' as const;
    constructor() {
        super('Portable supervisor context unavailable');
        this.name = 'PortableSupervisorContextOwnerError';
    }
}

function unavailable(): never { throw new PortableSupervisorContextOwnerError(); }
function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function safeInteger(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function hostId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.trim() === value
        && Buffer.byteLength(value, 'utf8') <= 256;
}
function currentBinding(value: unknown, scope: unknown): value is ServerSessionSelectionBindingSnapshotV1 {
    if (!value || typeof value !== 'object' || types.isProxy(value)) return false;
    try {
        const candidate = value as ServerSessionSelectionBindingSnapshotV1;
        const selection = candidate.selection;
        return !!selection && selection.scopeIdentity === scope && REF.test(selection.sessionRef)
            && REF.test(selection.patientRef) && REF.test(selection.ambulatoryRef) && REF.test(selection.leaseRef)
            && safeInteger(selection.selectionEpoch) && safeInteger(selection.expiresAt, 1)
            && safeInteger(candidate.patientVersion, 1);
    } catch { return false; }
}
function sameBinding(left: ServerSessionSelectionBindingSnapshotV1, right: unknown): boolean {
    if (!currentBinding(right, left.selection.scopeIdentity)) return false;
    return right.selection.sessionRef === left.selection.sessionRef
        && right.selection.patientRef === left.selection.patientRef
        && right.selection.ambulatoryRef === left.selection.ambulatoryRef
        && right.selection.leaseRef === left.selection.leaseRef
        && right.selection.selectionEpoch === left.selection.selectionEpoch
        && right.selection.expiresAt === left.selection.expiresAt
        && right.patientVersion === left.patientVersion;
}
function clinicalBinding(value: unknown, version: number): value is ServerSessionSelectionCommitBindingV1 {
    if (!value || typeof value !== 'object' || types.isProxy(value)) return false;
    try {
        const candidate = value as ServerSessionSelectionCommitBindingV1;
        return hostId(candidate.patientId) && hostId(candidate.ambulatoryId) && candidate.patientVersion === version;
    } catch { return false; }
}

/** Process owner composed below with authenticated Web and production selection lifecycle only. */
export function createPortableSupervisorContextOwnerProcessV1(sources: Sources): Readonly<{
    acquire(): Promise<PortableSupervisorContextOwnerV1 | null>;
}> {
    let generation = 0, revocationGeneration = 0, restartGeneration = 1;
    let parentGeneration = 0, lastProcessNow = -1;
    let ownerSlot: symbol | RecordState | null = null;
    const policyGeneration = 1;
    const increment = (value: number): number => value < Number.MAX_SAFE_INTEGER ? value + 1 : unavailable();
    const clock = (): number => {
        let value: unknown;
        try { value = sources.clock(); } catch { return unavailable(); }
        if (!safeInteger(value) || value < lastProcessNow) return unavailable();
        lastProcessNow = value; return value;
    };
    const hash = (domain: 'user' | 'parent', value: string): string => {
        let digest: unknown;
        try { digest = sources.hashRef(`mediflow.portable-supervisor.${domain}.v1\0${value}`); }
        catch { return unavailable(); }
        if (typeof digest !== 'string' || !DIGEST.test(digest)) return unavailable();
        return `${domain}.${digest.slice(7)}`;
    };
    const terminal = (state: RecordState, detached: boolean, restart: boolean): boolean => {
        if (!state.active) return false;
        state.active = false;
        if (ownerSlot === state) ownerSlot = null;
        const cancel = state.cancel; state.cancel = null;
        try { cancel?.(); } catch { /* Logical authority is already terminal. */ }
        if (!detached) {
            try { sources.selectionLifecycle.unregisterDependent(state.scope, state.registration); }
            catch { /* Logical authority remains terminal. */ }
        }
        revocationGeneration = increment(revocationGeneration);
        if (restart) restartGeneration = increment(restartGeneration);
        return true;
    };
    const read = (state: RecordState): Context => {
        if (!state.active) return unavailable();
        let now: number;
        try { now = clock(); } catch { terminal(state, false, false); return unavailable(); }
        if (now > state.expiresAt - 2) { terminal(state, false, false); return unavailable(); }
        let observed: unknown = null;
        let selectionCurrent = false;
        try {
            selectionCurrent = sources.selectionBinding.withCurrentDependentBinding(
                state.scope, state.registration, (candidate) => { observed = candidate; },
            );
        } catch { terminal(state, false, false); return unavailable(); }
        if (!selectionCurrent || !sameBinding(state.binding, observed)) {
            terminal(state, false, false); return unavailable();
        }
        let clinical: unknown = null;
        let clinicalCurrent = false;
        try {
            clinicalCurrent = sources.selectionCommitBinding.withCurrentCommitBinding(
                state.scope, state.expected as never, (candidate) => { clinical = candidate; },
            );
        } catch { terminal(state, false, false); return unavailable(); }
        if (!clinicalCurrent || !clinicalBinding(clinical, state.binding.patientVersion)) {
            terminal(state, false, false); return unavailable();
        }
        observed = null;
        try {
            selectionCurrent = sources.selectionBinding.withCurrentDependentBinding(
                state.scope, state.registration, (candidate) => { observed = candidate; },
            );
        } catch { terminal(state, false, false); return unavailable(); }
        if (!selectionCurrent || !sameBinding(state.binding, observed)) {
            terminal(state, false, false); return unavailable();
        }
        const bootstrapExpiresAt = Math.min(now + PORTABLE_SUPERVISOR_BOOTSTRAP_TTL_MS, state.expiresAt - 1);
        return record({ status: 'available' as const, userRef: state.userRef, parentRef: state.parentRef,
            purposeCode: 'care_coordination', patientId: clinical.patientId, ambulatoryId: clinical.ambulatoryId,
            generation: state.generation, revocationGeneration: state.revocationGeneration,
            selectionEpoch: state.binding.selection.selectionEpoch, restartGeneration: state.restartGeneration,
            parentGeneration: state.parentGeneration, policyGeneration: state.policyGeneration,
            expiresAt: state.expiresAt, bootstrapExpiresAt });
    };
    const acquire = async (): Promise<PortableSupervisorContextOwnerV1 | null> => {
        if (ownerSlot !== null) return null;
        const acquisition = Symbol('portable-supervisor-acquisition');
        ownerSlot = acquisition;
        let authenticatedContext: AuthenticatedWebSessionProjectionOwnerContext | null;
        try { authenticatedContext = await sources.acquireAuthenticatedContext(); }
        catch { if (ownerSlot === acquisition) ownerSlot = null; return null; }
        if (!authenticatedContext) { if (ownerSlot === acquisition) ownerSlot = null; return null; }
        const authenticated = authenticatedContext.session;
        let scope: ServerSessionSelectionScopeV1 | null = null;
        let registration: ServerSessionSelectionDependentRegistrationV1 | null = null;
        let state: RecordState | null = null, drained = false;
        try {
            const attached = sources.selectionLifecycle.withCurrentSelection(authenticated, (candidate) => {
                scope = candidate;
                registration = sources.selectionLifecycle.registerDependent(candidate, () => {
                    if (state) terminal(state, true, false); else drained = true;
                });
            });
            if (!attached || !scope || !registration || drained) return null;
            let binding: unknown = null;
            if (!sources.selectionBinding.withCurrentDependentBinding(
                scope, registration, (candidate) => { binding = candidate; },
            ) || !currentBinding(binding, scope)) return null;
            const selected = binding as ServerSessionSelectionBindingSnapshotV1;
            const expected = record({ webSessionId: authenticated.id, sessionRef: selected.selection.sessionRef,
                patientRef: selected.selection.patientRef, ambulatoryRef: selected.selection.ambulatoryRef,
                leaseRef: selected.selection.leaseRef, selectionEpoch: selected.selection.selectionEpoch,
                patientVersion: selected.patientVersion });
            let clinical: unknown = null;
            if (!sources.selectionCommitBinding.withCurrentCommitBinding(
                scope, expected as never, (candidate) => { clinical = candidate; },
            ) || !clinicalBinding(clinical, selected.patientVersion)) return null;
            const now = clock();
            const expiresAt = Math.min(authenticated.expiresAt, selected.selection.expiresAt,
                now + PORTABLE_SUPERVISOR_CONTEXT_TTL_MS);
            if (!safeInteger(expiresAt) || now > expiresAt - 2) return null;
            generation = increment(generation); parentGeneration = increment(parentGeneration);
            state = { active: true, scope, registration, binding: selected, expected,
                userRef: hash('user', authenticated.userId),
                parentRef: hash('parent', `${selected.selection.sessionRef}\0${selected.selection.leaseRef}`),
                generation, revocationGeneration, restartGeneration, parentGeneration, policyGeneration,
                expiresAt, cancel: null };
            let scheduling = true, firedSynchronously = false, cancel: unknown;
            try {
                cancel = sources.scheduler(expiresAt - now, () => {
                    if (scheduling) { firedSynchronously = true; return; }
                    if (state) terminal(state, false, false);
                });
            } catch { terminal(state, false, false); return null; }
            scheduling = false;
            if (firedSynchronously || typeof cancel !== 'function') {
                try { if (typeof cancel === 'function') cancel(); } catch { /* unpublished timer denied */ }
                terminal(state, false, false); return null;
            }
            state.cancel = cancel as () => void;
            if (!sources.selectionLifecycle.confirmDependent(scope, registration)) {
                terminal(state, false, false); return null;
            }
            ownerSlot = state;
            read(state);
            const published = state;
            return record({ readHostContext: () => read(published), stop: () => terminal(published, false, false),
                restart: () => terminal(published, false, true), dispose: () => terminal(published, false, false) });
        } catch { if (state) terminal(state, false, false); return null; }
        finally {
            if (ownerSlot === acquisition) ownerSlot = null;
            if (!state?.active && scope && registration) {
                try { sources.selectionLifecycle.unregisterDependent(scope, registration); } catch { /* partial attach denied */ }
            }
        }
    };
    return record({ acquire });
}

const hostDateNow = Date.now;
const hostSetTimeout = setTimeout;
const hostClearTimeout = clearTimeout;
function schedule(delayMs: number, operation: () => void): () => void {
    let active = true;
    const timer = hostSetTimeout(() => { if (!active) return; active = false; operation(); }, delayMs);
    timer.unref();
    return () => { if (!active) return; active = false; hostClearTimeout(timer); };
}
function hashRef(value: string): string {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

const productionSelectionOwner = serverSessionProjectionOwnerProductionOwner;
const productionProcessOwner = createPortableSupervisorContextOwnerProcessV1({
    acquireAuthenticatedContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    selectionLifecycle: productionSelectionOwner.selectionLifecycleController,
    selectionBinding: productionSelectionOwner.selectionBindingController,
    selectionCommitBinding: productionSelectionOwner.selectionCommitBindingController,
    clock: hostDateNow, hashRef, scheduler: schedule,
});

export const acquirePortableSupervisorContextOwnerV1 = productionProcessOwner.acquire;
