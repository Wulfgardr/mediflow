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
import { captureNativeOrdinaryHostSources, readNativeOrdinaryHostSource, closeNativeOrdinaryHostSources, nativeOrdinaryHostSourcesAreCurrent,
    type NativeOrdinaryHostSourceCapture, type NativeOrdinarySelectionLease } from '../security/server-session-clinical-context-native-sources';

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
    const input = prepared.input;
    const [{ acquireDocumentSynthesisProductionOperation }, { createDocumentSynthesisPreviewHttpHandler }] = await Promise.all([
        import('../ai-providers/fabric/document-synthesis-production-operation'),
        import('../ai-providers/fabric/document-synthesis-production-http'),
    ]);
    const operation = await acquireDocumentSynthesisProductionOperation(); confirm(context);
    if (!operation) throw new ProductError('revoked');
    const capture = await operation.capture({ attachmentId: input.attachmentId }); confirm(context);
    if (capture.status !== 'available') throw new ProductError('revoked');
    const ingest = await operation.ingest({ captureHandle: capture.captureHandle }); confirm(context);
    if (ingest.status !== 'available') throw new ProductError('invalid_state');
    return createDocumentSynthesisPreviewHttpHandler({ acquireOperation: async () => operation })(
        requestFor(request, { previewHandle: ingest.previewHandle }));
}

/** Only the paired Mac ingress calls this fixed four-way composition. */
export async function prepareNativeOrdinary(request: Request, session: PairedNativeSession, input: NativeOrdinaryPreparation): Promise<Response> {
    // Revalidate even direct internal calls BEFORE owner acquisition/operation creation.
    input = parseNativeOrdinaryPreparation(input);
    const port = native.mintResourcePort(session);
    if (!port) throw new ProductError('session_expired');
    try {
        const owner = nativeSessionProjectionOwnerRegistry.acquire(session);
        return await beginOrdinaryFunction(request, input.functionId, session, async ownedRequest => {
            const service = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => owner });
            const selection = await service.issue({ expectedEpoch: owner.snapshotSelectionEpoch(session),
                patientId: input.patientId, ambulatoryId: input.ambulatoryId });
            const sources = input.functionId === 'document_synthesis' ? null : captureNativeOrdinaryHostSources(session, owner, input, selection);
            const context: Context = Object.freeze({ session, owner, request: input, selection, sources });
            try {
                confirm(context);
                return await scope.run(context, async () => {
                    const response = await originalFunction(ownedRequest, context);
                    confirm(context); // Original parser/commit is not a bypass of host-source currentness.
                    return response;
                });
            } catch (error) { if (sources) closeNativeOrdinaryHostSources(sources); throw error; }
        });
    } finally { native.releaseResourcePort(port); }
}
