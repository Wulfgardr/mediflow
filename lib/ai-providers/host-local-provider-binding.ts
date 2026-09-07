/* @Codex: web composition; the host CLI reuses the same reader without opening a writer. */
import 'server-only';
import { functionModelBindingSettings, guardFunctionModelResolution } from './fabric/function-model-dispatch';
import { inArray } from 'drizzle-orm';
import { settings } from '@/lib/schema';
import { createLocalProviderBindingReader, HOST_LOCAL_PROVIDER_SETTING_KEYS,
    type HostLocalProviderSettingsSnapshot } from './local-provider-binding-reader';
export type { HostLocalProviderBindingResult, HostLocalProviderBindingDenialCode,
    HostLocalProviderSettingsSnapshot } from './local-provider-binding-reader';

async function readProductionSettings(): Promise<HostLocalProviderSettingsSnapshot> {
    // @Codex: supplying a reader must not initialize the production database.
    const { dbServer } = await import('@/lib/db-server');
    const rows = await dbServer.select({ key: settings.key, value: settings.value }).from(settings)
        .where(inArray(settings.key, [...HOST_LOCAL_PROVIDER_SETTING_KEYS]));
    return functionModelBindingSettings(Object.fromEntries(rows.map(({ key, value }) => [key, value])), 'clinical');
}

export function createHostLocalProviderBindingService(options: Readonly<{
    readSettings?: () => Promise<HostLocalProviderSettingsSnapshot>;
}> = {}) {
    const reader = createLocalProviderBindingReader({ readSettings: options.readSettings ?? readProductionSettings });
    return Object.freeze({ async readClinical() {
        const result = await reader.readClinical();
        return result.status === 'available' ? Object.freeze({ ...result, resolution: guardFunctionModelResolution(result.resolution) }) : result;
    } });
}
