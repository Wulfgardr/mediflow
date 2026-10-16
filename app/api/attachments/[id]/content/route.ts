import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { putAttachmentContent } from '@/lib/attachment-content-cas-route';
import { getAttachmentCurrentness } from '@/lib/attachment-currentness-get-route';
import { requireSession } from '@/lib/security/server-auth';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    const { id } = await params;
    return getAttachmentCurrentness(id, session);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    const { id } = await params;
    return putAttachmentContent(request, id, session);
}
