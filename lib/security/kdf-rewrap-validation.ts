import { CURRENT_KDF_VERSION } from './security';

const WRAPPED_MASTER_KEY_BYTES = 12 + 32 + 16;
const SALT_BYTES = 16;
const MAX_WRAPPED_MASTER_KEY_LENGTH = 512;
const MAX_SALT_LENGTH = 128;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type KdfRewrapPayload = {
    encryptedMasterKey: string;
    salt: string;
};

function hasCanonicalBase64ByteLength(value: string, expectedBytes: number): boolean {
    if (!BASE64_PATTERN.test(value)) return false;
    try {
        const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
        return decoded.byteLength === expectedBytes;
    } catch {
        return false;
    }
}

export function validateKdfRewrapPayload(value: unknown): KdfRewrapPayload | null {
    if (!value || typeof value !== 'object') return null;
    const body = value as Record<string, unknown>;
    if (typeof body.encryptedMasterKey !== 'string' || typeof body.salt !== 'string') return null;
    if (body.encryptedMasterKey.length > MAX_WRAPPED_MASTER_KEY_LENGTH || body.salt.length > MAX_SALT_LENGTH) {
        return null;
    }

    const prefix = `v${CURRENT_KDF_VERSION}:`;
    if (!body.encryptedMasterKey.startsWith(prefix)) return null;
    const wrappedBase64 = body.encryptedMasterKey.slice(prefix.length);
    if (!hasCanonicalBase64ByteLength(wrappedBase64, WRAPPED_MASTER_KEY_BYTES)) return null;
    if (!hasCanonicalBase64ByteLength(body.salt, SALT_BYTES)) return null;

    return {
        encryptedMasterKey: body.encryptedMasterKey,
        salt: body.salt,
    };
}
