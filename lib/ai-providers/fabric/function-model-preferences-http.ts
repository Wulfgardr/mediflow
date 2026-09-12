/* @Codex */
import { readBoundedJsonBody } from '../../bounded-request-body';
import { mintResourcePort, releaseResourcePort, registerPrivateResource, unregisterPrivateResource,
    beginResourceUse, commitResourceUse, abortResourceUse } from '../../security/web-auth-lifecycle-owner-adapter';
import { FunctionModelError, functionModelDigest, FUNCTION_PREFERENCES_VERSION_HEADER, parseFunctionModelCommand } from './function-model-preferences';
import { functionModelErrorResponse } from './function-model-dispatch';
import type { createFunctionModelPreferencesService } from './function-model-preferences';

export const FUNCTION_MODEL_BODY_TIMEOUT_MS = 1000;

export function createFunctionModelPreferencesHttp(dependencies: Readonly<{ authenticate(): Promise<unknown>;
    service: ReturnType<typeof createFunctionModelPreferencesService> }>) {
    const handle = (action: 'read' | 'preview' | 'apply') => async (request: Request): Promise<Response> => {
        let port: ReturnType<typeof mintResourcePort> = null;
        let registration: ReturnType<typeof registerPrivateResource> = null;
        let use: ReturnType<typeof beginResourceUse> = null;
        const controller = new AbortController();
        const abort = () => controller.abort();
        try {
            const session = await dependencies.authenticate();
            if (!session || request.signal.aborted) throw new FunctionModelError('session_stale');
            port = mintResourcePort(session);
            if (!port) throw new FunctionModelError('session_stale');
            registration = registerPrivateResource(port, abort);
            if (!registration) throw new FunctionModelError('session_stale');
            request.signal.addEventListener('abort', abort, { once: true });
            if (new URL(request.url).search !== '') throw new FunctionModelError('input_invalid');
            const requested = request.headers.get(FUNCTION_PREFERENCES_VERSION_HEADER);
            if (requested !== null && requested !== '1' && requested !== '2') throw new FunctionModelError('input_invalid');
            const version = requested === '2' ? 'v2' as const : 'v1' as const;
            let value: unknown;
            if (action !== 'read') {
                if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new FunctionModelError('input_invalid');
                const deadline = performance.now() + FUNCTION_MODEL_BODY_TIMEOUT_MS;
                let timedOut = false;
                const timer = setTimeout(() => { timedOut = true; abort(); }, FUNCTION_MODEL_BODY_TIMEOUT_MS);
                let body;
                try {
                    body = await readBoundedJsonBody(request, 4096, 'strict', { signal: controller.signal, deadline });
                } finally { clearTimeout(timer); }
                if (request.signal.aborted || (controller.signal.aborted && !timedOut)) throw new FunctionModelError('session_stale');
                if (!body.ok || timedOut || performance.now() >= deadline) throw new FunctionModelError('input_invalid');
                const parsed = parseFunctionModelCommand(body.value);
                if (parsed.schemaVersion !== `mediflow.function-preferences-command.${version}`) throw new FunctionModelError('input_invalid');
                value = parsed;
                // Do not replace database-backed authentication with an owner-only check.
                const currentSession = await dependencies.authenticate();
                if (!currentSession || controller.signal.aborted || request.signal.aborted
                    || functionModelDigest(currentSession) !== functionModelDigest(session)) throw new FunctionModelError('session_stale');
            }
            // No await between the owner check, synchronous CAS/read and response construction.
            use = beginResourceUse(port);
            if (!use || controller.signal.aborted || request.signal.aborted) throw new FunctionModelError('session_stale');
            const result = action === 'read' ? dependencies.service.read(version) : action === 'preview'
                ? dependencies.service.preview(value) : dependencies.service.apply(value);
            const response = Response.json(result, { headers: { 'Cache-Control': 'no-store', Vary: FUNCTION_PREFERENCES_VERSION_HEADER, [FUNCTION_PREFERENCES_VERSION_HEADER]: version === 'v2' ? '2' : '1' } });
            if (controller.signal.aborted || request.signal.aborted || !commitResourceUse(use)) throw new FunctionModelError('session_stale');
            use = null;
            return response;
        } catch (error) { return functionModelErrorResponse(error); }
        finally {
            if (use) abortResourceUse(use);
            if (port && registration) unregisterPrivateResource(port, registration);
            if (port) releaseResourcePort(port);
            request.signal.removeEventListener('abort', abort);
        }
    };
    return Object.freeze({ GET: handle('read'), POST: handle('apply'), PREVIEW: handle('preview') });
}
