import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { eq } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { buildAttachmentPath } from '@/lib/attachment-path';
import {
    type DocumentOcrQueueState,
} from '@/lib/domain/documents/document-ocr-queue';
/* @Codex */
import { attachmentUpdateSchema } from '@/lib/api-schemas/attachments';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
import { isAttachmentCurrentnessHostError, isAttachmentMetadataCurrentnessHostError, transitionAttachmentMetadataCurrentness } from '@/lib/attachment-currentness-host';

const ATTACHMENT_DETAIL_RESPONSE_COLUMNS = {
    id: attachments.id,
    patientId: attachments.patientId,
    name: attachments.name,
    type: attachments.type,
    size: attachments.size,
    path: attachments.path,
    data: attachments.data,
    summarySnapshot: attachments.summarySnapshot,
    parseEvidenceArtifactSnapshot: attachments.parseEvidenceArtifactSnapshot,
    ocrQueueState: attachments.ocrQueueState,
    ocrQueueReason: attachments.ocrQueueReason,
    ocrQueueUpdatedAt: attachments.ocrQueueUpdatedAt,
    ocrReplayArtifactSnapshot: attachments.ocrReplayArtifactSnapshot,
    createdAt: attachments.createdAt,
} as const;

/* STREAM B: full attachment retrieval INCLUDING the base64 `data` blob. The list
   endpoint (GET /api/attachments?metadata=true) omits the blob; this by-id read is
   how the facade fetches the actual payload on demand. */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const row = await dbServer.select(ATTACHMENT_DETAIL_RESPONSE_COLUMNS).from(attachments).where(eq(attachments.id, id)).get();
        if (!row) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        return NextResponse.json({
            ...row,
            path: buildAttachmentPath(row.path, row.name, row.id),
        });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json().catch(() => null) as unknown;
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }
        const parsedBody = parseApiBody(attachmentUpdateSchema, body);
        if (!parsedBody.ok) return parsedBody.response;
        const payload = parsedBody.data;

        const updateData: {
            summarySnapshot?: string | null;
            parseEvidenceArtifactSnapshot?: string | null;
            ocrQueueState?: DocumentOcrQueueState;
        } = {};

        if (Object.prototype.hasOwnProperty.call(payload, 'summarySnapshot')) {
            if (payload.summarySnapshot === null || payload.summarySnapshot === '') {
                updateData.summarySnapshot = null;
            } else if (typeof payload.summarySnapshot === 'string') {
                updateData.summarySnapshot = payload.summarySnapshot;
            }
        }

        if (Object.prototype.hasOwnProperty.call(payload, 'parseEvidenceArtifactSnapshot')) {
            if (payload.parseEvidenceArtifactSnapshot === null || payload.parseEvidenceArtifactSnapshot === '') {
                updateData.parseEvidenceArtifactSnapshot = null;
            } else if (typeof payload.parseEvidenceArtifactSnapshot === 'string') {
                updateData.parseEvidenceArtifactSnapshot = payload.parseEvidenceArtifactSnapshot;
            }
        }

        if (payload.ocrQueueState !== undefined) {
            updateData.ocrQueueState = payload.ocrQueueState;
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        transitionAttachmentMetadataCurrentness(id, {
            summarySnapshot: updateData.summarySnapshot,
            parseEvidenceArtifactSnapshot: updateData.parseEvidenceArtifactSnapshot,
            ocrQueueState: updateData.ocrQueueState,
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (isAttachmentMetadataCurrentnessHostError(error)) {
            if (error.code === 'ocr_queue_unavailable') return NextResponse.json({ error: 'Attachment is not in the OCR queue' }, { status: 409 });
            return NextResponse.json({ error: 'Invalid OCR queue state transition' }, { status: 409 });
        }
        if (isAttachmentCurrentnessHostError(error)) {
            if (error.code === 'attachment_missing') return NextResponse.json({ error: 'Not found' }, { status: 404 });
            if (error.code === 'currentness_overflow') return NextResponse.json({ error: 'Attachment currentness cannot advance' }, { status: 409 });
            if (error.code === 'currentness_conflict') return NextResponse.json({ error: 'Attachment changed; reload and retry' }, { status: 409 });
            if (error.code === 'input_invalid') return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }
        return NextResponse.json({ error: "Update Failed" }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const deleted = await dbServer.delete(attachments).where(eq(attachments.id, id));
        if (deleted.changes !== 1) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
