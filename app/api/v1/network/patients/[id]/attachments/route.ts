/* @Codex */
import { withNetworkAttachmentJson, jsonBodyTooLargeResponse } from '@/lib/native-network-json-body';
/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
    NETWORK_ATTACHMENT_READ_CAPABILITY,
    listNetworkScopedAttachments,
} from '@/lib/network-attachment-read';
/* @Codex */
import {
    NETWORK_ATTACHMENT_WRITE_CAPABILITY,
    createNetworkScopedAttachment,
} from '@/lib/network-attachment-write';
/* @Codex */
import { requireNetworkCapabilityContext, requireNetworkWriteContext } from '@/lib/network-write-context';

/* @Codex */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkCapabilityContext(request, NETWORK_ATTACHMENT_READ_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        const list = await listNetworkScopedAttachments(id, resolved.context.scopeAmbulatoryId);
        return NextResponse.json(list);
    } catch (error) {
        console.error('API GET /api/v1/network/patients/[id]/attachments error:', error);
        return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
    }
}

/* @Codex */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const resolved = await requireNetworkWriteContext(request, NETWORK_ATTACHMENT_WRITE_CAPABILITY);
        if (!resolved.ok) return resolved.response;

        return await withNetworkAttachmentJson(request, async (body) => {
            const result = await createNetworkScopedAttachment(
                { ...resolved.context, patientId: id },
                body as Record<string, unknown>,
            );
            return NextResponse.json(result.value, { status: result.status });
        });
    } catch (error) {
        /* @Codex */
        const sizeError = jsonBodyTooLargeResponse(error);
        if (sizeError) return sizeError;
        console.error('API POST /api/v1/network/patients/[id]/attachments error:', error);
        return NextResponse.json({ error: 'Failed to create attachment' }, { status: 500 });
    }
}
