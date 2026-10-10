/* ADR 0143: primitives of the strong unlock credential. Nothing calls them until the
   migration lands; the PIN path in ./security stays as it is. */
import { parseWrappedMasterKey, unwrapMasterKey, wrapMasterKey } from './security';

/** One policy for setup, unlock, change and recovery. */
export const PASSPHRASE_POLICY = Object.freeze({ version: 1, minLength: 15, maxLength: 128 });
/** The wrapping version of a passphrase. Versions 1 and 2 are PIN wrappings and stay in ./security. */
export const UNLOCK_KDF_VERSION = 3;
/** Proposed in ADR 0143; to be confirmed by measuring the slowest supported profile. */
export const UNLOCK_KDF_ITERATIONS = 2_000_000;

const KEK_INFO = 'mediflow.unlock.kek.v3';
const VERIFIER_INFO = 'mediflow.unlock.verifier.v3';
const RECOVERY_INFO = 'mediflow.recovery.kek.v1';
const RECOVERY_VERIFIER_INFO = 'mediflow.recovery.verifier.v1';
const RECOVERY_PREFIX = 'r1:';
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const SALT_BYTES = 16;

export type PassphraseCheck =
    | { ok: true; passphrase: string }
    | { ok: false; reason: 'too_short' | 'too_long' };

/** Length counts characters after NFKC. The passphrase is never trimmed or truncated. */
export function checkPassphrase(input: string): PassphraseCheck {
    const passphrase = input.normalize('NFKC');
    const length = [...passphrase].length;
    if (length < PASSPHRASE_POLICY.minLength) return { ok: false, reason: 'too_short' };
    if (length > PASSPHRASE_POLICY.maxLength) return { ok: false, reason: 'too_long' };
    return { ok: true, passphrase };
}

function subtle(): SubtleCrypto {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API unavailable');
    return globalThis.crypto.subtle;
}

const utf8 = (value: string) => new TextEncoder().encode(value);
const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const newSalt = () => globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
const expand = (info: string, salt: Uint8Array = new Uint8Array(0)) => ({
    name: 'HKDF', hash: 'SHA-256', salt: salt as unknown as BufferSource, info: utf8(info),
});

function requireSalt(salt: Uint8Array): Uint8Array {
    if (salt.byteLength < SALT_BYTES) throw new Error('Salt is too short');
    return salt;
}

function aesKey(root: CryptoKey, info: string, salt?: Uint8Array): Promise<CryptoKey> {
    return subtle().deriveKey(expand(info, salt), root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * Stretches the passphrase once, then splits the result into two independent values: the key
 * that wraps the master key, which never leaves the browser, and the access verifier the
 * browser sends to the server. The verifier cannot be turned into the wrapping key.
 * `iterations` exists to measure a profile and to build test vectors: a version 3 wrapping
 * is always made at UNLOCK_KDF_ITERATIONS.
 */
export async function deriveUnlockMaterial(
    passphrase: string,
    salt: Uint8Array,
    iterations: number = UNLOCK_KDF_ITERATIONS,
): Promise<{ kek: CryptoKey; verifier: string }> {
    const material = await subtle().importKey('raw', utf8(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    const stretched = await subtle().deriveBits(
        { name: 'PBKDF2', salt: requireSalt(salt) as unknown as BufferSource, iterations, hash: 'SHA-256' }, material, 256,
    );
    const root = await subtle().importKey('raw', stretched, 'HKDF', false, ['deriveKey', 'deriveBits']);
    return {
        kek: await aesKey(root, KEK_INFO),
        verifier: toBase64(await subtle().deriveBits(expand(VERIFIER_INFO), root, 256)),
    };
}

/** What the server stores and compares: it never keeps the verifier itself. */
export async function hashAccessVerifier(verifier: string): Promise<string> {
    const digest = new Uint8Array(await subtle().digest('SHA-256', fromBase64(verifier)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Setup and change: the only way to make a passphrase wrapping. It refuses a passphrase
 * outside the policy, takes a fresh salt and always pays the full derivation cost.
 */
export async function createUnlockWrapping(
    masterKey: CryptoKey,
    passphrase: string,
): Promise<{ encryptedMasterKey: string; salt: string; verifier: string }> {
    const checked = checkPassphrase(passphrase);
    if (!checked.ok) throw new Error(`Passphrase outside the policy: ${checked.reason}`);
    const salt = newSalt();
    const { kek, verifier } = await deriveUnlockMaterial(checked.passphrase, salt);
    return { encryptedMasterKey: `v${UNLOCK_KDF_VERSION}:${await wrapMasterKey(masterKey, kek)}`, salt: toBase64(salt), verifier };
}

/** Unlock: the key comes from deriveUnlockMaterial, which also gave the verifier sent to the server. */
export async function openUnlockWrapping(encryptedMasterKey: string, kek: CryptoKey): Promise<CryptoKey> {
    const { version, base64 } = parseWrappedMasterKey(encryptedMasterKey);
    if (version !== UNLOCK_KDF_VERSION) throw new Error(`Not a passphrase wrapping: version ${version}`);
    return unwrapMasterKey(base64, kek);
}

/** 160 random bits as eight groups of four characters. */
function generateRecoveryKey(): string {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
    const bits = Array.from(bytes, (byte) => byte.toString(2).padStart(8, '0')).join('');
    const characters = Array.from(bits.matchAll(/.{5}/gu), ([chunk]) => RECOVERY_ALPHABET[Number.parseInt(chunk, 2)]).join('');
    return Array.from(characters.matchAll(/.{4}/gu), ([group]) => group).join('-');
}

/** Accepts what a person types back from paper: any case, spaces or dashes, and the look-alikes of 0 and 1. */
function recoveryKeyBytes(recoveryKey: string): Uint8Array {
    const characters = recoveryKey.toUpperCase().replace(/[\s-]/gu, '').replace(/O/gu, '0').replace(/[IL]/gu, '1');
    if (characters.length !== 32 || [...characters].some((character) => !RECOVERY_ALPHABET.includes(character))) {
        throw new Error('Recovery key is not valid');
    }
    const bits = Array.from(characters, (character) => RECOVERY_ALPHABET.indexOf(character).toString(2).padStart(5, '0')).join('');
    return Uint8Array.from(bits.matchAll(/.{8}/gu), ([chunk]) => Number.parseInt(chunk, 2));
}

/** The same split as the passphrase: a wrapping key, and a verifier that proves possession to the server. */
async function recoveryMaterial(recoveryKey: string, salt: Uint8Array): Promise<{ kek: CryptoKey; verifier: string }> {
    // The key carries 160 bits of entropy of its own: it needs separation, not stretching.
    const root = await subtle().importKey(
        'raw', recoveryKeyBytes(recoveryKey) as unknown as BufferSource, 'HKDF', false, ['deriveKey', 'deriveBits'],
    );
    requireSalt(salt);
    return {
        kek: await aesKey(root, RECOVERY_INFO, salt),
        verifier: toBase64(await subtle().deriveBits(expand(RECOVERY_VERIFIER_INFO, salt), root, 256)),
    };
}

/**
 * The second wrapping of the master key. The recovery key is made here, so it is always
 * random, and is shown to the person once; the wrapping and its salt go into the recovery kit.
 * The verifier lets the server accept a new passphrase from whoever holds the recovery key.
 */
export async function createRecoveryWrapping(
    masterKey: CryptoKey,
): Promise<{ recoveryKey: string; wrappedMasterKey: string; salt: string; verifier: string }> {
    const recoveryKey = generateRecoveryKey();
    const salt = newSalt();
    const { kek, verifier } = await recoveryMaterial(recoveryKey, salt);
    return { recoveryKey, wrappedMasterKey: `${RECOVERY_PREFIX}${await wrapMasterKey(masterKey, kek)}`, salt: toBase64(salt), verifier };
}

export async function openRecoveryWrapping(
    wrappedMasterKey: string,
    salt: string,
    recoveryKey: string,
): Promise<{ masterKey: CryptoKey; verifier: string }> {
    if (!wrappedMasterKey.startsWith(RECOVERY_PREFIX)) throw new Error('Not a recovery wrapping');
    const { kek, verifier } = await recoveryMaterial(recoveryKey, fromBase64(salt));
    return { masterKey: await unwrapMasterKey(wrappedMasterKey.slice(RECOVERY_PREFIX.length), kek), verifier };
}
