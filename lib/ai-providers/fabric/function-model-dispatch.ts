/* @Codex */
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { FunctionModelError, parseFunctionModelChoice, resolveFunctionModelDispatch,
    type FunctionModelId, type FunctionModelSources } from './function-model-preferences';
import type { LocalProviderResolution } from '../registry';

export const FUNCTION_MODEL_CHOICE_HEADER = 'x-mediflow-function-model';
type Selection = ReturnType<typeof resolveFunctionModelDispatch>;
type Scope = Readonly<{ selection: Selection; verify(): Promise<void> }>;
const scopes = new AsyncLocalStorage<Scope>();
export function functionModelErrorResponse(error: unknown): Response {
    const code = error instanceof FunctionModelError ? error.code : 'unavailable';
    const status = code === 'session_stale' ? 401 : ['input_invalid', 'unsupported', 'model_not_cataloged'].includes(code) ? 400
        : ['catalog_stale', 'revision_conflict', 'command_conflict', 'binding_stale'].includes(code) ? 409
            : code === 'function_disabled' ? 403 : 503;
    return Response.json({ error: 'La richiesta richiede una nuova verifica delle impostazioni.', code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Host-only decorator; only the four named preview routes may introduce a scope. */
export function createFunctionModelDispatch(dependencies: Readonly<{
    authenticate(): Promise<string | null>; readSources(): FunctionModelSources;
}>) {
    return (id: FunctionModelId, handler: (request: Request) => Promise<Response>) => async (request: Request): Promise<Response> => {
        let active = true;
        try {
            const session = await dependencies.authenticate();
            if (!session || request.signal.aborted) throw new FunctionModelError('session_stale');
            // A UI query is never admission or model configuration.
            if (new URL(request.url).search !== '') throw new FunctionModelError('input_invalid');
            const raw = request.headers.get(FUNCTION_MODEL_CHOICE_HEADER);
            let choice: ReturnType<typeof parseFunctionModelChoice> | undefined;
            if (raw !== null) {
                if (raw.length > 512) throw new FunctionModelError('input_invalid');
                try { choice = parseFunctionModelChoice(JSON.parse(raw)); }
                catch { throw new FunctionModelError('input_invalid'); }
            }
            const selection = resolveFunctionModelDispatch(dependencies.readSources(), id, choice);
            const verify = async () => {
                if (!active || request.signal.aborted) throw new FunctionModelError('session_stale');
                const currentSession = await dependencies.authenticate();
                // Authentication may yield while the request is cancelled or its
                // response closes. A captured guard cannot outlive that preview.
                if (!active || request.signal.aborted || currentSession !== session) throw new FunctionModelError('session_stale');
                const current = resolveFunctionModelDispatch(dependencies.readSources(), id, choice);
                if (current.catalogRevision !== selection.catalogRevision || current.preferenceRevision !== selection.preferenceRevision
                    || current.binding.modelOptionId !== selection.binding.modelOptionId) throw new FunctionModelError('binding_stale');
            };
            return await scopes.run(Object.freeze({ selection, verify }), async () => {
                await verify(); const response = await handler(request); await verify();
                // Selection evidence contains no endpoints, session/patient identifiers or authority.
                response.headers.set('Cache-Control', 'no-store');
                response.headers.set('x-mediflow-model-option', selection.binding.modelOptionId);
                response.headers.set('x-mediflow-model-source', selection.source);
                response.headers.set('x-mediflow-catalog-revision', selection.catalogRevision);
                return response;
            });
        } catch (error) { return functionModelErrorResponse(error); }
        finally { active = false; }
    };
}

/** Projects the sealed request choice into the existing host binding reader. */
export async function functionModelBindingSettings<T extends Readonly<Record<string, string | undefined>>>(settings: T, role: 'clinical' | 'reasoning'): Promise<T> {
    const scope = scopes.getStore(); if (!scope) return settings;
    await scope.verify();
    const { functionId, binding } = scope.selection;
    if (binding.provider !== 'ollama' || (role === 'reasoning' ? functionId !== 'document_synthesis'
        : !['patient_insight', 'smart_import'].includes(functionId))) throw new FunctionModelError('unsupported');
    return Object.freeze({ ...settings, [`aiModel_${role}`]: binding.model }) as T;
}

/** Captures the scope at binding time, so detached work cannot shed its checks. */
export function captureFunctionModelTransportGuard(provider: 'ollama' | 'athena_mlx', model?: string, endpoint?: string) {
    const scope = scopes.getStore();
    return async () => {
        if (!scope) return;
        await scope.verify();
        const binding = scope.selection.binding;
        if (binding.provider !== provider || (provider === 'ollama' && (binding.model !== model || binding.endpoint !== endpoint))) {
            throw new FunctionModelError('binding_stale');
        }
    };
}
export function guardFunctionModelResolution(resolution: LocalProviderResolution): LocalProviderResolution {
    if (!scopes.getStore()) return resolution;
    const raw = resolution.adapter;
    const verify = captureFunctionModelTransportGuard('ollama', raw.getModel(), raw.getBaseUrl());
    return Object.freeze({ ...resolution, adapter: Object.freeze({ id: raw.id, kind: raw.kind, capabilities: raw.capabilities,
        getModel: () => raw.getModel(), getBaseUrl: () => raw.getBaseUrl(), listModels: () => raw.listModels(),
        async chat(...args: Parameters<typeof raw.chat>) {
            await verify(); const result = await raw.chat(...args); await verify(); return result;
        },
    }) });
}
