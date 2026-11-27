import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { eq, getTableColumns, getTableName, is, SQL, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { cassetteItems } from './agent-cassette-contract';
import { AGENT_CASSETTE_COMPLETE, readAgentCassette } from './agent-cassette-store';
import { readSqliteArchiveGeneration } from './archive-generation';
import { auditOrigin } from './backup-import-provenance';
import { backupAuditsEqual, snapshotBackupAudit, type BackupAuditRow } from './backup-audit';
import { ARCHIVE_POLICY_MESSAGES, BackupRestoreBlockedError, type ArchivePolicyReason } from './backup-restore-blocked';
import type { BackupRowDataset, BackupRecord } from './backup-artifact';
import { derivePatientAmbulatoryLinks, type RestoredPatientAmbulatoryLink } from './backup-patient-ambulatory-links';
import { normalizeRestoreRow } from './backup-restore-row';
import { PATIENT_CHILD_TABLES } from './patient-cascade';
import { readRetentionHolds, type RetentionRunner } from './retention-store';
import { attachments, auditEvents, entryRevisions, patients, patientsToAmbulatories, therapyStatusCommands } from './schema';
import { sanitizeAuditMetadata } from './security/audit';

function block(reason: ArchivePolicyReason): never {
    throw new BackupRestoreBlockedError(reason, ARCHIVE_POLICY_MESSAGES[reason]);
}

type RestoreReader = Pick<RetentionRunner, 'get' | 'select'>;
type RestorePlan = { payload: BackupRowDataset; memberships: RestoredPatientAmbulatoryLink[]; excludedRetiredPatients: number };

function matchingRows(rows: Iterable<BackupRecord>, keep: (row: BackupRecord) => boolean): Iterable<BackupRecord> {
    return { *[Symbol.iterator]() { for (const row of rows) if (keep(row)) yield row; } };
}

function retainPatientGraph(payload: BackupRowDataset, retired: ReadonlySet<unknown>): BackupRowDataset {
    const kept = { ...payload, patients: matchingRows(payload.patients, row => !retired.has(row.id)) };
    for (const { name } of PATIENT_CHILD_TABLES) {
        if (name === 'patientsToAmbulatories') continue;
        const collection = name === 'sissHandoffEvents' ? 'sissHandoffs' : name;
        kept[collection] = matchingRows(payload[collection] ?? [], row => !retired.has(row.patientId));
    }
    const entryIds = new Set<unknown>();
    for (const entry of kept.entries) entryIds.add(entry.id);
    kept.entryRevisions = matchingRows(payload.entryRevisions ?? [], row => entryIds.has(row.entryId));
    return kept;
}

function persistedRowsUnchanged(
    db: Database.Database, table: SQLiteTable, incoming: Iterable<BackupRecord>, identity: readonly string[], condition: string, refs: string[],
): boolean {
    const columns = getTableColumns(table);
    const tableName = getTableName(table);
    const expected = db.prepare(`SELECT count(*) FROM ${tableName} WHERE ${condition}`).pluck().get(...refs);
    if (expected === 0) return true;
    const whereIdentity = identity.map(field => `${columns[field]!.name} = ?`).join(' AND ');
    const find = db.prepare(`SELECT * FROM ${tableName} WHERE (${condition}) AND ${whereIdentity}`);
    const matched = new Set<string>();
    for (const replacement of incoming) {
        const ids = identity.map(field => replacement[field]);
        if (!ids.every(value => typeof value === 'string')) continue;
        const row = find.get(...refs, ...ids) as BackupRecord | undefined;
        if (!row) continue;
        const normalized = normalizeRestoreRow(replacement);
        const unchanged = Object.entries(columns).every(([field, column]) => {
            const value = normalized[field] === undefined ? column.default ?? null : normalized[field];
            const persisted = row[column.name];
            if (value === null || persisted === null) return value === persisted;
            if (is(value, SQL)) return false;
            try {
                return column.dataType === 'json'
                    ? isDeepStrictEqual(value, column.mapFromDriverValue(persisted))
                    : Object.is(column.mapToDriverValue(value), persisted);
            } catch { return false; }
        });
        if (!unchanged) return false;
        matched.add(JSON.stringify(ids));
    }
    return matched.size === expected;
}

function assertRestorePreservesHolds(db: Database.Database, reader: RestoreReader, plan: RestorePlan): void {
    const document = readRetentionHolds(reader);
    if (!document) block('retention_unreadable');
    for (const hold of document.holds) {
        const patientId = hold.patientId;
        const { payload, memberships } = plan;
        if (hold.scope === 'document') {
            if (!persistedRowsUnchanged(db, attachments, payload.attachments, ['id'], 'id = ? AND patient_id = ?', [hold.attachmentId!, patientId])) block('legal_hold');
            continue;
        }
        if (!persistedRowsUnchanged(db, patients, payload.patients, ['id'], 'id = ?', [patientId])
            || !persistedRowsUnchanged(db, patientsToAmbulatories, memberships, ['patientId', 'ambulatoryId'], 'patient_id = ?', [patientId])
            || !persistedRowsUnchanged(db, entryRevisions, payload.entryRevisions ?? [], ['eventId'],
                'entry_id IN (SELECT id FROM entries WHERE patient_id = ?)', [patientId])) block('legal_hold');
        for (const { name, table } of PATIENT_CHILD_TABLES) {
            if (name === 'patientsToAmbulatories') continue;
            const collection = name === 'sissHandoffEvents' ? 'sissHandoffs' : name;
            if (!persistedRowsUnchanged(db, table, payload[collection] ?? [], ['id'], 'patient_id = ?', [patientId])) block('legal_hold');
        }
    }
}

function cassetteAttributedHere(db: Database.Database, reader: RestoreReader, cassette: BackupRecord, retired: ReadonlySet<unknown>): boolean {
    const { id, actorRef, agentRef, mandateRef, archiveGeneration, status } = cassette;
    if (status !== 'closed' || typeof id !== 'string' || typeof actorRef !== 'string'
        || archiveGeneration !== readSqliteArchiveGeneration(db)) return false;
    const local = readAgentCassette(db, id, actorRef);
    if (!local || !isDeepStrictEqual(local, cassette)) return false;
    const events = reader.select().from(auditEvents).where(sql`
        ${auditEvents.outcome} = 'success' AND ${auditEvents.sourceSurface} = 'agent'
        AND ${auditEvents.actorRef} = ${actorRef} AND ${auditEvents.proposerRef} = ${agentRef} AND ${auditEvents.mandateRef} = ${mandateRef}
        AND ${auditOrigin(auditEvents.eventId)} = 'local'
        AND ((${auditEvents.eventType} = 'agent.visit.applied' AND ${auditEvents.subjectType} = 'agent_operation' AND ${auditEvents.subjectRef} = ${id})
            OR (${auditEvents.eventType} = 'patient.updated' AND ${auditEvents.subjectType} = 'patient' AND ${auditEvents.requestId} = ${id})
            OR (${auditEvents.eventType} = 'agent.item.applied' AND ${auditEvents.subjectType} = 'agent_operation' AND ${auditEvents.requestId} = ${id}))
    `).all();
    const recipients = new Set(events.filter(row => row.eventType === 'patient.updated').map(row => row.subjectRef));
    if (recipients.size !== 1 || [...recipients].some(ref => !ref || retired.has(ref))) return false;
    const appliedIds = new Set(events.filter(row => row.eventType === 'agent.item.applied').map(row => row.subjectRef));
    const items = cassetteItems(local);
    if (items.length === 0 || !items.every(item => appliedIds.has(item.id))) return false;
    return events.some(row => {
        if (row.eventType !== 'agent.visit.applied' || !row.redactedMetadata) return false;
        try {
            const flags: unknown = JSON.parse(row.redactedMetadata).flags;
            return Array.isArray(flags) && flags.includes(AGENT_CASSETTE_COMPLETE);
        } catch { return false; }
    });
}

function minimizedAudit(reader: RestoreReader, incoming: BackupRecord): boolean {
    const event = incoming as BackupAuditRow;
    const local = reader.select().from(auditEvents).where(eq(auditEvents.eventId, event.eventId)).get();
    if (local && backupAuditsEqual(snapshotBackupAudit(local), event)) return true;
    if (![event.eventId, event.eventType, event.actorRef, event.subjectRef, event.requestId, event.subjectType,
        event.sourceSurface, event.actorType, event.outcome].every(value => value === null || /^[A-Za-z0-9_.:/-]{1,256}$/u.test(value))) return false;
    if (event.redactedMetadata === null) return true;
    try {
        const metadata = JSON.parse(event.redactedMetadata);
        return isDeepStrictEqual(metadata, sanitizeAuditMetadata(metadata));
    } catch { return false; }
}

function cassetteHeldHere(db: Database.Database, cassette: BackupRecord): boolean {
    const { id, actorRef } = cassette;
    return typeof id === 'string' && typeof actorRef === 'string' && isDeepStrictEqual(readAgentCassette(db, id, actorRef), cassette);
}

function assertNoRetiredPatientMaterial(
    db: Database.Database, reader: RestoreReader, payload: BackupRowDataset, retired: ReadonlySet<unknown>, excludesPatients: boolean,
): void {
    const cassetteAdmitted = (row: BackupRecord) => excludesPatients ? cassetteAttributedHere(db, reader, row, retired) : cassetteHeldHere(db, row);
    const auditInScope = (row: BackupRecord) => excludesPatients || retired.has(row.subjectRef);
    for (const row of payload.agentCassettes ?? []) if (!cassetteAdmitted(row)) block('retired_patient_material');
    for (const row of payload.auditEvents ?? []) {
        if (auditInScope(row) && !minimizedAudit(reader, row)) block('retired_patient_material');
    }

    for (const row of payload.therapyStatusCommands ?? []) {
        if (!retired.has(row.patientId) || (row.target === null && row.resultEndDate === null)) continue;
        const local = reader.select().from(therapyStatusCommands).where(eq(therapyStatusCommands.commandId, row.commandId as string)).get();
        if (!isDeepStrictEqual(row, local)) block('retired_patient_material');
    }
}

export function planBackupRestore(db: Database.Database, source: BackupRowDataset, reader: RestoreReader): RestorePlan {
    const retired = new Set(db.prepare('SELECT id FROM patient_retired_ids').pluck().all());
    const excluded = new Set<unknown>();
    if (retired.size) for (const { id } of source.patients) if (retired.has(id)) excluded.add(id);
    const payload = excluded.size > 0 ? retainPatientGraph(source, retired) : source;
    const plan = { payload, memberships: derivePatientAmbulatoryLinks(payload.patients), excludedRetiredPatients: excluded.size };
    assertRestorePreservesHolds(db, reader, plan);
    if (retired.size > 0) assertNoRetiredPatientMaterial(db, reader, source, retired, excluded.size > 0);
    return plan;
}
