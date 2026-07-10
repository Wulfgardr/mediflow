/* @Codex */
import { and, desc, eq } from 'drizzle-orm';
/* @Codex */
import { buildAttachmentPath } from './attachment-path';
/* @Codex */
import { dbServer } from './db-server';
/* @Codex */
import type { AttachmentDetail, AttachmentSummary } from './api/v1/types';
/* @Codex */
import { isDocumentOcrQueueReason, isDocumentOcrQueueState } from './domain/documents/document-ocr-queue';
/* @Codex */
import { attachments, patientsToAmbulatories } from './schema';

/* @Codex */
export const NETWORK_ATTACHMENT_READ_CAPABILITY = 'network.replica.readonly-documents';

function toIsoString(value: unknown): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Mirrors the host list projection (app/api/attachments/route.ts
// ATTACHMENT_METADATA_COLUMNS): every attachment column except the base64
// `data` blob, so a list never ships (or decrypts) attachment payloads.
function toAttachmentSummary(row: typeof attachments.$inferSelect): AttachmentSummary {
    return {
        id: row.id,
        patientId: row.patientId,
        name: row.name,
        type: row.type,
        size: row.size,
        path: buildAttachmentPath(row.path, row.name, row.id),
        summarySnapshot: row.summarySnapshot ?? null,
        parseEvidenceArtifactSnapshot: row.parseEvidenceArtifactSnapshot ?? null,
        ocrQueueState: isDocumentOcrQueueState(row.ocrQueueState) ? row.ocrQueueState : null,
        ocrQueueReason: isDocumentOcrQueueReason(row.ocrQueueReason) ? row.ocrQueueReason : null,
        ocrQueueUpdatedAt: toIsoString(row.ocrQueueUpdatedAt),
        ocrReplayArtifactSnapshot: row.ocrReplayArtifactSnapshot ?? null,
        createdAt: toIsoString(row.createdAt),
    };
}

/* @Codex */
export async function listNetworkScopedAttachments(
    patientId: string,
    scopeAmbulatoryId: string
): Promise<AttachmentSummary[]> {
    const rows = await dbServer
        .select({ attachment: attachments })
        .from(attachments)
        .innerJoin(patientsToAmbulatories, eq(attachments.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(attachments.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .orderBy(desc(attachments.createdAt));

    return rows.map((row) => toAttachmentSummary(row.attachment));
}

/* @Codex */
export async function getNetworkScopedAttachment(
    patientId: string,
    attachmentId: string,
    scopeAmbulatoryId: string
): Promise<AttachmentDetail | null> {
    const row = await dbServer
        .select({ attachment: attachments })
        .from(attachments)
        .innerJoin(patientsToAmbulatories, eq(attachments.patientId, patientsToAmbulatories.patientId))
        .where(and(
            eq(attachments.id, attachmentId),
            eq(attachments.patientId, patientId),
            eq(patientsToAmbulatories.ambulatoryId, scopeAmbulatoryId),
        ))
        .get();

    if (!row) return null;

    return {
        ...toAttachmentSummary(row.attachment),
        data: row.attachment.data ?? null,
    };
}
