export const SECURITY_CONFIG = {
    PIN_SALT_KEY: 'mediflow_pin_salt',
    ENCRYPTED_MASTER_KEY: 'mediflow_master_key_v1',
    PIN_MIN_LENGTH: 4,
    PIN_MAX_LENGTH: 8,
    AUTO_LOCK_TIMEOUT_MS: 15 * 60 * 1000,
    ITERATIONS: 100000, // PBKDF2 iterations (legacy default, kept for byte parity with v1 blobs)
};

// Versioned PBKDF2 work factor for the wrapped-master-key blob.
// v1 = legacy 100k (read/unwrap support forever; never used for NEW wraps).
// v2 = OWASP guidance for PBKDF2-HMAC-SHA256 (600k); every NEW wrap uses this.
// The master key itself never changes across versions: only the PIN-derived
// wrapping does, so an upgrade re-wraps in place without re-encrypting data.
// Native (Swift CommonCrypto/CryptoKit) must stay in lockstep with this table.
export const KDF_ITERATIONS: Record<number, number> = {
    1: 100_000,
    2: 600_000,
};

// The version every NEW wrapped-master-key blob is written at.
export const CURRENT_KDF_VERSION = 2;

// Serialized wrapped blobs are self-describing: a bare base64 string (no marker)
// is the legacy v1 shape; a "v<N>:" prefix pins the KDF version explicitly.
// Absent marker => v1 keeps existing stored blobs (DB / localStorage) valid.
const KDF_VERSION_PREFIX = /^v(\d+):/;

/**
 * Splits a stored wrapped-master-key blob into its KDF version and the raw
 * base64(iv||ct||tag) payload. A blob with no "v<N>:" marker is treated as v1.
 */
export function parseWrappedMasterKey(blob: string): { version: number; base64: string } {
    const match = blob.match(KDF_VERSION_PREFIX);
    if (!match) {
        return { version: 1, base64: blob };
    }
    return { version: Number(match[1]), base64: blob.slice(match[0].length) };
}

/**
 * The KDF version of a stored blob (1 when unmarked). Used to decide whether a
 * lazy re-wrap to CURRENT_KDF_VERSION is needed on login / change-pin.
 */
export function getKdfVersion(blob: string): number {
    return parseWrappedMasterKey(blob).version;
}

function iterationsForVersion(version: number): number {
    const iterations = KDF_ITERATIONS[version];
    if (!iterations) {
        throw new Error(`Unsupported KDF version: ${version}`);
    }
    return iterations;
}

/* @Codex */
function getCryptoApi(): Crypto {
    if (!globalThis.crypto) {
        throw new Error('Web Crypto API unavailable');
    }
    return globalThis.crypto;
}

// --- Key Management ---

/**
 * Generates a random 256-bit AES-GCM key (Master Key)
 */
export async function generateMasterKey(): Promise<CryptoKey> {
    return getCryptoApi().subtle.generateKey(
        {
            name: 'AES-GCM',
            length: 256,
        },
        true,
        ['encrypt', 'decrypt']
    );
}

/**
 * Derives a Key Encrypting Key (KEK) from the user's PIN using PBKDF2.
 * `iterations` defaults to the legacy v1 work factor so existing 2-arg callers
 * stay byte-identical with v1 blobs; version-aware callers pass the matching
 * iteration count (see KDF_ITERATIONS).
 */
export async function deriveKeyFromPin(
    pin: string,
    salt: Uint8Array,
    iterations: number = SECURITY_CONFIG.ITERATIONS,
): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await getCryptoApi().subtle.importKey(
        'raw',
        enc.encode(pin),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return getCryptoApi().subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as unknown as BufferSource,
            iterations,
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
    const cryptoApi = getCryptoApi();
    const rawMasterKey = await cryptoApi.subtle.exportKey('raw', masterKey);
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));

    const encryptedKeyBuffer = await cryptoApi.subtle.encrypt(
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
    const cryptoApi = getCryptoApi();
    const combined = base64ToArrayBuffer(encryptedMasterKeyB64);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const rawMasterKey = await cryptoApi.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        kek,
        data
    );

    return cryptoApi.subtle.importKey(
        'raw',
        rawMasterKey,
        'AES-GCM',
        true,
        ['encrypt', 'decrypt']
    );
}

// --- Versioned wrapped-master-key blob ---

/**
 * Wraps the master key at a given KDF version and returns a self-describing,
 * versioned blob (e.g. "v2:<base64>"). Derives the KEK from the PIN + salt using
 * the iteration count for that version; defaults to CURRENT_KDF_VERSION so every
 * NEW wrap is written at the strongest supported work factor.
 */
export async function wrapMasterKeyVersioned(
    masterKey: CryptoKey,
    pin: string,
    salt: Uint8Array,
    version: number = CURRENT_KDF_VERSION,
): Promise<string> {
    const kek = await deriveKeyFromPin(pin, salt, iterationsForVersion(version));
    const base64 = await wrapMasterKey(masterKey, kek);
    return `v${version}:${base64}`;
}

/**
 * Unwraps a stored (possibly legacy-unmarked) wrapped-master-key blob. Reads the
 * KDF version from the blob, derives the KEK with the matching iteration count,
 * and returns the master key. The master key is identical across versions, so an
 * upgrade only changes the wrapping.
 */
export async function unwrapMasterKeyVersioned(
    blob: string,
    pin: string,
    salt: Uint8Array,
): Promise<CryptoKey> {
    const { version, base64 } = parseWrappedMasterKey(blob);
    const kek = await deriveKeyFromPin(pin, salt, iterationsForVersion(version));
    return unwrapMasterKey(base64, kek);
}

// --- Data Encryption ---

/**
 * Encrypts arbitrary data (string or object) using the Master Key
 */
export async function encryptData(data: unknown, masterKey: CryptoKey): Promise<{ iv: string; data: string }> {
    const cryptoApi = getCryptoApi();
    const json = JSON.stringify(data);
    const enc = new TextEncoder();
    const encoded = enc.encode(json);

    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await cryptoApi.subtle.encrypt(
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
export async function decryptData(encryptedData: string, ivB64: string, masterKey: CryptoKey): Promise<unknown> {
    const cryptoApi = getCryptoApi();
    const iv = base64ToArrayBuffer(ivB64);
    const data = base64ToArrayBuffer(encryptedData);

    try {
        const decryptedBuffer = await cryptoApi.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(iv) },
            masterKey,
            data
        );

        const dec = new TextDecoder();
        const json = dec.decode(decryptedBuffer);
        return JSON.parse(json);
    } catch (e) {
        console.warn('Decryption failed, returning null', e);
        // Fallback: return null so the UI can decide how to handle it (e.g. show "Locked" or empty)
        // Throwing causes the entire LiveQuery to fail.
        return null;
    }
}

// --- Utilities ---

function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
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
