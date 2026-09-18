/* @Codex — thin native ingress. No DB, prompt construction, grants or clinical writes. */
import 'server-only';
import { requirePairedNativeSession } from '../security/paired-native-session';
import * as native from '../security/native-inference-lifecycle';
import { readBoundedJsonBody } from '../bounded-request-body';
import { parseOrdinaryCommand } from './ordinary-http';
import { ordinaryFunctionCommand, ordinaryFailure } from './ordinary-flow';
import { parseNativeOrdinaryPreparation } from './native-ordinary-wire';
import { prepareNativeOrdinary } from './native-ordinary-composition';
import { ProductError } from './product-contract';
export const NATIVE_ORDINARY_NAMESPACE = '/api/v1/network/ai/chatgpt/ordinary/';
export type NativeOrdinaryOperation = 'prepare' | 'status' | 'consent' | 'login/start' | 'login/complete' | 'models' | 'generate' | 'cancel';
export async function handleNativeOrdinaryHttp(request: Request, operation: NativeOrdinaryOperation): Promise<Response> {
    let port: native.NativeInferencePort | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const url = new URL(request.url);
        if (url.pathname !== NATIVE_ORDINARY_NAMESPACE + operation || url.search
            || request.method !== (operation === 'status' ? 'GET' : 'POST')) throw new ProductError('invalid_request');
        // Genuine issuer before any body read, attempt lookup or patient context read.
        const session = await requirePairedNativeSession(request);
        if (!session || !(port = native.mintResourcePort(session))) throw new ProductError('session_expired');
        if (request.signal.aborted) throw new ProductError('revoked');
        let body: Record<string, unknown> = {};
        let preparation: ReturnType<typeof parseNativeOrdinaryPreparation> | null = null;
        if (operation !== 'status') {
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
            const response = operation === 'prepare'
                ? await prepareNativeOrdinary(request, session, preparation!)
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
