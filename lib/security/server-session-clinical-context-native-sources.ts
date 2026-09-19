/* @Codex — native pre-attempt grants and host captures. No key, PIN, decryptor or writer. */
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import * as native from './native-inference-lifecycle';
import { nativeSessionProjectionOwnerRegistry, nativeSessionProjectionOwnerProduction, resolveNativeOrdinaryClinicalContext } from './native-session-projection-owner-production';
import type { ServerSessionProjectionOwner } from './server-session-projection-owner';
import type { PairedNativeSession } from './paired-native-session';
import { parseNativeOrdinaryPreparation, type NativeOrdinaryPreparation } from '../chatgpt-product/native-ordinary-wire';
import { NATIVE_PROJECTION_SCHEMA, isNativeProjectionGrantId, parseNativeOrdinaryProjection,
    type NativeProjectionPlan, type NativeProjectionSelector } from '../chatgpt-product/native-ordinary-projection-wire';
import { ProductError } from '../chatgpt-product/product-contract';
import { readNativeOrdinarySourceRows } from './server-session-clinical-context-native-source-rows';
import { buildNativeOrdinaryHostValue, type NativeOrdinaryHostValue } from './server-session-clinical-context-native-source-projection';
import { nativeEncryptedSourceRoster, projectNativeSourceRows } from './server-session-clinical-context-native-source-roster';
import { createNativeAttachmentExtractionSourceAuthority } from '../domain/documents/attachment-extraction-source-authority';

declare const sourceBrand: unique symbol;
export type NativeOrdinaryHostSourceCapture = Readonly<{ [sourceBrand]: true }>;
export type NativeOrdinarySelectionLease = ReturnType<ServerSessionProjectionOwner['issueSelection']>;
type DocumentAuthority = ReturnType<typeof createNativeAttachmentExtractionSourceAuthority>;
type DocumentSource = NonNullable<ReturnType<DocumentAuthority['issueNativeOrdinarySource']>>;
type HostValue = NativeOrdinaryHostValue | Readonly<{ functionId: 'document_synthesis'; input: Readonly<{ attachmentId: string }> }>;
type RecordState = {
    session: PairedNativeSession; owner: ServerSessionProjectionOwner; request: NativeOrdinaryPreparation;
    lease: NativeOrdinarySelectionLease; reviewEpoch: number; digest: string; value: HostValue | null;
    capturedAt: string; deadline: number; expiresAt: number; phaseDeadline: number; phaseExpiresAt: number; closed: boolean; completed: boolean;
    port: native.NativeInferencePort; registration: ReturnType<typeof native.registerPrivateResource>;
    detachSelection: () => void; controller: AbortController; timer?: ReturnType<typeof setTimeout>;
    roster: readonly NativeProjectionSelector[]; plan: NativeProjectionPlan | null;
    claimed: boolean; documentUse: boolean; authority?: DocumentAuthority; document?: DocumentSource;
};
const records = new WeakMap<object, RecordState>();
const grants = new Map<string, NativeOrdinaryHostSourceCapture>();
const fail = (): never => { throw new ProductError('revoked'); };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Native issuer returns a stable authentic session object. Never admit cloned DTOs by tuple equality.
const sameSession = (a: PairedNativeSession, b: PairedNativeSession) => a === b;
function close(state: RecordState): void {
    if (state.closed) return;
    state.closed = true; state.value = null; state.digest = ''; clearTimeout(state.timer);
    if (state.plan) grants.delete(state.plan.grantId);
    state.controller.abort(); state.authority?.cancel();
    // Selection/lifecycle retirement can run inside the owner: revoke now, unregister after its stack.
    queueMicrotask(() => {
        state.detachSelection(); state.authority?.dispose();
        if (state.registration) native.unregisterPrivateResource(state.port, state.registration);
        native.releaseResourcePort(state.port);
    });
}
function arm(state: RecordState, milliseconds: number): void {
    clearTimeout(state.timer);
    state.phaseDeadline = Math.min(state.deadline, performance.now() + milliseconds);
    state.phaseExpiresAt = Math.min(state.expiresAt, Date.now() + milliseconds);
    state.timer = setTimeout(() => close(state), Math.max(0, Math.min(state.phaseExpiresAt - Date.now(), state.phaseDeadline - performance.now())));
    state.timer.unref?.();
}
function selected(state: RecordState): void {
    if (state.closed || performance.now() >= Math.min(state.deadline, state.phaseDeadline) || Date.now() >= Math.min(state.expiresAt, state.phaseExpiresAt)
        || !nativeSessionProjectionOwnerRegistry.isAuthenticOwner(state.owner)) return fail();
    const { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef } = state.lease;
    const pair = state.owner.dereferenceSelection(state.session, { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef });
    if (pair.patientId !== state.request.patientId || pair.ambulatoryId !== state.request.ambulatoryId
        || state.owner.snapshotReviewContextEpoch(state.session) !== state.reviewEpoch) return fail();
}
function read(state: RecordState) {
    selected(state);
    const use = native.beginResourceUse(state.port); if (!use) return fail();
    try {
        const functionId = state.request.functionId;
        if (functionId === 'document_synthesis') {
            const context = resolveNativeOrdinaryClinicalContext(state.session,
                { patientId: state.request.patientId, ambulatoryId: state.request.ambulatoryId });
            if (context.patientVersion !== state.request.patientRevision || !state.document || !state.authority
                || !state.authority.checkNativeOrdinaryWitness(state.document.witness) || !native.commitResourceUse(use)) return fail();
            return null;
        }
        const rows = state.owner.withLeaseCriticalSection(state.session, pair => {
            if (pair.patientId !== state.request.patientId || pair.ambulatoryId !== state.request.ambulatoryId) return fail();
            return readNativeOrdinarySourceRows(pair, functionId);
        });
        if (rows.patient.version !== state.request.patientRevision || !native.commitResourceUse(use)) return fail();
        return rows;
    } finally { native.abortResourceUse(use); }
}
function stateOf(capture: NativeOrdinaryHostSourceCapture): RecordState {
    const state = records.get(capture); if (!state || state.closed) return fail(); return state;
}
/** Veto-only and terminal at the first mismatch, including while a body read is suspended. */
export function nativeOrdinaryHostSourcesAreCurrent(capture: NativeOrdinaryHostSourceCapture): boolean {
    const state = records.get(capture); if (!state || state.closed) return false;
    try {
        if (state.plan && !state.claimed && Date.now() >= state.plan.expiresAt) throw new ProductError('revoked');
        const rows = read(state);
        if (state.request.functionId === 'document_synthesis' || digest(rows) === state.digest) return true;
    } catch { /* terminal denial */ }
    close(state); return false;
}
export function captureNativeOrdinaryProjectionSources(session: PairedNativeSession, owner: ServerSessionProjectionOwner,
    value: NativeOrdinaryPreparation, lease: NativeOrdinarySelectionLease): NativeOrdinaryHostSourceCapture {
    const request = parseNativeOrdinaryPreparation(value);
    if (!nativeSessionProjectionOwnerRegistry.isAuthenticOwner(owner)) return fail();
    const port = native.mintResourcePort(session); if (!port) return fail();
    let state: RecordState | undefined;
    try {
        state = { session, owner, request, lease, reviewEpoch: owner.snapshotReviewContextEpoch(session), digest: '', value: null,
            capturedAt: new Date().toISOString(), deadline: performance.now() + 300000,
            expiresAt: Math.min(lease.expiresAt, Date.now() + 300000), phaseDeadline: Infinity, phaseExpiresAt: Infinity, closed: false, completed: false, port, registration: null,
            detachSelection: () => {}, controller: new AbortController(), roster: [], plan: null, claimed: false, documentUse: false };
        const captured = state;
        state.registration = native.registerPrivateResource(port, () => close(captured));
        if (!state.registration || state.closed) return fail();
        const lifecycle = nativeSessionProjectionOwnerProduction.selectionLifecycleController;
        let registered = false;
        if (!lifecycle.withCurrentSelection(session, scope => {
            const registration = lifecycle.registerDependent(scope, () => close(captured));
            if (registration) { registered = true; captured.detachSelection = () => { lifecycle.unregisterDependent(scope, registration); }; }
        }) || !registered || state.closed) return fail();
        if (request.functionId === 'document_synthesis') {
            selected(state);
            state.authority = createNativeAttachmentExtractionSourceAuthority(session);
            state.document = state.authority.issueNativeOrdinarySource(request.input) ?? undefined;
            if (!state.document) return fail();
            if (state.document.clientProjectionRequired) state.roster = Object.freeze([
                Object.freeze({ entity: 'attachment_bytes', id: request.input.attachmentId, fields: Object.freeze(['data']) }),
            ]);
            else state.value = Object.freeze({ functionId: 'document_synthesis', input: request.input });
            read(state);
        } else {
            const rows = read(state); if (!rows) return fail();
            state.digest = digest(rows); state.roster = nativeEncryptedSourceRoster(rows);
            if (!state.roster.length) state.value = buildNativeOrdinaryHostValue(request.functionId, request.ambulatoryId, rows, state.capturedAt);
            if (digest(read(state)) !== state.digest) return fail();
        }
        const capture = Object.freeze(Object.create(null)) as NativeOrdinaryHostSourceCapture;
        records.set(capture, state); arm(state, 300000); return capture;
    } catch (error) { if (state) close(state); else native.releaseResourcePort(port); throw error; }
}
/** Compatibility entrypoint remains closed to ciphertext unless the named two-phase composition is used. */
export function captureNativeOrdinaryHostSources(session: PairedNativeSession, owner: ServerSessionProjectionOwner,
    value: NativeOrdinaryPreparation, lease: NativeOrdinarySelectionLease): NativeOrdinaryHostSourceCapture {
    const capture = captureNativeOrdinaryProjectionSources(session, owner, value, lease);
    if (!stateOf(capture).value) { closeNativeOrdinaryHostSources(capture); throw new ProductError('invalid_state'); }
    return capture;
}
export function issueNativeOrdinaryProjection(capture: NativeOrdinaryHostSourceCapture): NativeProjectionPlan | null {
    const state = stateOf(capture);
    if (!nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
    if (!state.roster.length) return null;
    if (state.plan || state.claimed || grants.size >= 16) throw new ProductError('busy');
    const plan = Object.freeze({ schemaVersion: NATIVE_PROJECTION_SCHEMA, grantId: randomBytes(32).toString('hex'),
        functionId: state.request.functionId, expiresAt: Math.min(state.expiresAt, Date.now() + 30000), roster: state.roster });
    state.plan = plan; grants.set(plan.grantId, capture); arm(state, plan.expiresAt - Date.now()); return plan;
}
/** A grant is reserved exactly once BEFORE parsing or allocating the submitted body. */
export function claimNativeOrdinaryProjection(session: PairedNativeSession, grantId: unknown): NativeOrdinaryHostSourceCapture {
    if (!isNativeProjectionGrantId(grantId)) return fail();
    const capture = grants.get(grantId); if (!capture) return fail();
    const state = stateOf(capture);
    if (!sameSession(state.session, session)) return fail(); // Do not let another session retire it.
    if (state.claimed || !nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
    state.claimed = true; arm(state, 120000); return capture;
}
export function cancelNativeOrdinaryProjection(session: PairedNativeSession, grantId: unknown): void {
    if (!isNativeProjectionGrantId(grantId)) throw new ProductError('invalid_request');
    const capture = grants.get(grantId); if (!capture) return;
    const state = records.get(capture);
    if (state && sameSession(state.session, session)) close(state);
}
export function nativeOrdinaryProjectionContext(capture: NativeOrdinaryHostSourceCapture) {
    const state = stateOf(capture);
    if (!nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
    return Object.freeze({ session: state.session, owner: state.owner, request: state.request, selection: state.lease, sources: capture });
}
export function nativeOrdinaryProjectionReadControl(capture: NativeOrdinaryHostSourceCapture) {
    const state = stateOf(capture);
    if (!state.claimed || !state.plan) return fail();
    return Object.freeze({ signal: state.controller.signal, current: () => nativeOrdinaryHostSourcesAreCurrent(capture) });
}
export function finalizeNativeOrdinaryChartProjection(capture: NativeOrdinaryHostSourceCapture, value: unknown): void {
    const state = stateOf(capture);
    try {
        if (!state.claimed || !state.plan || state.value || state.request.functionId === 'document_synthesis'
            || !nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
        const body = parseNativeOrdinaryProjection(value, state.plan);
        const rows = read(state); if (!rows || digest(rows) !== state.digest) return fail();
        const projected = projectNativeSourceRows(rows, body);
        const built = buildNativeOrdinaryHostValue(state.request.functionId, state.request.ambulatoryId,
            projected, state.capturedAt, `source_${state.digest}`);
        if (!nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
        state.value = built;
    } catch (error) { close(state); throw error; }
}
/** The existing AnyDoc binary pipeline consumes this real native source, never a caller callback. */
export function consumeNativeOrdinaryDocumentProjection(capture: NativeOrdinaryHostSourceCapture, session: PairedNativeSession, attachmentId: string) {
    const state = stateOf(capture);
    if (!sameSession(state.session, session) || state.request.functionId !== 'document_synthesis'
        || state.request.input.attachmentId !== attachmentId || !state.claimed || !state.plan || state.documentUse
        || !state.authority || !state.document || !nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
    state.documentUse = true;
    const authority = state.authority, source = state.document;
    let operation: object | null = null, finalized = false;
    return Object.freeze({
        signal: state.controller.signal,
        current: () => nativeOrdinaryHostSourcesAreCurrent(capture) && (!operation || authority.checkpoint(operation)),
        consume(bytes: Uint8Array) {
            if (operation || finalized || !nativeOrdinaryHostSourcesAreCurrent(capture)) return null;
            const result = authority.consumeProjection(source.locator, bytes);
            if (result.status !== 'begun') { close(state); return null; }
            operation = result.operation; return result;
        },
        finalize() {
            if (!operation || !nativeOrdinaryHostSourcesAreCurrent(capture)) return false;
            const result = authority.finalize(operation); operation = null;
            if (result.status !== 'spent' || !result.evidenceAdmissible || !nativeOrdinaryHostSourcesAreCurrent(capture)) return false;
            finalized = true;
            state.value = Object.freeze({ functionId: 'document_synthesis', input: Object.freeze({ attachmentId }) });
            return true;
        },
        cancel() { close(state); },
        dispose() { if (operation) authority.abort(operation); operation = null; if (!finalized) close(state); },
    });
}
/** Called only after canonical source parsing/AnyDoc ingest, before creating the attempt. */
export function completeNativeOrdinaryProjection(capture: NativeOrdinaryHostSourceCapture): void {
    const state = stateOf(capture);
    if (state.completed || !state.value || !nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
    state.completed = true; arm(state, 300000);
    // Keep the cancellation address through the handoff. Replay remains denied by claimed.

}
export function nativeOrdinarySourceAcquisition(capture: NativeOrdinaryHostSourceCapture) {
    const state = stateOf(capture);
    return state.plan && state.value ? Object.freeze({ origin: 'authenticated_client_decryption' as const, ciphertextEquality: 'not_attested' as const }) : null;
}
export function readNativeOrdinaryHostSource(capture: NativeOrdinaryHostSourceCapture, session: PairedNativeSession,
    functionId: NativeOrdinaryPreparation['functionId']): HostValue {
    const state = stateOf(capture);
    if (!sameSession(state.session, session) || state.request.functionId !== functionId
        || !nativeOrdinaryHostSourcesAreCurrent(capture) || !state.value) return fail();
    return state.value;
}
export function closeNativeOrdinaryHostSources(capture: NativeOrdinaryHostSourceCapture): void {
    const state = records.get(capture); if (state) close(state);
}

/* @Codex — descriptive branch only, after authentic source acquisition. */
export function nativeOrdinaryDocumentRequiresProjection(capture: NativeOrdinaryHostSourceCapture): boolean {
    const state = stateOf(capture);
    if (state.request.functionId !== 'document_synthesis' || !nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
    return state.roster.length > 0;
}

/* @Codex — revocation-only views; never expose the private capture or source metadata. */
export function nativeOrdinaryHostSourceSignal(capture: NativeOrdinaryHostSourceCapture): AbortSignal {
    return stateOf(capture).controller.signal;
}
export function nativeOrdinaryProjectionHandedOff(capture: NativeOrdinaryHostSourceCapture): void {
    const state = stateOf(capture);
    if (!state.completed || !nativeOrdinaryHostSourcesAreCurrent(capture)) return fail();
    if (state.plan) grants.delete(state.plan.grantId);
}
/** A closed capture may still identify its exact attempt for cleanup retries, never for source use. */
export function nativeOrdinarySourceMatchesGrant(capture: NativeOrdinaryHostSourceCapture,
    session: PairedNativeSession, grantId: unknown): boolean {
    const state = records.get(capture);
    return !!state && isNativeProjectionGrantId(grantId) && sameSession(state.session, session) && state.plan?.grantId === grantId;
}
