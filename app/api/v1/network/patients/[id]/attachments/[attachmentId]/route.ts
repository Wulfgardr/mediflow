/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_ATTACHMENT_READ_CAPABILITY,
    getNetworkScopedAttachment,
} from '@/lib/network-attachment-read';
/* @Codex */
import { requireNetworkCapabilityContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
    try {
        const { id, attachmentId } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_ATTACHMENT_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const attachment = await getNetworkScopedAttachment(id, attachmentId, resolved.context.scopeAmbulatoryId);
        if (!attachment) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return NextResponse.json(attachment);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/attachments/[attachmentId] error:', error);
        return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
    }
}
