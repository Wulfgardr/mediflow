import 'server-only';
import { requirePairedNativeSession } from '../security/paired-native-session';
import * as native from '../security/native-inference-lifecycle';
import { readBoundedJsonBody } from '../bounded-request-body';
import { FunctionModelError, functionModelRecord } from '../ai-providers/fabric/function-model-preferences';
import { ProductError } from './product-contract';

export async function handleNativeAuthorityRetirementHttp(request: Request): Promise<Response> {
    let port: native.NativeInferencePort | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const url = new URL(request.url);
        if (request.method !== 'POST' || url.pathname !== '/api/v1/network/ai/authority-retirement' || url.search)
            throw new ProductError('invalid_request');
        const session = await requirePairedNativeSession(request);
        if (!session || !(port = native.mintResourcePort(session))) throw new ProductError('session_expired');
        const abort = new AbortController(); timer = setTimeout(() => abort.abort(), 2000);
        const read = await readBoundedJsonBody(request, 256, 'strict',
            { signal: AbortSignal.any([request.signal, abort.signal]), deadline: performance.now() + 2000 });
        clearTimeout(timer);
        if (!read.ok || abort.signal.aborted || request.signal.aborted) throw new ProductError('invalid_request');
        const { previousAuthorityRef } = functionModelRecord(read.value, ['previousAuthorityRef']);
        if (typeof previousAuthorityRef !== 'string' || !/^[a-f0-9]{64}$/u.test(previousAuthorityRef))
            throw new ProductError('invalid_request');
        const use = native.beginResourceUse(port);
        if (!use) throw new ProductError('session_expired');
        try {
            const receipt = native.verifyPreviousAuthorityRetirement(use, previousAuthorityRef);
            if (!receipt) throw new ProductError('invalid_state');
            if (request.signal.aborted || !native.commitResourceUse(use)) throw new ProductError('session_expired');
            return Response.json(receipt, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
        } finally { native.abortResourceUse(use); }
    } catch (error) {
        const code = error instanceof FunctionModelError ? 'invalid_request' : error instanceof ProductError ? error.code : 'unavailable';
        return Response.json({ code }, { status: code === 'session_expired' ? 401 : code === 'invalid_request' ? 400 : code === 'invalid_state' ? 409 : 503,
            headers: { 'Cache-Control': 'no-store' } });
    } finally { clearTimeout(timer); if (port) native.releaseResourcePort(port); }
}
