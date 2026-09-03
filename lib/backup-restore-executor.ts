/* @Codex */
import { eq } from 'drizzle-orm';
import { dbServer, runDbServerImmediateTransaction } from './db-server';
import {
    ambulatories,
    auditEvents,
    attachments,
    checkups,
    conversations,
    documentDiagnosisProposals,
    durableReviewCommandOperations,
    durableReviewCommandStates,
    durableReviewOperations,
    durableReviewPatientLinks,
    durableReviewRecords,
    drugs,
    entries,
    exemptions,
    headlessSoapActiveRoleAttestations,
    headlessSoapEntryCommits,
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
import type { BackupArtifact, BackupCollectionName } from './backup-artifact';
import { derivePatientAmbulatoryLinks } from './backup-patient-ambulatory-links';
import { revokeAttachmentExtractionLocatorGeneration } from './domain/documents/attachment-extraction-locator-revocation';

const CLEAR_ORDER: BackupCollectionName[] = [
    'headlessSoapEntryCommits',
    'messages',
    'attachments',
    'documentDiagnosisProposals',
    'durableReviewCommandOperations',
    'durableReviewCommandStates',
    'durableReviewPatientLinks',
    'durableReviewOperations',
    'durableReviewRecords',
    'physicianReviewAttestations',
    'headlessSoapActiveRoleAttestations',
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
    'ambulatories',
];

const INSERT_ORDER: BackupCollectionName[] = [
    'ambulatories',
    'drugs',
    'exemptions',
    'conversations',
    'patients',
    'physicianReviewAttestations',
    'headlessSoapActiveRoleAttestations',
    'documentDiagnosisProposals',
    'durableReviewRecords',
    'durableReviewOperations',
    'durableReviewPatientLinks',
    'durableReviewCommandStates',
    'durableReviewCommandOperations',
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
    ambulatories,
    headlessSoapEntryCommits,
    attachments,
    checkups,
    conversations,
    documentDiagnosisProposals,
    durableReviewCommandOperations,
    durableReviewCommandStates,
    durableReviewOperations,
    durableReviewPatientLinks,
    durableReviewRecords,
    drugs,
    entries,
    exemptions,
    messages,
    observations,
    patients,
    physicianReviewAttestations,
    headlessSoapActiveRoleAttestations,
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

/* @Codex v1 cannot restore command replay receipts without their append-only audit ledger. */
function assertCommandRecoveryIsRepresentable(): void {
    const state = dbServer.select({ reviewId: durableReviewCommandStates.reviewId }).from(durableReviewCommandStates).get();
    const operation = dbServer.select({ id: durableReviewCommandOperations.id }).from(durableReviewCommandOperations).get();
    if (state || operation) {
        throw new Error('Restore blocked: durable review commands require the append-only audit ledger.');
    }
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

export const DATE_FIELDS = new Set([
    'assignedAt',
    'birthDate',
    'collaudoAt',
    'decidedAt',
    'createdAt',
    'date',
    'endDate',
    'importedAt',
    'observedAt',
    'ocrQueueUpdatedAt',
    'performedAt',
    'prescribedAt',
    'reportReceivedAt',
    'scheduledAt',
    'startDate',
    'startedAt',
    'completedAt',
    'committedAt',
    'expiresAt',
    'activatedAt',
    'revokedAt',
    'deletedAt',
    'updatedAt',
]);

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

function insertRows<T extends Record<string, unknown>>(
    runner: InsertRunner,
    table: InsertableTable,
    rows: T[],
): void {
    if (rows.length === 0) return;
    for (const group of chunk(rows, 250)) {
        runner.insert(table).values(group.map(normalizeInsertRow)).run();
    }
}

const HEADLESS_SOAP_AUDIT_KEYS = [
    'eventId', 'schemaVersion', 'eventType', 'occurredAt', 'outcome', 'actorType', 'actorRef',
    'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata', 'createdAt',
] as const;

/* @Codex */
function parseHeadlessSoapAuditSnapshot(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') throw new Error('Restore blocked: invalid H7b audit snapshot.');
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            || JSON.stringify(parsed) !== value
            || Object.keys(parsed).length !== HEADLESS_SOAP_AUDIT_KEYS.length
            || HEADLESS_SOAP_AUDIT_KEYS.some((key, index) => Object.keys(parsed)[index] !== key)) {
            throw new Error('invalid');
        }
        return parsed as Record<string, unknown>;
    } catch {
        throw new Error('Restore blocked: invalid H7b audit snapshot.');
    }
}

/* @Codex */
function dateSeconds(value: Date | null): number | null {
    return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() % 1000 === 0
        ? value.getTime() / 1000
        : null;
}

/* @Codex */
function snapshotStoredAudit(row: typeof auditEvents.$inferSelect): Record<string, unknown> {
    return {
        eventId: row.eventId, schemaVersion: row.schemaVersion, eventType: row.eventType,
        occurredAt: dateSeconds(row.occurredAt), outcome: row.outcome, actorType: row.actorType,
        actorRef: row.actorRef, subjectType: row.subjectType, subjectRef: row.subjectRef,
        sourceSurface: row.sourceSurface, requestId: row.requestId, redactedMetadata: row.redactedMetadata,
        createdAt: dateSeconds(row.createdAt),
    };
}

/* @Codex Audit collision checks run under the writer lock and before any target collection is cleared. */
function preflightHeadlessSoapAuditCollisions(rows: Record<string, unknown>[]): void {
    for (const row of rows) {
        const audit = parseHeadlessSoapAuditSnapshot(row.auditSnapshot);
        const eventId = audit.eventId;
        if (typeof eventId !== 'string') throw new Error('Restore blocked: invalid H7b audit snapshot.');
        const existing = dbServer.select().from(auditEvents).where(eq(auditEvents.eventId, eventId)).get();
        if (existing && JSON.stringify(snapshotStoredAudit(existing)) !== row.auditSnapshot) {
            throw new Error('Restore blocked: H7b audit collision.');
        }
    }
}

/* @Codex Restore must synchronously retire volatile authority before the first destructive write. */
function runMutationFence(fence: BackupRestoreMutationFence): void {
    if (typeof fence !== 'function') {
        throw new Error('Restore blocked: runtime mutation fence unavailable.');
    }
    try {
        if (typeof fence() !== 'boolean') {
            throw new Error('invalid fence result');
        }
    } catch {
        throw new Error('Restore blocked: runtime mutation fence unavailable.');
    }
}

/* @Codex Entries already exist at this point; audits are inserted/reused field-exactly before the ledger. */
function restoreHeadlessSoapEntryCommits(rows: Record<string, unknown>[]): void {
    for (const row of rows) {
        const audit = parseHeadlessSoapAuditSnapshot(row.auditSnapshot);
        const eventId = audit.eventId as string;
        const existing = dbServer.select().from(auditEvents).where(eq(auditEvents.eventId, eventId)).get();
        if (existing) {
            if (JSON.stringify(snapshotStoredAudit(existing)) !== row.auditSnapshot) {
                throw new Error('Restore blocked: H7b audit collision.');
            }
        } else {
            dbServer.insert(auditEvents).values({
                eventId,
                schemaVersion: audit.schemaVersion as number,
                eventType: audit.eventType as string,
                occurredAt: new Date((audit.occurredAt as number) * 1000),
                outcome: audit.outcome as string,
                actorType: audit.actorType as string,
                actorRef: audit.actorRef as string,
                subjectType: audit.subjectType as string,
                subjectRef: audit.subjectRef as string | null,
                sourceSurface: audit.sourceSurface as string,
                requestId: audit.requestId as string | null,
                redactedMetadata: audit.redactedMetadata as string | null,
                createdAt: new Date((audit.createdAt as number) * 1000),
            }).run();
        }
    }
    insertRows(dbServer, headlessSoapEntryCommits, rows);
}

export function restoreBackupArtifact(
    artifact: BackupArtifact,
    beforeMutation: BackupRestoreMutationFence,
): void {
    revokeAttachmentExtractionLocatorGeneration();
    runDbServerImmediateTransaction(() => {
        assertCommandRecoveryIsRepresentable();
        const headlessSoapRows = artifact.payload.headlessSoapEntryCommits ?? [];
        preflightHeadlessSoapAuditCollisions(headlessSoapRows);
        runMutationFence(beforeMutation);
        for (const collection of CLEAR_ORDER) {
            dbServer.delete(TABLE_LOOKUP[collection]).run();
        }
        dbServer.delete(patientsToAmbulatories).run();

        for (const collection of INSERT_ORDER) {
            insertRows(dbServer, TABLE_LOOKUP[collection], artifact.payload[collection] ?? []);
        }

        insertRows(dbServer, patientsToAmbulatories, derivePatientAmbulatoryLinks(artifact.payload.patients));
        restoreHeadlessSoapEntryCommits(headlessSoapRows);
    });
}
