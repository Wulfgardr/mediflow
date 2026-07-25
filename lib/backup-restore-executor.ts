/* @Codex */
import { dbServer } from './db-server';
import {
    ambulatories,
    attachments,
    checkups,
    conversations,
    documentDiagnosisProposals,
    drugs,
    entries,
    exemptions,
    messages,
    observations,
    patients,
    patientsToAmbulatories,
    prostheticPrescriptions,
    serviceCatalogEntries,
    servicePrescriptionItems,
    servicePrescriptions,
    sissHandoffEvents,
    therapies,
} from './schema';
import type { BackupArtifact, BackupCollectionName } from './backup-artifact';
import { derivePatientAmbulatoryLinks } from './backup-patient-ambulatory-links';

const CLEAR_ORDER: BackupCollectionName[] = [
    'messages',
    'attachments',
    'documentDiagnosisProposals',
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
    ambulatories,
    attachments,
    checkups,
    conversations,
    documentDiagnosisProposals,
    drugs,
    entries,
    exemptions,
    messages,
    observations,
    patients,
    prostheticPrescriptions,
    serviceCatalogEntries,
    servicePrescriptionItems,
    servicePrescriptions,
    sissHandoffs: sissHandoffEvents,
    therapies,
} as const;

type InsertRunner = Pick<typeof dbServer, 'insert'>;
type InsertableTable = (typeof TABLE_LOOKUP)[BackupCollectionName] | typeof patientsToAmbulatories;

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

export function restoreBackupArtifact(artifact: BackupArtifact): void {
    dbServer.transaction((tx) => {
        for (const collection of CLEAR_ORDER) {
            tx.delete(TABLE_LOOKUP[collection]).run();
        }
        tx.delete(patientsToAmbulatories).run();

        for (const collection of INSERT_ORDER) {
            insertRows(tx, TABLE_LOOKUP[collection], artifact.payload[collection]);
        }

        insertRows(tx, patientsToAmbulatories, derivePatientAmbulatoryLinks(artifact.payload.patients));
    });
}
