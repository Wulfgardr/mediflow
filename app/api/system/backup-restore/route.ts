/* @Codex */
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import {
    attachments,
    ambulatories,
    checkups,
    conversations,
    documentDiagnosisProposals,
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
    type BackupDataset,
    serializeBackupArtifact,
} from '@/lib/backup-artifact';
import { enrichBackupPatientsWithAmbulatoryLinks } from '@/lib/backup-patient-ambulatory-links';
import { restoreBackupArtifact } from '@/lib/backup-restore-executor';
import { runBackupRestorePreflight } from '@/lib/backup-restore-preflight';
import { apiInternalError } from '@/lib/api-error-response';

/* @Codex */
export const dynamic = 'force-dynamic';

/* @Codex */
function sortBackupRows<T extends Record<string, unknown>>(rows: T[]): T[] {
    return [...rows].sort((left, right) => {
        const leftKey = String(left.idempotencyKey ?? left.attestationRef ?? left.actorRef ?? left.id ?? left.key ?? left.code ?? left.aic ?? left.patientId ?? left.conversationId ?? '');
        const rightKey = String(right.idempotencyKey ?? right.attestationRef ?? right.actorRef ?? right.id ?? right.key ?? right.code ?? right.aic ?? right.patientId ?? right.conversationId ?? '');
        const primary = leftKey.localeCompare(rightKey);
        return primary === 0 ? String(left.actorRef ?? '').localeCompare(String(right.actorRef ?? '')) : primary;
    });
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
function buildBackupDataset(): BackupDataset {
    return dbServer.transaction((tx): BackupDataset => {
        const ambulatoriesRows = tx.select().from(ambulatories).all();
        const attachmentsRows = tx.select().from(attachments).all();
        const conversationsRows = tx.select().from(conversations).all();
        const documentDiagnosisProposalRows = tx.select().from(documentDiagnosisProposals).all();
        const durableReviewRecordRows = tx.select().from(durableReviewRecords).all();
        const durableReviewOperationRows = tx.select().from(durableReviewOperations).all();
        const durableReviewPatientLinkRows = tx.select().from(durableReviewPatientLinks).all();
        const drugsRows = tx.select().from(drugs).all();
        const entriesRows = tx.select().from(entries).all();
        const exemptionsRows = tx.select().from(exemptions).all();
        const messagesRows = tx.select().from(messages).all();
        const observationsRows = tx.select().from(observations).all();
        const patientsRows = tx.select().from(patients).all();
        const physicianReviewAttestationRows = tx.select().from(physicianReviewAttestations).all();
        const headlessSoapActiveRoleAttestationRows = tx.select().from(headlessSoapActiveRoleAttestations).all();
        const headlessSoapEntryCommitRows = tx.select().from(headlessSoapEntryCommits).all();
        const prostheticPrescriptionRows = tx.select().from(prostheticPrescriptions).all();
        const serviceCatalogRows = tx.select().from(serviceCatalogEntries).all();
        const servicePrescriptionItemRows = tx.select().from(servicePrescriptionItems).all();
        const servicePrescriptionRows = tx.select().from(servicePrescriptions).all();
        const sissHandoffRows = tx.select().from(sissHandoffEvents).all();
        const checkupsRows = tx.select().from(checkups).all();
        const therapiesRows = tx.select().from(therapies).all();
        const patientAmbulatoryRows = tx.select().from(patientsToAmbulatories).all();

    const normalizedPatientAmbulatoryRows = sortBackupRows(patientAmbulatoryRows);
    const enrichedPatients = enrichBackupPatientsWithAmbulatoryLinks(patientsRows, normalizedPatientAmbulatoryRows);
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
    const durableReviewIds = new Set(
        durableReviewRecordRows
            .map((record) => record.reviewId)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );

        return {
            ambulatories: sortBackupRows(ambulatoriesRows),
            attachments: sortBackupRows(filterRowsByReference(attachmentsRows, 'patientId', patientIds)),
            conversations: sortBackupRows(conversationsRows),
            documentDiagnosisProposals: sortBackupRows(filterRowsByReference(documentDiagnosisProposalRows, 'patientId', patientIds)),
            durableReviewPatientLinks: sortBackupRows(
                filterRowsByReference(durableReviewPatientLinkRows, 'patientId', patientIds)
                    .filter((link) => typeof link.reviewId === 'string' && durableReviewIds.has(link.reviewId)),
            ),
            durableReviewRecords: sortBackupRows(durableReviewRecordRows),
            durableReviewOperations: sortBackupRows(durableReviewOperationRows),
            drugs: sortBackupRows(drugsRows),
            entries: sortBackupRows(filterRowsByReference(entriesRows, 'patientId', patientIds)),
            exemptions: sortBackupRows(exemptionsRows),
            messages: sortBackupRows(filterRowsByReference(messagesRows, 'conversationId', conversationIds)),
            observations: sortBackupRows(filterRowsByReference(observationsRows, 'patientId', patientIds)),
            patients: sortBackupRows(enrichedPatients),
            physicianReviewAttestations: sortBackupRows(physicianReviewAttestationRows),
            headlessSoapActiveRoleAttestations: sortBackupRows(headlessSoapActiveRoleAttestationRows),
            headlessSoapEntryCommits: sortBackupRows(headlessSoapEntryCommitRows),
            prostheticPrescriptions: sortBackupRows(filterRowsByReference(prostheticPrescriptionRows, 'patientId', patientIds)),
            serviceCatalogEntries: sortBackupRows(serviceCatalogRows),
            servicePrescriptionItems: sortBackupRows(filterRowsByReference(servicePrescriptionItemRows, 'patientId', patientIds)),
            servicePrescriptions: sortBackupRows(filterRowsByReference(servicePrescriptionRows, 'patientId', patientIds)),
            sissHandoffs: sortBackupRows(filterRowsByReference(sissHandoffRows, 'patientId', patientIds)),
            checkups: sortBackupRows(filterRowsByReference(checkupsRows, 'patientId', patientIds)),
            therapies: sortBackupRows(filterRowsByReference(therapiesRows, 'patientId', patientIds)),
        };
    });
}

/* @Codex */
export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();

    try {
        const payload = buildBackupDataset();
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

        restoreBackupArtifact(artifact);

        return NextResponse.json({
            success: true,
            format: artifact.format,
            version: artifact.version,
            collections: [...BACKUP_COLLECTIONS],
            counts: artifact.manifest.recordCounts,
        });
    } catch (error) {
        /* La distinzione 400/500 resta: un artefatto malformato e' colpa del
           chiamante, il resto no. Cio' che non torna piu' e' il dettaglio, che
           su un restore contiene percorsi e struttura del manifest. */
        const malformato = error instanceof SyntaxError;
        return apiInternalError('Backup restore failed', error, {
            status: malformato ? 400 : 500,
            code: malformato ? 'invalid_backup_artifact' : 'restore_failed',
            message: malformato ? 'Artefatto di backup non valido.' : 'Ripristino non riuscito.',
            /* La route espone `success` anche negli altri due rami d'errore
               (righe 140 e 154): il campo resta per non spezzarne il contratto. */
            extra: { success: false },
        });
    }
}
