// WUL-323: guard against persisting the '[LOCKED DATA]' placeholder produced
// when client-side decryption of an ENC: field fails. The placeholder is a
// presentation-only artifact: the original ciphertext must survive any save,
// otherwise a later re-encrypt overwrites the clinical data irreversibly.

export const LOCKED_DATA_PLACEHOLDER = '[LOCKED DATA]';

// Enumerable side-channel key so the preserved ciphertext survives object
// spreads ({ ...patient }) in UI flows; it is stripped before any write.
export const LOCKED_CIPHERTEXT_KEY = '__lockedCiphertext';

export function isLockedDataPlaceholder(value: unknown): value is typeof LOCKED_DATA_PLACEHOLDER {
    return value === LOCKED_DATA_PLACEHOLDER;
}

export function isEncryptedFieldValue(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('ENC:');
}

// Fields of an item whose decrypt failed and whose ciphertext is preserved.
export function getLockedFields(item: unknown): string[] {
    if (!item || typeof item !== 'object') return [];
    const map = (item as Record<string, unknown>)[LOCKED_CIPHERTEXT_KEY];
    if (!map || typeof map !== 'object') return [];
    return Object.keys(map);
}

export function rememberLockedCiphertext(item: Record<string, unknown>, field: string, ciphertext: unknown): void {
    if (!isEncryptedFieldValue(ciphertext)) return;
    const existing = item[LOCKED_CIPHERTEXT_KEY];
    const map: Record<string, string> =
        existing && typeof existing === 'object' ? (existing as Record<string, string>) : {};
    map[field] = ciphertext;
    item[LOCKED_CIPHERTEXT_KEY] = map;
}

// Removes the side-channel from the outgoing payload and returns the valid
// preserved ciphertexts, if any.
export function takeLockedCiphertext(item: Record<string, unknown>): Record<string, string> | undefined {
    const value = item[LOCKED_CIPHERTEXT_KEY];
    if (LOCKED_CIPHERTEXT_KEY in item) delete item[LOCKED_CIPHERTEXT_KEY];
    if (!value || typeof value !== 'object') return undefined;

    const map: Record<string, string> = {};
    for (const [field, ciphertext] of Object.entries(value)) {
        if (isEncryptedFieldValue(ciphertext)) map[field] = ciphertext;
    }
    return Object.keys(map).length > 0 ? map : undefined;
}
