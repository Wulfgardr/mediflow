/* @Codex — fixed native application composition, never a request-defined callback. */
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import * as native from '../security/native-inference-lifecycle';
import { nativeSessionProjectionOwnerRegistry, resolveNativeOrdinaryClinicalContext } from '../security/native-session-projection-owner-production';
import { createAuthenticatedWebSessionSelectionService } from '../security/server-session-authenticated-selection';
import type { AuthenticatedWebSessionProjectionOwnerContext } from '../security/server-auth';
import type { PairedNativeSession } from '../security/paired-native-session';
import { ProductError } from './product-contract';
import { beginOrdinaryFunction, bindNativeOrdinaryHostSources } from './ordinary-flow';
import { parseNativeOrdinaryPreparation, type NativeOrdinaryPreparation } from './native-ordinary-wire';
import { ExecutionError } from '../chatgpt-execution/execution-contract';
import { reportMacProductPreparationDiagnostic } from '../chatgpt-execution/execution-mac-product';
import { ServerSessionProjectionOwnerError } from '../security/server-session-projection-owner';
import { captureNativeOrdinaryProjectionSources, readNativeOrdinaryHostSource, closeNativeOrdinaryHostSources, nativeOrdinaryHostSourcesAreCurrent,
    nativeOrdinaryHostSourceSignal, nativeOrdinaryProjectionHandedOff,
    issueNativeOrdinaryProjection, claimNativeOrdinaryProjection, nativeOrdinaryProjectionContext,
    nativeOrdinaryProjectionReadControl, finalizeNativeOrdinaryChartProjection, completeNativeOrdinaryProjection,
    type NativeOrdinaryHostSourceCapture, type NativeOrdinarySelectionLease } from '../security/server-session-clinical-context-native-sources';

import { NATIVE_PROJECTION_HEADER } from './native-ordinary-projection-wire';
import { readNativeOrdinaryProjectionJson } from './native-ordinary-projection-transport';
import type { DocumentSynthesisProductionOperation } from '../ai-providers/fabric/document-synthesis-production-operation';
type DocumentPreparation = { operation: DocumentSynthesisProductionOperation; discard(input: unknown): void; captureHandle: string; previewHandle?: string };
const documents = new WeakMap<NativeOrdinaryHostSourceCapture, DocumentPreparation>();
type Context = AuthenticatedWebSessionProjectionOwnerContext & { session: PairedNativeSession; request: NativeOrdinaryPreparation; selection: NativeOrdinarySelectionLease; sources: NativeOrdinaryHostSourceCapture | null };
const scope = new AsyncLocalStorage<Context>();
function confirm(context: Context): void {
    const port = native.mintResourcePort(context.session);
    if (!port) throw new ProductError('session_expired');
    try {
        const current = resolveNativeOrdinaryClinicalContext(context.session,
            { patientId: context.request.patientId, ambulatoryId: context.request.ambulatoryId });
        if (current.patientVersion !== context.request.patientRevision
            || !nativeSessionProjectionOwnerRegistry.isAuthenticOwner(context.owner)) throw new ProductError('revoked');
        const { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef } = context.selection;
        context.owner.dereferenceSelection(context.session, { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef });
        if (context.sources && !nativeOrdinaryHostSourcesAreCurrent(context.sources)) throw new ProductError('revoked');
    } finally { native.releaseResourcePort(port); }
}
/** This accessor cannot create a native scope or select a function. */
export function getNativeOrdinaryApplicationContext(): Context | null {
    const context = scope.getStore();
    if (!context) return null;
    confirm(context); return context;
}
const requestFor = (source: Request, value: unknown): Request => new Request(source.url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: source.signal });
const requestId = () => `native_${randomUUID()}`;

/** The owner exposes closed failures, but the HTTP boundary only serializes
 * Product/Execution errors. Preserve that closed distinction without exposing
 * the owner code or any selected-record detail. */
function nativePreparationFailure(error: unknown): never {
    if (error instanceof ServerSessionProjectionOwnerError) {
        reportMacProductPreparationDiagnostic('binding');
        if (['session_unavailable', 'session_ineligible', 'lease_expired', 'owner_disposed'].includes(error.code)) {
            throw new ProductError('session_expired');
        }
        if (['owner_acquiring', 'owner_exists', 'selection_busy'].includes(error.code)) throw new ProductError('busy');
        if (error.code === 'input_invalid') throw new ProductError('invalid_request');
        throw new ProductError('revoked');
    }
    if (!(error instanceof ProductError || error instanceof ExecutionError)) reportMacProductPreparationDiagnostic('binding');
    throw error;
}

async function originalFunction(request: Request, context: Context): Promise<Response> {
    confirm(context);
    const prepared = context.request;
    const source = context.sources ? readNativeOrdinaryHostSource(context.sources, context.session, prepared.functionId) : null;
    if (context.sources) bindNativeOrdinaryHostSources(context.sources);
    if (prepared.functionId === 'patient_insight') {
        if (source?.functionId !== 'patient_insight') throw new ProductError('revoked');
        const input = source.input;
        const [{ acquireAuthenticatedPatientInsightPreview }, { createPatientInsightPreviewHttpHandler }] = await Promise.all([
            import('../ai-providers/fabric/patient-insight-authenticated-preview-production'),
            import('../ai-providers/fabric/patient-insight-authenticated-preview'),
        ]);
        confirm(context);
        return createPatientInsightPreviewHttpHandler({ acquirePreview: acquireAuthenticatedPatientInsightPreview })(requestFor(request, input));
    }
    const lease = context.selection;
    if (prepared.functionId === 'smart_import') {
        if (source?.functionId !== 'smart_import') throw new ProductError('revoked');
        const projection = source.input;
        const [{ acquireAuthenticatedSmartImportAttachmentIngest }, { acquireAuthenticatedSmartImportPreview },
            { createSmartImportPreviewHttpHandler }] = await Promise.all([
            import('../security/server-session-authenticated-smart-import-attachment-ingest-production'),
            import('../security/server-session-authenticated-smart-import-preview-production'),
            import('../security/server-session-smart-import-preview-http'),
        ]);
        const operation = await acquireAuthenticatedSmartImportAttachmentIngest(); confirm(context);
        const { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef } = lease;
        const handle = await operation.ingest({ tuple: { sessionRef, selectionEpoch, patientRef, ambulatoryRef, leaseRef },
            attachment: projection, requestId: requestId() });
        confirm(context);
        return createSmartImportPreviewHttpHandler({ acquirePreview: acquireAuthenticatedSmartImportPreview })(
            requestFor(request, { handle, requestId: requestId() }));
    }
    if (prepared.functionId === 'treatment_reasoning') {
        if (source?.functionId !== 'treatment_reasoning') throw new ProductError('revoked');
        const [{ acquireTreatmentReasoningIngest, acquireTreatmentReasoningPreview }, { createTreatmentReasoningPreviewHttpHandler }] = await Promise.all([
            import('../ai-providers/fabric/treatment-reasoning-production-root'),
            import('../ai-providers/fabric/treatment-reasoning-production-http'),
        ]);
        const operation = await acquireTreatmentReasoningIngest(); confirm(context);
        const handle = operation.ingest({ projection: source.input, requestId: requestId() });
        return createTreatmentReasoningPreviewHttpHandler({ acquirePreview: acquireTreatmentReasoningPreview })(
            requestFor(request, { handle, requestId: requestId() }));
    }
    const document = context.sources ? documents.get(context.sources) : null;
    if (!document?.previewHandle) throw new ProductError('revoked');
    const { createDocumentSynthesisPreviewHttpHandler } = await import('../ai-providers/fabric/document-synthesis-production-http');
    confirm(context);
    return createDocumentSynthesisPreviewHttpHandler({ acquireOperation: async () => document.operation })(
        requestFor(request, { previewHandle: document.previewHandle }));
}

/** Document capture and binary ingest precede the ordinary attempt, but keep the same native scope. */
async function captureDocument(context: Context): Promise<void> {
    if (!context.sources || context.request.functionId !== 'document_synthesis') return;
    const { acquireDocumentSynthesisProductionOperation, discardDocumentSynthesisPreparation } = await import('../ai-providers/fabric/document-synthesis-production-operation');
    confirm(context);
    const operation = await acquireDocumentSynthesisProductionOperation(); confirm(context);
    if (!operation) throw new ProductError('revoked');
    const signal = nativeOrdinaryHostSourceSignal(context.sources);
    const captured = await operation.capture(context.request.input);
    if (captured.status !== 'available') throw new ProductError('revoked');
    const document: DocumentPreparation = { operation, discard: input => discardDocumentSynthesisPreparation(operation, input), captureHandle: captured.captureHandle };
    const retire = () => {
        documents.delete(context.sources!);
        document.discard({ captureHandle: document.captureHandle });
        if (document.previewHandle) document.discard({ previewHandle: document.previewHandle });
    };
    documents.set(context.sources, document);
    signal.addEventListener('abort', retire, { once: true });
    if (signal.aborted) { retire(); throw new ProductError('revoked'); }
    confirm(context);
}
async function ingestDocument(context: Context, request?: Request): Promise<void> {
    if (!context.sources || context.request.functionId !== 'document_synthesis') throw new ProductError('revoked');
    const document = documents.get(context.sources); if (!document || document.previewHandle) throw new ProductError('revoked');
    confirm(context);
    const signal = nativeOrdinaryHostSourceSignal(context.sources);
    const ingested = await document.operation.ingest({ captureHandle: document.captureHandle }, request);
    if (ingested.status !== 'available') throw new ProductError('invalid_state');
    document.previewHandle = ingested.previewHandle;
    if (signal.aborted) { document.discard({ previewHandle: ingested.previewHandle }); throw new ProductError('revoked'); }
    confirm(context);
}
async function beginPrepared(request: Request, context: Context): Promise<Response> {
    if (!context.sources) throw new ProductError('revoked');
    completeNativeOrdinaryProjection(context.sources); confirm(context);
    // Both prepare and project ingress streams may already be disturbed; never reuse their body.
    const identity = new Request(request.url, { method: 'POST', headers: request.headers,
        signal: AbortSignal.any([request.signal, nativeOrdinaryHostSourceSignal(context.sources)]) });
    const response = await beginOrdinaryFunction(identity, context.request.functionId, context.session, ownedRequest => scope.run(context, async () => {
        const response = await originalFunction(ownedRequest, context); confirm(context); return response;
    }));
    // A lane-disabled original handler may have already closed its source. Never resurrect it.
    if (nativeOrdinaryHostSourcesAreCurrent(context.sources)) nativeOrdinaryProjectionHandedOff(context.sources);
    return response;
}
/** Only the paired Mac ingress calls this fixed four-way composition. No attempt exists during a grant. */
export async function prepareNativeOrdinary(request: Request, session: PairedNativeSession, input: NativeOrdinaryPreparation): Promise<Response> {
    input = parseNativeOrdinaryPreparation(input);
    const port = native.mintResourcePort(session);
    if (!port) throw new ProductError('session_expired');
    let sources: NativeOrdinaryHostSourceCapture | null = null;
    const cancel = () => { if (sources) closeNativeOrdinaryHostSources(sources); };
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
        if (request.signal.aborted) throw new ProductError('revoked');
        const owner = nativeSessionProjectionOwnerRegistry.acquire(session);
        const service = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => owner });
        const selection = await service.issue({ expectedEpoch: owner.snapshotSelectionEpoch(session),
            patientId: input.patientId, ambulatoryId: input.ambulatoryId });
        if (request.signal.aborted) throw new ProductError('revoked');
        sources = captureNativeOrdinaryProjectionSources(session, owner, input, selection);
        const context: Context = Object.freeze({ session, owner, request: input, selection, sources });
        return await scope.run(context, async () => {
            confirm(context);
            const plan = issueNativeOrdinaryProjection(sources!);
            if (input.functionId === 'document_synthesis') await captureDocument(context);
            confirm(context);
            if (request.signal.aborted) throw new ProductError('revoked');
            if (plan) return Response.json({ schema: 'mediflow.native-ordinary.v1', phase: 'needs_source_projection',
                functionId: input.functionId, expiresAt: plan.expiresAt, sourceProjection: plan },
                { status: 202, headers: { 'Cache-Control': 'no-store' } });
            if (input.functionId === 'document_synthesis') await ingestDocument(context);
            return beginPrepared(request, context);
        });
    } catch (error) { cancel(); nativePreparationFailure(error); }
    finally { request.signal.removeEventListener('abort', cancel); native.releaseResourcePort(port); }
}
/** Claims before any body read; header, MIME and body never select the source or function. */
export async function projectNativeOrdinary(request: Request, session: PairedNativeSession): Promise<Response> {
    const capture = claimNativeOrdinaryProjection(session, request.headers.get(NATIVE_PROJECTION_HEADER));
    const cancel = () => closeNativeOrdinaryHostSources(capture);
    request.signal.addEventListener('abort', cancel, { once: true });
    try {
        if (request.signal.aborted || request.headers.has('content-encoding')) throw new ProductError('revoked');
        const context: Context = nativeOrdinaryProjectionContext(capture);
        return await scope.run(context, async () => {
            confirm(context);
            if (context.request.functionId === 'document_synthesis') {
                if (request.headers.get('content-type') !== 'application/octet-stream') throw new ProductError('invalid_request');
                await ingestDocument(context, request);
            } else {
                const body = await readNativeOrdinaryProjectionJson(request, nativeOrdinaryProjectionReadControl(capture));
                confirm(context); finalizeNativeOrdinaryChartProjection(capture, body);
            }
            confirm(context);
            if (request.signal.aborted) throw new ProductError('revoked');
            return beginPrepared(request, context);
        });
    } catch (error) { cancel(); nativePreparationFailure(error); }
    finally { request.signal.removeEventListener('abort', cancel); }
}
