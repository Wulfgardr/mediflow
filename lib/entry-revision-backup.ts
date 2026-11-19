import { isSealedAttachmentValue } from './attachment-payload.ts';
import { snapshotBackupAudit } from './backup-audit.ts';

type Row = Record<string, unknown>;
const fields = ['eventId', 'entryId', 'version', 'title', 'content', 'correctedAt', 'correctedBy'];

export function assertEntryRevisionBackup(revisions: Row[], entries: Row[], audit: Row[]): void {
    if (!revisions.length) return;
    const parents = new Map(entries.map(entry => [entry.id, entry]));
    const auditById = new Map(audit.map(row => [row.eventId, row]));
    const eventIds = new Set<string>();
    const versionsByEntry = new Map<string, Set<number>>();
    for (const row of revisions) {
        if (!row || Object.keys(row).length !== fields.length || !fields.every(key => Object.hasOwn(row, key))
            || typeof row.eventId !== 'string' || typeof row.entryId !== 'string'
            || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
            || (row.correctedBy !== null && typeof row.correctedBy !== 'string')
            || (row.title !== null && !isSealedAttachmentValue(row.title))
            || (row.content !== null && !isSealedAttachmentValue(row.content))) throw new Error('Invalid diary revision');

        const parent = parents.get(row.entryId);
        const event = auditById.get(row.eventId);
        const versions = versionsByEntry.get(row.entryId) ?? new Set<number>();
        if (!parent || typeof parent.version !== 'number' || parent.version <= row.version
            || eventIds.has(row.eventId) || versions.has(row.version) || !event) throw new Error('Invalid diary revision reference');

        const auditRow = snapshotBackupAudit(event);
        const at = row.correctedAt instanceof Date ? row.correctedAt
            : typeof row.correctedAt === 'string' ? new Date(row.correctedAt) : null;
        if (!at || at.getTime() !== auditRow.occurredAt * 1000
            || !['entry.updated', 'entry.deleted'].includes(auditRow.eventType) || auditRow.outcome !== 'success'
            || auditRow.subjectType !== 'entry' || auditRow.subjectRef !== row.entryId
            || JSON.parse(auditRow.redactedMetadata ?? 'null')?.resourceVersion !== row.version + 1) {
            throw new Error('Invalid diary revision audit');
        }
        eventIds.add(row.eventId);
        versions.add(row.version);
        versionsByEntry.set(row.entryId, versions);
    }
}
