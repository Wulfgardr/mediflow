import { isCiphertext, openPatientDocumentFile } from './security/attachment-file-envelope';
import { decryptData } from './security/security';
import { DIARY_REVISION_PREFIX, openLegacyDiaryRevision } from './diary-revision-envelope';

/** The restore replaces every clinical record: refuse it before the request when its ciphertext cannot be read. */
export class BackupRestoreKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackupRestoreKeyError';
    }
}

const camel = (table: string) => table.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
// The one collection whose backup name is not its table name in camel case.
const COLLECTION_OF: Record<string, string> = { siss_handoff_events: 'sissHandoffs' };

async function readable(value: string, masterKey: CryptoKey | null): Promise<boolean> {
    if (value.startsWith('ENC2:')) {
        try { return masterKey !== null && Boolean(await openPatientDocumentFile(value, masterKey)); } catch { return false; }
    }
    const [, iv, ciphertext, ...rest] = value.split(':');
    return masterKey !== null && Boolean(iv) && Boolean(ciphertext) && rest.length === 0
        && await decryptData(ciphertext, iv, masterKey) !== null;
}

/**
 * Checks every sealed value of the fields the client encrypts (the caller's
 * contract, table name to field names): an archive may mix keys, and a field
 * outside the contract may legitimately hold text that starts with "ENC:".
 * An artifact the server will reject as malformed passes through to its preflight.
 */
export async function assertBackupReadableWithKey(
    artifactJson: string,
    masterKey: CryptoKey | null,
    encryptedFields: Record<string, string[]>,
): Promise<void> {
    let payload: Record<string, unknown>;
    try { payload = (JSON.parse(artifactJson) as { payload?: Record<string, unknown> })?.payload ?? {}; } catch { return; }
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const patientByEntry = new Map(entries.filter(entry => entry && typeof entry.id === 'string')
        .map(entry => [entry.id, entry.patientId]));
    for (const [table, fields] of Object.entries({ ...encryptedFields, agent_cassettes: ['wrappedPrivateKey'] })) {
        const rows = payload[COLLECTION_OF[table] ?? camel(table)];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            for (const field of fields) {
                const value = (row as Record<string, unknown>)[field];
                if (typeof value !== 'string') continue;
                if (table === 'entry_revisions' && (field === 'title' || field === 'content') && value.startsWith(DIARY_REVISION_PREFIX)) {
                    const { entryId, version } = row;
                    const patientId = patientByEntry.get(entryId);
                    const opened = masterKey && typeof patientId === 'string'
                        ? await openLegacyDiaryRevision(value, { patientId, entryId, version }, field, masterKey).catch(() => null)
                        : null;
                    if (opened !== null) continue;
                } else if (!isCiphertext(value) || await readable(value, masterKey)) continue;
                throw new BackupRestoreKeyError(
                    'Ripristino non avviato: questo backup contiene dati cifrati con una chiave diversa da quella sbloccata. '
                    + 'I dati attuali non sono stati toccati. Sblocca con le credenziali con cui il backup è stato creato e riprova.',
                );
            }
        }
    }
}
