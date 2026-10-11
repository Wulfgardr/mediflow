import { hasCanonicalBase64ByteLength } from './kdf-rewrap-validation';
import { UNLOCK_KDF_VERSION } from './unlock-credential';

const WRAPPED_MASTER_KEY_BYTES = 12 + 32 + 16;
const SALT_BYTES = 16;
const VERIFIER_BYTES = 32;
const MAX_PIN_LENGTH = 64;

/** What the browser sends to move an account from its PIN to a passphrase (ADR 0143). */
export type PassphraseAdoptionPayload = {
    currentPin: string;
    encryptedMasterKey: string;
    salt: string;
    verifier: string;
    recovery: { wrappedMasterKey: string; salt: string; verifier: string };
};

function wrapping(value: unknown, prefix: string): value is string {
    return typeof value === 'string' && value.length <= 128 && value.startsWith(prefix)
        && hasCanonicalBase64ByteLength(value.slice(prefix.length), WRAPPED_MASTER_KEY_BYTES);
}

const bytes = (value: unknown, length: number): value is string =>
    typeof value === 'string' && value.length <= 64 && hasCanonicalBase64ByteLength(value, length);

type PassphraseCredentials = Omit<PassphraseAdoptionPayload, 'currentPin'>;

/** Shape only: the server cannot open either wrapping, and must not be able to. */
function readPassphraseCredentials(body: Record<string, unknown>): PassphraseCredentials | null {
    const recovery = body.recovery && typeof body.recovery === 'object' ? body.recovery as Record<string, unknown> : null;
    if (!wrapping(body.encryptedMasterKey, `v${UNLOCK_KDF_VERSION}:`) || !bytes(body.salt, SALT_BYTES)
        || !bytes(body.verifier, VERIFIER_BYTES)) return null;
    if (!recovery || !wrapping(recovery.wrappedMasterKey, 'r1:') || !bytes(recovery.salt, SALT_BYTES)
        || !bytes(recovery.verifier, VERIFIER_BYTES)) return null;
    // One secret must not stand in for the other, nor one salt for both wrappings.
    if (body.verifier === recovery.verifier || body.salt === recovery.salt) return null;
    return {
        encryptedMasterKey: body.encryptedMasterKey,
        salt: body.salt,
        verifier: body.verifier,
        recovery: { wrappedMasterKey: recovery.wrappedMasterKey, salt: recovery.salt, verifier: recovery.verifier },
    };
}

export function validatePassphraseAdoptionPayload(value: unknown): PassphraseAdoptionPayload | null {
    if (!value || typeof value !== 'object') return null;
    const body = value as Record<string, unknown>;
    if (typeof body.currentPin !== 'string' || !body.currentPin || body.currentPin.length > MAX_PIN_LENGTH) return null;
    const credentials = readPassphraseCredentials(body);
    return credentials && { currentPin: body.currentPin, ...credentials };
}

/** What the browser sends to set a new passphrase with the recovery key, when the old one is lost. */
export type PassphraseRecoveryPayload = PassphraseCredentials & { username: string; recoveryVerifier: string };

export function validatePassphraseRecoveryPayload(value: unknown): PassphraseRecoveryPayload | null {
    if (!value || typeof value !== 'object') return null;
    const body = value as Record<string, unknown>;
    const username = body.username === undefined ? '' : body.username;
    if (typeof username !== 'string' || username.length > 128 || !bytes(body.recoveryVerifier, VERIFIER_BYTES)) return null;
    const credentials = readPassphraseCredentials(body);
    // The recovery key has been typed into a browser: it is replaced, never kept.
    if (!credentials || credentials.recovery.verifier === body.recoveryVerifier || credentials.verifier === body.recoveryVerifier) return null;
    return { username: username.trim(), recoveryVerifier: body.recoveryVerifier, ...credentials };
}
