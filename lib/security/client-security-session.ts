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
function getSessionStorage(): Storage | null {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
}

/* @Codex */
export function clearSecuritySession(): void {
    const storage = getSessionStorage();
    if (!storage) return;

    try {
        storage.removeItem(SESSION_KEY_STORAGE_KEY);
    } catch {
        // Storage can be unavailable in a restricted browser context.
    }

    try {
        storage.removeItem(SESSION_USER_STORAGE_KEY);
    } catch {
        // Continue so an unavailable storage API cannot retain the active key.
    }
}

/* @Codex */
export function lockSecuritySession(
    clearActiveMasterKey: () => void,
    logoutServerSession: () => void,
): void {
    clearSecuritySession();
    clearActiveMasterKey();

    try {
        logoutServerSession();
    } catch {
        // Local lock state must not depend on an asynchronous logout request.
    }
}
