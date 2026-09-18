/* @Codex — host source authority for the three chart functions; not a DTO factory. */
import 'server-only';
import { createHash } from 'node:crypto';
import * as native from './native-inference-lifecycle';
import { nativeSessionProjectionOwnerRegistry } from './native-session-projection-owner-production';
import type { ServerSessionProjectionOwner } from './server-session-projection-owner';
import type { PairedNativeSession } from './paired-native-session';
import { parseNativeOrdinaryPreparation, type NativeOrdinaryPreparation } from '../chatgpt-product/native-ordinary-wire';
import { ProductError } from '../chatgpt-product/product-contract';
import { readNativeOrdinarySourceRows, type NativeChartFunction } from './server-session-clinical-context-native-source-rows';
import { buildNativeOrdinaryHostValue, type NativeOrdinaryHostValue } from './server-session-clinical-context-native-source-projection';

declare const sourceBrand: unique symbol;
export type NativeOrdinaryHostSourceCapture = Readonly<{ [sourceBrand]: true }>;
export type NativeOrdinarySelectionLease = ReturnType<ServerSessionProjectionOwner['issueSelection']>;
type RecordState = {
    session: PairedNativeSession; owner: ServerSessionProjectionOwner; request: NativeOrdinaryPreparation;
    functionId: NativeChartFunction; lease: NativeOrdinarySelectionLease; reviewEpoch: number;
    digest: string; value: NativeOrdinaryHostValue | null; deadline: number; expiresAt: number;
    closed: boolean; port: native.NativeInferencePort; registration: ReturnType<typeof native.registerPrivateResource>;
};
const records = new WeakMap<object, RecordState>();
const fail = (): never => { throw new ProductError('revoked'); };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function close(state: RecordState): void {
    if (state.closed) return;
    state.closed = true; state.value = null; state.digest = '';
    if (state.registration) native.unregisterPrivateResource(state.port, state.registration);
    native.releaseResourcePort(state.port);
}
function read(state: RecordState) {
    if (state.closed || performance.now() >= state.deadline || Date.now() >= state.expiresAt
        || !nativeSessionProjectionOwnerRegistry.isAuthenticOwner(state.owner)) return fail();
    const use = native.beginResourceUse(state.port); if (!use) return fail();
    try {
        const { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef } = state.lease;
        const pair = state.owner.dereferenceSelection(state.session, { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef });
        if (pair.patientId !== state.request.patientId || pair.ambulatoryId !== state.request.ambulatoryId
            || state.owner.snapshotReviewContextEpoch(state.session) !== state.reviewEpoch) return fail();
        const rows = state.owner.withLeaseCriticalSection(state.session, selected => {
            if (selected.patientId !== pair.patientId || selected.ambulatoryId !== pair.ambulatoryId) return fail();
            return readNativeOrdinarySourceRows(selected, state.functionId);
        });
        if (rows.patient.version !== state.request.patientRevision || !native.commitResourceUse(use)) return fail();
        return rows;
    } finally { native.abortResourceUse(use); }
}
/** Fixed service: no arbitrary reader/auth/currentness callbacks can be supplied. */
export function captureNativeOrdinaryHostSources(session: PairedNativeSession, owner: ServerSessionProjectionOwner,
    value: NativeOrdinaryPreparation, lease: NativeOrdinarySelectionLease): NativeOrdinaryHostSourceCapture {
    const request = parseNativeOrdinaryPreparation(value);
    if (request.functionId === 'document_synthesis') throw new ProductError('invalid_request');
    if (!nativeSessionProjectionOwnerRegistry.isAuthenticOwner(owner)) return fail();
    const port = native.mintResourcePort(session); if (!port) return fail();
    let state: RecordState | undefined;
    try {
        state = { session, owner, request, functionId: request.functionId, lease,
            reviewEpoch: owner.snapshotReviewContextEpoch(session), digest: '', value: null,
            deadline: performance.now() + 300000, expiresAt: Math.min(lease.expiresAt, Date.now() + 300000),
            closed: false, port, registration: null };
        const captured = state;
        state.registration = native.registerPrivateResource(port, () => close(captured));
        if (!state.registration || state.closed) return fail();
        const rows = read(state); state.digest = digest(rows);
        state.value = buildNativeOrdinaryHostValue(request.functionId, request.ambulatoryId, rows, new Date().toISOString());
        if (digest(read(state)) !== state.digest) return fail();
        const capture = Object.freeze(Object.create(null)) as NativeOrdinaryHostSourceCapture;
        records.set(capture, state); return capture;
    } catch (error) { if (state) close(state); else native.releaseResourcePort(port); throw error; }
}
/** Reads are veto-only and terminal on first mismatch, never renewal. */
export function nativeOrdinaryHostSourcesAreCurrent(capture: NativeOrdinaryHostSourceCapture): boolean {
    const state = records.get(capture); if (!state || state.closed || !state.value) return false;
    try {
        if (digest(read(state)) === state.digest) return true;
    } catch { /* fail closed */ }
    close(state); return false;
}
export function readNativeOrdinaryHostSource(capture: NativeOrdinaryHostSourceCapture, session: PairedNativeSession,
    functionId: NativeOrdinaryPreparation['functionId']): NativeOrdinaryHostValue {
    const state = records.get(capture);
    if (!state || state.session !== session || state.functionId !== functionId || !nativeOrdinaryHostSourcesAreCurrent(capture) || !state.value) return fail();
    return state.value;
}
export function closeNativeOrdinaryHostSources(capture: NativeOrdinaryHostSourceCapture): void {
    const state = records.get(capture); if (state) close(state);
}
