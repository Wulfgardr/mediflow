import { decryptData } from './security/security';

/** The restore replaces every clinical record: refuse it before the request when its ciphertext cannot be read. */
export class BackupRestoreKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackupRestoreKeyError';
    }
}

function firstEncryptedValue(value: unknown): string | null {
    if (typeof value === 'string') return value.startsWith('ENC:') ? value : null;
    if (!value || typeof value !== 'object') return null;
    for (const child of Object.values(value)) {
        const found = firstEncryptedValue(child);
        if (found) return found;
    }
    return null;
}

/**
 * Every encrypted field of an archive is sealed with one master key, so one
 * sample decides. An artifact without ciphertext, or one the server will
 * reject as malformed anyway, passes through to the server preflight.
 */
export async function assertBackupReadableWithKey(artifactJson: string, masterKey: CryptoKey | null): Promise<void> {
    let artifact: unknown;
    try { artifact = JSON.parse(artifactJson); } catch { return; }
    const sample = firstEncryptedValue(artifact);
    if (!sample) return;
    const [, iv, ciphertext, ...rest] = sample.split(':');
    const readable = masterKey !== null && iv && ciphertext && rest.length === 0
        && await decryptData(ciphertext, iv, masterKey) !== null;
    if (!readable) {
        throw new BackupRestoreKeyError(
            'Ripristino non avviato: questo backup è cifrato con una chiave diversa da quella sbloccata. '
            + 'I dati attuali non sono stati toccati. Sblocca con le credenziali con cui il backup è stato creato e riprova.',
        );
    }
}
