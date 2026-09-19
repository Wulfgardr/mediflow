/* @Codex — thin native ingress. No DB, prompt construction, grants or clinical writes. */
import 'server-only';
import { requirePairedNativeSession } from '../security/paired-native-session';
import * as native from '../security/native-inference-lifecycle';
import { readBoundedJsonBody } from '../bounded-request-body';
import { parseOrdinaryCommand } from './ordinary-http';
import { ordinaryFunctionCommand, ordinaryFailure, cancelNativeOrdinaryProjectionAttempt } from './ordinary-flow';
import { parseNativeOrdinaryPreparation } from './native-ordinary-wire';
import { prepareNativeOrdinary, projectNativeOrdinary } from './native-ordinary-composition';
import { ProductError } from './product-contract';
import { cancelNativeOrdinaryProjection } from '../security/server-session-clinical-context-native-sources';
import { NATIVE_PROJECTION_HEADER } from './native-ordinary-projection-wire';
import { hasEmptyAttachmentExtractionBody } from '../domain/documents/attachment-extraction-projection-transport';
export const NATIVE_ORDINARY_NAMESPACE = '/api/v1/network/ai/chatgpt/ordinary/';
export type NativeOrdinaryOperation = 'prepare' | 'project' | 'status' | 'consent' | 'login/start' | 'login/complete' | 'models' | 'generate' | 'cancel';
export async function handleNativeOrdinaryHttp(request: Request, operation: NativeOrdinaryOperation): Promise<Response> {
    let port: native.NativeInferencePort | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const url = new URL(request.url);
        if (url.pathname !== NATIVE_ORDINARY_NAMESPACE + operation || url.search
            || !(operation === 'project' ? ['POST', 'DELETE'] : [operation === 'status' ? 'GET' : 'POST']).includes(request.method)) throw new ProductError('invalid_request');
        // Genuine issuer before any body read, attempt lookup or patient context read.
        const session = await requirePairedNativeSession(request);
        if (!session || !(port = native.mintResourcePort(session))) throw new ProductError('session_expired');
        if (request.signal.aborted) throw new ProductError('revoked');
        let body: Record<string, unknown> = {};
        let preparation: ReturnType<typeof parseNativeOrdinaryPreparation> | null = null;
        if (operation !== 'status' && operation !== 'project') {
            const abort = new AbortController(); timer = setTimeout(() => abort.abort(), 2000);
            const read = await readBoundedJsonBody(request, 4096, 'strict',
                { signal: AbortSignal.any([request.signal, abort.signal]), deadline: performance.now() + 2000 });
            clearTimeout(timer);
            if (!read.ok || abort.signal.aborted) throw new ProductError('invalid_request');
            if (operation === 'prepare') preparation = parseNativeOrdinaryPreparation(read.value);
            else body = parseOrdinaryCommand(operation, read.value);
        }
        const use = native.beginResourceUse(port);
        if (!use) throw new ProductError('session_expired');
        try {
            // `readBoundedJsonBody` has consumed the ingress stream. The fixed
            // composition only needs request identity (URL, method, headers and
            // abort signal), so never pass the disturbed body into its owned
            // Request constructor.
            const preparationRequest = operation === 'prepare'
                ? new Request(request.url, { method: request.method, headers: request.headers, signal: request.signal })
                : null;
            let response: Response;
            if (operation === 'project') {
                if (request.method === 'DELETE') {
                    const grantId = request.headers.get(NATIVE_PROJECTION_HEADER);
                    cancelNativeOrdinaryProjection(session, grantId);
                    const cleanupConfirmed = await cancelNativeOrdinaryProjectionAttempt(session, grantId);
                    if (!(await hasEmptyAttachmentExtractionBody(request))) throw new ProductError('invalid_request');
                    response = Response.json({ schema: 'mediflow.chatgpt-ordinary-flow.v1', phase: 'closed', attemptId: null, cleanupConfirmed });
                } else response = await projectNativeOrdinary(request, session);
            } else response = operation === 'prepare'
                ? await prepareNativeOrdinary(preparationRequest!, session, preparation!)
                : await ordinaryFunctionCommand(session, operation, body, request.signal);
            let permitted = false;
            if (!native.withCurrentResourceBinding(use, () => { permitted = !request.signal.aborted; })
                || !permitted || !native.commitResourceUse(use)) throw new ProductError('session_expired');
            response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer');
            return response;
        } finally { native.abortResourceUse(use); }
    } catch (error) { return ordinaryFailure(error); }
    finally { clearTimeout(timer); if (port) native.releaseResourcePort(port); }
}
