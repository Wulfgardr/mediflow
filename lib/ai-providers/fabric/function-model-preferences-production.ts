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

const ollama = createHostProviderLifecycleService().service;
const athena = createHostProviderLifecycleService({ provider: 'athena_mlx' }).service;
export function readProductionFunctionModelSources(): FunctionModelSources {
    const rows = dbServer.select({ key: settings.key, value: settings.value }).from(settings)
        .where(inArray(settings.key, FUNCTION_MODEL_SETTING_KEYS)).all();
    return { settings: Object.fromEntries(rows.map(row => [row.key, row.value])), ollamaLifecycle: ollama.read(), athenaLifecycle: athena.read(),
        athenaIdentity: functionModelDigest([defaultAthenaMlxModelDir(), process.env.MEDIFLOW_ATHENA_MLX_GENERATE_BIN ?? null,
            process.env.MEDIFLOW_ATHENA_MLX_LM_PACKAGE ?? null]), athenaAvailable: isAthenaMlxModelAvailable() };
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
export const withFunctionModelDispatch = createFunctionModelDispatch({ readSources: readProductionFunctionModelSources,
    async authenticate() { const session = await requireSession(); return session ? functionModelDigest(session) : null; },
});
