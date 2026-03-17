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
    therapies,
} from '@/lib/schema';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';
import {
    BACKUP_COLLECTIONS,
    BackupArtifactError,
    type BackupArtifact,
    type BackupCollectionName,
    parseBackupArtifact,
} from '@/lib/backup-artifact';

/* @Codex */
export const dynamic = 'force-dynamic';

const CLEAR_ORDER: BackupCollectionName[] = [
    'messages',
    'attachments',
    'observations',
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
    | typeof therapies;

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

async function insertRows<T extends Record<string, unknown>>(runner: InsertRunner, table: InsertableTable, rows: T[]): Promise<void> {
    if (rows.length === 0) return;
    for (const group of chunk(rows, 250)) {
        await runner.insert(table).values(group);
    }
}

function derivePatientLinks(patientsPayload: BackupArtifact['payload']['patients']): Array<{ patientId: string; ambulatoryId: string; assignedAt: Date }> {
    return patientsPayload.flatMap((patient) => {
        if (typeof patient.id !== 'string' || typeof patient.ambulatoryId !== 'string' || patient.ambulatoryId.trim().length === 0) {
            return [];
        }

        const assignedAt = typeof patient.updatedAt === 'string'
            ? new Date(patient.updatedAt)
            : typeof patient.createdAt === 'string'
                ? new Date(patient.createdAt)
                : new Date();

        return [{
            patientId: patient.id,
            ambulatoryId: patient.ambulatoryId,
            assignedAt: Number.isNaN(assignedAt.getTime()) ? new Date() : assignedAt,
        }];
    });
}

export async function POST(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json();
        const artifact = await parseBackupArtifact(body);

        await dbServer.transaction(async (tx) => {
            for (const collection of CLEAR_ORDER) {
                await tx.delete(TABLE_LOOKUP[collection]);
            }
            await tx.delete(TABLES.patientsToAmbulatories);

            for (const collection of INSERT_ORDER) {
                if (collection === 'patients') {
                    await insertRows(tx, TABLE_LOOKUP.patients, artifact.payload.patients);
                    continue;
                }

                if (collection === 'ambulatories') {
                    await insertRows(tx, TABLE_LOOKUP.ambulatories, artifact.payload.ambulatories);
                    continue;
                }

                if (collection === 'drugs') {
                    await insertRows(tx, TABLE_LOOKUP.drugs, artifact.payload.drugs);
                    continue;
                }

                if (collection === 'exemptions') {
                    await insertRows(tx, TABLE_LOOKUP.exemptions, artifact.payload.exemptions);
                    continue;
                }

                if (collection === 'conversations') {
                    await insertRows(tx, TABLE_LOOKUP.conversations, artifact.payload.conversations);
                    continue;
                }

                if (collection === 'entries') {
                    await insertRows(tx, TABLE_LOOKUP.entries, artifact.payload.entries);
                    continue;
                }

                if (collection === 'therapies') {
                    await insertRows(tx, TABLE_LOOKUP.therapies, artifact.payload.therapies);
                    continue;
                }

                if (collection === 'checkups') {
                    await insertRows(tx, TABLE_LOOKUP.checkups, artifact.payload.checkups);
                    continue;
                }

                if (collection === 'observations') {
                    await insertRows(tx, TABLE_LOOKUP.observations, artifact.payload.observations);
                    continue;
                }

                if (collection === 'attachments') {
                    await insertRows(tx, TABLE_LOOKUP.attachments, artifact.payload.attachments);
                    continue;
                }

                if (collection === 'messages') {
                    await insertRows(tx, TABLE_LOOKUP.messages, artifact.payload.messages);
                }
            }

            const patientLinks = derivePatientLinks(artifact.payload.patients);
            await insertRows(tx, TABLES.patientsToAmbulatories, patientLinks);
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
        const status = error instanceof BackupArtifactError ? 400 : 500;
        return NextResponse.json({ success: false, error: message }, { status });
    }
}
