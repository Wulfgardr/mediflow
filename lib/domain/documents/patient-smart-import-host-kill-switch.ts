/* @Codex */
import 'server-only';
import {
    isAiSmartImportEnabledValue,
} from '@/lib/ai-smart-import-kill-switch';

type HostKillSwitchSettingReader = () => Promise<unknown>;

export type PatientSmartImportHostKillSwitchResult =
    | Readonly<{ status: 'enabled' }>
    | Readonly<{ status: 'denied'; code: 'disabled' | 'unavailable' }>;

const ENABLED = Object.freeze({ status: 'enabled' as const });
const DISABLED = Object.freeze({ status: 'denied' as const, code: 'disabled' as const });
const UNAVAILABLE = Object.freeze({ status: 'denied' as const, code: 'unavailable' as const });

export function createPatientSmartImportHostKillSwitch(options: Readonly<{
    readSetting: HostKillSwitchSettingReader;
}>) {
    const { readSetting } = options;

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
