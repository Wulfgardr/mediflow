import { SECURITY_CONFIG } from './security';

const DIGITS_ONLY = /^[0-9]*$/u;
const NUMERIC_PIN = new RegExp(`^[0-9]{${SECURITY_CONFIG.PIN_MIN_LENGTH},${SECURITY_CONFIG.PIN_MAX_LENGTH}}$`, 'u');
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/u;

export const PIN_PASSPHRASE_MESSAGE = 'Sembra la passphrase: qui serve il PIN di conferma.';
export const PIN_LENGTH_MESSAGE = `Il PIN ha tra ${SECURITY_CONFIG.PIN_MIN_LENGTH} e ${SECURITY_CONFIG.PIN_MAX_LENGTH} caratteri.`;
export const PIN_DIGITS_ONLY_MESSAGE = `Il PIN richiede da ${SECURITY_CONFIG.PIN_MIN_LENGTH} a ${SECURITY_CONFIG.PIN_MAX_LENGTH} cifre.`;

export function isValidConfirmationPin(value: string): boolean {
    return value.length >= SECURITY_CONFIG.PIN_MIN_LENGTH && value.length <= SECURITY_CONFIG.PIN_MAX_LENGTH && !CONTROL_CHAR.test(value);
}

export function confirmationPinError(value: string): string | null {
    if (value.length > SECURITY_CONFIG.PIN_MAX_LENGTH) return PIN_PASSPHRASE_MESSAGE;
    if (CONTROL_CHAR.test(value)) return PIN_LENGTH_MESSAGE;
    return null;
}

export function validateConfirmationPinSubmission(value: string): string | null {
    if (value.length > SECURITY_CONFIG.PIN_MAX_LENGTH) return PIN_PASSPHRASE_MESSAGE;
    if (!isValidConfirmationPin(value)) return PIN_LENGTH_MESSAGE;
    return null;
}

export function isValidNumericPin(value: string): boolean {
    return NUMERIC_PIN.test(value);
}

export function numericPinError(value: string): string | null {
    if (value.length > SECURITY_CONFIG.PIN_MAX_LENGTH) return PIN_PASSPHRASE_MESSAGE;
    if (value !== '' && !DIGITS_ONLY.test(value)) return PIN_DIGITS_ONLY_MESSAGE;
    return null;
}

export function validateNumericPinSubmission(value: string): string | null {
    if (value.length > SECURITY_CONFIG.PIN_MAX_LENGTH) return PIN_PASSPHRASE_MESSAGE;
    if (!NUMERIC_PIN.test(value)) return PIN_DIGITS_ONLY_MESSAGE;
    return null;
}
