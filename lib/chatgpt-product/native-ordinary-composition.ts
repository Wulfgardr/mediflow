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
import { beginOrdinaryFunction } from './ordinary-flow';
import { ordinaryWireObject } from './ordinary-wire';
import type { NativeOrdinaryPreparation } from './native-ordinary-wire';

type Context = AuthenticatedWebSessionProjectionOwnerContext & { session: PairedNativeSession; request: NativeOrdinaryPreparation };
const scope = new AsyncLocalStorage<Context>();
function confirm(context: Context): void {
    const port = native.mintResourcePort(context.session);
    if (!port) throw new ProductError('session_expired');
    try {
        const current = resolveNativeOrdinaryClinicalContext(context.session,
            { patientId: context.request.patientId, ambulatoryId: context.request.ambulatoryId });
        if (current.patientVersion !== context.request.patientRevision
            || !nativeSessionProjectionOwnerRegistry.isAuthenticOwner(context.owner)) throw new ProductError('revoked');
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
    if (prepared.functionId === 'patient_insight') {
        const input = prepared.input as Record<string, unknown>;
        if (input.patientId !== prepared.patientId || input.ambulatoryId !== prepared.ambulatoryId
            || input.patientRevision !== prepared.patientRevision) throw new ProductError('invalid_request');
        const [{ acquireAuthenticatedPatientInsightPreview }, { createPatientInsightPreviewHttpHandler }] = await Promise.all([
            import('../ai-providers/fabric/patient-insight-authenticated-preview-production'),
            import('../ai-providers/fabric/patient-insight-authenticated-preview'),
        ]);
        confirm(context);
        return createPatientInsightPreviewHttpHandler({ acquirePreview: acquireAuthenticatedPatientInsightPreview })(requestFor(request, input));
    }
    // Named selection Application Service, never a route-local DB query or client capability.
    const selection = createAuthenticatedWebSessionSelectionService({ acquireOwner: async () => context.owner });
    const lease = await selection.issue({ expectedEpoch: context.owner.snapshotSelectionEpoch(context.session),
        patientId: prepared.patientId, ambulatoryId: prepared.ambulatoryId });
    confirm(context);
    if (prepared.functionId === 'smart_import') {
        const projection = prepared.input as Record<string, unknown>;
        if (projection.patientRevision !== prepared.patientRevision) throw new ProductError('invalid_request');
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
        if ((prepared.input as Record<string, unknown>).patientRevision !== prepared.patientRevision) throw new ProductError('invalid_request');
        const [{ acquireTreatmentReasoningIngest, acquireTreatmentReasoningPreview }, { createTreatmentReasoningPreviewHttpHandler }] = await Promise.all([
            import('../ai-providers/fabric/treatment-reasoning-production-root'),
            import('../ai-providers/fabric/treatment-reasoning-production-http'),
        ]);
        const operation = await acquireTreatmentReasoningIngest(); confirm(context);
        const handle = operation.ingest({ projection: prepared.input, requestId: requestId() });
        return createTreatmentReasoningPreviewHttpHandler({ acquirePreview: acquireTreatmentReasoningPreview })(
            requestFor(request, { handle, requestId: requestId() }));
    }
    const input = ordinaryWireObject(prepared.input, ['attachmentId']);
    if (!input || typeof input.attachmentId !== 'string' || !input.attachmentId || input.attachmentId.length > 200) throw new ProductError('invalid_request');
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
    const port = native.mintResourcePort(session);
    if (!port) throw new ProductError('session_expired');
    try {
        const owner = nativeSessionProjectionOwnerRegistry.acquire(session);
        const context: Context = Object.freeze({ session, owner, request: input });
        confirm(context);
        return await scope.run(context, () => beginOrdinaryFunction(request, input.functionId, session,
            ownedRequest => originalFunction(ownedRequest, context)));
    } finally { native.releaseResourcePort(port); }
}
