/* @Codex */
import { readBoundedJsonBody } from './bounded-request-body';
import { FunctionModelError, type createFunctionModelPreferencesService } from './ai-providers/fabric/function-model-preferences';
import { NativeConfigurationGrantError } from './native-ai-configuration-grants';

export type NativeConfigurationAuthority = Readonly<{
    identity: string;
    register(dispose: () => void): (() => void) | null;
    runCurrent<T>(operation: () => T): T;
}>;
export function createNativeConfigurationHttp(deps: Readonly<{
    authenticate(request: Request): Promise<NativeConfigurationAuthority | null>;
    service: ReturnType<typeof createFunctionModelPreferencesService>;
}>) {
    const handle = (action: 'read' | 'preview' | 'apply') => async (request: Request): Promise<Response> => {
        const controller = new AbortController(); const abort = () => controller.abort();
        let unregister: (() => void) | null = null;
        const current = () => { if (controller.signal.aborted || request.signal.aborted) throw new FunctionModelError('session_stale'); };
        try {
            const authority = await deps.authenticate(request);
            current();
            if (!authority) throw new FunctionModelError('session_stale');
            unregister = authority.register(abort);
            if (!unregister) throw new FunctionModelError('session_stale');
            request.signal.addEventListener('abort', abort, { once: true });
            if (new URL(request.url).search) throw new FunctionModelError('input_invalid');
            let value: unknown;
            if (action !== 'read') {
                if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new FunctionModelError('input_invalid');
                const deadline = performance.now() + 1000;
                let timedOut = false;
                const timer = setTimeout(() => { timedOut = true; abort(); }, 1000);
                let body;
                try { body = await readBoundedJsonBody(request, 4096, 'strict', { signal: controller.signal, deadline }); }
                finally { clearTimeout(timer); }
                if (timedOut) throw new FunctionModelError('input_invalid');
                current();
                if (!body.ok || performance.now() >= deadline) throw new FunctionModelError('input_invalid');
                value = body.value;
            }
            // Reauthenticate after every asynchronous boundary, including GET.
            const reread = await deps.authenticate(request);
            current();
            if (!reread || reread.identity !== authority.identity) throw new FunctionModelError('session_stale');
            // Production runCurrent holds a DB transaction; it rereads pairing/role,
            // session and the explicit grant synchronously before and after work.
            return authority.runCurrent(() => {
                current();
                const result = action === 'read' ? deps.service.read() : action === 'preview'
                    ? deps.service.preview(value) : deps.service.apply(value);
                current();
                return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
            });
        } catch (error) {
            const code = error instanceof NativeConfigurationGrantError ? 'configuration_grant_denied'
                : error instanceof FunctionModelError ? error.code : 'unavailable';
            const status = code === 'session_stale' ? 401 : code === 'configuration_grant_denied' ? 403
                : ['input_invalid', 'unsupported', 'model_not_cataloged'].includes(code) ? 400
                    : ['catalog_stale', 'revision_conflict', 'command_conflict', 'binding_stale'].includes(code) ? 409 : 503;
            return Response.json({ error: 'Rileggi la configurazione e verifica l’accesso sull’host.', code },
                { status, headers: { 'Cache-Control': 'no-store' } });
        } finally { unregister?.(); request.signal.removeEventListener('abort', abort); }
    };
    return Object.freeze({ GET: handle('read'), POST: handle('apply'), PREVIEW: handle('preview') });
}
