import { SECURITY_CONFIG } from './security';
import { checkPassphrase } from './unlock-credential';

const DIGITS_ONLY = /^[0-9]*$/u;
const NUMERIC_PIN = new RegExp(`^[0-9]{${SECURITY_CONFIG.PIN_MIN_LENGTH},${SECURITY_CONFIG.PIN_MAX_LENGTH}}$`, 'u');

export const PIN_DIGITS_ONLY_MESSAGE = `PIN di ${SECURITY_CONFIG.PIN_MIN_LENGTH}-${SECURITY_CONFIG.PIN_MAX_LENGTH} cifre, non la passphrase.`;
export const PIN_LENGTH_MESSAGE = `Il PIN ha tra ${SECURITY_CONFIG.PIN_MIN_LENGTH} e ${SECURITY_CONFIG.PIN_MAX_LENGTH} cifre.`;

export type NumericPinInputResult =
    | { ok: true; value: string; error: null }
    | { ok: false; value: string; error: string };

export function isValidNumericPin(value: string): boolean {
    return NUMERIC_PIN.test(value);
}

export function acceptNumericPinChange(nextRaw: string, previousValue: string): NumericPinInputResult {
    if (nextRaw === '') return { ok: true, value: '', error: null };
    if (!DIGITS_ONLY.test(nextRaw)) {
        return { ok: false, value: previousValue, error: PIN_DIGITS_ONLY_MESSAGE };
    }
    if (nextRaw.length > SECURITY_CONFIG.PIN_MAX_LENGTH) {
        return {
            ok: false,
            value: previousValue,
            error: checkPassphrase(nextRaw).ok ? PIN_DIGITS_ONLY_MESSAGE : PIN_LENGTH_MESSAGE,
        };
    }
    return { ok: true, value: nextRaw, error: null };
}

export function validateNumericPinSubmission(value: string): string | null {
    if (!DIGITS_ONLY.test(value)) return PIN_DIGITS_ONLY_MESSAGE;
    if (!isValidNumericPin(value)) {
        return checkPassphrase(value).ok ? PIN_DIGITS_ONLY_MESSAGE : PIN_LENGTH_MESSAGE;
    }
    return null;
}
