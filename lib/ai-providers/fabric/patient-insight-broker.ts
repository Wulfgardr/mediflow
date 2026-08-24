/* @Codex */
import 'server-only';

import { types } from 'node:util';
import type { PatientInsightHostBoundary, PatientInsightHostResult, PatientInsightProjection } from './patient-insight-host-boundary.ts';
import { createPatientInsightHostProjectionResolver } from './patient-insight-host-projection.ts';

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
type RecordEntry = Readonly<{ entropyHandle: string; currentness: Currentness; accepted: Extract<PatientInsightHostResult, { status: 'available' }> }>;
type ReservationEntry = Readonly<{ entropyHandle: string; handle: string; currentness: Currentness; accepted: Extract<PatientInsightHostResult, { status: 'available' }> }>;
const handlePattern = /^pib_[0-9a-f]{32}$/u;
const tokenPattern = /^[A-Za-z][A-Za-z0-9._:-]{15,159}$/u;

function fail(code: PatientInsightBrokerErrorCode): never { throw new PatientInsightBrokerError(code); }
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
        if (!input || !Object.isFrozen(value) || !Number.isSafeInteger(input.selectionEpoch) || (input.selectionEpoch as number) < 1 || !Number.isSafeInteger(input.revision) || (input.revision as number) < 0 || typeof input.freshnessToken !== 'string' || !tokenPattern.test(input.freshnessToken) || typeof input.isRevoked !== 'function') return null;
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

/** Candidate-only: ABA needs P4 lease critical section; production remains HOLD. */
export function createPatientInsightBroker(value: PatientInsightBrokerHost): PatientInsightBroker {
    const host = exact(value, ['readCurrentness', 'readSources', 'boundary', 'clock', 'entropy']);
    const boundaryValue = host && exact(host.boundary, ['prepare']);
    if (!host || !Object.isFrozen(value) || !boundaryValue || typeof host.readCurrentness !== 'function' || typeof host.readSources !== 'function' || typeof boundaryValue.prepare !== 'function' || typeof host.clock !== 'function' || typeof host.entropy !== 'function') fail('input_invalid');
    const resolver = createPatientInsightHostProjectionResolver(); const records = new Map<string, RecordEntry>(); const reservations = new WeakMap<object, ReservationEntry>(); const liveEntropyHandles = new Set<string>(); const reservedHandles = new Set<string>(); const consumed = new Set<string>();
    let operationActive = false; let operationPoisoned = false; let operationCleanup: (() => void) | null = null;
    const readCurrentness = () => {
        let result: unknown; try { result = (host.readCurrentness as () => unknown)(); } catch { return fail('dependency_unavailable'); }
        const snapshot = currentness(result); if (!snapshot) fail('dependency_unavailable'); return snapshot;
    };
    const readClock = () => { try { if (!timestamp((host.clock as () => unknown)())) fail('dependency_unavailable'); } catch (error) { if (error instanceof PatientInsightBrokerError) throw error; fail('dependency_unavailable'); } };
    const issueHandle = () => {
        let bytes: unknown; try { bytes = (host.entropy as () => unknown)(); } catch { return fail('dependency_unavailable'); }
        try {
            if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16) fail('dependency_unavailable');
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
        while (records.has(candidate) || reservedHandles.has(candidate) || consumed.has(candidate)) {
            const next = nextHandle(candidate); if (!next) fail('handle_collision'); candidate = next;
        }
        return candidate;
    };
    const discardOperationState = (): void => {
        const cleanup = operationCleanup as (() => void) | null; operationCleanup = null;
        if (cleanup) cleanup();
    };
    const ensureNotPoisoned = (): void => { if (operationPoisoned) { discardOperationState(); fail('operation_reentered'); } };
    const stage = (): object => {
        const snapshot = readCurrentness(); ensureNotPoisoned(); readClock(); ensureNotPoisoned(); let sources: unknown;
        try { sources = (host.readSources as () => unknown)(); } catch { return fail('dependency_unavailable'); }
        ensureNotPoisoned();
        const projection = resolver.resolve(sources); if (!projection) fail('dependency_unavailable');
        let output: unknown; try { output = (boundaryValue.prepare as (request: Readonly<{ projection: PatientInsightProjection }>) => unknown)(Object.freeze({ projection })); } catch { return fail('dependency_unavailable'); }
        ensureNotPoisoned();
        const result = accepted(output); if (!result) fail('proposal_invalid'); const entropyHandle = issueHandle();
        if (liveEntropyHandles.has(entropyHandle)) fail('handle_collision'); const handle = availableHandle(entropyHandle);
        const current = readCurrentness(); ensureNotPoisoned(); currentnessChanged(snapshot, current);
        const reservation = Object.freeze(Object.create(null)) as object; const entry = Object.freeze({ entropyHandle, handle, currentness: snapshot, accepted: result });
        reservations.set(reservation, entry); liveEntropyHandles.add(entropyHandle); reservedHandles.add(handle);
        operationCleanup = () => { if (reservations.get(reservation) === entry) { reservations.delete(reservation); liveEntropyHandles.delete(entry.entropyHandle); reservedHandles.delete(entry.handle); } };
        ensureNotPoisoned();
        return reservation;
    };
    const publish = (inputValue: unknown, verifyCurrentness = true): string => {
        const reservation = reservationInput(inputValue); const entry = reservations.get(reservation); if (!entry) fail('reservation_missing');
        if (verifyCurrentness) { readClock(); ensureNotPoisoned(); const current = readCurrentness(); ensureNotPoisoned(); currentnessChanged(entry.currentness, current); }
        ensureNotPoisoned();
        if (records.has(entry.handle)) fail('handle_collision');
        const record = Object.freeze({ entropyHandle: entry.entropyHandle, currentness: entry.currentness, accepted: entry.accepted });
        reservations.delete(reservation); reservedHandles.delete(entry.handle); records.set(entry.handle, record);
        operationCleanup = () => { if (records.get(entry.handle) === record) { records.delete(entry.handle); liveEntropyHandles.delete(record.entropyHandle); } };
        ensureNotPoisoned();
        return entry.handle;
    };
    const abort = (inputValue: unknown): void => {
        const reservation = reservationInput(inputValue); const entry = reservations.get(reservation); if (!entry) fail('reservation_missing');
        reservations.delete(reservation); liveEntropyHandles.delete(entry.entropyHandle); reservedHandles.delete(entry.handle);
    };
    const exclusive = <Result>(callback: () => Result): Result => {
        if (operationActive) { operationPoisoned = true; fail('operation_reentered'); }
        operationActive = true; operationPoisoned = false; operationCleanup = null;
        try {
            const result = callback();
            if (operationPoisoned) { discardOperationState(); fail('operation_reentered'); }
            return result;
        } finally { operationActive = false; operationPoisoned = false; operationCleanup = null; }
    };
    return Object.freeze({
        stage() { return exclusive(stage); },
        publish(inputValue) { return exclusive(() => publish(inputValue)); },
        abort(inputValue) { return exclusive(() => abort(inputValue)); },
        issue() {
            return exclusive(() => publish(stage(), false));
        },
        consume(inputValue) {
            return exclusive(() => {
                const input = exact(inputValue, ['handle']); if (!input || typeof input.handle !== 'string' || !handlePattern.test(input.handle)) fail('input_invalid');
                if (consumed.has(input.handle)) fail('handle_replayed'); const entry = records.get(input.handle); if (!entry) fail('handle_missing'); records.delete(input.handle); liveEntropyHandles.delete(entry.entropyHandle); consumed.add(input.handle);
                readClock(); ensureNotPoisoned(); const current = readCurrentness(); ensureNotPoisoned(); currentnessChanged(entry.currentness, current); return entry.accepted;
            });
        },
    });
}
