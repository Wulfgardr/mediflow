import { BackupLineDecoder, BackupRowLayout } from './backup-row-layout';
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

function backupKeyChecker(masterKey: CryptoKey | null, encryptedFields: Record<string, string[]>) {
    const byCollection = new Map(Object.entries({ ...encryptedFields, agent_cassettes: ['wrappedPrivateKey'] })
        .map(([table, fields]) => [COLLECTION_OF[table] ?? camel(table), fields]));
    const patientByEntry = new Map<unknown, unknown>();
    return async (collection: string, row: Record<string, unknown>) => {
        if (collection === 'entries' && typeof row.id === 'string') patientByEntry.set(row.id, row.patientId);
        const fields = byCollection.get(collection);
        if (!fields) return;
        for (const field of fields) {
            const value = row[field];
            if (typeof value !== 'string') continue;
            if (collection === 'entryRevisions' && (field === 'title' || field === 'content') && value.startsWith(DIARY_REVISION_PREFIX)) {
                const { entryId, version } = row;
                const patientId = patientByEntry.get(entryId);
                const opened = masterKey && typeof patientId === 'string' && typeof entryId === 'string' && typeof version === 'number'
                    ? await openLegacyDiaryRevision(value, { patientId, entryId, version }, field, masterKey).catch(() => null)
                    : null;
                if (opened !== null) continue;
            } else if (!isCiphertext(value) || await readable(value, masterKey)) continue;
            throw new BackupRestoreKeyError(
                'Ripristino non avviato: questo backup contiene dati cifrati con una chiave diversa da quella sbloccata. '
                + 'I dati attuali non sono stati toccati. Sblocca con le credenziali con cui il backup è stato creato e riprova.',
            );
        }
    };
}

export async function assertBackupReadableWithKey(
    artifactJson: string | Blob,
    masterKey: CryptoKey | null,
    encryptedFields: Record<string, string[]>,
    signal?: AbortSignal,
): Promise<void> {
    const check = backupKeyChecker(masterKey, encryptedFields);
    if (typeof artifactJson !== 'string') {
        const reader = artifactJson.stream().getReader();
        const decoder = new BackupLineDecoder();
        const layout = new BackupRowLayout();
        try {
            for (;;) {
                signal?.throwIfAborted();
                const chunk = await reader.read();
                if (chunk.done) break;
                for (const { text } of decoder.push(chunk.value)) {
                    const event = layout.read(text);
                    if (event.kind === 'row') await check(event.collection, event.row);
                }
            }
            decoder.finish();
            layout.finish();
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
        return;
    }
    let payload: Record<string, unknown>;
    try { payload = (JSON.parse(artifactJson) as { payload?: Record<string, unknown> })?.payload ?? {}; } catch { return; }
    for (const collection of ['entries', ...Object.keys(payload).filter(key => key !== 'entries')]) {
        const rows = payload[collection];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            if (row && typeof row === 'object') await check(collection, row);
        }
    }
}
