/* @Codex */
import {
    assertAiLaneEnabledValue,
    isAiLaneEnabledValue,
    resolveAiLaneKillSwitchState,
    serializeAiLaneKillSwitchState,
    type AiLaneKillSwitchState,
} from './ai-lane-kill-switch';

export const AI_TREATMENT_REASONING_KILL_SWITCH_KEY = 'aiTreatmentReasoningKillSwitch';

export type AiTreatmentReasoningKillSwitchState = AiLaneKillSwitchState;

export class AiTreatmentReasoningDisabledError extends Error {
    constructor() {
        super('AI Treatment Reasoning is disabled by the local rollout kill switch.');
        this.name = 'AiTreatmentReasoningDisabledError';
    }
}

export function resolveAiTreatmentReasoningKillSwitchState(value: unknown): AiTreatmentReasoningKillSwitchState {
    return resolveAiLaneKillSwitchState(value);
}

export function isAiTreatmentReasoningEnabledValue(value: unknown): boolean {
    return isAiLaneEnabledValue(value);
}

export function serializeAiTreatmentReasoningKillSwitchState(enabled: boolean): AiTreatmentReasoningKillSwitchState {
    return serializeAiLaneKillSwitchState(enabled);
}

export function assertAiTreatmentReasoningEnabledValue(value: unknown): void {
    assertAiLaneEnabledValue(value, () => new AiTreatmentReasoningDisabledError());
}
