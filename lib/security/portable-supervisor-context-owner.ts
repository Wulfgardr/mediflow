/* @Codex */
import 'server-only';

import { createHash } from 'node:crypto';
import { types } from 'node:util';

import {
    PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1,
    type PortableSupervisorWebCaptureV1,
} from '../../packages/aip/src/portable-supervisor-web-ipc-contract.ts';
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

export const PORTABLE_SUPERVISOR_WEB_CAPTURE_TTL_MS = 15 * 60_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REF = /^[a-z][a-z0-9._-]{15,127}$/u;
const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REVOKE_REASONS = new Set(['logout', 'application_lock', 'reselection', 'explicit']);

export type PortableSupervisorWebCaptureTerminalReasonV1 =
    'logout' | 'application_lock' | 'reselection' | 'expiry' | 'web_disconnect' | 'explicit';
export type PortableSupervisorWebCaptureRevokeReasonV1 =
    'logout' | 'application_lock' | 'reselection' | 'explicit';
type Scheduler = (delayMs: number, operation: () => void) => unknown;
type TerminalObserver = (reason: PortableSupervisorWebCaptureTerminalReasonV1) => unknown;
type Sources = Readonly<{
    acquireAuthenticatedContext(): Promise<AuthenticatedWebSessionProjectionOwnerContext | null>;
    selectionLifecycle: ServerSessionSelectionLifecycleControllerV1;
    selectionBinding: ServerSessionSelectionBindingControllerV1;
    selectionCommitBinding: ServerSessionSelectionCommitBindingControllerV1;
    clock(): unknown;
    hashRef(value: string): unknown;
    scheduler: Scheduler;
}>;
type RecordState = {
    active: boolean; published: boolean; scope: ServerSessionSelectionScopeV1;
    registration: ServerSessionSelectionDependentRegistrationV1;
    context: AuthenticatedWebSessionProjectionOwnerContext;
    binding: ServerSessionSelectionBindingSnapshotV1;
    expected: Readonly<Record<string, unknown>>;
    capture: PortableSupervisorWebCaptureV1;
    observeTerminal: TerminalObserver;
    cancel: (() => void) | null;
};

export type PortableSupervisorWebCaptureOwnerV1 = Readonly<{
    readCapture(): PortableSupervisorWebCaptureV1;
    matchesCurrentContext(value: unknown): boolean;
    revoke(reason: PortableSupervisorWebCaptureRevokeReasonV1): boolean;
    dispose(): boolean;
}>;

export class PortableSupervisorWebCaptureOwnerError extends Error {
    readonly code = 'capture_unavailable' as const;
    constructor() {
        super('Portable supervisor Web capture unavailable');
        this.name = 'PortableSupervisorWebCaptureOwnerError';
    }
}

function unavailable(): never { throw new PortableSupervisorWebCaptureOwnerError(); }
function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function safeInteger(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function currentBinding(value: unknown, scope: unknown): value is ServerSessionSelectionBindingSnapshotV1 {
    if (!value || typeof value !== 'object' || types.isProxy(value)) return false;
    try {
        const candidate = value as ServerSessionSelectionBindingSnapshotV1;
        const selection = candidate.selection;
        return !!selection && selection.scopeIdentity === scope && REF.test(selection.sessionRef)
            && REF.test(selection.patientRef) && REF.test(selection.ambulatoryRef) && REF.test(selection.leaseRef)
            && safeInteger(selection.selectionEpoch, 1) && safeInteger(selection.expiresAt, 1)
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
        return typeof candidate.patientId === 'string' && HOST_ID.test(candidate.patientId)
            && typeof candidate.ambulatoryId === 'string' && HOST_ID.test(candidate.ambulatoryId)
            && candidate.patientVersion === version;
    } catch { return false; }
}
function discardPromise(value: unknown): boolean {
    if (!types.isPromise(value)) return false;
    try { void Promise.prototype.then.call(value, undefined, () => undefined); } catch { /* terminal observer */ }
    return true;
}

function canonicalAuthenticatedContext(value: unknown): AuthenticatedWebSessionProjectionOwnerContext | null {
    if (!value || typeof value !== 'object' || types.isProxy(value)) return null;
    try {
        if (!Object.isFrozen(value) || Object.getPrototypeOf(value) !== null) return null;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== 2 || !keys.includes('session') || !keys.includes('owner')) return null;
        const session = Object.getOwnPropertyDescriptor(value, 'session');
        const owner = Object.getOwnPropertyDescriptor(value, 'owner');
        if (!session?.enumerable || session.configurable || session.writable || !('value' in session)
            || !owner?.enumerable || owner.configurable || owner.writable || !('value' in owner)
            || !session.value || typeof session.value !== 'object' || types.isProxy(session.value)
            || !owner.value || typeof owner.value !== 'object' || types.isProxy(owner.value)) return null;
        return value as AuthenticatedWebSessionProjectionOwnerContext;
    } catch { return null; }
}

/** Web-only capture owner; the trusted Supervisor mints all downstream authority. */
export function createPortableSupervisorWebCaptureOwnerProcessV1(sources: Sources): Readonly<{
    acquire(observeTerminal: TerminalObserver): Promise<PortableSupervisorWebCaptureOwnerV1 | null>;
}> {
    let lastProcessNow = -1, spent = false;
    let ownerSlot: symbol | RecordState | null = null;
    const clock = (): number => {
        let value: unknown;
        try { value = sources.clock(); } catch { return unavailable(); }
        if (discardPromise(value) || !safeInteger(value) || value < lastProcessNow) return unavailable();
        lastProcessNow = value; return value;
    };
    const hash = (domain: 'user' | 'parent', value: string): string => {
        let digest: unknown;
        try { digest = sources.hashRef(`mediflow.portable-supervisor.web-capture.${domain}.v1\0${value}`); }
        catch { return unavailable(); }
        if (discardPromise(digest) || typeof digest !== 'string' || !DIGEST.test(digest)) return unavailable();
        return `${domain}.${digest.slice(7)}`;
    };
    const notify = (state: RecordState, reason: PortableSupervisorWebCaptureTerminalReasonV1): void => {
        if (!state.published) return;
        let result: unknown;
        try { result = state.observeTerminal(reason); } catch { return; }
        discardPromise(result);
    };
    const terminal = (state: RecordState, detached: boolean,
        reason: PortableSupervisorWebCaptureTerminalReasonV1): boolean => {
        if (!state.active) return false;
        state.active = false;
        if (ownerSlot === state) ownerSlot = null;
        const cancel = state.cancel; state.cancel = null;
        try { cancel?.(); } catch { /* logical authority is already terminal */ }
        if (!detached) {
            try { sources.selectionLifecycle.unregisterDependent(state.scope, state.registration); }
            catch { /* logical authority remains terminal */ }
        }
        notify(state, reason);
        return true;
    };
    const invalidate = (state: RecordState, reason: PortableSupervisorWebCaptureTerminalReasonV1): never => {
        terminal(state, false, reason); return unavailable();
    };
    const read = (state: RecordState): PortableSupervisorWebCaptureV1 => {
        if (!state.active) return unavailable();
        let before: number;
        try { before = clock(); } catch { return invalidate(state, 'reselection'); }
        if (before > state.capture.expiresAt - 2) return invalidate(state, 'expiry');
        let observed: unknown = null;
        try {
            if (!sources.selectionBinding.withCurrentDependentBinding(
                state.scope, state.registration, (candidate) => { observed = candidate; },
            ) || !sameBinding(state.binding, observed)) return invalidate(state, 'reselection');
        } catch { return invalidate(state, 'reselection'); }
        let clinical: unknown = null;
        try {
            if (!sources.selectionCommitBinding.withCurrentCommitBinding(
                state.scope, state.expected as never, (candidate) => { clinical = candidate; },
            ) || !clinicalBinding(clinical, state.binding.patientVersion)
                || clinical.patientId !== state.capture.patientId
                || clinical.ambulatoryId !== state.capture.ambulatoryId) return invalidate(state, 'reselection');
        } catch { return invalidate(state, 'reselection'); }
        observed = null;
        try {
            if (!sources.selectionBinding.withCurrentDependentBinding(
                state.scope, state.registration, (candidate) => { observed = candidate; },
            ) || !sameBinding(state.binding, observed)) return invalidate(state, 'reselection');
        } catch { return invalidate(state, 'reselection'); }
        let after: number;
        try { after = clock(); } catch { return invalidate(state, 'reselection'); }
        if (after > state.capture.expiresAt - 2) return invalidate(state, 'expiry');
        return state.capture;
    };
    const acquire = async (observeTerminal: TerminalObserver): Promise<PortableSupervisorWebCaptureOwnerV1 | null> => {
        if (spent || ownerSlot !== null || typeof observeTerminal !== 'function'
            || types.isProxy(observeTerminal) || types.isAsyncFunction(observeTerminal)) return null;
        const acquisition = Symbol('portable-supervisor-web-capture-acquisition');
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
                    if (state) terminal(state, true, 'reselection'); else drained = true;
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
                now + PORTABLE_SUPERVISOR_WEB_CAPTURE_TTL_MS);
            if (!safeInteger(expiresAt, 1) || now > expiresAt - 2) return null;
            const capture = record({ schemaVersion: PORTABLE_SUPERVISOR_WEB_CAPTURE_SCHEMA_V1,
                userRef: hash('user', authenticated.userId),
                parentRef: hash('parent', `${selected.selection.sessionRef}\0${selected.selection.leaseRef}`),
                patientId: clinical.patientId, ambulatoryId: clinical.ambulatoryId,
                selectionEpoch: selected.selection.selectionEpoch,
                expectedPatientVersion: selected.patientVersion, expiresAt });
            state = { active: true, published: false, scope, registration, context: authenticatedContext,
                binding: selected,
                expected, capture, observeTerminal, cancel: null };
            let scheduling = true, firedSynchronously = false, cancel: unknown;
            try {
                cancel = sources.scheduler(expiresAt - now, () => {
                    if (scheduling) { firedSynchronously = true; return; }
                    if (state) terminal(state, false, 'expiry');
                });
            } catch { terminal(state, false, 'expiry'); return null; }
            scheduling = false;
            const cancelIsPromise = discardPromise(cancel);
            if (firedSynchronously || cancelIsPromise || typeof cancel !== 'function'
                || types.isProxy(cancel) || types.isAsyncFunction(cancel)) {
                try { if (typeof cancel === 'function') cancel(); } catch { /* unpublished timer denied */ }
                terminal(state, false, 'expiry'); return null;
            }
            state.cancel = cancel as () => void;
            if (!sources.selectionLifecycle.confirmDependent(scope, registration)) {
                terminal(state, false, 'reselection'); return null;
            }
            read(state);
            ownerSlot = state; spent = true; state.published = true;
            const published = state;
            return record({ readCapture: () => read(published),
                /* @Codex: bind a dependent operation to the exact H1a session and
                   projection owner without exporting either identity. */
                matchesCurrentContext: (value: unknown) => {
                    const candidate = canonicalAuthenticatedContext(value);
                    if (!published.active || !candidate || candidate.owner !== published.context.owner) return false;
                    let sameScope = false;
                    try {
                        if (!sources.selectionLifecycle.withCurrentSelection(candidate.session, (scope) => {
                            sameScope = scope === published.scope;
                        }) || !sameScope) return false;
                    } catch { return false; }
                    try { return read(published) === published.capture && published.active; } catch { return false; }
                },
                revoke: (reason: PortableSupervisorWebCaptureRevokeReasonV1) =>
                    REVOKE_REASONS.has(reason) && terminal(published, false, reason),
                dispose: () => terminal(published, false, 'web_disconnect') });
        } catch { if (state) terminal(state, false, 'reselection'); return null; }
        finally {
            if (ownerSlot === acquisition) ownerSlot = null;
            if (!state?.active && scope && registration) {
                try { sources.selectionLifecycle.unregisterDependent(scope, registration); } catch { /* partial attach */ }
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
const productionProcessOwner = createPortableSupervisorWebCaptureOwnerProcessV1({
    acquireAuthenticatedContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    selectionLifecycle: productionSelectionOwner.selectionLifecycleController,
    selectionBinding: productionSelectionOwner.selectionBindingController,
    selectionCommitBinding: productionSelectionOwner.selectionCommitBindingController,
    clock: hostDateNow, hashRef, scheduler: schedule,
});

export const acquirePortableSupervisorWebCaptureOwnerV1 = productionProcessOwner.acquire;
