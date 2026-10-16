import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { messages } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const { id } = await params;
        await dbServer.delete(messages).where(eq(messages.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        return NextResponse.json({ error: "Delete Failed" }, { status: 500 });
    }
}
