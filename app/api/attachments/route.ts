import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { buildAttachmentPath } from '@/lib/attachment-path';

/* @Codex */
function serializeAttachment(row: typeof attachments.$inferSelect) {
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

    try {
        let query = dbServer.select().from(attachments);

        if (patientId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            query = query.where(eq(attachments.patientId, patientId)) as any;
        }

        const data = await query.orderBy(desc(attachments.createdAt));
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
        const body = await request.json();
        const newId = body.id || uuidv4();

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
            createdAt: new Date()
        });

        return NextResponse.json({ id: newId }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: "Create Failed" }, { status: 500 });
    }
}
