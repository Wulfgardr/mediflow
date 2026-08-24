/* @Codex */
import 'server-only';

import { types } from 'node:util';
import type { PatientInsightHostBoundary, PatientInsightHostResult, PatientInsightProjection } from './patient-insight-host-boundary';
import { createPatientInsightHostProjectionResolver } from './patient-insight-host-projection';

export type PatientInsightBrokerErrorCode = 'dependency_unavailable' | 'freshness_stale' | 'handle_collision' | 'handle_missing' | 'handle_replayed' | 'input_invalid' | 'operation_reentered' | 'proposal_invalid' | 'reservation_missing' | 'revision_stale' | 'revoked' | 'selection_changed';
export class PatientInsightBrokerError extends Error {
    constructor(readonly code: PatientInsightBrokerErrorCode) { super(`Patient Insight broker denied: ${code}`); this.name = 'PatientInsightBrokerError'; }
}
export type PatientInsightBrokerCurrentness = Readonly<{ selectionEpoch: number; revision: number; freshnessToken: string; isRevoked: () => boolean }>;
export type PatientInsightBrokerHost = Readonly<{
    readCurrentness: () => PatientInsightBrokerCurrentness;
    readSources: () => unknown;
    boundary: PatientInsightHostBoundary;
    clock: () => string;
    entropy: () => Uint8Array;
}>;
export type PatientInsightBroker = Readonly<{
    stage: () => object;
    publish: (input: unknown) => string;
    abort: (input: unknown) => void;
    issue: () => string;
    consume: (input: unknown) => Extract<PatientInsightHostResult, { status: 'available' }>;
}>;

type Currentness = Readonly<{ selectionEpoch: number; revision: number; freshnessToken: string }>;
type RecordEntry = Readonly<{ handle: string; entropyHandle: string; currentness: Currentness; accepted: Extract<PatientInsightHostResult, { status: 'available' }> }>;
type ReservationEntry = Readonly<{ entropyHandle: string; handle: string; record: RecordEntry }>;
const handlePattern = /^pib_[0-9a-f]{32}$/u;
const tokenPattern = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;
const authenticBrokers = new WeakSet<object>();
const authenticReservations = new WeakSet<object>();
const mapGet = Function.prototype.call.bind(Map.prototype.get) as <Key, Value>(map: Map<Key, Value>, key: Key) => Value | undefined;
const mapSet = Function.prototype.call.bind(Map.prototype.set) as <Key, Value>(map: Map<Key, Value>, key: Key, value: Value) => Map<Key, Value>;
const mapDelete = Function.prototype.call.bind(Map.prototype.delete) as <Key, Value>(map: Map<Key, Value>, key: Key) => boolean;
const mapHas = Function.prototype.call.bind(Map.prototype.has) as <Key, Value>(map: Map<Key, Value>, key: Key) => boolean;
const setAdd = Function.prototype.call.bind(Set.prototype.add) as <Value>(set: Set<Value>, value: Value) => Set<Value>;
const setDelete = Function.prototype.call.bind(Set.prototype.delete) as <Value>(set: Set<Value>, value: Value) => boolean;
const setHas = Function.prototype.call.bind(Set.prototype.has) as <Value>(set: Set<Value>, value: Value) => boolean;
const weakMapGet = Function.prototype.call.bind(WeakMap.prototype.get) as <Key extends object, Value>(map: WeakMap<Key, Value>, key: Key) => Value | undefined;
const weakMapSet = Function.prototype.call.bind(WeakMap.prototype.set) as <Key extends object, Value>(map: WeakMap<Key, Value>, key: Key, value: Value) => WeakMap<Key, Value>;
const weakMapDelete = Function.prototype.call.bind(WeakMap.prototype.delete) as <Key extends object, Value>(map: WeakMap<Key, Value>, key: Key) => boolean;
const weakSetAdd = Function.prototype.call.bind(WeakSet.prototype.add) as <Value extends object>(set: WeakSet<Value>, value: Value) => WeakSet<Value>;
const weakSetHas = Function.prototype.call.bind(WeakSet.prototype.has) as <Value extends object>(set: WeakSet<Value>, value: Value) => boolean;

/** Returns true only for the frozen broker capability created by this module. */
export function isPatientInsightBrokerCapability(value: unknown): value is PatientInsightBroker {
    try { return !!value && typeof value === 'object' && !types.isProxy(value) && weakSetHas(authenticBrokers, value); } catch { return false; }
}

function fail(code: PatientInsightBrokerErrorCode): never { throw new PatientInsightBrokerError(code); }
function callable(value: unknown): value is () => unknown { return typeof value === 'function' && !types.isProxy(value); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const copy: Record<string, unknown> = {};
        for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) return null; copy[key] = descriptor.value; }
        return copy;
    } catch { return null; }
}
function timestamp(value: unknown): string | null {
    return typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
}
function currentness(value: unknown): Currentness | null {
    try {
        const input = exact(value, ['selectionEpoch', 'revision', 'freshnessToken', 'isRevoked']);
        if (!input || !Object.isFrozen(value) || !Number.isSafeInteger(input.selectionEpoch) || (input.selectionEpoch as number) < 1 || !Number.isSafeInteger(input.revision) || (input.revision as number) < 0 || typeof input.freshnessToken !== 'string' || !tokenPattern.test(input.freshnessToken) || !callable(input.isRevoked)) return null;
        const revoked = (input.isRevoked as () => unknown)();
        if (typeof revoked !== 'boolean') return null;
        if (revoked) return fail('revoked');
        return Object.freeze({ selectionEpoch: input.selectionEpoch as number, revision: input.revision as number, freshnessToken: input.freshnessToken });
    } catch (error) { if (error instanceof PatientInsightBrokerError) throw error; return null; }
}
function accepted(value: unknown): Extract<PatientInsightHostResult, { status: 'available' }> | null {
    try {
        const input = exact(value, ['status', 'writesPerformed', 'applyPolicy', 'receiptReference', 'provenanceReference', 'proposal']);
        const proposal = input && exact(input.proposal, ['schemaVersion', 'reviewOnly', 'promptFingerprint']);
        if (!input || !proposal || !Object.isFrozen(value) || !Object.isFrozen(input.proposal) || input.status !== 'available' || input.writesPerformed !== 0 || input.applyPolicy !== 'none' || typeof input.receiptReference !== 'string' || !tokenPattern.test(input.receiptReference) || typeof input.provenanceReference !== 'string' || !tokenPattern.test(input.provenanceReference) || proposal.schemaVersion !== 'mediflow.patient-insight.review-proposal.v1' || proposal.reviewOnly !== true || typeof proposal.promptFingerprint !== 'string' || !/^pi_[0-9a-f]{8}$/u.test(proposal.promptFingerprint)) return null;
        return value as Extract<PatientInsightHostResult, { status: 'available' }>;
    } catch { return null; }
}

function currentnessChanged(before: Currentness, after: Currentness): void {
    if (after.selectionEpoch !== before.selectionEpoch) fail('selection_changed');
    if (after.revision !== before.revision) fail('revision_stale');
    if (after.freshnessToken !== before.freshnessToken) fail('freshness_stale');
}

/** Candidate-only: ABA needs P4 lease critical section; production remains HOLD. A P4 composer must retain a staged reservation and must not call publish before final P4 validation. */
export function createPatientInsightBroker(value: PatientInsightBrokerHost): PatientInsightBroker {
    const host = exact(value, ['readCurrentness', 'readSources', 'boundary', 'clock', 'entropy']);
    const boundaryValue = host && exact(host.boundary, ['prepare']);
    if (!host || !Object.isFrozen(value) || !boundaryValue || !callable(host.readCurrentness) || !callable(host.readSources) || !callable(boundaryValue.prepare) || !callable(host.clock) || !callable(host.entropy)) fail('input_invalid');
    const resolver = createPatientInsightHostProjectionResolver(); const records = new Map<string, RecordEntry>(); const reservations = new WeakMap<object, ReservationEntry>(); const liveEntropyHandles = new Set<string>(); const reservedHandles = new Set<string>(); const consumed = new Set<string>();
    let operationActive = false; let operationPoisoned = false;
    const readCurrentness = () => {
        let result: unknown; try { result = (host.readCurrentness as () => unknown)(); } catch { return fail('dependency_unavailable'); }
        const snapshot = currentness(result); if (!snapshot) fail('dependency_unavailable'); return snapshot;
    };
    const readClock = () => { try { if (!timestamp((host.clock as () => unknown)())) fail('dependency_unavailable'); } catch (error) { if (error instanceof PatientInsightBrokerError) throw error; fail('dependency_unavailable'); } };
    const issueHandle = () => {
        let bytes: unknown; try { bytes = (host.entropy as () => unknown)(); } catch { return fail('dependency_unavailable'); }
        try {
            if (types.isProxy(bytes) || !(bytes instanceof Uint8Array) || bytes.byteLength < 16) fail('dependency_unavailable');
            let hex = ''; for (let index = 0; index < 16; index += 1) hex += bytes[index].toString(16).padStart(2, '0'); return `pib_${hex}`;
        } catch (error) { if (error instanceof PatientInsightBrokerError) throw error; return fail('dependency_unavailable'); }
    };
    const reservationInput = (value: unknown): object => {
        try {
            if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value) || Reflect.ownKeys(value).length !== 0) fail('input_invalid');
            return value;
        } catch (error) { if (error instanceof PatientInsightBrokerError) throw error; return fail('input_invalid'); }
    };
    const nextHandle = (handle: string): string | null => {
        const digits = '0123456789abcdef'; const output = handle.slice(4).split('');
        for (let index = output.length - 1; index >= 0; index -= 1) {
            const digit = digits.indexOf(output[index]); if (digit < 15) { output[index] = digits[digit + 1]; return `pib_${output.join('')}`; }
            output[index] = '0';
        }
        return null;
    };
    const availableHandle = (entropyHandle: string): string => {
        let candidate = entropyHandle;
        while (mapHas(records, candidate) || setHas(reservedHandles, candidate) || setHas(consumed, candidate)) {
            const next = nextHandle(candidate); if (!next) fail('handle_collision'); candidate = next;
        }
        return candidate;
    };
    const ensureNotPoisoned = (): void => { if (operationPoisoned) fail('operation_reentered'); };
    const abortEntry = (reservation: object, entry: ReservationEntry): void => {
        weakMapDelete(reservations, reservation); setDelete(liveEntropyHandles, entry.entropyHandle); setDelete(reservedHandles, entry.handle);
    };
    const liveReservationEntry = (value: unknown): Readonly<{ reservation: object; entry: ReservationEntry }> | null => {
        if (!value || typeof value !== 'object' || !weakSetHas(authenticReservations, value)) return null;
        const entry = weakMapGet(reservations, value);
        return entry ? { reservation: value, entry } : null;
    };
    const completeRecord = (handle: string, entropyHandle: string, snapshot: Currentness, result: Extract<PatientInsightHostResult, { status: 'available' }>): RecordEntry => Object.freeze({ handle, entropyHandle, currentness: snapshot, accepted: result });
    const validPreparedEntry = (entry: ReservationEntry): boolean => Object.isFrozen(entry) && Object.isFrozen(entry.record) && entry.record.handle === entry.handle && entry.record.entropyHandle === entry.entropyHandle && handlePattern.test(entry.handle) && handlePattern.test(entry.entropyHandle) && Object.isFrozen(entry.record.currentness) && Object.isFrozen(entry.record.accepted);
    const stage = (): object => {
        const snapshot = readCurrentness(); ensureNotPoisoned(); readClock(); ensureNotPoisoned(); let sources: unknown;
        try { sources = (host.readSources as () => unknown)(); } catch { return fail('dependency_unavailable'); }
        ensureNotPoisoned();
        const projection = resolver.resolve(sources); if (!projection) fail('dependency_unavailable');
        let output: unknown; try { output = (boundaryValue.prepare as (request: Readonly<{ projection: PatientInsightProjection }>) => unknown)(Object.freeze({ projection })); } catch { return fail('dependency_unavailable'); }
        ensureNotPoisoned();
        const result = accepted(output); if (!result) fail('proposal_invalid'); const entropyHandle = issueHandle();
        if (setHas(liveEntropyHandles, entropyHandle)) fail('handle_collision'); const handle = availableHandle(entropyHandle);
        const current = readCurrentness(); ensureNotPoisoned(); currentnessChanged(snapshot, current);
        const record = completeRecord(handle, entropyHandle, snapshot, result); const reservation = Object.freeze(Object.create(null)) as object; const entry = Object.freeze({ entropyHandle, handle, record });
        if (!validPreparedEntry(entry)) fail('proposal_invalid');
        weakMapSet(reservations, reservation, entry); weakSetAdd(authenticReservations, reservation); setAdd(liveEntropyHandles, entropyHandle); setAdd(reservedHandles, handle);
        return reservation;
    };
    const publish = (inputValue: unknown, verifyCurrentness = true): string => {
        const live = liveReservationEntry(inputValue);
        if (!live) { reservationInput(inputValue); fail('reservation_missing'); }
        const { reservation, entry } = live;
        try {
            reservationInput(reservation);
            if (!validPreparedEntry(entry)) fail('reservation_missing');
            if (verifyCurrentness) { readClock(); ensureNotPoisoned(); const current = readCurrentness(); ensureNotPoisoned(); currentnessChanged(entry.record.currentness, current); }
            ensureNotPoisoned();
            if (mapHas(records, entry.handle) || !setHas(reservedHandles, entry.handle) || !setHas(liveEntropyHandles, entry.entropyHandle)) fail('handle_collision');
            // @Codex: Commit uses only captured collection intrinsics and prepared private data.
            weakMapDelete(reservations, reservation); setDelete(reservedHandles, entry.handle); mapSet(records, entry.handle, entry.record);
            return entry.handle;
        } catch (error) { abortEntry(reservation, entry); throw error; }
    };
    const abort = (inputValue: unknown): void => {
        const live = liveReservationEntry(inputValue);
        if (!live) { reservationInput(inputValue); fail('reservation_missing'); }
        const { reservation, entry } = live;
        try { reservationInput(reservation); abortEntry(reservation, entry); }
        catch (error) { abortEntry(reservation, entry); throw error; }
    };
    const exclusive = <Result>(callback: () => Result, commitLast = false): Result => {
        if (operationActive) { operationPoisoned = true; fail('operation_reentered'); }
        operationActive = true; operationPoisoned = false;
        try {
            const result = callback();
            if (!commitLast && operationPoisoned) fail('operation_reentered');
            return result;
        } finally { operationActive = false; operationPoisoned = false; }
    };
    const broker = Object.freeze({
        stage() { return exclusive(stage); },
        publish(inputValue: unknown) { return exclusive(() => publish(inputValue), true); },
        abort(inputValue: unknown) { return exclusive(() => abort(inputValue), true); },
        issue() {
            return exclusive(() => publish(stage(), false), true);
        },
        consume(inputValue: unknown) {
            return exclusive(() => {
                const input = exact(inputValue, ['handle']); if (!input || typeof input.handle !== 'string' || !handlePattern.test(input.handle)) fail('input_invalid');
                if (setHas(consumed, input.handle)) fail('handle_replayed'); const entry = mapGet(records, input.handle); if (!entry) fail('handle_missing'); mapDelete(records, input.handle); setDelete(liveEntropyHandles, entry.entropyHandle); setAdd(consumed, input.handle);
                readClock(); ensureNotPoisoned(); const current = readCurrentness(); ensureNotPoisoned(); currentnessChanged(entry.currentness, current); return entry.accepted;
            });
        },
    });
    weakSetAdd(authenticBrokers, broker);
    return broker;
}
