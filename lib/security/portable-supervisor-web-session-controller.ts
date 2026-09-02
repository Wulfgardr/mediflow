/* @Codex */
import 'server-only';

import { types } from 'node:util';

import {
    acquirePortableSupervisorWebCaptureOwnerV1,
    PortableSupervisorWebCaptureOwnerError,
    type PortableSupervisorWebCaptureOwnerV1,
    type PortableSupervisorWebCaptureTerminalReasonV1,
} from './portable-supervisor-context-owner.ts';
import {
    activatePortableSupervisorWebIpcV1,
    disconnectPortableSupervisorWebIpcV1,
    PortableSupervisorWebIpcBridgeV1Error,
    revokePortableSupervisorWebIpcV1,
} from './portable-supervisor-web-ipc-bridge.ts';

const INPUT_KEYS = ['expectedPatientId', 'selectionEpoch'] as const;
const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RETIRE_REASONS = new Set(['logout', 'application_lock', 'reselection', 'explicit']);
const CONTEXT_DENIALS = new Set(['context_invalid', 'context_stale']);

type Phase = 'idle' | 'activating' | 'active' | 'revoking' | 'terminal';
export type PortableSupervisorWebSessionRetirementReasonV1 =
    'logout' | 'application_lock' | 'reselection' | 'explicit';
export type PortableSupervisorWebSessionActivationInputV1 = Readonly<{
    expectedPatientId: string;
    selectionEpoch: number;
}>;
export type PortableSupervisorWebSessionActivationV1 = Readonly<{
    state: 'active';
    expiresAt: number;
}>;
export type PortableSupervisorWebSessionV1ErrorCode =
    'input_invalid' | 'selection_unavailable' | 'selection_conflict'
    | 'host_unavailable' | 'session_terminal';

type TerminalObserver = (reason: PortableSupervisorWebCaptureTerminalReasonV1) => unknown;
type Sources = Readonly<{
    acquireCaptureOwner(observer: TerminalObserver): Promise<PortableSupervisorWebCaptureOwnerV1 | null>;
    activateBridge(readCapture: () => unknown): Promise<Readonly<{ expiresAt: number }>>;
    revokeBridge(reason: PortableSupervisorWebCaptureTerminalReasonV1): Promise<boolean>;
    disconnectBridge(): unknown;
}>;
type Deferred = Readonly<{
    promise: Promise<boolean>;
    resolve(value: boolean): void;
    reject(error: unknown): void;
}>;

export class PortableSupervisorWebSessionV1Error extends Error {
    constructor(public readonly code: PortableSupervisorWebSessionV1ErrorCode) {
        super(`Portable supervisor Web session rejected: ${code}`);
        this.name = 'PortableSupervisorWebSessionV1Error';
    }
}

function fail(code: PortableSupervisorWebSessionV1ErrorCode): PortableSupervisorWebSessionV1Error {
    return new PortableSupervisorWebSessionV1Error(code);
}
function record<T extends object>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}
function deferred(): Deferred {
    let resolve!: (value: boolean) => void, reject!: (error: unknown) => void;
    const promise = new Promise<boolean>((accept, deny) => { resolve = accept; reject = deny; });
    return record({ promise, resolve, reject });
}
function input(value: unknown): PortableSupervisorWebSessionActivationInputV1 | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
            || types.isPromise(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== INPUT_KEYS.length
            || own.some((key) => typeof key !== 'string'
                || !INPUT_KEYS.some((candidate) => candidate === key))) return null;
        const patient = Object.getOwnPropertyDescriptor(value, 'expectedPatientId');
        const epoch = Object.getOwnPropertyDescriptor(value, 'selectionEpoch');
        if (!patient?.enumerable || !('value' in patient) || typeof patient.value !== 'string'
            || !HOST_ID.test(patient.value) || !epoch?.enumerable || !('value' in epoch)
            || !Number.isSafeInteger(epoch.value) || epoch.value < 1) return null;
        return record({ expectedPatientId: patient.value, selectionEpoch: epoch.value });
    } catch { return null; }
}
function bridgeExpiry(value: unknown, maximum: number): number | null {
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
            || types.isPromise(value)) return null;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== null && prototype !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== 1 || own[0] !== 'expiresAt') return null;
        const expiresAt = Object.getOwnPropertyDescriptor(value, 'expiresAt');
        return expiresAt?.enumerable && 'value' in expiresAt && Number.isSafeInteger(expiresAt.value)
            && expiresAt.value >= 1 && expiresAt.value <= maximum ? expiresAt.value : null;
    } catch { return null; }
}
function activationError(error: unknown): PortableSupervisorWebSessionV1Error {
    if (error instanceof PortableSupervisorWebSessionV1Error) return error;
    if (error instanceof PortableSupervisorWebCaptureOwnerError) return fail('selection_unavailable');
    if (error instanceof PortableSupervisorWebIpcBridgeV1Error) {
        if (error.code === 'denied' && error.denialCode === 'already_bound') {
            return fail('selection_conflict');
        }
        if (error.code === 'context_invalid'
            || (error.code === 'denied' && CONTEXT_DENIALS.has(error.denialCode ?? ''))) {
            return fail('selection_unavailable');
        }
        return fail('host_unavailable');
    }
    return fail('host_unavailable');
}
function retirementError(error: unknown): unknown {
    return error instanceof PortableSupervisorWebIpcBridgeV1Error ? error : fail('host_unavailable');
}

/** One-shot Web process controller. Caller fields constrain, but never create, the owner capture. */
export function createPortableSupervisorWebSessionControllerV1(sources: Sources): Readonly<{
    activateCurrentSelection(input: unknown): Promise<PortableSupervisorWebSessionActivationV1>;
    retire(reason: PortableSupervisorWebSessionRetirementReasonV1): Promise<boolean>;
}> {
    let phase: Phase = 'idle';
    let owner: PortableSupervisorWebCaptureOwnerV1 | null = null;
    let activationPromise: Promise<PortableSupervisorWebSessionActivationV1> | null = null;
    let revocationPromise: Promise<boolean> | null = null;
    let acquisitionCut = false;
    let requestedRetirement: PortableSupervisorWebSessionRetirementReasonV1 | null = null;
    let terminalWithoutRevocation: Promise<boolean> | null = null;

    const disconnect = (): void => {
        try {
            const result = sources.disconnectBridge();
            if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => undefined);
        } catch { /* logical session is already terminal */ }
    };
    const revokeRemote = (reason: PortableSupervisorWebCaptureTerminalReasonV1): Promise<boolean> => {
        if (revocationPromise) return revocationPromise;
        phase = 'revoking';
        const pending = deferred();
        revocationPromise = pending.promise;
        // The Promise is observed even when the synchronous terminal observer has no caller.
        void Promise.prototype.then.call(pending.promise, undefined, () => undefined);
        let result: unknown;
        try { result = sources.revokeBridge(reason); }
        catch (error) {
            disconnect(); phase = 'terminal'; pending.reject(retirementError(error)); return pending.promise;
        }
        if (!types.isPromise(result)) {
            disconnect(); phase = 'terminal'; pending.reject(fail('host_unavailable')); return pending.promise;
        }
        void Promise.prototype.then.call(result, (value: unknown) => {
            if (value !== true) {
                disconnect(); phase = 'terminal'; pending.reject(fail('host_unavailable')); return;
            }
            phase = 'terminal'; pending.resolve(true);
        }, (error: unknown) => {
            disconnect(); phase = 'terminal'; pending.reject(retirementError(error));
        });
        return pending.promise;
    };
    const observeTerminal = (reason: PortableSupervisorWebCaptureTerminalReasonV1): void => {
        if (!acquisitionCut) revokeRemote(reason);
    };
    const terminalNoOwner = (): void => {
        phase = 'terminal'; disconnect();
        terminalWithoutRevocation ??= Promise.resolve(false);
    };
    const revokeLateOwner = (lateOwner: PortableSupervisorWebCaptureOwnerV1,
        reason: PortableSupervisorWebSessionRetirementReasonV1): void => {
        try { lateOwner.revoke(reason); }
        catch {
            try { lateOwner.dispose(); } catch { /* transport is already cut */ }
        }
    };
    const constrainCapture = (currentOwner: PortableSupervisorWebCaptureOwnerV1,
        constraint: PortableSupervisorWebSessionActivationInputV1) => {
        const capture = currentOwner.readCapture();
        if (capture.patientId !== constraint.expectedPatientId
            || capture.selectionEpoch !== constraint.selectionEpoch) throw fail('selection_conflict');
        return capture;
    };
    const revokeLocal = (reason: PortableSupervisorWebSessionRetirementReasonV1): Promise<boolean> => {
        const currentOwner = owner;
        if (!currentOwner) {
            requestedRetirement ??= reason;
            acquisitionCut = true;
            terminalNoOwner();
            return terminalWithoutRevocation as Promise<boolean>;
        }
        try { currentOwner.revoke(reason); }
        catch {
            try { currentOwner.dispose(); } catch { /* continue to terminal transport cut */ }
        }
        return revocationPromise ?? revokeRemote(reason);
    };
    const cleanupActivation = async (error: unknown): Promise<never> => {
        const mapped = activationError(error);
        if (owner && !revocationPromise) {
            const reason = mapped.code === 'selection_conflict' || mapped.code === 'selection_unavailable'
                ? 'reselection' as const : 'explicit' as const;
            revokeLocal(reason);
        }
        if (revocationPromise) {
            try { await revocationPromise; } catch (revokeError) { throw activationError(revokeError); }
        } else terminalNoOwner();
        throw mapped;
    };
    const runActivation = async (constraint: PortableSupervisorWebSessionActivationInputV1) => {
        try {
            const acquired = await sources.acquireCaptureOwner(observeTerminal);
            if (acquisitionCut || phase !== 'activating') {
                if (acquired) revokeLateOwner(acquired, requestedRetirement ?? 'explicit');
                throw fail('session_terminal');
            }
            if (!acquired) throw fail('selection_unavailable');
            owner = acquired;
            const activated = await sources.activateBridge(() => constrainCapture(acquired, constraint));
            if (phase !== 'activating' || owner !== acquired) throw fail('session_terminal');
            const currentCapture = constrainCapture(acquired, constraint);
            const expiresAt = bridgeExpiry(activated, currentCapture.expiresAt);
            if (expiresAt === null) throw fail('host_unavailable');
            const result = record({ state: 'active' as const, expiresAt });
            phase = 'active';
            return result;
        } catch (error) {
            if (acquisitionCut) throw fail('session_terminal');
            return cleanupActivation(error);
        }
    };
    const activateCurrentSelection = (value: unknown): Promise<PortableSupervisorWebSessionActivationV1> => {
        const constraint = input(value);
        if (!constraint) return Promise.reject(fail('input_invalid'));
        if (phase === 'activating' || phase === 'active') {
            // A second HTTP request has its own request-local H1a context. Input
            // equality cannot prove it belongs to the session that won the slot.
            return Promise.reject(fail('selection_conflict'));
        }
        if (phase !== 'idle') return Promise.reject(fail('session_terminal'));
        phase = 'activating';
        let accept!: (value: PortableSupervisorWebSessionActivationV1) => void;
        let deny!: (error: unknown) => void;
        activationPromise = new Promise((resolve, reject) => { accept = resolve; deny = reject; });
        void Promise.prototype.then.call(runActivation(constraint), accept, deny);
        return activationPromise;
    };
    const retire = (reason: PortableSupervisorWebSessionRetirementReasonV1): Promise<boolean> => {
        if (!RETIRE_REASONS.has(reason)) return Promise.reject(fail('input_invalid'));
        if (revocationPromise) return revocationPromise;
        if (phase === 'terminal') return terminalWithoutRevocation ??= Promise.resolve(false);
        // The first patient selection precedes Intelligent Host activation. It is
        // not a retirement event until this one-shot controller has started to
        // acquire or own a capture.
        if (phase === 'idle' && reason === 'reselection') return Promise.resolve(false);
        if (phase === 'idle') { terminalNoOwner(); return terminalWithoutRevocation as Promise<boolean>; }
        return revokeLocal(reason);
    };
    return record({ activateCurrentSelection, retire });
}

const productionController = createPortableSupervisorWebSessionControllerV1({
    acquireCaptureOwner: acquirePortableSupervisorWebCaptureOwnerV1,
    activateBridge: activatePortableSupervisorWebIpcV1,
    revokeBridge: revokePortableSupervisorWebIpcV1,
    disconnectBridge: disconnectPortableSupervisorWebIpcV1,
});

export const activatePortableSupervisorWebSessionV1 = productionController.activateCurrentSelection;
export const retirePortableSupervisorWebSessionV1 = productionController.retire;
