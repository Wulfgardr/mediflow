/* @Codex */
export const AI_SMART_IMPORT_KILL_SWITCH_KEY = 'aiSmartImportKillSwitch';

export type AiSmartImportKillSwitchState = 'enabled' | 'disabled';

export class AiSmartImportDisabledError extends Error {
    constructor() {
        super('AI Smart Import is disabled by the local rollout kill switch.');
        this.name = 'AiSmartImportDisabledError';
    }
}

export function resolveAiSmartImportKillSwitchState(value: unknown): AiSmartImportKillSwitchState {
    if (value === 'disabled' || value === false || value === 'false' || value === 0 || value === '0') {
        return 'disabled';
    }

    return 'enabled';
}

export function isAiSmartImportEnabledValue(value: unknown): boolean {
    return resolveAiSmartImportKillSwitchState(value) === 'enabled';
}

export function serializeAiSmartImportKillSwitchState(enabled: boolean): AiSmartImportKillSwitchState {
    return enabled ? 'enabled' : 'disabled';
}

export function assertAiSmartImportEnabledValue(value: unknown): void {
    if (!isAiSmartImportEnabledValue(value)) {
        throw new AiSmartImportDisabledError();
    }
}
