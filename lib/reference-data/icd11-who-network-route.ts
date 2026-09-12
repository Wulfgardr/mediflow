/* @Codex: WUL-673. Pure paired delivery fence; production supplies canonical authority. */
import type { NetworkWriteContext } from '../network-write-context';
import type { Icd11WhoLocalRuntime } from './icd11-who-local-runtime';
import { ICD11_WHO_BINDING, Icd11WhoServiceError } from './icd11-who-service';
import { parseWhoLocalReadiness, parseWhoLocalSearchResponse } from './icd11-who-local-contract';
import { isWhoCheckCode, parseWhoCodeCheckResult } from './icd11-who-code-check-contract';

type Context = Pick<NetworkWriteContext, 'session' | 'pairedClient' | 'scopeAmbulatoryId'>;
type Resolution = { ok: true; context: Context } | { ok: false; response: Response };
export type WhoNetworkOperation = 'readiness' | 'search' | 'code-check';
type Dependencies = Readonly<{
    resolveContext(request: Request): Promise<Resolution>;
    isSessionCurrent(context: Context): boolean;
    getRuntime(): Pick<Icd11WhoLocalRuntime, 'readiness' | 'search' | 'checkCode'>;
}>;
type ErrorCode = 'request_invalid' | 'release_not_supported' | 'service_unavailable'
    | 'upstream_response_invalid' | 'upstream_timeout';
const encoder = new TextEncoder();
const noStore = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: noStore });
const denied = () => json({ error: 'Unauthorized' }, 401);
const failure = (code: ErrorCode, status: number) => json({
    schemaVersion: 'mediflow.reference-data.icd11-error.v1', code,
}, status);

// Snapshot scalars as well as object identity: an in-place role/binding change is
// not allowed to make the old authority appear current. Never serialize this.
function identity(context: Context) {
    return Object.freeze({
        session: context.session,
        sessionId: context.session.id, userId: context.session.userId,
        username: context.session.username, role: context.session.role,
        authChannel: context.session.authChannel,
        clientId: context.pairedClient.clientId, tokenHash: context.pairedClient.tokenHash,
        clientPlatform: context.pairedClient.clientPlatform, scope: context.scopeAmbulatoryId,
    });
}
type Identity = ReturnType<typeof identity>;
function sameIdentity(original: Identity, context: Context): boolean {
    const next = identity(context);
    return (Object.keys(original) as (keyof Identity)[]).every(key => original[key] === next[key]);
}
function normalizedQuery(parameters: URLSearchParams): string | null {
    const keys = [...parameters.keys()];
    if (keys.length !== 1 || keys[0] !== 'q') return null;
    const value = parameters.get('q')!.trim().replace(/\s+/gu, ' ');
    return value && !/[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(value)
        && encoder.encode(value).byteLength <= ICD11_WHO_BINDING.queryMaxBytes ? value : null;
}
function mapFailure(error: unknown): Response {
    if (error instanceof Icd11WhoServiceError) {
        if (error.code === 'input_invalid') return failure('request_invalid', 400);
        if (error.code === 'response_invalid') return failure('upstream_response_invalid', 502);
        if (error.code === 'request_timeout') return failure('upstream_timeout', 504);
    }
    // A 503 is deliberately not described as an oversized response.
    return failure('service_unavailable', 503);
}
function safeAuthResponse(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
}

export function createIcd11WhoNetworkRoute(operation: WhoNetworkOperation, dependencies: Dependencies) {
    return async (request: Request): Promise<Response> => {
        if (request.signal.aborted) return denied();
        let initial: Resolution;
        try { initial = await dependencies.resolveContext(request); }
        catch { return denied(); }
        if (request.signal.aborted) return denied();
        if (!initial.ok) return safeAuthResponse(initial.response);
        const context = initial.context;
        const binding = identity(context);
        const sessionCurrent = () => {
            try {
                return !request.signal.aborted && sameIdentity(binding, context)
                    && dependencies.isSessionCurrent(context);
            } catch { return false; }
        };
        if (!sessionCurrent()) return denied();
        const recheck = async (): Promise<Response | null> => {
            if (!sessionCurrent()) return denied();
            let next: Resolution;
            try { next = await dependencies.resolveContext(request); }
            catch { return denied(); }
            if (!sessionCurrent()) return denied();
            if (!next.ok) return safeAuthResponse(next.response);
            try {
                return sameIdentity(binding, next.context) && dependencies.isSessionCurrent(next.context)
                    ? null : denied();
            } catch { return denied(); }
        };

        if (request.method !== 'GET') return failure('request_invalid', 405);
        let parameters: URLSearchParams;
        try { parameters = new URL(request.url).searchParams; }
        catch { return failure('request_invalid', 400); }
        let query: string | null = null;
        let code: string | null = null;
        const keys = [...parameters.keys()];
        if (operation === 'search') {
            query = normalizedQuery(parameters);
            if (!query) return failure('request_invalid', 400);
        } else if (operation === 'code-check') {
            code = parameters.get('code');
            if (keys.length !== 2 || !keys.includes('code') || !keys.includes('release') || !isWhoCheckCode(code)) {
                return failure('request_invalid', 400);
            }
            if (parameters.get('release') !== ICD11_WHO_BINDING.releaseId) return failure('release_not_supported', 409);
        } else if (keys.length !== 0) return failure('request_invalid', 400);

        // Recheck even before service admission: context resolution itself awaits.
        const before = await recheck();
        if (before || !sessionCurrent()) return before ?? denied();
        try {
            const runtime = dependencies.getRuntime();
            let body: unknown;
            let status = 200;
            if (operation === 'readiness') {
                const result = parseWhoLocalReadiness(runtime.readiness());
                if (!result) throw new Icd11WhoServiceError('response_invalid');
                body = result; status = result.status === 'available' ? 200 : 503;
            } else if (operation === 'search') {
                const result = await runtime.search(query!, request.signal);
                const parsed = parseWhoLocalSearchResponse({
                    schemaVersion: 'mediflow.reference-data.icd11-search-response.v2', ...result,
                });
                if (!parsed) throw new Icd11WhoServiceError('response_invalid');
                body = { schemaVersion: 'mediflow.reference-data.icd11-search-response.v2', ...parsed };
            } else {
                const result = await runtime.checkCode(code!, request.signal);
                const parsed = parseWhoCodeCheckResult(result, code!);
                if (!parsed) throw new Icd11WhoServiceError('response_invalid');
                body = parsed;
            }
            const after = await recheck();
            if (after || !sessionCurrent()) return after ?? denied();
            // Bound the paired projection too, without changing the canonical raw cap.
            const serialized = JSON.stringify(body);
            if (encoder.encode(serialized).byteLength > ICD11_WHO_BINDING.maxResponseBytes) {
                return failure('upstream_response_invalid', 502);
            }
            return new Response(serialized, { status, headers: noStore });
        } catch (error) {
            const after = await recheck();
            if (after || !sessionCurrent()) return after ?? denied();
            return mapFailure(error);
        }
    };
}
