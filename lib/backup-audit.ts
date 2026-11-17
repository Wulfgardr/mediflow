import type Database from 'better-sqlite3';
import { types } from 'node:util';

export const BACKUP_AUDIT_FIELDS = [
    'eventId', 'schemaVersion', 'eventType', 'occurredAt', 'outcome', 'actorType', 'actorRef',
    'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata', 'createdAt',
] as const;

export const BACKUP_AGENT_AUDIT_FIELDS = ['proposerRef', 'mandateRef', 'modelProvider'] as const;

export type BackupAuditRow = {
    proposerRef?: string | null; mandateRef?: string | null; modelProvider?: string | null;
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
    // Signed zero cannot survive Date/SQLite; reject it while ordinary zero remains valid.
    return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)
        && Number.isFinite(new Date(value * 1000).getTime());
}

export function canonicalizeBackupAuditRows(value: unknown): BackupAuditRow[] {
    if (!Array.isArray(value) || types.isProxy(value)) throw new Error('Backup audit collection is invalid.');
    const identities = new Set<string>();
    const rows = value.map((row: unknown) => {
        if (!row || typeof row !== 'object' || types.isProxy(row) || Array.isArray(row)
            || Object.getPrototypeOf(row) !== Object.prototype) throw new Error('Backup audit row is invalid.');
        const descriptors = Object.getOwnPropertyDescriptors(row);
        const hasProvenance = BACKUP_AGENT_AUDIT_FIELDS.every(key => Object.hasOwn(descriptors, key));
        const fields = hasProvenance ? [...BACKUP_AUDIT_FIELDS, ...BACKUP_AGENT_AUDIT_FIELDS] : BACKUP_AUDIT_FIELDS;
        if (Reflect.ownKeys(row).length !== fields.length
            || fields.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) {
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
        const agent = audit.sourceSurface === 'agent';
        if (agent ? !hasProvenance || audit.actorType !== 'user'
            || ![audit.proposerRef, audit.mandateRef].every(ref => typeof ref === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(ref))
            || !['openai', 'anthropic', 'local'].includes(audit.modelProvider ?? '')
            : hasProvenance && BACKUP_AGENT_AUDIT_FIELDS.some(key => audit[key] !== null)) throw new Error('Backup agent audit provenance is invalid.');
        identities.add(audit.eventId);
        return Object.fromEntries((agent ? fields : BACKUP_AUDIT_FIELDS).map(key => [key, audit[key]])) as BackupAuditRow;
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
    return [...BACKUP_AUDIT_FIELDS, ...BACKUP_AGENT_AUDIT_FIELDS].every(key => Object.is(left[key] ?? null, right[key] ?? null));
}


export function readBackupAuditRows(db: Database.Database): BackupAuditRow[] {
    const columns = new Set((db.pragma('table_info(audit_events)') as { name: string }[]).map(column => column.name));
    const snake = (key: string) => key.replace(/[A-Z]/gu, value => `_${value.toLowerCase()}`);
    const fields = [...BACKUP_AUDIT_FIELDS, ...BACKUP_AGENT_AUDIT_FIELDS.filter(key => columns.has(snake(key)))];
    return canonicalizeBackupAuditRows(db.prepare(`SELECT ${fields.map(key => `${snake(key)} AS ${key}`).join(',')} FROM audit_events`).all());
}
