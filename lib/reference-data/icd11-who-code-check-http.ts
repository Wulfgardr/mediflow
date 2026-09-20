/* @Codex */
import { isWhoCheckCode } from './icd11-who-code-check-contract';
import { Icd11WhoServiceError } from './icd11-who-service';
import type { Icd11WhoLocalRuntime } from './icd11-who-local-runtime';

export function createWhoCodeCheckRoute(dependencies: {
    authorize(): Promise<boolean>;
    getRuntime(): Pick<Icd11WhoLocalRuntime, 'checkCode'>;
}) {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    const authorized = async () => { try { return await dependencies.authorize(); } catch { return false; } };
    return async (request: Request): Promise<Response> => {
        if (!await authorized()) return json({ error: 'Unauthorized' }, 401);
        if (request.method !== 'GET') return json({ code: 'request_invalid' }, 405);
        let parameters: URLSearchParams;
        try { parameters = new URL(request.url).searchParams; } catch { return json({ code: 'request_invalid' }, 400); }
        const keys = [...parameters.keys()];
        const code = parameters.get('code'), release = parameters.get('release');
        if (keys.length !== 2 || !keys.includes('code') || !keys.includes('release') || !isWhoCheckCode(code)) return json({ code: 'request_invalid' }, 400);
        if (release !== '2026-01') return json({ code: 'release_not_supported', releaseId: '2026-01' }, 409);
        try {
            const result = await dependencies.getRuntime().checkCode(code, request.signal);
            if (request.signal.aborted || !await authorized()) return json({ error: 'Unauthorized' }, 401);
            return json(result);
        } catch (error) {
            if (!await authorized()) return json({ error: 'Unauthorized' }, 401);
            if (error instanceof Icd11WhoServiceError) {
                if (error.code === 'input_invalid') return json({ code: 'request_invalid' }, 400);
                if (error.code === 'response_invalid') return json({ code: 'upstream_response_invalid' }, 502);
                if (error.code === 'request_timeout') return json({ code: 'upstream_timeout' }, 504);
            }
            return json({ code: 'service_unavailable' }, 503);
        }
    };
}
