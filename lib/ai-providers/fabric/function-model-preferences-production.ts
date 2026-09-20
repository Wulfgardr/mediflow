/* @Codex */
import 'server-only';
import { inArray } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from '../../db-server';
import { settings } from '../../schema';
import { defaultAthenaMlxModelDir, isAthenaMlxModelAvailable } from '../../athena-mlx-runtime';
import { requireSession } from '../../security/server-auth';
import { createHostProviderLifecycleService } from './provider-lifecycle-service';
import { createFunctionModelPreferencesService, FUNCTION_MODEL_SETTING_KEYS, FUNCTION_PREFERENCES_KEY, FUNCTION_SWITCH_KEYS, FunctionModelError, functionModelDigest, type FunctionModelSources } from './function-model-preferences';
import { createFunctionModelDispatch } from './function-model-dispatch';
import { createPortableProvisioning } from './treatment-reasoning-portable-provisioning';

// @Codex: launcher-owned root, independent of the Webpack module/asset location.
const portable = createPortableProvisioning({ applicationRoot: process.cwd() });
const ollama = createHostProviderLifecycleService().service;
const athena = createHostProviderLifecycleService({ provider: 'athena_mlx' }).service;
export function readProductionFunctionModelSources(): FunctionModelSources {
    const rows = dbServer.select({ key: settings.key, value: settings.value }).from(settings)
        .where(inArray(settings.key, FUNCTION_MODEL_SETTING_KEYS)).all();
    return { settings: Object.fromEntries(rows.map(row => [row.key, row.value])), ollamaLifecycle: ollama.read(), athenaLifecycle: athena.read(),
        athenaIdentity: functionModelDigest([defaultAthenaMlxModelDir(), process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN ?? null,
            process.env.MEDIFLOW_ATHENA_MLX_LM_PACKAGE ?? null]), athenaAvailable: process.platform === 'darwin' && process.arch === 'arm64' && isAthenaMlxModelAvailable(),
        ...(['win32', 'linux'].includes(process.platform) ? { portable: portable.status() } : {}) };
}
export const functionModelPreferencesService = createFunctionModelPreferencesService({
    readSources: readProductionFunctionModelSources, immediate: runDbServerImmediateTransaction,
    writeSettings(writes) {
        const allowed = [FUNCTION_PREFERENCES_KEY, ...Object.values(FUNCTION_SWITCH_KEYS)];
        if (Object.keys(writes).some(key => !allowed.includes(key))) throw new FunctionModelError('input_invalid');
        for (const [key, value] of Object.entries(writes)) dbServer.insert(settings).values({ key: key, value: value })
            .onConflictDoUpdate({ target: settings.key, set: { value: value } }).run();
    },
});
const withLocalFunctionModelDispatch = createFunctionModelDispatch({ readSources: readProductionFunctionModelSources,
    async authenticate() { const session = await requireSession(); return session ? functionModelDigest(session) : null; },
});

/** Four named routes only. An OpenAI channel choice is NOT a model option or
 * authority: the real catalog becomes available only after owned prepare/login. */
export function withFunctionModelDispatch(id: import('./function-model-preferences').FunctionModelId, handler: (request: Request) => Promise<Response>) {
    const local = withLocalFunctionModelDispatch(id, handler);
    return async (request: Request): Promise<Response> => {
        const raw = request.headers.get('x-mediflow-function-model');
        if (!raw || !raw.includes('mediflow.function-model-chatgpt-choice.v1')) return local(request);
        const { ordinaryFailure, beginOrdinaryFunction } = await import('../../chatgpt-product/ordinary-flow');
        try {
            const { ProductError } = await import('../../chatgpt-product/product-contract');
            const { isTrustedWebMutationRequest } = await import('../../security/request-transport');
            const url = new URL(request.url);
            if (request.method !== 'POST' || url.search || url.pathname !== `/api/ai/${id.replaceAll('_', '-')}/preview`
                || !isTrustedWebMutationRequest(request) || raw.length > 512) throw new ProductError('invalid_request');
            const session = await requireSession();
            const owner = await import('../../security/web-auth-lifecycle-owner-adapter');
            const port = session && owner.mintResourcePort(session);
            if (!session || !port) throw new ProductError('session_expired');
            try {
                const { ordinaryWireObject, ORDINARY_SELECTION_SCHEMA } = await import('../../chatgpt-product/ordinary-wire');
                const choice = ordinaryWireObject(JSON.parse(raw), ['schema', 'expectedPreferenceRevision']);
                if (!choice || choice.schema !== ORDINARY_SELECTION_SCHEMA) throw new ProductError('invalid_request');
                const { readOrdinaryCloudSettings } = await import('../../chatgpt-product/ordinary-settings');
                const settings = await readOrdinaryCloudSettings();
                if (!settings.enabled || settings.revision !== choice.expectedPreferenceRevision) throw new ProductError('consent_stale');
                const use = owner.beginResourceUse(port); if (!use || request.signal.aborted) throw new ProductError('session_expired');
                owner.abortResourceUse(use);
                return await beginOrdinaryFunction(request, id, session, handler);
            } finally { owner.releaseResourcePort(port); }
        } catch (error) { return ordinaryFailure(error); }
    };
}
