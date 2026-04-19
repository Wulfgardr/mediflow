/* @Codex */
import { SECURITY_CONFIG, deriveKeyFromPin, wrapMasterKey } from './security';

/* @Codex */
export const PIN_CHANGE_INVALID_CURRENT_PIN_CODE = 'PIN_CHANGE_INVALID_CURRENT_PIN';
/* @Codex */
export const PIN_CHANGE_INVALID_NEW_PIN_CODE = 'PIN_CHANGE_INVALID_NEW_PIN';
/* @Codex */
export const PIN_CHANGE_REUSE_NOT_ALLOWED_CODE = 'PIN_CHANGE_REUSE_NOT_ALLOWED';

/* @Codex */
export type PinChangeFailurePayload = {
    error?: string;
    code?: string;
    message?: string;
};

/* @Codex */
function getCryptoApi(): Crypto {
    if (!globalThis.crypto) {
        throw new Error('Web Crypto API unavailable');
    }
    return globalThis.crypto;
}

/* @Codex */
function bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
}

/* @Codex */
export function validatePinChangeInput(currentPin: string, newPin: string): string | null {
    if (!currentPin) {
        return 'Inserisci il PIN attuale.';
    }

    if (newPin.length < SECURITY_CONFIG.PIN_MIN_LENGTH || newPin.length > SECURITY_CONFIG.PIN_MAX_LENGTH) {
        return `Il nuovo PIN deve avere tra ${SECURITY_CONFIG.PIN_MIN_LENGTH} e ${SECURITY_CONFIG.PIN_MAX_LENGTH} caratteri.`;
    }

    if (newPin === currentPin) {
        return 'Il nuovo PIN deve essere diverso dal PIN attuale.';
    }

    return null;
}

/* @Codex */
export async function createPinRotationBundle(masterKey: CryptoKey, newPin: string): Promise<{ encryptedMasterKey: string; salt: string }> {
    const salt = getCryptoApi().getRandomValues(new Uint8Array(16));
    const kek = await deriveKeyFromPin(newPin, salt);
    const encryptedMasterKey = await wrapMasterKey(masterKey, kek);

    return {
        encryptedMasterKey,
        salt: bytesToBase64(salt),
    };
}

/* @Codex */
export function formatPinChangeFailure(payload: PinChangeFailurePayload | null, status: number): string {
    if (payload?.code === PIN_CHANGE_INVALID_CURRENT_PIN_CODE) {
        return payload.message || 'Il PIN attuale non è corretto.';
    }

    if (
        payload?.code === PIN_CHANGE_INVALID_NEW_PIN_CODE
        || payload?.code === PIN_CHANGE_REUSE_NOT_ALLOWED_CODE
    ) {
        return payload.message || 'Il nuovo PIN non è valido.';
    }

    if (status === 401) {
        return "Sessione non valida. Effettua di nuovo l'accesso.";
    }

    return payload?.message || payload?.error || 'Errore durante il cambio PIN.';
}
