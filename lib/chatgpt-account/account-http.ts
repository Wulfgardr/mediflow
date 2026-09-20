/* @Codex */
import 'server-only';
import { isTrustedWebMutationRequest } from '../security/request-transport';
import type { AccountHttpError, AccountOperation } from './account-contract';
import { AccountError } from './account-protocol';
import type { AccountSessionHandle } from './account-session';

type Sources = { acquire(): Promise<AccountSessionHandle | null> };
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
function denied(code: AccountHttpError['error'], status: number): Response {
    const body: AccountHttpError = { error: code, inferenceEnabled: false, executionBlock: 'data_boundary_unqualified' };
    return Response.json(body, { status, headers });
}
async function emptyBody(request: Request): Promise<boolean> {
    const reader = request.body?.getReader();
    if (!reader) return false;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async () => {
                for (;;) {
                    const next = await reader.read();
                    if (next.done) break;
                    bytes += next.value.byteLength;
                    if (bytes > 64) return false;
                    chunks.push(next.value);
                }
                const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                return data !== null && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0;
            })(),
            new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 2000); }),
        ]);
    } catch { return false; }
    finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}
export function createAccountHttp(sources: Sources) {
    return async (request: Request, operation: AccountOperation | 'status'): Promise<Response> => {
        try {
            const session = await sources.acquire();
            if (!session) return denied('unauthorized', 401);
            if (operation === 'status') {
                if (request.method !== 'GET') return denied('method_not_allowed', 405);
            } else {
                if (request.method !== 'POST') return denied('method_not_allowed', 405);
                if (!isTrustedWebMutationRequest(request)) return denied('forbidden', 403);
                if (!await emptyBody(request)) return denied('invalid_request', 400);
            }
            if (new URL(request.url).search) return denied('invalid_request', 400);
            return await session.respond(operation, (result) => Response.json(result, { headers }));
        } catch (error) {
            const code = error instanceof AccountError ? error.code : 'protocol_error';
            return denied(code, code === 'session_expired' ? 401 : code === 'invalid_state' || code === 'busy' ? 409 : code === 'timeout' ? 504 : 503);
        }
    };
}
