import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { attachments, patients } from '@/lib/schema';
import { activePatients } from '@/lib/patient-lifecycle';
import { and, asc, eq, desc, type SQL } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { buildAttachmentPath } from '@/lib/attachment-path';
/* @Codex */
import { getAttachmentPayloadByteSize } from '@/lib/attachment-payload';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';
/* @Codex */
import { attachmentCreateSchema } from '@/lib/api-schemas/attachments';
/* @Codex */
import { parseApiBody } from '@/lib/api-schemas/parse';

// Only plaintext columns are sortable (name/path/data are ENC:). size/type are
// plaintext metadata and safe to sort on.
const ATTACHMENT_SORT_COLUMNS = {
    createdAt: attachments.createdAt,
    size: attachments.size,
    type: attachments.type,
} as const;

// Metadata-mode column projection: every column EXCEPT the heavy base64 `data`
// blob, so a list never ships (or decrypts) attachment payloads.
const ATTACHMENT_METADATA_COLUMNS = {
    id: attachments.id,
    patientId: attachments.patientId,
    name: attachments.name,
    type: attachments.type,
    size: attachments.size,
    path: attachments.path,
    summarySnapshot: attachments.summarySnapshot,
    parseEvidenceArtifactSnapshot: attachments.parseEvidenceArtifactSnapshot,
    ocrQueueState: attachments.ocrQueueState,
    ocrQueueReason: attachments.ocrQueueReason,
    ocrQueueUpdatedAt: attachments.ocrQueueUpdatedAt,
    ocrReplayArtifactSnapshot: attachments.ocrReplayArtifactSnapshot,
    createdAt: attachments.createdAt,
} as const;

/* @Codex */
const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/* @Codex */
function resolveMaxAttachmentBytes(): number {
    const configured = Number.parseInt(process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES ?? '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_ATTACHMENT_BYTES;
}
import { isDocumentOcrQueueReason, isDocumentOcrQueueState } from '@/lib/domain/documents/document-ocr-queue';

/* @Codex */
function serializeAttachment<T extends { id: string; name: string; path: string }>(row: T): T {
    return {
        ...row,
        path: buildAttachmentPath(row.path, row.name, row.id),
    };
}

export async function GET(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    /* STREAM B */
    const parsed = parseListParams(searchParams, {
        sortableColumns: Object.keys(ATTACHMENT_SORT_COLUMNS),
        defaultOrderBy: 'createdAt',
        defaultOrderDir: 'desc',
        allowMetadataOnly: true,
    });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { limit, offset, orderBy, orderDir, metadataOnly } = parsed.params;

    try {
        const whereClause: SQL | undefined = patientId ? eq(attachments.patientId, patientId) : undefined;

        const sortColumn = ATTACHMENT_SORT_COLUMNS[(orderBy ?? 'createdAt') as keyof typeof ATTACHMENT_SORT_COLUMNS];
        const orderExpr = orderDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

        // Metadata mode omits the base64 `data` blob entirely: the list never
        // ships (nor decrypts) attachment payloads. Full retrieval is via
        // GET /api/attachments/[id].
        let query = (metadataOnly
            ? dbServer.select(ATTACHMENT_METADATA_COLUMNS).from(attachments)
            : dbServer.select().from(attachments))
            .where(whereClause)
            .orderBy(orderExpr)
            .$dynamic();
        if (typeof limit === 'number') query = query.limit(limit);
        if (typeof offset === 'number') query = query.offset(offset);

        const data = await query;
        return NextResponse.json(data.map(serializeAttachment));
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch attachments" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        /* @Codex */
        const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
        if (Number.isFinite(contentLength) && contentLength > resolveMaxAttachmentBytes()) {
            return NextResponse.json({ error: 'Attachment payload too large' }, { status: 413 });
        }

        const rawBody = await request.json();
        const parsedBody = parseApiBody(attachmentCreateSchema, rawBody);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        const newId = body.id || uuidv4();
        /* @Codex */
        if (typeof body.patientId !== 'string' || body.patientId.trim().length === 0) {
            return NextResponse.json({ error: 'patientId required' }, { status: 400 });
        }
        /* @Codex */
        // WUL-306 (ADR 0066): soft-deleted patients must not accept new attachments.
        const patient = await dbServer.select({ id: patients.id }).from(patients).where(and(eq(patients.id, body.patientId), activePatients())).get();
        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }
        /* @Codex */
        const dataSize = getAttachmentPayloadByteSize(body.data);
        if (!dataSize.ok) {
            return NextResponse.json({ error: dataSize.error }, { status: 400 });
        }
        /* @Codex */
        if (dataSize.size > resolveMaxAttachmentBytes()) {
            return NextResponse.json({ error: 'Attachment payload too large' }, { status: 413 });
        }

        // Note: The actual file upload is handled separately (usually).
        // This endpoint likely stores the metadata of the attachment.
        // If the 'path' doesn't exist, we might need a separate upload endpoint
        // or this endpoint expects the path to be already determined (e.g. valid URL or local path).

        await dbServer.insert(attachments).values({
            id: newId,
            patientId: body.patientId,
            name: body.name,
            type: body.type,
            size: body.size,
            /* @Codex */
            path: buildAttachmentPath(body.path, body.name, newId),
            /* @Codex */
            data: body.data ?? null,
            summarySnapshot: body.summarySnapshot ?? null,
            /* @Codex */
            parseEvidenceArtifactSnapshot: body.parseEvidenceArtifactSnapshot ?? null,
            ocrQueueState: isDocumentOcrQueueState(body.ocrQueueState) ? body.ocrQueueState : null,
            ocrQueueReason: isDocumentOcrQueueReason(body.ocrQueueReason) ? body.ocrQueueReason : null,
            ocrQueueUpdatedAt: isDocumentOcrQueueState(body.ocrQueueState) ? new Date() : null,
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
