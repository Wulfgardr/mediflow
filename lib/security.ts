export const SECURITY_CONFIG = {
    PIN_SALT_KEY: 'mediflow_pin_salt',
    ENCRYPTED_MASTER_KEY: 'mediflow_master_key_v1',
    PIN_MIN_LENGTH: 4,
    PIN_MAX_LENGTH: 8,
    AUTO_LOCK_TIMEOUT_MS: 15 * 60 * 1000,
    ITERATIONS: 100000, // PBKDF2 iterations
};

// --- Key Management ---

/**
 * Generates a random 256-bit AES-GCM key (Master Key)
 */
export async function generateMasterKey(): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey(
        {
            name: 'AES-GCM',
            length: 256,
        },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Derives a Key Encrypting Key (KEK) from the user's PIN using PBKDF2
 */
export async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(pin),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: SECURITY_CONFIG.ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts the Master Key using the PIN-derived key (KEK)
 */
export async function wrapMasterKey(masterKey: CryptoKey, kek: CryptoKey): Promise<string> {
    const rawMasterKey = await window.crypto.subtle.exportKey('raw', masterKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encryptedKeyBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        kek,
        rawMasterKey
    );

    // Pack IV + Encrypted Key into a base64 string
    const encryptedArray = new Uint8Array(encryptedKeyBuffer);
    const combined = new Uint8Array(iv.length + encryptedArray.length);
    combined.set(iv);
    combined.set(encryptedArray, iv.length);

    return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypts the Master Key using the PIN-derived key (KEK)
 */
export async function unwrapMasterKey(encryptedMasterKeyB64: string, kek: CryptoKey): Promise<CryptoKey> {
    const combined = base64ToArrayBuffer(encryptedMasterKeyB64);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const rawMasterKey = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        kek,
        data
    );

    return window.crypto.subtle.importKey(
        'raw',
        rawMasterKey,
        'AES-GCM',
        true,
        ['encrypt', 'decrypt']
    );
}

// --- Data Encryption ---

/**
 * Encrypts arbitrary data (string or object) using the Master Key
 */
export async function encryptData(data: any, masterKey: CryptoKey): Promise<{ iv: string; data: string }> {
    const json = JSON.stringify(data);
    const enc = new TextEncoder();
    const encoded = enc.encode(json);

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        masterKey,
        encoded
    );

    return {
        iv: arrayBufferToBase64(iv.buffer),
        data: arrayBufferToBase64(encryptedBuffer),
    };
}

/**
 * Decrypts data using the Master Key
 */
export async function decryptData(encryptedData: string, ivB64: string, masterKey: CryptoKey): Promise<any> {
    const iv = base64ToArrayBuffer(ivB64);
    const data = base64ToArrayBuffer(encryptedData);

    try {
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(iv) },
            masterKey,
            data
        );

        const dec = new TextDecoder();
        const json = dec.decode(decryptedBuffer);
        return JSON.parse(json);
    } catch (e) {
        console.error('Decryption failed', e);
        // If decryption fails, return null or throw. 
        // In migration context, failing to decrypt might mean it wasn't encrypted? 
        // But here we assume inputs are encrypted.
        throw new Error('Decryption failed');
    }
}

// --- Utilities ---

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// --- Storage Helpers ---

export function getStoredSalt(): Uint8Array | null {
    const b64 = localStorage.getItem(SECURITY_CONFIG.PIN_SALT_KEY);
    return b64 ? new Uint8Array(base64ToArrayBuffer(b64)) : null;
}

export function storeSalt(salt: Uint8Array) {
    localStorage.setItem(SECURITY_CONFIG.PIN_SALT_KEY, arrayBufferToBase64(salt.buffer));
}

export function getStoredEncryptedMasterKey(): string | null {
    return localStorage.getItem(SECURITY_CONFIG.ENCRYPTED_MASTER_KEY);
}

export function storeEncryptedMasterKey(key: string) {
    localStorage.setItem(SECURITY_CONFIG.ENCRYPTED_MASTER_KEY, key);
}

export function hasSecuritySetup(): boolean {
    return !!getStoredEncryptedMasterKey();
}
