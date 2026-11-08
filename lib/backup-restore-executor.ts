import { randomUUID } from 'node:crypto';
import { recordPortableImportOrigin } from './backup-import-provenance';
import { restoreSnapshot, writeRestoreReceipt, type RestoreIntent, type RestoreReceipt } from './backup-restore-receipt';
import { planAmbulatoryCommandUnion, insertAmbulatoryCommandUnion } from './ambulatory-destructive-command-backup';
import { planTherapyStatusCommandUnion, insertTherapyStatusCommandUnion } from './therapy-status-command-backup';
import { eq, sql } from 'drizzle-orm';
import { assertExemptionImportReceiptRows } from './exemption-import-receipt';
import { migrateProstheticsSources } from './reference-data/prosthetics-catalog-schema';
import { assertProstheticsCatalogBackup } from './reference-data/prosthetics-catalog-backup';
import { dbServer, openDbServer, runDbServerImmediateTransaction } from './db-server';
import { ArchiveReplacedError, rotateSqliteArchiveGeneration } from './archive-generation';
import { clearAllSessions } from './security/server-session';
import {
    ambulatories,
    auditEvents,
    therapyStatusCommands,
    ambulatoryDestructiveCommands,
    attachments,
    checkups,
    conversations,
    documentDiagnosisProposals,
    drugs,
    entries,
    exemptions,
    exemptionImportReceipts,
    prostheticsCatalogEntries,
    prostheticsCatalogReceipts,
    prostheticsCatalogSources,
    prostheticsCatalogDocuments,
    messages,
    observations,
    patients,
    patientsToAmbulatories,
    physicianReviewAttestations,
    prostheticPrescriptions,
    serviceCatalogEntries,
    servicePrescriptionItems,
    servicePrescriptions,
    sissHandoffEvents,
    therapies,
} from './schema';
import { backupArtifactInputChecksum, type BackupArtifact, type BackupCollectionName } from './backup-artifact';
import { backupAuditCoverage, backupAuditsEqual, canonicalizeBackupAuditRows, snapshotBackupAudit,
    type BackupAuditCoverage, type BackupAuditRow } from './backup-audit';
import { derivePatientAmbulatoryLinks } from './backup-patient-ambulatory-links';
import { revokeAttachmentExtractionLocatorGeneration } from './domain/documents/attachment-extraction-locator-revocation';
import { DATE_FIELDS } from '../scripts/scheduled-backup-date-fields.mjs';

export { DATE_FIELDS };

const CLEAR_ORDER: BackupCollectionName[] = [
    'messages',
    'attachments',
    'documentDiagnosisProposals',
    'physicianReviewAttestations',
    'observations',
    'prostheticPrescriptions',
    'servicePrescriptionItems',
    'servicePrescriptions',
    'serviceCatalogEntries',
    'sissHandoffs',
    'checkups',
    'therapies',
    'entries',
    'patients',
    'conversations',
    'drugs',
    'exemptions',
    'exemptionImportReceipts',
    'prostheticsCatalogEntries',
    'prostheticsCatalogReceipts',
    'prostheticsCatalogSources',
    'prostheticsCatalogDocuments',
    'ambulatories',
];

const INSERT_ORDER: BackupCollectionName[] = [
    'ambulatories',
    'drugs',
    'exemptions',
    'exemptionImportReceipts',
    'prostheticsCatalogEntries',
    'prostheticsCatalogReceipts',
    'prostheticsCatalogSources',
    'prostheticsCatalogDocuments',
    'conversations',
    'patients',
    'physicianReviewAttestations',
    'documentDiagnosisProposals',
    'entries',
    'therapies',
    'checkups',
    'prostheticPrescriptions',
    'servicePrescriptions',
    'servicePrescriptionItems',
    'observations',
    'serviceCatalogEntries',
    'sissHandoffs',
    'attachments',
    'messages',
];

const TABLE_LOOKUP = {
    auditEvents,
    therapyStatusCommands,
    ambulatoryDestructiveCommands,
    ambulatories,
    attachments,
    checkups,
    conversations,
    documentDiagnosisProposals,
    drugs,
    entries,
    exemptions,
    exemptionImportReceipts,
    prostheticsCatalogEntries,
    prostheticsCatalogReceipts,
    prostheticsCatalogSources,
    prostheticsCatalogDocuments,
    messages,
    observations,
    patients,
    physicianReviewAttestations,
    prostheticPrescriptions,
    serviceCatalogEntries,
    servicePrescriptionItems,
    servicePrescriptions,
    sissHandoffs: sissHandoffEvents,
    therapies,
} as const;

type InsertRunner = Pick<typeof dbServer, 'insert'>;
type InsertableTable = (typeof TABLE_LOOKUP)[BackupCollectionName] | typeof patientsToAmbulatories;
export type BackupRestoreMutationFence = () => boolean;

export type BackupRestoreBlockedReason = 'audit' | 'runtime_fence' | 'therapy_status_commands' | 'ambulatory_destructive_commands' | 'snapshot';

/* The restore stopped inside its transaction: the target archive is unchanged. Callers report it as blocked, not as failed. */
export class BackupRestoreBlockedError extends Error {
    constructor(readonly reason: BackupRestoreBlockedReason, detail: string) {
        super(`Restore blocked: ${detail}`);
        this.name = 'BackupRestoreBlockedError';
    }
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function normalizeDateValue(value: unknown): unknown {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
        // Scheduled-runner artifacts predating WUL-319 carry raw SQLite unix-seconds
        // integers; unix-milliseconds for any contemporary date are >= 10^12.
        const milliseconds = Number.isInteger(value) && Math.abs(value) < 1_000_000_000_000
            ? value * 1000
            : value;
        const parsed = new Date(milliseconds);
        return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return value;
}

function normalizeInsertRow<T extends Record<string, unknown>>(row: T): T {
    const normalized: Record<string, unknown> = { ...row };
    for (const field of DATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(normalized, field)) {
            normalized[field] = normalizeDateValue(normalized[field]);
        }
    }
    return normalized as T;
}

function clearRows(table: InsertableTable): void {
    dbServer.delete(table).run();
    if (dbServer.select({ present: sql<number>`1` }).from(table).limit(1).get()) {
        throw new Error('RESTORE_ROWS_NOT_CLEARED');
    }
}

function insertRows<T extends Record<string, unknown>>(
    runner: InsertRunner,
    table: InsertableTable,
    rows: T[],
): void {
    if (rows.length === 0) return;
    const insertableRows: Record<string, unknown>[] = table === prostheticsCatalogDocuments ? rows.map(row => {
        const { base64, ...metadata } = row;
        return { ...metadata, bytes: Buffer.from(base64 as string, 'base64') };
    }) : rows;
    for (const group of chunk(insertableRows, 250)) {
        /* Repertory dates are declared source text, not clinical timestamp columns. */
        const inserted = runner.insert(table).values((table === prostheticsCatalogEntries || table === prostheticsCatalogSources) ? group : group.map(normalizeInsertRow)).run();
        if (inserted.changes !== group.length) throw new Error('RESTORE_ROWS_NOT_PERSISTED');
    }
}

/* Restore must synchronously retire volatile authority before the first destructive write. */
function runMutationFence(fence: BackupRestoreMutationFence): void {
    if (typeof fence !== 'function') {
        throw new BackupRestoreBlockedError('runtime_fence', 'runtime mutation fence unavailable.');
    }
    try {
        if (typeof fence() !== 'boolean') {
            throw new Error('invalid fence result');
        }
    } catch (error) {
        if (error instanceof ArchiveReplacedError) throw error;
        throw new BackupRestoreBlockedError('runtime_fence', 'runtime mutation fence unavailable.');
    }
}

function physicianAttestationsWithoutRestoredAuthority(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const revokedHere = dbServer.select().from(physicianReviewAttestations)
        .where(eq(physicianReviewAttestations.status, 'revoked')).all();
    const actors = new Set<unknown>(revokedHere.map(row => row.actorRef));
    return [...revokedHere, ...rows.filter(row => !actors.has(row.actorRef))
        .map(row => row.status === 'active' ? { ...row, status: 'inactive' } : row)];
}

export type BackupRestoreResult = {
    sourceChecksum: string;
    receipt?: RestoreReceipt;
    audit: { coverage: BackupAuditCoverage; inserted: number; reused: number };
};

type AuditRestorePlan = Array<{ row: BackupAuditRow; reused: boolean }>;

function planBackupAuditRestore(rows: BackupAuditRow[]): AuditRestorePlan {
    return rows.map(row => {
        const existing = dbServer.select().from(auditEvents).where(eq(auditEvents.eventId, row.eventId)).get();
        if (existing && !backupAuditsEqual(snapshotBackupAudit(existing), row)) {
            throw new BackupRestoreBlockedError('audit', 'audit collision.');
        }
        return { row, reused: !!existing };
    });
}

function insertBackupAudits(plan: AuditRestorePlan): void {
    for (const { row, reused } of plan) {
        if (reused) continue;
        const result = dbServer.insert(auditEvents).values({
            ...row,
            occurredAt: new Date(row.occurredAt * 1000),
            createdAt: row.createdAt === null ? null : new Date(row.createdAt * 1000),
        }).run();
        if (result.changes !== 1) throw new BackupRestoreBlockedError('audit', 'audit insertion did not persist.');
    }
}

/* Keep source rows field-exact for history and command snapshots. Local companion events
   identify every new imported event, including imported provenance claims, in the same transaction. */
function recordPortableImport(plan: AuditRestorePlan, checksum: string, importedCommands: string[], actorRef?: string): void {
    const eventId = randomUUID();
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const base = {
        schemaVersion: 1, occurredAt: now, createdAt: now, outcome: 'success',
        actorType: actorRef ? 'user' : 'system', actorRef: actorRef ?? 'portable-restore',
        sourceSurface: 'web', requestId: eventId, redactedMetadata: null,
    };
    dbServer.insert(auditEvents).values({ ...base, eventId, eventType: 'backup.portable.imported',
        subjectType: 'backup', subjectRef: checksum }).run();
    for (const commandId of importedCommands) {
        recordPortableImportOrigin(openDbServer(), 'therapy_command', commandId, eventId);
        dbServer.insert(auditEvents).values({ ...base, eventId: randomUUID(), eventType: 'backup.therapy-command.imported',
            subjectType: 'therapy_command', subjectRef: commandId }).run();
    }
    for (const { row, reused } of plan) {
        if (reused) continue;
        recordPortableImportOrigin(openDbServer(), 'audit', row.eventId, eventId);
        dbServer.insert(auditEvents).values({ ...base, eventId: randomUUID(), eventType: 'backup.audit.imported',
            subjectType: 'audit_event', subjectRef: row.eventId }).run();
    }
}

export function restoreBackupArtifact(
    artifact: BackupArtifact,
    beforeMutation: BackupRestoreMutationFence,
    intent?: RestoreIntent,
    actorRef?: string,
): BackupRestoreResult {
    assertExemptionImportReceiptRows(artifact.payload.exemptionImportReceipts ?? []);
    assertProstheticsCatalogBackup(artifact.payload.prostheticsCatalogEntries ?? [], artifact.payload.prostheticsCatalogReceipts ?? [], artifact.payload.prostheticsCatalogSources ?? [], artifact.payload.prostheticsCatalogDocuments ?? [], artifact.payload.prostheticPrescriptions ?? []);

    const coverage = backupAuditCoverage(artifact.payload);
    let audit: BackupRestoreResult['audit'] = { coverage, inserted: 0, reused: 0 };
    let receipt: RestoreReceipt | undefined;
    revokeAttachmentExtractionLocatorGeneration();
    runDbServerImmediateTransaction(() => {
        if (intent && restoreSnapshot(openDbServer()) !== intent.expectedSnapshot) {
            throw new BackupRestoreBlockedError('snapshot', 'archive changed after preview.');
        }
        const rows = canonicalizeBackupAuditRows(coverage === 'included' ? artifact.payload.auditEvents : []);
        let therapyCommands;
        try { therapyCommands = planTherapyStatusCommandUnion(openDbServer(), artifact.payload.therapyStatusCommands ?? [], rows); }
        catch { throw new BackupRestoreBlockedError('therapy_status_commands', 'therapy status command or audit collision.'); }
        let ambulatoryCommands;
        try { ambulatoryCommands = planAmbulatoryCommandUnion(openDbServer(), artifact.payload.ambulatoryDestructiveCommands ?? [], rows); }
        catch { throw new BackupRestoreBlockedError('ambulatory_destructive_commands', 'ambulatory command or audit collision.'); }
        const importedCommands = therapyCommands.filter(row => !openDbServer().prepare('SELECT 1 FROM therapy_status_commands WHERE command_id=?').get(row.commandId)).map(row => row.commandId as string);
        const plan = planBackupAuditRestore(rows);
        const physicianAttestations = physicianAttestationsWithoutRestoredAuthority(artifact.payload.physicianReviewAttestations ?? []);
        runMutationFence(beforeMutation);
        rotateSqliteArchiveGeneration(openDbServer());
        clearAllSessions();
        for (const collection of CLEAR_ORDER) {
            clearRows(TABLE_LOOKUP[collection]);
        }
        clearRows(patientsToAmbulatories);

        for (const collection of INSERT_ORDER) {
            insertRows(dbServer, TABLE_LOOKUP[collection], collection === 'physicianReviewAttestations'
                ? physicianAttestations : artifact.payload[collection] ?? []);
        }

        migrateProstheticsSources(dbServer.$client);
        insertRows(dbServer, patientsToAmbulatories, derivePatientAmbulatoryLinks(artifact.payload.patients));
        if (coverage === 'included') insertBackupAudits(plan);
        insertTherapyStatusCommandUnion(openDbServer(), therapyCommands);
        insertAmbulatoryCommandUnion(openDbServer(), ambulatoryCommands);
        recordPortableImport(plan, backupArtifactInputChecksum(artifact), importedCommands, actorRef);
        if (intent) receipt = writeRestoreReceipt(openDbServer(), intent, backupArtifactInputChecksum(artifact));
        audit = { coverage, inserted: plan.filter(item => !item.reused).length, reused: plan.filter(item => item.reused).length };
    });
    return { sourceChecksum: backupArtifactInputChecksum(artifact), audit, ...(receipt ? { receipt } : {}) };
}
