import 'server-only';
import { eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from '../../db-server';
import { settings } from '../../schema';
import { FUNCTION_MODEL_SETTING_KEYS } from './function-model-preferences';
import { FUNCTION_MODEL_CONFIGURATION_GENERATION_KEY, nextFunctionModelConfigurationGeneration } from './function-model-configuration-generation';

/** Called after the settings HTTP owner's authorization, in the same commit as revocation. */
export function writeSettingWithFunctionModelGeneration(key: string, value: string): void {
    if (key === FUNCTION_MODEL_CONFIGURATION_GENERATION_KEY) throw new Error('Host-managed generation');
    runDbServerImmediateTransaction(() => {
        const before = dbServer.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value;
        let next: string | undefined;
        if (before !== value && FUNCTION_MODEL_SETTING_KEYS.includes(key)) {
            const row = dbServer.select({ value: settings.value }).from(settings)
                .where(eq(settings.key, FUNCTION_MODEL_CONFIGURATION_GENERATION_KEY)).get();
            next = nextFunctionModelConfigurationGeneration(row?.value);
        }
        dbServer.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
        if (next !== undefined) dbServer.insert(settings).values({ key: FUNCTION_MODEL_CONFIGURATION_GENERATION_KEY, value: next })
            .onConflictDoUpdate({ target: settings.key, set: { value: next } }).run();
    });
}
