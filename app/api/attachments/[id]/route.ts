import { readBoundedJsonBody } from '@/lib/bounded-request-body';
import { writeAttachmentWebAudit } from '@/lib/attachment-web-audit';
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { buildAttachmentPath } from '@/lib/attachment-path';
import {
    type DocumentOcrQueueState,
} from '@/lib/domain/documents/document-ocr-queue';
/* @Codex */
import { attachmentDeleteSchema, attachmentUpdateSchema, type AttachmentExpectedCurrentness } from '@/lib/api-schemas/attachments';
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
    currentness: {
        sourceRef: attachments.documentSourceRef,
        revision: attachments.documentRevision,
        freshnessEpoch: attachments.documentFreshnessEpoch,
    },
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
        let json;
        try {
            json = await readBoundedJsonBody(request, 4 * 1024 * 1024, 'request-json',
                { signal: request.signal, deadline: Infinity });
        } catch {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }
        if (!json.ok) return NextResponse.json(
            { error: json.status === 413 ? 'JSON payload too large' : 'Invalid payload' },
            { status: json.status });
        const body = json.value;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
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

        const updated = dbServer.transaction((tx) => {
            assertAttachmentExpected(tx, id, payload.patientId, payload.expected);
            const currentness = transitionAttachmentMetadataCurrentness(id, {
                summarySnapshot: updateData.summarySnapshot,
                parseEvidenceArtifactSnapshot: updateData.parseEvidenceArtifactSnapshot,
                ocrQueueState: updateData.ocrQueueState,
            });
            writeAttachmentWebAudit(tx, request, session, 'attachment.updated', id,
                { changedFields: Object.keys(updateData), resourceVersion: currentness.revision });
            return currentness;
        }, { behavior: 'immediate' });
        return NextResponse.json({ success: true, currentness: updated });
    } catch (error) {
        if (error instanceof AttachmentPreconditionError) return error.response();
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
        const body = await readBoundedJsonBody(request, 4 * 1024 * 1024, 'request-json',
            { signal: request.signal, deadline: Infinity });
        if (!body.ok) return NextResponse.json({ error: body.status === 413 ? 'JSON payload too large' : 'Invalid payload' }, { status: body.status });
        const parsed = parseApiBody(attachmentDeleteSchema, body.value);
        if (!parsed.ok) return parsed.response;
        const { patientId, expected } = parsed.data;
        dbServer.transaction((tx) => {
            assertAttachmentExpected(tx, id, patientId, expected);
            const result = tx.delete(attachments).where(and(eq(attachments.id, id),
                eq(attachments.patientId, patientId), eq(attachments.documentSourceRef, expected.sourceRef),
                eq(attachments.documentRevision, expected.revision), eq(attachments.documentFreshnessEpoch, expected.freshnessEpoch))).run();
            if (result.changes !== 1) throw new Error('Attachment delete did not affect exactly one row');
            writeAttachmentWebAudit(tx, request, session, 'attachment.deleted', id);
        }, { behavior: 'immediate' });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof AttachmentPreconditionError) return error.response();
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}

class AttachmentPreconditionError extends Error {
    constructor(private readonly status: 404 | 409) { super('Attachment precondition failed'); }
    response() { return NextResponse.json({ error: this.status === 404 ? 'Not found' : 'Attachment changed; reload and retry' }, { status: this.status }); }
}
function assertAttachmentExpected(tx: Parameters<Parameters<typeof dbServer.transaction>[0]>[0], id: string,
    patientId: string, expected: AttachmentExpectedCurrentness): void {
    const row = tx.select({ patientId: attachments.patientId, sourceRef: attachments.documentSourceRef,
        revision: attachments.documentRevision, freshnessEpoch: attachments.documentFreshnessEpoch })
        .from(attachments).where(eq(attachments.id, id)).get();
    if (!row || row.patientId !== patientId) throw new AttachmentPreconditionError(404);
    if (row.sourceRef !== expected.sourceRef || row.revision !== expected.revision || row.freshnessEpoch !== expected.freshnessEpoch)
        throw new AttachmentPreconditionError(409);
}
