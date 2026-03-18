const SESSION_KEY_STORAGE_KEY = 'mediflow_session_key';
const SESSION_USER_STORAGE_KEY = 'mediflow_user';

type RestoredSecuritySession<T> = {
    key: CryptoKey;
    userData: T;
};

/* @Codex */
export async function persistSecuritySession<T>(key: CryptoKey, userData: T): Promise<void> {
    const jwk = await window.crypto.subtle.exportKey('jwk', key);
    sessionStorage.setItem(SESSION_KEY_STORAGE_KEY, JSON.stringify(jwk));
    sessionStorage.setItem(SESSION_USER_STORAGE_KEY, JSON.stringify(userData));
}

/* @Codex */
export async function restoreSecuritySession<T>(): Promise<RestoredSecuritySession<T> | null> {
    const jwkStr = sessionStorage.getItem(SESSION_KEY_STORAGE_KEY);
    const userStr = sessionStorage.getItem(SESSION_USER_STORAGE_KEY);

    if (!jwkStr || !userStr) return null;

    const jwk = JSON.parse(jwkStr);
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
    };
}

/* @Codex */
export function clearSecuritySession(): void {
    sessionStorage.removeItem(SESSION_KEY_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_USER_STORAGE_KEY);
}
