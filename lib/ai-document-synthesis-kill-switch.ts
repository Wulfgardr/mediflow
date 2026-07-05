/* @Codex */
import {
    assertAiLaneEnabledValue,
    isAiLaneEnabledValue,
    resolveAiLaneKillSwitchState,
    serializeAiLaneKillSwitchState,
    type AiLaneKillSwitchState,
} from './ai-lane-kill-switch';

export const AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY = 'aiDocumentSynthesisKillSwitch';

export type AiDocumentSynthesisKillSwitchState = AiLaneKillSwitchState;

export class AiDocumentSynthesisDisabledError extends Error {
    constructor() {
        super('AI document synthesis is disabled by the local rollout kill switch.');
        this.name = 'AiDocumentSynthesisDisabledError';
    }
}

export function resolveAiDocumentSynthesisKillSwitchState(value: unknown): AiDocumentSynthesisKillSwitchState {
    return resolveAiLaneKillSwitchState(value);
}

export function isAiDocumentSynthesisEnabledValue(value: unknown): boolean {
    return isAiLaneEnabledValue(value);
}

export function serializeAiDocumentSynthesisKillSwitchState(enabled: boolean): AiDocumentSynthesisKillSwitchState {
    return serializeAiLaneKillSwitchState(enabled);
}

export function assertAiDocumentSynthesisEnabledValue(value: unknown): void {
    assertAiLaneEnabledValue(value, () => new AiDocumentSynthesisDisabledError());
}
