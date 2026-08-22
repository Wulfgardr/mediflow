/* @Codex */
import 'server-only';
import { eq } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import {
    AI_SMART_IMPORT_KILL_SWITCH_KEY,
    isAiSmartImportEnabledValue,
} from '@/lib/ai-smart-import-kill-switch';
import { settings } from '@/lib/schema';

type HostKillSwitchSettingReader = () => Promise<unknown>;

export type PatientSmartImportHostKillSwitchResult =
    | Readonly<{ status: 'enabled' }>
    | Readonly<{ status: 'denied'; code: 'disabled' | 'unavailable' }>;

async function readProductionSetting(): Promise<unknown> {
    const row = await dbServer
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, AI_SMART_IMPORT_KILL_SWITCH_KEY))
        .get();

    return row?.value;
}

const ENABLED = Object.freeze({ status: 'enabled' as const });
const DISABLED = Object.freeze({ status: 'denied' as const, code: 'disabled' as const });
const UNAVAILABLE = Object.freeze({ status: 'denied' as const, code: 'unavailable' as const });

export function createPatientSmartImportHostKillSwitch(options: Readonly<{
    readSetting?: HostKillSwitchSettingReader;
}> = {}) {
    const readSetting = options.readSetting ?? readProductionSetting;

    return Object.freeze({
        async read(): Promise<PatientSmartImportHostKillSwitchResult> {
            let value: unknown;
            try {
                value = await readSetting();
            } catch {
                return UNAVAILABLE;
            }

            return isAiSmartImportEnabledValue(value) ? ENABLED : DISABLED;
        },
    });
}
