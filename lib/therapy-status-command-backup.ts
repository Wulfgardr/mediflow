import type Database from 'better-sqlite3';
import { parseTherapyStatusCommand } from './therapy-status-command-contract.ts';
import { backupAuditsEqual, canonicalizeBackupAuditRows, type BackupAuditRow } from './backup-audit.ts';

export const THERAPY_COMMAND_FIELDS = ['commandId', 'protocol', 'archiveGeneration', 'actorRef', 'patientId', 'therapyId', 'expectedVersion', 'target', 'outcome', 'reason', 'committedAt', 'resultVersion', 'resultEndDate', 'auditEventId', 'auditSnapshot'] as const;
export type TherapyCommandRow = Record<typeof THERAPY_COMMAND_FIELDS[number], unknown>;
const snake = (name: string) => name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const projection = THERAPY_COMMAND_FIELDS.map(key => `${snake(key)} AS ${key}`).join(',');
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && !Object.is(value, -0) && (value as number) >= 0 && (value as number) <= 8640000000000; }
export function validateTherapyStatusCommandRows(values: unknown, audits: unknown): TherapyCommandRow[] {
    if (!Array.isArray(values)) throw new Error('Invalid therapy status command ledger');
    const auditMap = new Map(canonicalizeBackupAuditRows(audits).map(row => [row.eventId, row]));
    const ids = new Set<string>();
    return values.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
            || Object.keys(value).length !== THERAPY_COMMAND_FIELDS.length || !THERAPY_COMMAND_FIELDS.every(key => Object.hasOwn(value, key))) throw new Error('Invalid therapy status command row');
        const row = value as TherapyCommandRow;
        const command = { commandId: row.commandId, protocol: row.protocol, archiveGeneration: row.archiveGeneration, patientId: row.patientId, therapyId: row.therapyId, expectedVersion: row.expectedVersion };
        if (!parseTherapyStatusCommand(command, false) || typeof row.actorRef !== 'string' || row.actorRef.length < 1 || row.actorRef.length > 256 || row.actorRef !== row.actorRef.trim()
            || !integer(row.committedAt) || ids.has(row.commandId as string)) throw new Error('Invalid therapy status command binding');
        ids.add(row.commandId as string);
        const emptyResult = row.resultVersion === null && row.resultEndDate === null && row.auditEventId === null && row.auditSnapshot === null;
        if (row.outcome === 'closed') {
            if (row.target !== null || row.reason !== null || !emptyResult) throw new Error('Invalid closed therapy command');
        } else {
            if (!['active', 'suspended', 'completed'].includes(row.target as string)) throw new Error('Invalid therapy command target');
            if (row.outcome === 'rejected') {
                if (row.reason !== 'version_conflict' || !emptyResult) throw new Error('Invalid rejected therapy command');
            } else if (row.outcome === 'applied') {
                if (row.reason !== null || row.resultVersion !== (row.expectedVersion as number) + 1
                    || (row.resultEndDate !== null && !integer(row.resultEndDate))
                    || (row.target === 'active' && row.resultEndDate !== null) || (row.target === 'completed' && row.resultEndDate !== row.committedAt)
                    || typeof row.auditSnapshot !== 'string' || typeof row.auditEventId !== 'string') throw new Error('Invalid applied therapy command');
                const snapshot = canonicalizeBackupAuditRows([JSON.parse(row.auditSnapshot)])[0]!;
                const audit = auditMap.get(row.auditEventId);
                const metadata = snapshot.redactedMetadata ? JSON.parse(snapshot.redactedMetadata) : null;
                if (!audit || !backupAuditsEqual(snapshot, audit) || snapshot.eventId !== row.auditEventId
                    || snapshot.actorType !== 'user' || snapshot.actorRef !== row.actorRef || snapshot.eventType !== 'therapy.updated'
                    || snapshot.subjectType !== 'therapy' || snapshot.subjectRef !== row.therapyId || snapshot.outcome !== 'success'
                    || snapshot.sourceSurface !== 'web' || snapshot.requestId !== row.commandId || snapshot.occurredAt !== row.committedAt
                    || metadata?.resourceVersion !== row.resultVersion) throw new Error('Therapy command audit missing or divergent');
            } else throw new Error('Invalid therapy command outcome');
        }
        return Object.fromEntries(THERAPY_COMMAND_FIELDS.map(key => [key, row[key]])) as TherapyCommandRow;
    }).sort((a, b) => String(a.commandId).localeCompare(String(b.commandId)));
}
export function readTherapyStatusCommandRows(db: Database.Database): TherapyCommandRow[] {
    return db.prepare(`SELECT ${projection} FROM therapy_status_commands ORDER BY command_id`).all() as TherapyCommandRow[];
}
export function readTherapyCommandAudits(db: Database.Database): BackupAuditRow[] {
    return canonicalizeBackupAuditRows(db.prepare(`SELECT event_id AS eventId, schema_version AS schemaVersion, event_type AS eventType,
        occurred_at AS occurredAt, outcome, actor_type AS actorType, actor_ref AS actorRef, subject_type AS subjectType,
        subject_ref AS subjectRef, source_surface AS sourceSurface, request_id AS requestId, redacted_metadata AS redactedMetadata,
        created_at AS createdAt FROM audit_events`).all());
}
export function planTherapyStatusCommandUnion(db: Database.Database, incoming: unknown, audits: unknown): TherapyCommandRow[] {
    const local = validateTherapyStatusCommandRows(readTherapyStatusCommandRows(db), readTherapyCommandAudits(db));
    const candidate = validateTherapyStatusCommandRows(incoming, audits);
    const byId = new Map(local.map(row => [row.commandId, row]));
    for (const row of candidate) {
        const previous = byId.get(row.commandId);
        if (previous && !THERAPY_COMMAND_FIELDS.every(key => Object.is(previous[key], row[key]))) throw new Error('Therapy status command collision');
        byId.set(row.commandId, row);
    }
    const allAudits = new Map(readTherapyCommandAudits(db).map(row => [row.eventId, row]));
    for (const audit of canonicalizeBackupAuditRows(audits)) {
        const previous = allAudits.get(audit.eventId);
        if (previous && !backupAuditsEqual(previous, audit)) throw new Error('Therapy command audit collision');
    }
    return [...byId.values()];
}
export function insertTherapyStatusCommandUnion(db: Database.Database, rows: TherapyCommandRow[]): void {
    if (!db.inTransaction) throw new Error('Therapy command preservation requires transaction');
    for (const row of rows) {
        if (db.prepare('SELECT 1 FROM therapy_status_commands WHERE command_id=?').get(row.commandId)) continue;
        if (row.auditSnapshot !== null) {
            const audit = canonicalizeBackupAuditRows([JSON.parse(row.auditSnapshot as string)])[0]!;
            const current = readTherapyCommandAudits(db).find(item => item.eventId === audit.eventId);
            if (current && !backupAuditsEqual(current, audit)) throw new Error('Therapy command audit collision');
            if (!current) {
                const keys = Object.keys(audit) as (keyof BackupAuditRow)[];
                const result = db.prepare(`INSERT INTO audit_events (${keys.map(snake).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => audit[key]));
                if (result.changes !== 1) throw new Error('Therapy command audit preservation failed');
            }
        }
        const result = db.prepare(`INSERT INTO therapy_status_commands (${THERAPY_COMMAND_FIELDS.map(snake).join(',')}) VALUES (${THERAPY_COMMAND_FIELDS.map(() => '?').join(',')})`).run(...THERAPY_COMMAND_FIELDS.map(key => row[key]));
        if (result.changes !== 1) throw new Error('Therapy command preservation failed');
    }
}
export function captureTherapyStatusCommands(current: Database.Database): { rows: TherapyCommandRow[]; audits: BackupAuditRow[] } {
    return current.transaction(() => {
        const audits = readTherapyCommandAudits(current);
        return { rows: validateTherapyStatusCommandRows(readTherapyStatusCommandRows(current), audits), audits };
    })();
}
export function preserveTherapyStatusCommands(snapshot: ReturnType<typeof captureTherapyStatusCommands>, replacement: Database.Database): void {
    replacement.transaction(() => {
        const rows = planTherapyStatusCommandUnion(replacement, snapshot.rows, snapshot.audits);
        insertTherapyStatusCommandUnion(replacement, rows);
    }).immediate();
}
