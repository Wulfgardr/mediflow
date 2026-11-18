const SESSION_KEY_STORAGE_KEY = 'mediflow_session_key';
const SESSION_USER_STORAGE_KEY = 'mediflow_user';

export type SessionKeyWrapping = { encryptedMasterKey: string; salt: string };

type RestoredSecuritySession<T> = {
    key: CryptoKey;
    userData: T;
    wrapping: SessionKeyWrapping | null;
};
type StoredSessionKey = JsonWebKey | { jwk: JsonWebKey; wrapping: SessionKeyWrapping };

export async function persistSecuritySession<T>(key: CryptoKey, userData: T, wrapping: SessionKeyWrapping): Promise<void> {
    const jwk = await window.crypto.subtle.exportKey('jwk', key);
    sessionStorage.setItem(SESSION_KEY_STORAGE_KEY, JSON.stringify({ jwk, wrapping }));
    sessionStorage.setItem(SESSION_USER_STORAGE_KEY, JSON.stringify(userData));
}

export async function restoreSecuritySession<T>(): Promise<RestoredSecuritySession<T> | null> {
    const jwkStr = sessionStorage.getItem(SESSION_KEY_STORAGE_KEY);
    const userStr = sessionStorage.getItem(SESSION_USER_STORAGE_KEY);

    if (!jwkStr || !userStr) return null;

    const stored = JSON.parse(jwkStr) as StoredSessionKey;
    const { jwk, wrapping } = 'jwk' in stored ? stored : { jwk: stored, wrapping: null };
    const key = await window.crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    );

    return {
        key,
        userData: JSON.parse(userStr) as T,
        wrapping: typeof wrapping?.encryptedMasterKey === 'string' && typeof wrapping.salt === 'string' ? wrapping : null,
    };
}

export function clearSecuritySession(): void {
    sessionStorage.removeItem(SESSION_KEY_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_USER_STORAGE_KEY);
}
