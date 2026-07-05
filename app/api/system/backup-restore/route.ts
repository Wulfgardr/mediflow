/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import {
    attachments,
    ambulatories,
    checkups,
    conversations,
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
} from '@/lib/schema';
import {
    forbiddenResponse,
    requireSession,
    unauthorizedResponse,
} from '@/lib/security/server-auth';
/* @Codex */
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import {
    BACKUP_COLLECTIONS,
    type BackupArtifact,
    type BackupCollectionName,
    type BackupDataset,
    serializeBackupArtifact,
} from '@/lib/backup-artifact';
import { runBackupRestorePreflight } from '@/lib/backup-restore-preflight';

/* @Codex */
export const dynamic = 'force-dynamic';

const CLEAR_ORDER: BackupCollectionName[] = [
    'messages',
    'attachments',
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
    'entries',
    'therapies',
    'checkups',
    'observations',
    'prostheticPrescriptions',
    'servicePrescriptions',
    'servicePrescriptionItems',
    'serviceCatalogEntries',
    'sissHandoffs',
    'attachments',
    'messages',
];

const TABLES = {
    ambulatories,
    attachments,
    checkups,
    conversations,
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
    sissHandoffs: sissHandoffEvents,
    therapies,
} as const;

const TABLE_LOOKUP = {
    ambulatories,
    attachments,
    checkups,
    conversations,
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
type InsertableTable =
    | typeof ambulatories
    | typeof attachments
    | typeof checkups
    | typeof conversations
    | typeof drugs
    | typeof entries
    | typeof exemptions
    | typeof messages
    | typeof observations
    | typeof patients
    | typeof patientsToAmbulatories
    | typeof prostheticPrescriptions
    | typeof serviceCatalogEntries
    | typeof servicePrescriptionItems
    | typeof servicePrescriptions
    | typeof sissHandoffEvents
    | typeof therapies;

type PatientAmbulatoryLinkRow = {
    patientId: string;
    ambulatoryId: string;
    assignedAt: Date | null;
};

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

/* @Codex */
function sortBackupRows<T extends Record<string, unknown>>(rows: T[]): T[] {
    return [...rows].sort((left, right) => {
        const leftKey = String(left.id ?? left.key ?? left.code ?? left.aic ?? left.patientId ?? left.conversationId ?? '');
        const rightKey = String(right.id ?? right.key ?? right.code ?? right.aic ?? right.patientId ?? right.conversationId ?? '');
        return leftKey.localeCompare(rightKey);
    });
}

/* @Codex */
function buildAssignedAmbulatoryIds(
    patient: Record<string, unknown>,
    rows: PatientAmbulatoryLinkRow[]
): string[] {
    const ids = new Set<string>();

    if (typeof patient.ambulatoryId === 'string' && patient.ambulatoryId.trim().length > 0) {
        ids.add(patient.ambulatoryId);
    }

    for (const row of rows) {
        if (row.patientId === patient.id && row.ambulatoryId.trim().length > 0) {
            ids.add(row.ambulatoryId);
        }
    }

    return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

/* @Codex */
function filterRowsByReference<T extends Record<string, unknown>>(
    rows: T[],
    foreignKey: 'patientId' | 'conversationId',
    validRefs: Set<string>
): T[] {
    return rows.filter((row) => {
        const value = row[foreignKey];
        return typeof value === 'string' && validRefs.has(value);
    });
}

/* @Codex */
async function buildBackupDataset(): Promise<BackupDataset> {
    const [
        ambulatoriesRows,
        attachmentsRows,
        conversationsRows,
        drugsRows,
        entriesRows,
        exemptionsRows,
        messagesRows,
        observationsRows,
        patientsRows,
        prostheticPrescriptionRows,
        serviceCatalogRows,
        servicePrescriptionItemRows,
        servicePrescriptionRows,
        sissHandoffRows,
        checkupsRows,
        therapiesRows,
        patientAmbulatoryRows,
    ] = await Promise.all([
        dbServer.select().from(ambulatories),
        dbServer.select().from(attachments),
        dbServer.select().from(conversations),
        dbServer.select().from(drugs),
        dbServer.select().from(entries),
        dbServer.select().from(exemptions),
        dbServer.select().from(messages),
        dbServer.select().from(observations),
        dbServer.select().from(patients),
        dbServer.select().from(prostheticPrescriptions),
        dbServer.select().from(serviceCatalogEntries),
        dbServer.select().from(servicePrescriptionItems),
        dbServer.select().from(servicePrescriptions),
        dbServer.select().from(sissHandoffEvents),
        dbServer.select().from(checkups),
        dbServer.select().from(therapies),
        dbServer.select().from(patientsToAmbulatories),
    ]);

    const normalizedPatientAmbulatoryRows = sortBackupRows(patientAmbulatoryRows);
    const enrichedPatients = patientsRows.map((patient) => {
        const assignedAmbulatoryIds = buildAssignedAmbulatoryIds(patient, normalizedPatientAmbulatoryRows);
        return assignedAmbulatoryIds.length > 0
            ? { ...patient, assignedAmbulatoryIds }
            : patient;
    });
    const patientIds = new Set(
        enrichedPatients
            .map((patient) => patient.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );
    const conversationIds = new Set(
        conversationsRows
            .map((conversation) => conversation.id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );

    return {
        ambulatories: sortBackupRows(ambulatoriesRows),
        attachments: sortBackupRows(filterRowsByReference(attachmentsRows, 'patientId', patientIds)),
        conversations: sortBackupRows(conversationsRows),
        drugs: sortBackupRows(drugsRows),
        entries: sortBackupRows(filterRowsByReference(entriesRows, 'patientId', patientIds)),
        exemptions: sortBackupRows(exemptionsRows),
        messages: sortBackupRows(filterRowsByReference(messagesRows, 'conversationId', conversationIds)),
        observations: sortBackupRows(filterRowsByReference(observationsRows, 'patientId', patientIds)),
        patients: sortBackupRows(enrichedPatients),
        prostheticPrescriptions: sortBackupRows(filterRowsByReference(prostheticPrescriptionRows, 'patientId', patientIds)),
        serviceCatalogEntries: sortBackupRows(serviceCatalogRows),
        servicePrescriptionItems: sortBackupRows(filterRowsByReference(servicePrescriptionItemRows, 'patientId', patientIds)),
        servicePrescriptions: sortBackupRows(filterRowsByReference(servicePrescriptionRows, 'patientId', patientIds)),
        sissHandoffs: sortBackupRows(filterRowsByReference(sissHandoffRows, 'patientId', patientIds)),
        checkups: sortBackupRows(filterRowsByReference(checkupsRows, 'patientId', patientIds)),
        therapies: sortBackupRows(filterRowsByReference(therapiesRows, 'patientId', patientIds)),
    };
}

/* @Codex */
const DATE_FIELDS = new Set([
    'assignedAt',
    'birthDate',
    'collaudoAt',
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

function insertRows<T extends Record<string, unknown>>(runner: InsertRunner, table: InsertableTable, rows: T[]): void {
    if (rows.length === 0) return;
    for (const group of chunk(rows, 250)) {
        runner.insert(table).values(group.map(normalizeInsertRow)).run();
    }
}

/* @Codex */
function parseAssignedAmbulatoryIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    ));
}

function derivePatientLinks(patientsPayload: BackupArtifact['payload']['patients']): Array<{ patientId: string; ambulatoryId: string; assignedAt: Date }> {
    return patientsPayload.flatMap((patient) => {
        if (typeof patient.id !== 'string') {
            return [];
        }
        const patientId = patient.id;

        const assignedAt = typeof patient.updatedAt === 'string'
            ? new Date(patient.updatedAt)
            : typeof patient.createdAt === 'string'
                ? new Date(patient.createdAt)
                : new Date();

        const normalizedAssignedAt = Number.isNaN(assignedAt.getTime()) ? new Date() : assignedAt;
        const ambulatoryIds = new Set(parseAssignedAmbulatoryIds(patient.assignedAmbulatoryIds));
        if (typeof patient.ambulatoryId === 'string' && patient.ambulatoryId.trim().length > 0) {
            ambulatoryIds.add(patient.ambulatoryId);
        }

        return Array.from(ambulatoryIds).map((ambulatoryId) => ({
            patientId,
            ambulatoryId,
            assignedAt: normalizedAssignedAt,
        }));
    });
}

/* @Codex */
export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const payload = await buildBackupDataset();
        const serialized = await serializeBackupArtifact(payload);
        return new NextResponse(serialized, {
            status: 200,
            headers: {
                'Cache-Control': 'no-store',
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    } catch (error) {
        console.error('[MediFlow] Backup export failed:', error);
        return NextResponse.json({ success: false, error: 'Backup export failed.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const body = await request.json();
        const { artifact, result: preflight } = await runBackupRestorePreflight(body);
        if (!preflight.ok || !artifact) {
            return NextResponse.json(
                { success: false, error: preflight.error ?? 'Restore preflight failed.', preflight },
                { status: 412 },
            );
        }

        // @Codex better-sqlite3 transactions are synchronous; promise callbacks break restore execution.
        dbServer.transaction((tx) => {
            for (const collection of CLEAR_ORDER) {
                tx.delete(TABLE_LOOKUP[collection]).run();
            }
            tx.delete(TABLES.patientsToAmbulatories).run();

            for (const collection of INSERT_ORDER) {
                if (collection === 'patients') {
                    insertRows(tx, TABLE_LOOKUP.patients, artifact.payload.patients);
                    continue;
                }

                if (collection === 'ambulatories') {
                    insertRows(tx, TABLE_LOOKUP.ambulatories, artifact.payload.ambulatories);
                    continue;
                }

                if (collection === 'drugs') {
                    insertRows(tx, TABLE_LOOKUP.drugs, artifact.payload.drugs);
                    continue;
                }

                if (collection === 'exemptions') {
                    insertRows(tx, TABLE_LOOKUP.exemptions, artifact.payload.exemptions);
                    continue;
                }

                if (collection === 'conversations') {
                    insertRows(tx, TABLE_LOOKUP.conversations, artifact.payload.conversations);
                    continue;
                }

                if (collection === 'entries') {
                    insertRows(tx, TABLE_LOOKUP.entries, artifact.payload.entries);
                    continue;
                }

                if (collection === 'therapies') {
                    insertRows(tx, TABLE_LOOKUP.therapies, artifact.payload.therapies);
                    continue;
                }

                if (collection === 'checkups') {
                    insertRows(tx, TABLE_LOOKUP.checkups, artifact.payload.checkups);
                    continue;
                }

                if (collection === 'observations') {
                    insertRows(tx, TABLE_LOOKUP.observations, artifact.payload.observations);
                    continue;
                }

                if (collection === 'prostheticPrescriptions') {
                    insertRows(tx, TABLE_LOOKUP.prostheticPrescriptions, artifact.payload.prostheticPrescriptions);
                    continue;
                }

                if (collection === 'servicePrescriptions') {
                    insertRows(tx, TABLE_LOOKUP.servicePrescriptions, artifact.payload.servicePrescriptions);
                    continue;
                }

                if (collection === 'servicePrescriptionItems') {
                    insertRows(tx, TABLE_LOOKUP.servicePrescriptionItems, artifact.payload.servicePrescriptionItems);
                    continue;
                }

                if (collection === 'serviceCatalogEntries') {
                    insertRows(tx, TABLE_LOOKUP.serviceCatalogEntries, artifact.payload.serviceCatalogEntries);
                    continue;
                }

                if (collection === 'sissHandoffs') {
                    insertRows(tx, TABLE_LOOKUP.sissHandoffs, artifact.payload.sissHandoffs);
                    continue;
                }

                if (collection === 'attachments') {
                    insertRows(tx, TABLE_LOOKUP.attachments, artifact.payload.attachments);
                    continue;
                }

                if (collection === 'messages') {
                    insertRows(tx, TABLE_LOOKUP.messages, artifact.payload.messages);
                }
            }

            const patientLinks = derivePatientLinks(artifact.payload.patients);
            insertRows(tx, TABLES.patientsToAmbulatories, patientLinks);
        });

        return NextResponse.json({
            success: true,
            format: artifact.format,
            version: artifact.version,
            collections: [...BACKUP_COLLECTIONS],
            counts: artifact.manifest.recordCounts,
        });
    } catch (error) {
        console.error('[MediFlow] Backup restore failed:', error);
        const message = error instanceof Error ? error.message : 'Restore failed.';
        const status = error instanceof SyntaxError ? 400 : 500;
        return NextResponse.json({ success: false, error: message }, { status });
    }
}
