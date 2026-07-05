/* @Codex */
import {
    assertAiLaneEnabledValue,
    isAiLaneEnabledValue,
    resolveAiLaneKillSwitchState,
    serializeAiLaneKillSwitchState,
    type AiLaneKillSwitchState,
} from './ai-lane-kill-switch';

export const AI_SMART_IMPORT_KILL_SWITCH_KEY = 'aiSmartImportKillSwitch';

export type AiSmartImportKillSwitchState = AiLaneKillSwitchState;

export class AiSmartImportDisabledError extends Error {
    constructor() {
        super('AI Smart Import is disabled by the local rollout kill switch.');
        this.name = 'AiSmartImportDisabledError';
    }
}

export function resolveAiSmartImportKillSwitchState(value: unknown): AiSmartImportKillSwitchState {
    return resolveAiLaneKillSwitchState(value);
}

export function isAiSmartImportEnabledValue(value: unknown): boolean {
    return isAiLaneEnabledValue(value);
}

export function serializeAiSmartImportKillSwitchState(enabled: boolean): AiSmartImportKillSwitchState {
    return serializeAiLaneKillSwitchState(enabled);
}

export function assertAiSmartImportEnabledValue(value: unknown): void {
    assertAiLaneEnabledValue(value, () => new AiSmartImportDisabledError());
}
