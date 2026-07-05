/**
 * Logica condivisa dei kill switch per lane AI.
 *
 * I tre kill switch (patient insight, smart import, document synthesis) erano
 * copie identiche a meno del nome. Questo modulo centralizza la semantica
 * fail-closed (default 'disabled' se il valore non e riconosciuto come truthy) e
 * l'assert, cosi ogni nuova lane (es. una futura dettatura/STT) costa poche righe
 * invece di un quarto clone. Ogni modulo lane mantiene le proprie classi di errore
 * come dichiarazioni, per preservare identita di valore e di tipo.
 */

export type AiLaneKillSwitchState = 'enabled' | 'disabled';

/** Fail-closed: solo valori esplicitamente truthy contano come 'enabled'. */
export function resolveAiLaneKillSwitchState(value: unknown): AiLaneKillSwitchState {
    if (value === 'enabled' || value === true || value === 'true' || value === 1 || value === '1') {
        return 'enabled';
    }
    return 'disabled';
}

export function isAiLaneEnabledValue(value: unknown): boolean {
    return resolveAiLaneKillSwitchState(value) === 'enabled';
}

export function serializeAiLaneKillSwitchState(enabled: boolean): AiLaneKillSwitchState {
    return enabled ? 'enabled' : 'disabled';
}

/** Lancia l'errore specifico della lane (fornito dal chiamante) se non abilitata. */
export function assertAiLaneEnabledValue(value: unknown, makeError: () => Error): void {
    if (!isAiLaneEnabledValue(value)) {
        throw makeError();
    }
}
