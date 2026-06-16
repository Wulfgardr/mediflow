/* @Codex */
export const AI_PATIENT_INSIGHT_KILL_SWITCH_KEY = 'aiPatientInsightKillSwitch';

export type AiPatientInsightKillSwitchState = 'enabled' | 'disabled';

export class AiPatientInsightDisabledError extends Error {
    constructor() {
        super('AI Patient Insight is disabled by the local rollout kill switch.');
        this.name = 'AiPatientInsightDisabledError';
    }
}

export function resolveAiPatientInsightKillSwitchState(value: unknown): AiPatientInsightKillSwitchState {
    if (value === 'enabled' || value === true || value === 'true' || value === 1 || value === '1') {
        return 'enabled';
    }

    return 'disabled';
}

export function isAiPatientInsightEnabledValue(value: unknown): boolean {
    return resolveAiPatientInsightKillSwitchState(value) === 'enabled';
}

export function serializeAiPatientInsightKillSwitchState(enabled: boolean): AiPatientInsightKillSwitchState {
    return enabled ? 'enabled' : 'disabled';
}

export function assertAiPatientInsightEnabledValue(value: unknown): void {
    if (!isAiPatientInsightEnabledValue(value)) {
        throw new AiPatientInsightDisabledError();
    }
}
