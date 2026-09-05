/* @Codex */
import 'server-only';

import { types } from 'node:util';

import type { AuthenticatedWebSessionProjectionOwnerContext } from '../../security/server-auth';
import type {
    TreatmentReasoningLeaseCommitPort,
    TreatmentReasoningLeaseCommitRef,
} from '../../security/server-session-projection-owner';
import {
    snapshotTreatmentReasoningProjectionAttachment,
    type TreatmentReasoningProjectionAttachment,
} from './treatment-reasoning-projection';

export type TreatmentReasoningAuthenticatedProjectionErrorCode =
    | 'handle_missing'
    | 'input_invalid'
    | 'lease_unavailable'
    | 'projection_stale'
    | 'request_replayed'
    | 'selection_changed'
    | 'selection_unavailable'
    | 'session_unavailable'
    | 'source_invalid';

export class TreatmentReasoningAuthenticatedProjectionError extends Error {
    constructor(readonly code: TreatmentReasoningAuthenticatedProjectionErrorCode) {
        super(`Authenticated treatment reasoning projection rejected: ${code}`);
        this.name = 'TreatmentReasoningAuthenticatedProjectionError';
    }
}

export type TreatmentReasoningProjectionExecution = Readonly<{
    projection: TreatmentReasoningProjectionAttachment;
    patientRef: string;
    commit(): boolean;
    abort(): void;
}>;

type Sources = Readonly<{
    acquireContext(): Promise<AuthenticatedWebSessionProjectionOwnerContext | null>;
    clock(): string;
    entropy(): Uint8Array;
    readPatientVersion(patientId: string, ambulatoryId: string): number | null;
    registerResource(sessionId: string, dispose: () => void): (() => void) | null;
}>;
type State = Readonly<{
    projection: TreatmentReasoningProjectionAttachment;
    patientRef: string;
    ambulatoryRef: string;
    selectionEpoch: number;
    patientVersion: number;
    port: TreatmentReasoningLeaseCommitPort;
    expected: TreatmentReasoningLeaseCommitRef;
}>;
type Broker = {
    records: Map<string, State>;
    requests: Set<string>;
    executions: Set<() => void>;
    unregister: (() => void) | null;
    disposed: boolean;
};

const INGEST_KEYS = ['projection', 'requestId'] as const;
const PREVIEW_KEYS = ['handle', 'requestId'] as const;
const HANDLE = /^trp_[0-9a-f]{32}$/u;
const REQUEST = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const OWNER_BROKERS = new WeakMap<object, WeakMap<object, Broker>>();

function fail(code: TreatmentReasoningAuthenticatedProjectionErrorCode): never {
    throw new TreatmentReasoningAuthenticatedProjectionError(code);
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    try {
        if (typeof value !== 'object' || value === null || types.isProxy(value) || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return fail('input_invalid');
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) return fail('input_invalid');
        const output: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail('input_invalid');
            output[key] = descriptor.value;
        }
        return output;
    } catch (error) {
        if (error instanceof TreatmentReasoningAuthenticatedProjectionError) throw error;
        return fail('input_invalid');
    }
}

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> {
    return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function requestId(value: unknown): string {
    return typeof value === 'string' && REQUEST.test(value) ? value : fail('input_invalid');
}

function positive(value: unknown, code: TreatmentReasoningAuthenticatedProjectionErrorCode): number {
    return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fail(code);
}

function brokerFor(context: AuthenticatedWebSessionProjectionOwnerContext): Broker {
    let sessions = OWNER_BROKERS.get(context.owner);
    if (!sessions) { sessions = new WeakMap<object, Broker>(); OWNER_BROKERS.set(context.owner, sessions); }
    let broker = sessions.get(context.session);
    if (broker && !broker.disposed) return broker;
    broker = { records: new Map(), requests: new Set(), executions: new Set(), unregister: null, disposed: false };
    sessions.set(context.session, broker);
    return broker;
}

function disposeBroker(broker: Broker): void {
    if (broker.disposed) return;
    broker.disposed = true;
    for (const state of broker.records.values()) { try { state.port.dispose(); } catch { /* terminal */ } }
    broker.records.clear(); broker.requests.clear();
    for (const abort of Array.from(broker.executions)) { try { abort(); } catch { /* terminal */ } }
    broker.executions.clear();
    try { broker.unregister?.(); } catch { /* terminal */ }
    broker.unregister = null;
}

function register(broker: Broker, context: AuthenticatedWebSessionProjectionOwnerContext, sources: Sources): void {
    if (broker.disposed) fail('session_unavailable');
    if (broker.unregister) return;
    let unregister: (() => void) | null;
    try { unregister = sources.registerResource(context.session.id, () => disposeBroker(broker)); }
    catch { unregister = null; }
    if (!unregister) fail('session_unavailable');
    broker.unregister = unregister;
}

function releaseIfIdle(broker: Broker): void {
    if (broker.records.size !== 0 || broker.executions.size !== 0 || !broker.unregister) return;
    const unregister = broker.unregister; broker.unregister = null;
    try { unregister(); } catch { /* no authority remains */ }
}

function acceptRequest(broker: Broker, value: unknown): void {
    const id = requestId(value);
    if (broker.requests.has(id)) fail('request_replayed');
    broker.requests.add(id);
}

function selection<T>(context: AuthenticatedWebSessionProjectionOwnerContext, operation: (pair: Readonly<{ patientId: string; ambulatoryId: string }>) => T): T {
    try { return context.owner.withLeaseCriticalSection(context.session, operation); }
    catch (error) {
        if (error instanceof TreatmentReasoningAuthenticatedProjectionError) throw error;
        return fail('selection_unavailable');
    }
}

function patientVersion(sources: Sources, patientId: string, ambulatoryId: string): number {
    try { return positive(sources.readPatientVersion(patientId, ambulatoryId), 'projection_stale'); }
    catch (error) {
        if (error instanceof TreatmentReasoningAuthenticatedProjectionError) throw error;
        return fail('source_invalid');
    }
}

function handle(sources: Sources): string {
    let bytes: Uint8Array;
    try { bytes = sources.entropy(); } catch { return fail('source_invalid'); }
    if (!(bytes instanceof Uint8Array) || types.isProxy(bytes) || bytes.length !== 16) return fail('source_invalid');
    let hex = '';
    for (let index = 0; index < bytes.length; index += 1) hex += bytes[index]!.toString(16).padStart(2, '0');
    const value = `trp_${hex}`;
    return HANDLE.test(value) ? value : fail('source_invalid');
}

function clock(sources: Sources): string {
    let value: string;
    try { value = sources.clock(); } catch { return fail('source_invalid'); }
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return fail('source_invalid');
    return value;
}

export function createTreatmentReasoningAuthenticatedProjectionBroker(sources: Sources) {
    const acquire = async (): Promise<Readonly<{ context: AuthenticatedWebSessionProjectionOwnerContext; broker: Broker }>> => {
        let context: AuthenticatedWebSessionProjectionOwnerContext | null;
        try { context = await sources.acquireContext(); } catch { return fail('session_unavailable'); }
        if (!context) return fail('session_unavailable');
        return Object.freeze({ context, broker: brokerFor(context) });
    };

    return Object.freeze({
        async acquireIngest() {
            const { context, broker } = await acquire();
            return Object.freeze({
                ingest(value: unknown): string {
                    const input = exact(value, INGEST_KEYS); acceptRequest(broker, input.requestId);
                    let projection: TreatmentReasoningProjectionAttachment;
                    try { projection = snapshotTreatmentReasoningProjectionAttachment(input.projection, clock(sources)); }
                    catch { return fail('input_invalid'); }
                    return selection(context, (pair) => {
                        const version = patientVersion(sources, pair.patientId, pair.ambulatoryId);
                        if (version !== projection.patientRevision) return fail('projection_stale');
                        const selectionEpoch = positive(context.owner.snapshotSelectionEpoch(context.session), 'selection_unavailable');
                        let port: TreatmentReasoningLeaseCommitPort;
                        try { port = context.owner.mintTreatmentReasoningLeaseCommitPort(context.session); }
                        catch { return fail('lease_unavailable'); }
                        const snapshot = port.snapshot();
                        if (!snapshot || snapshot.terminal || snapshot.stagedRef !== null) { port.dispose(); return fail('lease_unavailable'); }
                        const projectionHandle = handle(sources);
                        if (broker.records.has(projectionHandle)) { port.dispose(); return fail('source_invalid'); }
                        register(broker, context, sources);
                        broker.records.set(projectionHandle, frozen({ projection, patientRef: pair.patientId, ambulatoryRef: pair.ambulatoryId,
                            selectionEpoch, patientVersion: version, port, expected: snapshot.currentRef }) as State);
                        return projectionHandle;
                    });
                },
            });
        },
        async acquirePreview() {
            const { context, broker } = await acquire();
            return Object.freeze({
                begin(value: unknown): TreatmentReasoningProjectionExecution {
                    const input = exact(value, PREVIEW_KEYS); acceptRequest(broker, input.requestId);
                    if (typeof input.handle !== 'string' || !HANDLE.test(input.handle)) return fail('input_invalid');
                    const state = broker.records.get(input.handle);
                    if (!state) return fail('handle_missing');
                    broker.records.delete(input.handle);
                    try {
                        const epoch = positive(context.owner.snapshotSelectionEpoch(context.session), 'selection_unavailable');
                        if (epoch !== state.selectionEpoch) return fail('selection_changed');
                        selection(context, (pair) => {
                            if (pair.patientId !== state.patientRef || pair.ambulatoryId !== state.ambulatoryRef) return fail('selection_changed');
                            if (patientVersion(sources, pair.patientId, pair.ambulatoryId) !== state.patientVersion) return fail('projection_stale');
                        });
                        const before = state.port.snapshot();
                        if (!before || before.terminal || before.stagedRef !== null || before.currentRef !== state.expected) return fail('lease_unavailable');
                        const replacement = state.port.prepare(Object.freeze({ expected: state.expected }));
                        if (!replacement) return fail('lease_unavailable');
                        let terminal = false;
                        const abort = () => {
                            if (terminal) return;
                            terminal = true;
                            try { if (!state.port.abort(Object.freeze({ replacement }))) state.port.dispose(); } catch { state.port.dispose(); }
                            broker.executions.delete(abort); releaseIfIdle(broker);
                        };
                        broker.executions.add(abort);
                        const commit = (): boolean => {
                            if (terminal) return false;
                            let current = false;
                            try {
                                const epochNow = context.owner.snapshotSelectionEpoch(context.session);
                                current = epochNow === state.selectionEpoch && selection(context, (pair) => pair.patientId === state.patientRef
                                    && pair.ambulatoryId === state.ambulatoryRef
                                    && patientVersion(sources, pair.patientId, pair.ambulatoryId) === state.patientVersion);
                            } catch { current = false; }
                            if (!current) { abort(); return false; }
                            terminal = true;
                            let committed = false;
                            try { committed = state.port.commit(Object.freeze({ expected: state.expected, replacement })); }
                            catch { committed = false; }
                            if (!committed) { try { state.port.abort(Object.freeze({ replacement })); } catch { state.port.dispose(); } }
                            broker.executions.delete(abort); releaseIfIdle(broker); return committed;
                        };
                        return Object.freeze({ projection: state.projection, patientRef: state.patientRef, commit, abort });
                    } catch (error) {
                        try { state.port.dispose(); } catch { /* terminal */ }
                        releaseIfIdle(broker);
                        throw error;
                    }
                },
            });
        },
    });
}
