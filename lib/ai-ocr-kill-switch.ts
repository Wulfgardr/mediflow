/* @Codex */
export const AI_OCR_KILL_SWITCH_KEY = 'aiOcrKillSwitch';

export type AiOcrKillSwitchState = 'disabled';

/** Historical import compatibility only; no production caller may depend on this module. */
export class AiOcrDisabledError extends Error {
    constructor() {
        super('OCR execution is retired in MediFlow 0.8.5.');
        this.name = 'AiOcrDisabledError';
    }
}

export function resolveAiOcrKillSwitchState(_value: unknown): AiOcrKillSwitchState {
    return 'disabled';
}

export function isAiOcrEnabledValue(_value: unknown): false {
    return false;
}

export function serializeAiOcrKillSwitchState(_enabled: boolean): AiOcrKillSwitchState {
    return 'disabled';
}

export function assertAiOcrEnabledValue(_value: unknown): never {
    throw new AiOcrDisabledError();
}
