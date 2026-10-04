import { types } from 'node:util';

export const BACKUP_AUDIT_FIELDS = [
    'eventId', 'schemaVersion', 'eventType', 'occurredAt', 'outcome', 'actorType', 'actorRef',
    'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata', 'createdAt',
] as const;

export type BackupAuditRow = {
    eventId: string; schemaVersion: number; eventType: string; occurredAt: number;
    outcome: string; actorType: string; actorRef: string; subjectType: string;
    subjectRef: string | null; sourceSurface: string; requestId: string | null;
    redactedMetadata: string | null; createdAt: number | null;
};

export type BackupAuditCoverage = 'included' | 'omitted';

export function backupAuditCoverage(payload: object): BackupAuditCoverage {
    return Object.hasOwn(payload, 'auditEvents') ? 'included' : 'omitted';
}

function isSqliteSecond(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value)
        && Number.isFinite(new Date(value * 1000).getTime());
}

export function canonicalizeBackupAuditRows(value: unknown): BackupAuditRow[] {
    if (!Array.isArray(value) || types.isProxy(value)) throw new Error('Backup audit collection is invalid.');
    const identities = new Set<string>();
    const rows = value.map((row: unknown) => {
        if (!row || typeof row !== 'object' || types.isProxy(row) || Array.isArray(row)
            || Object.getPrototypeOf(row) !== Object.prototype) throw new Error('Backup audit row is invalid.');
        const descriptors = Object.getOwnPropertyDescriptors(row);
        if (Reflect.ownKeys(row).length !== BACKUP_AUDIT_FIELDS.length
            || BACKUP_AUDIT_FIELDS.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) {
            throw new Error('Backup audit row fields are invalid.');
        }
        const audit = row as BackupAuditRow;
        if (typeof audit.eventId !== 'string' || audit.eventId.length === 0 || identities.has(audit.eventId)
            || !Number.isSafeInteger(audit.schemaVersion) || audit.schemaVersion < 1
            || !isSqliteSecond(audit.occurredAt)
            || (audit.createdAt !== null && !isSqliteSecond(audit.createdAt))
            || ['eventType', 'outcome', 'actorType', 'actorRef', 'subjectType', 'sourceSurface']
                .some(key => typeof (row as Record<string, unknown>)[key] !== 'string')
            || ['subjectRef', 'requestId', 'redactedMetadata']
                .some(key => (row as Record<string, unknown>)[key] !== null
                    && typeof (row as Record<string, unknown>)[key] !== 'string')) {
            throw new Error('Backup audit row or duplicate event identity is invalid.');
        }
        identities.add(audit.eventId);
        return Object.fromEntries(BACKUP_AUDIT_FIELDS.map(key => [key, audit[key]])) as BackupAuditRow;
    });
    return rows.sort((left, right) => left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0);
}

export function snapshotBackupAudit(row: Record<string, unknown>): BackupAuditRow {
    const snapshot = { ...row };
    for (const field of ['occurredAt', 'createdAt']) {
        if (snapshot[field] instanceof Date) {
            const milliseconds = (snapshot[field] as Date).getTime();
            if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) {
                throw new Error('Backup audit timestamp does not preserve SQLite seconds.');
            }
            snapshot[field] = milliseconds / 1000;
        }
    }
    return canonicalizeBackupAuditRows([snapshot])[0];
}

export function backupAuditsEqual(left: BackupAuditRow, right: BackupAuditRow): boolean {
    return BACKUP_AUDIT_FIELDS.every(key => Object.is(left[key], right[key]));
}

export function assertBackupAuditSnapshots(audits: BackupAuditRow[], snapshots: unknown[]): void {
    const byId = new Map(audits.map(row => [row.eventId, row]));
    for (const value of snapshots) {
        if (typeof value !== 'string') throw new Error('Backup H7b audit snapshot is invalid.');
        const [snapshot] = canonicalizeBackupAuditRows([JSON.parse(value)]);
        const audit = byId.get(snapshot.eventId);
        if (!audit || !backupAuditsEqual(audit, snapshot)) throw new Error('Backup H7b audit is missing or divergent.');
    }
}
