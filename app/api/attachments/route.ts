import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { asc, eq, desc, type SQL } from 'drizzle-orm';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { buildAttachmentPath } from '@/lib/attachment-path';
/* STREAM B: server-side list params (whitelisted, plaintext columns only). */
import { parseListParams } from '@/lib/list-query-params';
/* @Codex */
import { createWebAttachment } from '@/lib/attachment-web-create';

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

const ATTACHMENT_RESPONSE_COLUMNS = {
    ...ATTACHMENT_METADATA_COLUMNS,
    data: attachments.data,
} as const;

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
        let query = dbServer.select(metadataOnly ? ATTACHMENT_METADATA_COLUMNS : ATTACHMENT_RESPONSE_COLUMNS).from(attachments)
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
    return createWebAttachment(request, session);
}
