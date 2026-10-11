/** Full-archive recovery envelope v1. No keys, kit or clinical metadata in its header. */
const MAGIC = new TextEncoder().encode('MDFREC01');
const KEY_CONTEXT = new TextEncoder().encode('mediflow.recovery-backup.key.v1');
const SQLITE_MAGIC = new TextEncoder().encode('SQLite format 3\0');
const HEADER_BYTES = 80; // magic(8), wrapping nonce(12), wrapped AES-256 key + tag(48), payload nonce(12)
export const MAX_RECOVERY_DATABASE_BYTES = 256 * 1024 * 1024;
export const MAX_RECOVERY_BACKUP_BYTES = MAX_RECOVERY_DATABASE_BYTES + HEADER_BYTES + 16;

const source = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;
const matches = (bytes: Uint8Array, prefix: Uint8Array) => prefix.every((byte, index) => bytes[index] === byte);
const invalid = () => new Error('RECOVERY_BACKUP_INVALID');

export function assertRecoveryDatabaseBytes(bytes: Uint8Array): void {
    if (bytes.length < 100 || bytes.length > MAX_RECOVERY_DATABASE_BYTES || !matches(bytes, SQLITE_MAGIC)) throw invalid();
}

/** The resident master key is used, never exported. Each backup has an independent data key. */
export async function encryptRecoveryBackup(database: Uint8Array, masterKey: CryptoKey): Promise<Uint8Array> {
    assertRecoveryDatabaseBytes(database);
    const header = new Uint8Array(HEADER_BYTES);
    header.set(MAGIC);
    crypto.getRandomValues(header.subarray(8, 20));
    crypto.getRandomValues(header.subarray(68, 80));
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    try {
        const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
        header.set(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: header.subarray(8, 20),
            additionalData: KEY_CONTEXT }, masterKey, rawKey)), 20);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: header.subarray(68, 80),
            additionalData: header }, key, source(database)));
        const artifact = new Uint8Array(header.length + ciphertext.length);
        artifact.set(header); artifact.set(ciphertext, header.length);
        return artifact;
    } finally { rawKey.fill(0); }
}

/** No plaintext is returned until BOTH authentication tags and the format are valid. */
export async function decryptRecoveryBackup(artifact: Uint8Array, masterKey: CryptoKey): Promise<Uint8Array> {
    if (artifact.length < HEADER_BYTES + 100 + 16 || artifact.length > MAX_RECOVERY_BACKUP_BYTES || !matches(artifact, MAGIC)) throw invalid();
    let rawKey: Uint8Array | undefined;
    try {
        const header = artifact.subarray(0, HEADER_BYTES);
        rawKey = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: source(header.subarray(8, 20)),
            additionalData: KEY_CONTEXT }, masterKey, source(header.subarray(20, 68))));
        const key = await crypto.subtle.importKey('raw', source(rawKey), 'AES-GCM', false, ['decrypt']);
        const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: source(header.subarray(68, 80)),
            additionalData: source(header) }, key, source(artifact.subarray(HEADER_BYTES))));
        assertRecoveryDatabaseBytes(plaintext);
        return plaintext;
    } catch { throw invalid(); }
    finally { rawKey?.fill(0); }
}

export type RecoveryKit = { schemaVersion: 'mediflow.recovery-kit.v1'; username: string; wrappedMasterKey: string; salt: string };
export function parseRecoveryKit(text: string): RecoveryKit {
    if (text.length > 4096) throw invalid();
    const value = JSON.parse(text);
    if (!value || Object.keys(value).sort().join('|') !== 'salt|schemaVersion|username|wrappedMasterKey'
        || value.schemaVersion !== 'mediflow.recovery-kit.v1' || typeof value.username !== 'string' || !value.username || value.username.length > 128
        || typeof value.wrappedMasterKey !== 'string' || !/^r1:[A-Za-z0-9+/]{80}$/u.test(value.wrappedMasterKey)
        || typeof value.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/u.test(value.salt)) throw invalid();
    return value;
}
