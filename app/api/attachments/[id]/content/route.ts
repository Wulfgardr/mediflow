/* @Codex */
import { putAttachmentContent } from '@/lib/attachment-content-cas-route';
import { requireSession } from '@/lib/security/server-auth';

/* @Codex */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    const { id } = await params;
    return putAttachmentContent(request, id, session);
}
