import 'server-only';
import { requirePairedNativeSession } from '../security/paired-native-session';
import * as native from '../security/native-inference-lifecycle';
import { readBoundedJsonBody } from '../bounded-request-body';
import { parseNativeOrdinaryPreparation } from './native-ordinary-wire';
import { prepareNativeFabric, projectNativeFabric, nativeFabricExecution } from './native-ordinary-composition';
import { ProductError } from './product-contract';
import { FunctionModelError, functionModelRecord } from '../ai-providers/fabric/function-model-preferences';
import { functionModelErrorResponse } from '../ai-providers/fabric/function-model-dispatch';
import { cancelNativeOrdinaryProjection } from '../security/server-session-clinical-context-native-sources';
import { NATIVE_PROJECTION_HEADER } from './native-ordinary-projection-wire';
import { hasEmptyAttachmentExtractionBody } from '../domain/documents/attachment-extraction-projection-transport';
export const NATIVE_FABRIC_NAMESPACE = '/api/v1/network/ai/fabric/';
type Operation = 'prepare' | 'project' | 'generate' | 'cancel' | 'status';
function attempt(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) throw new ProductError('invalid_request');
    return value;
}
export async function handleNativeFabricHttp(request: Request, operation: Operation): Promise<Response> {
    let port: native.NativeInferencePort | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const url = new URL(request.url);
        if (url.pathname !== NATIVE_FABRIC_NAMESPACE + operation || url.search
            || !(operation === 'project' ? ['POST', 'DELETE'] : [operation === 'status' ? 'GET' : 'POST']).includes(request.method)
            || request.headers.has('x-mediflow-function-model')) throw new ProductError('invalid_request');
        const session = await requirePairedNativeSession(request);
        if (!session || !(port = native.mintResourcePort(session))) throw new ProductError('session_expired');
        if (request.signal.aborted) throw new ProductError('revoked');
        let preparation: ReturnType<typeof parseNativeOrdinaryPreparation> | undefined;
        let id: string | undefined;
        if (!['project', 'status'].includes(operation)) {
            const timeout = new AbortController(); timer = setTimeout(() => timeout.abort(), 2000);
            const read = await readBoundedJsonBody(request, 4096, 'strict',
                { signal: AbortSignal.any([request.signal, timeout.signal]), deadline: performance.now() + 2000 });
            clearTimeout(timer);
            if (!read.ok || timeout.signal.aborted) throw new ProductError('invalid_request');
            if (operation === 'prepare') preparation = parseNativeOrdinaryPreparation(read.value);
            else id = attempt(functionModelRecord(read.value, ['attemptId']).attemptId);
        }
        const use = native.beginResourceUse(port);
        if (!use) throw new ProductError('session_expired');
        try {
            let response: Response;
            if (operation === 'prepare') response = await prepareNativeFabric(new Request(request.url,
                { method: 'POST', signal: request.signal }), session, preparation!);
            else if (operation === 'project' && request.method === 'POST') response = await projectNativeFabric(request, session);
            else if (operation === 'project') {
                cancelNativeOrdinaryProjection(session, request.headers.get(NATIVE_PROJECTION_HEADER));
                if (!(await hasEmptyAttachmentExtractionBody(request))) throw new ProductError('invalid_request');
                response = Response.json({ schema: 'mediflow.native-fabric.v1', phase: 'closed', cleanupConfirmed: true });
            } else if (operation === 'generate') response = await nativeFabricExecution.generate(request, session, id!);
            else if (operation === 'cancel') response = nativeFabricExecution.cancel(session, id!);
            else {
                if (!(await hasEmptyAttachmentExtractionBody(request))) throw new ProductError('invalid_request');
                const raw = request.headers.get('X-MediFlow-Fabric-Attempt');
                response = nativeFabricExecution.status(session, raw === null ? null : attempt(raw));
            }
            let permitted = false;
            if (!native.withCurrentResourceBinding(use, () => { permitted = !request.signal.aborted; })
                || !permitted || !native.commitResourceUse(use)) throw new ProductError('session_expired');
            response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer');
            return response;
        } finally { native.abortResourceUse(use); }
    } catch (error) {
        if (error instanceof FunctionModelError) return functionModelErrorResponse(error);
        const code = error instanceof ProductError ? error.code : 'unavailable';
        return Response.json({ code, error: 'Funzione locale non disponibile. Nessuna alternativa avviata.' },
            { status: code === 'session_expired' ? 401 : code === 'invalid_request' ? 400 : ['revoked', 'busy', 'invalid_state'].includes(code) ? 409 : 503,
                headers: { 'Cache-Control': 'no-store' } });
    } finally { clearTimeout(timer); if (port) native.releaseResourcePort(port); }
}
