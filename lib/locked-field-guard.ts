// WUL-323: guard against persisting the '[LOCKED DATA]' placeholder produced
// when client-side decryption of an ENC: field fails. The placeholder is a
// presentation-only artifact: the original ciphertext must survive any save,
// otherwise a later re-encrypt overwrites the clinical data irreversibly.

/**
 * What the reader sees in place of a clinical field this session cannot open.
 *
 * It used to be `[LOCKED DATA]`: a technical token, in English, inside an
 * Italian interface, and silent about what had happened. A clinician reading it
 * cannot tell whether the datum is missing, corrupt, or simply sealed with a key
 * this device does not hold — and those are three very different situations.
 *
 * The wording follows what the Apple client already says for the same case, so
 * a field that cannot be read reads the same on every surface.
 */
export const LOCKED_DATA_PLACEHOLDER = 'Contenuto cifrato non leggibile con la chiave di questa sessione.';

/**
 * The token used before the sentence above.
 *
 * Still recognised, because this constant is not only what is shown: it is also
 * the sentinel that refuses to persist the placeholder over the real ciphertext
 * (see lib/db.ts). A record written by an older build must keep hitting that
 * guard rather than slipping through and overwriting clinical data.
 */
export const LEGACY_LOCKED_DATA_PLACEHOLDER = '[LOCKED DATA]';

// Enumerable side-channel key so the preserved ciphertext survives object
// spreads ({ ...patient }) in UI flows; it is stripped before any write.
export const LOCKED_CIPHERTEXT_KEY = '__lockedCiphertext';

export function isLockedDataPlaceholder(value: unknown): value is typeof LOCKED_DATA_PLACEHOLDER {
    return value === LOCKED_DATA_PLACEHOLDER || value === LEGACY_LOCKED_DATA_PLACEHOLDER;
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
