import { NextResponse } from 'next/server';
import { dbServer, runDbServerImmediateTransaction } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { eq } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { buildAttachmentPath } from '@/lib/attachment-path';
import {
    canTransitionDocumentOcrQueueState,
    isDocumentOcrQueueState,
    type DocumentOcrQueueState,
} from '@/lib/domain/documents/document-ocr-queue';
/* @Codex */
import { attachmentUpdateSchema } from '@/lib/api-schemas/attachments';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';
/* @Codex */
import { createLegacyAttachmentResponseSnapshot } from '@/lib/attachment-legacy-response';
/* @Codex */
import { createAttachmentWebPutCurrentness } from '@/lib/attachment-web-put-currentness';
/* @Codex */
import { createAttachmentWebDeleteCurrentness } from '@/lib/attachment-web-delete-currentness';

/* @Codex */
const attachmentWebPutCurrentness = createAttachmentWebPutCurrentness({
    database: dbServer,
    runImmediateTransaction: runDbServerImmediateTransaction,
});
/* @Codex */
const attachmentWebDeleteCurrentness = createAttachmentWebDeleteCurrentness({
    database: dbServer,
    runImmediateTransaction: runDbServerImmediateTransaction,
});
/* @Codex */
const ATTACHMENT_WEB_PUT_KEYS = new Set<PropertyKey>([
    'summarySnapshot', 'parseEvidenceArtifactSnapshot', 'ocrQueueState',
]);

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
        const row = await dbServer.select().from(attachments).where(eq(attachments.id, id)).get();
        if (!row) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const snapshot = createLegacyAttachmentResponseSnapshot(row);
        if (!snapshot) {
            return NextResponse.json({ error: 'Failed to serialize attachment' }, { status: 500 });
        }
        return NextResponse.json(Object.freeze({
            ...snapshot,
            path: buildAttachmentPath(snapshot.path, snapshot.name, snapshot.id),
        }));
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
        /* @Codex: an exact allowlist keeps every currentness and authority field host-owned. */
        if (Reflect.ownKeys(body).some((key) => !ATTACHMENT_WEB_PUT_KEYS.has(key))) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }
        const parsedBody = parseApiBody(attachmentUpdateSchema, body);
        if (!parsedBody.ok) return parsedBody.response;
        const payload = parsedBody.data;

        const existing = await dbServer
            .select({
                id: attachments.id,
                documentSourceRef: attachments.documentSourceRef,
                documentRevision: attachments.documentRevision,
                documentFreshnessEpoch: attachments.documentFreshnessEpoch,
                ocrQueueState: attachments.ocrQueueState,
            })
            .from(attachments)
            .where(eq(attachments.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const updateData: {
            summarySnapshot?: string | null;
            parseEvidenceArtifactSnapshot?: string | null;
            ocrQueueState?: DocumentOcrQueueState;
            ocrQueueUpdatedAt?: Date;
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
            if (!isDocumentOcrQueueState(payload.ocrQueueState)) {
                return NextResponse.json({ error: 'Invalid OCR queue state' }, { status: 400 });
            }
            if (!isDocumentOcrQueueState(existing.ocrQueueState)) {
                return NextResponse.json({ error: 'Attachment is not in the OCR queue' }, { status: 409 });
            }
            if (!canTransitionDocumentOcrQueueState(existing.ocrQueueState, payload.ocrQueueState)) {
                return NextResponse.json({ error: 'Invalid OCR queue state transition' }, { status: 409 });
            }
            updateData.ocrQueueState = payload.ocrQueueState;
            updateData.ocrQueueUpdatedAt = new Date();
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }

        const outcome = attachmentWebPutCurrentness.mutate({
            id: existing.id,
            documentSourceRef: existing.documentSourceRef,
            documentRevision: existing.documentRevision,
            documentFreshnessEpoch: existing.documentFreshnessEpoch,
        }, (database) => {
            const result = database.update(attachments).set(updateData).where(eq(attachments.id, id)).run();
            return { changes: result.changes };
        });
        if (outcome.status === 'not_found') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (outcome.status === 'conflict') {
            return NextResponse.json({ error: 'Attachment changed; reload and retry' }, { status: 409 });
        }
        if (outcome.status === 'failed') {
            return NextResponse.json({ error: 'Update Failed' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Update Failed" }, { status: 500 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const existing = await dbServer
            .select({
                id: attachments.id,
                documentSourceRef: attachments.documentSourceRef,
                documentRevision: attachments.documentRevision,
                documentFreshnessEpoch: attachments.documentFreshnessEpoch,
            })
            .from(attachments)
            .where(eq(attachments.id, id))
            .get();
        if (!existing) return NextResponse.json({ success: true });

        const outcome = attachmentWebDeleteCurrentness.delete(existing);
        if (outcome.status === 'conflict') {
            return NextResponse.json({ error: 'Attachment changed; reload and retry' }, { status: 409 });
        }
        if (outcome.status === 'failed') {
            return NextResponse.json({ error: 'Delete Failed' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
