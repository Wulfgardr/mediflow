/* @Codex */
import 'server-only';
import { readBoundedJsonBody } from '../bounded-request-body';
import { isTrustedWebMutationRequest } from '../security/request-transport';
import { ExecutionError } from '../chatgpt-execution/execution-contract';
import { PRODUCT_MUTATIONS, PRODUCT_NAMESPACE, ProductError, parseProductRequest, type ProductCode, type ProductOperation, type ProductRequest } from './product-contract';
import type { ProductSessionHandle } from './product-session';
const headers = Object.freeze({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
function deny(code: ProductCode, status: number) { return Response.json({ error: code, clinicalAdmission: 'held' }, { status, headers }); }
export function createProductHttp(sources: { acquire(request: Request): Promise<ProductSessionHandle | null> }) {
    return async (request: Request, operation: ProductOperation): Promise<Response> => {
        let bodyTimeout: ReturnType<typeof setTimeout> | undefined;
        let acquireTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const url = new URL(request.url);
            if (operation !== 'status' && !(PRODUCT_MUTATIONS as readonly string[]).includes(operation)) return deny('invalid_request', 400);
            if (url.pathname !== PRODUCT_NAMESPACE + operation || url.search) return deny('invalid_request', 400);
            if (request.method !== (operation === 'status' ? 'GET' : 'POST')) return deny('method_not_allowed', 405);
            if (operation !== 'status' && !isTrustedWebMutationRequest(request)) return deny('forbidden', 403);
            if (request.signal.aborted) return deny('session_expired', 401);
            const session = await Promise.race([
                sources.acquire(request),
                new Promise<never>((_, reject) => { acquireTimeout = setTimeout(() => reject(new ProductError('timeout')), 3000); }),
            ]);
            clearTimeout(acquireTimeout);
            if (!session) return deny('unauthorized', 401);
            if (!session.current() || request.signal.aborted) return deny('session_expired', 401);
            const bodyAbort = new AbortController();
            const signal = AbortSignal.any([request.signal, session.signal, bodyAbort.signal]);
            let payload: ProductRequest = {};
            // consent/generate require fields and are parsed after the bounded read.
            if (operation !== 'status') {
                bodyTimeout = setTimeout(() => bodyAbort.abort(), 1000);
                const body = await readBoundedJsonBody(request, 1024, 'strict', { signal, deadline: performance.now() + 1000 });
                clearTimeout(bodyTimeout);
                if (!session.current() || request.signal.aborted || session.signal.aborted) return deny('session_expired', 401);
                if (!body.ok || bodyAbort.signal.aborted) return deny('invalid_request', 400);
                payload = parseProductRequest(operation, body.value);
            }
            if (!session.current()) return deny('session_expired', 401);
            return await session.respond(operation, payload, result => Response.json(result, { headers }), request.signal);
        } catch (error) {
            const code = error instanceof ProductError || error instanceof ExecutionError ? error.code : 'protocol_error';
            return deny(code, ['session_expired', 'revoked', 'unauthorized'].includes(code) ? 401
                : code === 'invalid_request' ? 400 : ['busy', 'invalid_state', 'consent_required', 'consent_stale', 'catalog_stale', 'login_pending', 'canceled'].includes(code) ? 409
                    : code === 'timeout' ? 504 : 503);
        } finally { clearTimeout(bodyTimeout); clearTimeout(acquireTimeout); }
    };
}
