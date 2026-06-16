/* @Codex */
export const AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY = 'aiDocumentSynthesisKillSwitch';

export type AiDocumentSynthesisKillSwitchState = 'enabled' | 'disabled';

export class AiDocumentSynthesisDisabledError extends Error {
    constructor() {
        super('AI document synthesis is disabled by the local rollout kill switch.');
        this.name = 'AiDocumentSynthesisDisabledError';
    }
}

export function resolveAiDocumentSynthesisKillSwitchState(value: unknown): AiDocumentSynthesisKillSwitchState {
    if (value === 'enabled' || value === true || value === 'true' || value === 1 || value === '1') {
        return 'enabled';
    }

    return 'disabled';
}

export function isAiDocumentSynthesisEnabledValue(value: unknown): boolean {
    return resolveAiDocumentSynthesisKillSwitchState(value) === 'enabled';
}

export function serializeAiDocumentSynthesisKillSwitchState(enabled: boolean): AiDocumentSynthesisKillSwitchState {
    return enabled ? 'enabled' : 'disabled';
}

export function assertAiDocumentSynthesisEnabledValue(value: unknown): void {
    if (!isAiDocumentSynthesisEnabledValue(value)) {
        throw new AiDocumentSynthesisDisabledError();
    }
}
