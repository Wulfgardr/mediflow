/* @Codex */
import {
    isAiLaneEnabledValue,
    serializeAiLaneKillSwitchState,
    type AiLaneKillSwitchState,
} from './ai-lane-kill-switch';

export const AI_OCR_KILL_SWITCH_KEY = 'aiOcrKillSwitch';

export type AiOcrKillSwitchState = AiLaneKillSwitchState;

export class AiOcrDisabledError extends Error {
    constructor() {
        super('AI OCR is disabled by the local rollout kill switch.');
        this.name = 'AiOcrDisabledError';
    }
}

export function resolveAiOcrKillSwitchState(value: unknown): AiOcrKillSwitchState {
    return value === undefined || isAiLaneEnabledValue(value) ? 'enabled' : 'disabled';
}

export function isAiOcrEnabledValue(value: unknown): boolean {
    return resolveAiOcrKillSwitchState(value) === 'enabled';
}

export function serializeAiOcrKillSwitchState(enabled: boolean): AiOcrKillSwitchState {
    return serializeAiLaneKillSwitchState(enabled);
}

export function assertAiOcrEnabledValue(value: unknown): void {
    if (!isAiOcrEnabledValue(value)) {
        throw new AiOcrDisabledError();
    }
}
