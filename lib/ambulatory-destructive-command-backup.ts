import type Database from 'better-sqlite3';
import { AMBULATORY_MARKER_FIELDS, commandObject, commandOpaqueId, parseAmbulatoryCommandReceipt,
    type AmbulatoryCommandReceipt, type AmbulatoryCommandMarker } from './ambulatory-destructive-command-contract.ts';
import { backupAuditsEqual, canonicalizeBackupAuditRows, type BackupAuditRow } from './backup-audit.ts';

export const AMBULATORY_COMMAND_FIELDS = [...AMBULATORY_MARKER_FIELDS, 'actorRef', 'deviceId', 'devicePlatform', 'deviceTokenHash',
    'outcome', 'reason', 'committedAt', 'resultJson', 'auditSnapshots'] as const;
export type AmbulatoryCommandRow = Record<typeof AMBULATORY_COMMAND_FIELDS[number], unknown>;
const snake = (key: string) => key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
export function publicAmbulatoryReceipt(row: AmbulatoryCommandRow): AmbulatoryCommandReceipt {
    const marker = Object.fromEntries(AMBULATORY_MARKER_FIELDS.map(key => [key, row[key]])) as AmbulatoryCommandMarker;
    const receipt = { ...marker, outcome: row.outcome, reason: row.reason, committedAt: row.committedAt,
        result: row.resultJson === null ? null : JSON.parse(row.resultJson as string) };
    const parsed = parseAmbulatoryCommandReceipt(receipt);
    if (!parsed) throw new Error('Invalid ambulatory command receipt');
    return parsed;
}
export function ambulatoryCommandAuditSnapshots(row: AmbulatoryCommandRow): BackupAuditRow[] {
    return row.auditSnapshots === null ? [] : canonicalizeBackupAuditRows(JSON.parse(row.auditSnapshots as string));
}
export function validateAmbulatoryCommandRows(values: unknown, audits: unknown): AmbulatoryCommandRow[] {
    if (!Array.isArray(values)) throw new Error('Invalid ambulatory command ledger');
    const auditMap = new Map(canonicalizeBackupAuditRows(audits).map(row => [row.eventId, row]));
    const ids = new Set<string>();
    return values.map(value => {
        if (!commandObject(value, AMBULATORY_COMMAND_FIELDS)) throw new Error('Invalid ambulatory command row');
        const row = value as AmbulatoryCommandRow;
        if (!commandOpaqueId(row.actorRef) || !commandOpaqueId(row.deviceId)
            || !['macos', 'windows', 'linux', 'ios', 'ipados'].includes(row.devicePlatform as string)
            || typeof row.deviceTokenHash !== 'string' || !/^[0-9a-f]{64}$/u.test(row.deviceTokenHash)
            || ids.has(row.commandId as string)) throw new Error('Invalid ambulatory command owner');
        ids.add(row.commandId as string);
        const receipt = publicAmbulatoryReceipt(row);
        if (receipt.outcome !== 'applied') {
            if (row.auditSnapshots !== null) throw new Error('Non-applied ambulatory command has audit');
            return row;
        }
        if (typeof row.auditSnapshots !== 'string') throw new Error('Ambulatory command audit missing');
        const snapshots = ambulatoryCommandAuditSnapshots(row);
        const result = receipt.result!;
        const mainType = receipt.operation === 'ambulatory.clear-test.v1' ? 'ambulatory.cleared' : 'ambulatory.deleted';
        const expectedCount = 1 + (result.clear ? result.clear.tombstonedPatients + result.clear.unlinkedPatients : result.affectedAmbulatories.length);
        if (snapshots.length !== expectedCount) throw new Error('Ambulatory command audit cardinality');
        const subjects = new Set<string>();
        let main = 0, tombstones = 0, unlinks = 0, defaults = 0;
        for (const snapshot of snapshots) {
            const audit = auditMap.get(snapshot.eventId);
            const subject = `${snapshot.subjectType}:${snapshot.subjectRef}`;
            if (!audit || !backupAuditsEqual(snapshot, audit) || subjects.has(subject)
                || snapshot.actorType !== 'user' || snapshot.actorRef !== row.actorRef || snapshot.outcome !== 'success'
                || snapshot.sourceSurface !== 'web' || snapshot.requestId !== row.commandId) throw new Error('Ambulatory command audit binding');
            subjects.add(subject);
            const metadata = snapshot.redactedMetadata ? JSON.parse(snapshot.redactedMetadata) : null;
            if (snapshot.eventType === mainType && snapshot.subjectType === 'ambulatory' && snapshot.subjectRef === row.ambulatoryId) {
                if (metadata?.resourceVersion !== (result.targetVersion ?? row.expectedVersion)) throw new Error('Ambulatory command main audit version');
                main++;
            } else if (result.clear && snapshot.subjectType === 'patient' && snapshot.subjectRef) {
                if (!Number.isSafeInteger(metadata?.resourceVersion) || metadata.resourceVersion < 1) throw new Error('Ambulatory command patient version');
                if (snapshot.eventType === 'patient.deleted' && metadata.reasonCode === 'test-container-clear') tombstones++;
                else if (snapshot.eventType === 'patient.updated' && metadata.flags?.includes('membership:unassigned')) unlinks++;
                else throw new Error('Ambulatory command patient audit kind');
            } else if (!result.clear && snapshot.eventType === 'ambulatory.updated' && snapshot.subjectType === 'ambulatory'
                && result.affectedAmbulatories.some(row => row.id === snapshot.subjectRef && row.version === metadata?.resourceVersion)
                && JSON.stringify(metadata?.changedFields) === JSON.stringify(['isDefault'])) defaults++;
            else throw new Error('Ambulatory command unexpected audit');
        }
        if (main !== 1 || tombstones !== (result.clear?.tombstonedPatients ?? 0) || unlinks !== (result.clear?.unlinkedPatients ?? 0)
            || defaults !== (result.clear ? 0 : result.affectedAmbulatories.length)) throw new Error('Ambulatory command audit incomplete');
        return row;
    }).sort((a, b) => String(a.commandId).localeCompare(String(b.commandId)));
}
export function readAmbulatoryCommandRows(db: Database.Database): AmbulatoryCommandRow[] {
    return db.prepare(`SELECT ${AMBULATORY_COMMAND_FIELDS.map(key => `${snake(key)} AS ${key}`).join(',')} FROM ambulatory_destructive_commands ORDER BY command_id`).all() as AmbulatoryCommandRow[];
}
export function readAmbulatoryCommandAudits(db: Database.Database): BackupAuditRow[] {
    return canonicalizeBackupAuditRows(db.prepare(`SELECT event_id AS eventId, schema_version AS schemaVersion, event_type AS eventType,
        occurred_at AS occurredAt, outcome, actor_type AS actorType, actor_ref AS actorRef, subject_type AS subjectType,
        subject_ref AS subjectRef, source_surface AS sourceSurface, request_id AS requestId, redacted_metadata AS redactedMetadata,
        created_at AS createdAt FROM audit_events`).all());
}
export function planAmbulatoryCommandUnion(db: Database.Database, values: unknown, audits: unknown): AmbulatoryCommandRow[] {
    const localAudits = readAmbulatoryCommandAudits(db);
    const local = validateAmbulatoryCommandRows(readAmbulatoryCommandRows(db), localAudits);
    const candidate = validateAmbulatoryCommandRows(values, audits);
    const byId = new Map(local.map(row => [row.commandId, row]));
    for (const row of candidate) {
        const previous = byId.get(row.commandId);
        if (previous && !AMBULATORY_COMMAND_FIELDS.every(key => Object.is(previous[key], row[key]))) throw new Error('Ambulatory command collision');
        byId.set(row.commandId, row);
    }
    const knownAudits = new Map(localAudits.map(row => [row.eventId, row]));
    for (const audit of canonicalizeBackupAuditRows(audits)) {
        const previous = knownAudits.get(audit.eventId);
        if (previous && !backupAuditsEqual(previous, audit)) throw new Error('Ambulatory command audit collision');
    }
    return [...byId.values()];
}
export function insertAmbulatoryCommandUnion(db: Database.Database, rows: AmbulatoryCommandRow[]): void {
    if (!db.inTransaction) throw new Error('Ambulatory command union requires transaction');
    const knownAudits = new Map(readAmbulatoryCommandAudits(db).map(row => [row.eventId, row]));
    for (const row of rows) {
        if (db.prepare('SELECT 1 FROM ambulatory_destructive_commands WHERE command_id=?').get(row.commandId)) continue;
        for (const audit of ambulatoryCommandAuditSnapshots(row)) {
            const previous = knownAudits.get(audit.eventId);
            if (previous && !backupAuditsEqual(previous, audit)) throw new Error('Ambulatory command audit collision');
            if (!previous) {
                const keys = Object.keys(audit) as Array<keyof BackupAuditRow>;
                if (db.prepare(`INSERT INTO audit_events (${keys.map(snake).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => audit[key])).changes !== 1)
                    throw new Error('Ambulatory command audit preservation failed');
                knownAudits.set(audit.eventId, audit);
            }
        }
        if (db.prepare(`INSERT INTO ambulatory_destructive_commands (${AMBULATORY_COMMAND_FIELDS.map(snake).join(',')}) VALUES (${AMBULATORY_COMMAND_FIELDS.map(() => '?').join(',')})`)
            .run(...AMBULATORY_COMMAND_FIELDS.map(key => row[key])).changes !== 1) throw new Error('Ambulatory command preservation failed');
    }
}
export function captureAmbulatoryCommands(db: Database.Database) {
    return db.transaction(() => {
        const audits = readAmbulatoryCommandAudits(db);
        return { rows: validateAmbulatoryCommandRows(readAmbulatoryCommandRows(db), audits), audits };
    })();
}
export function preserveAmbulatoryCommands(snapshot: ReturnType<typeof captureAmbulatoryCommands>, replacement: Database.Database): void {
    replacement.transaction(() => insertAmbulatoryCommandUnion(replacement, planAmbulatoryCommandUnion(replacement, snapshot.rows, snapshot.audits))).immediate();
}
