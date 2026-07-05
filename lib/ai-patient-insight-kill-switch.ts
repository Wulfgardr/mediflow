/* @Codex */
import {
    assertAiLaneEnabledValue,
    isAiLaneEnabledValue,
    resolveAiLaneKillSwitchState,
    serializeAiLaneKillSwitchState,
    type AiLaneKillSwitchState,
} from './ai-lane-kill-switch';

export const AI_PATIENT_INSIGHT_KILL_SWITCH_KEY = 'aiPatientInsightKillSwitch';

export type AiPatientInsightKillSwitchState = AiLaneKillSwitchState;

export class AiPatientInsightDisabledError extends Error {
    constructor() {
        super('AI Patient Insight is disabled by the local rollout kill switch.');
        this.name = 'AiPatientInsightDisabledError';
    }
}

export function resolveAiPatientInsightKillSwitchState(value: unknown): AiPatientInsightKillSwitchState {
    return resolveAiLaneKillSwitchState(value);
}

export function isAiPatientInsightEnabledValue(value: unknown): boolean {
    return isAiLaneEnabledValue(value);
}

export function serializeAiPatientInsightKillSwitchState(enabled: boolean): AiPatientInsightKillSwitchState {
    return serializeAiLaneKillSwitchState(enabled);
}

export function assertAiPatientInsightEnabledValue(value: unknown): void {
    assertAiLaneEnabledValue(value, () => new AiPatientInsightDisabledError());
}
