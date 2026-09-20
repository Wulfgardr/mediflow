/* @Codex */
import { ICD11_WHO_BINDING, Icd11WhoServiceError } from './icd11-who-service.ts';
import type { Icd11WhoProductionRuntime } from './icd11-who-production-runtime.ts';
import type { Icd11WhoLocalRuntime } from './icd11-who-local-runtime.ts';
import { parseWhoLocalReadiness } from './icd11-who-local-contract.ts';

type Runtime = Icd11WhoProductionRuntime | Pick<Icd11WhoLocalRuntime, 'readiness' | 'search'>;

const encoder = new TextEncoder();
const READINESS_STATUSES = new Set([
    'disabled',
    'credentials_absent',
    'offline',
    'configured',
    'available',
    'unavailable',
]);

type Dependencies = Readonly<{
    authorize(): Promise<boolean>;
    getRuntime(): Runtime;
}>;

type PublicErrorCode = 'request_invalid' | 'service_unavailable'
    | 'upstream_response_invalid' | 'upstream_timeout';

function json(value: unknown, status: number): Response {
    return Response.json(value, {
        status,
        headers: { 'Cache-Control': 'no-store' },
    });
}

function errorResponse(code: PublicErrorCode, status: number): Response {
    return json(Object.freeze({
        schemaVersion: 'mediflow.reference-data.icd11-error.v1' as const,
        code,
    }), status);
}

function normalizedQuery(parameters: URLSearchParams): string | null {
    const keys = [...parameters.keys()];
    if (keys.length !== 1 || keys[0] !== 'q' || parameters.getAll('q').length !== 1) return null;
    const value = parameters.get('q');
    if (value === null) return null;
    const normalized = value.trim().replace(/\s+/gu, ' ');
    if (!normalized || /[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(normalized)
        || encoder.encode(normalized).byteLength > ICD11_WHO_BINDING.queryMaxBytes) return null;
    return normalized;
}

function mapFailure(error: unknown): Response {
    if (!(error instanceof Icd11WhoServiceError)) return errorResponse('service_unavailable', 503);
    if (error.code === 'input_invalid') return errorResponse('request_invalid', 400);
    if (error.code === 'response_invalid') return errorResponse('upstream_response_invalid', 502);
    if (error.code === 'request_timeout') return errorResponse('upstream_timeout', 504);
    return errorResponse('service_unavailable', 503);
}

function readinessResponse(runtime: Runtime): Response {
    let readiness: ReturnType<Runtime['readiness']>;
    try { readiness = runtime.readiness(); }
    catch { return errorResponse('service_unavailable', 503); }
    if (readiness.schemaVersion === 'mediflow.reference-data.icd11-who-readiness.v2') {
        const parsed = parseWhoLocalReadiness(readiness);
        return parsed ? json(parsed, parsed.status === 'available' ? 200 : 503) : errorResponse('service_unavailable', 503);
    }
    if (readiness.schemaVersion !== 'mediflow.reference-data.icd11-who-readiness.v1'
        || !READINESS_STATUSES.has(readiness.status)
        || readiness.releaseId !== ICD11_WHO_BINDING.releaseId
        || readiness.language !== ICD11_WHO_BINDING.language) {
        return errorResponse('service_unavailable', 503);
    }
    return json(readiness, readiness.status === 'available' ? 200 : 503);
}

export function createIcd11WhoHttpRoute(dependencies: Dependencies) {
    return async (request: Request): Promise<Response> => {
        const authorized = async (): Promise<boolean> => {
            if (request.signal.aborted) return false;
            try {
                const current = await dependencies.authorize();
                return current && !request.signal.aborted;
            } catch { return false; }
        };
        if (!await authorized() || request.signal.aborted) return json({ error: 'Unauthorized' }, 401);

        let url: URL;
        try { url = new URL(request.url); }
        catch { return errorResponse('request_invalid', 400); }

        const isReadinessRequest = [...url.searchParams.keys()].length === 0;
        const query = isReadinessRequest ? null : normalizedQuery(url.searchParams);
        if (!isReadinessRequest && !query) return errorResponse('request_invalid', 400);

        let runtime: Runtime;
        try { runtime = dependencies.getRuntime(); }
        catch { return errorResponse('service_unavailable', 503); }
        if (isReadinessRequest) return readinessResponse(runtime);

        try {
            const result = await runtime.search(query!, request.signal);
            if (!await authorized() || request.signal.aborted) return json({ error: 'Unauthorized' }, 401);
            if ('partial' in result) return json(Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-search-response.v2' as const,
                entries: result.entries, partial: result.partial, receipt: result.receipt,
            }), 200);
            return json(Object.freeze({
                schemaVersion: 'mediflow.reference-data.icd11-search-response.v1' as const,
                entries: result.entries,
                receipt: result.receipt,
            }), 200);
        } catch (error) {
            if (!await authorized() || request.signal.aborted) return json({ error: 'Unauthorized' }, 401);
            return mapFailure(error);
        }
    };
}
