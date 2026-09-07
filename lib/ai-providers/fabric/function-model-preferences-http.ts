/* @Codex */
import { FunctionModelError, functionModelDigest } from './function-model-preferences';
import { functionModelErrorResponse } from './function-model-dispatch';
import type { createFunctionModelPreferencesService } from './function-model-preferences';

export function createFunctionModelPreferencesHttp(dependencies: Readonly<{ authenticate(): Promise<unknown>;
    service: ReturnType<typeof createFunctionModelPreferencesService> }>) {
    const handle = (action: 'read' | 'preview' | 'apply') => async (request: Request): Promise<Response> => {
        try {
            const session = await dependencies.authenticate();
            if (!session || request.signal.aborted) throw new FunctionModelError('session_stale');
            if (new URL(request.url).search !== '') throw new FunctionModelError('input_invalid');
            let value: unknown;
            if (action !== 'read') {
                if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new FunctionModelError('input_invalid');
                if (!request.body) throw new FunctionModelError('input_invalid');
                const reader = request.body.getReader(); let text = ''; let size = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
                try { while (true) {
                    const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
                    if (size > 4096) { await reader.cancel(); throw new FunctionModelError('input_invalid'); }
                    text += decoder.decode(part.value, { stream: true });
                } text += decoder.decode(); value = JSON.parse(text);
                } catch { throw new FunctionModelError('input_invalid'); } finally { reader.releaseLock(); }
                // Body arrival may race lock/revocation; authenticate immediately before mutation.
                const currentSession = await dependencies.authenticate();
                if (!currentSession || request.signal.aborted || functionModelDigest(currentSession) !== functionModelDigest(session)) throw new FunctionModelError('session_stale');
            }
            const result = action === 'read' ? dependencies.service.read() : action === 'preview'
                ? dependencies.service.preview(value) : dependencies.service.apply(value);
            return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
        } catch (error) { return functionModelErrorResponse(error); }
    };
    return Object.freeze({ GET: handle('read'), POST: handle('apply'), PREVIEW: handle('preview') });
}
