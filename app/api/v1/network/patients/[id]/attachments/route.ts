/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import { resolveMaxAttachmentBytes } from '@/lib/attachment-payload';
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

        // Same Content-Length precheck as the host attachment upload
        // (app/api/attachments/route.ts): fail fast before parsing a body
        // that is already known to exceed the shared wire size limit.
        const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
        if (Number.isFinite(contentLength) && contentLength > resolveMaxAttachmentBytes()) {
            return NextResponse.json({ error: 'Attachment payload too large' }, { status: 413 });
        }

        const body = await request.json() as Record<string, unknown>;
        const result = await createNetworkScopedAttachment(
            { ...resolved.context, patientId: id },
            body,
        );
        return NextResponse.json(result.value, { status: result.status });
    } catch (error) {
        console.error('API POST /api/v1/network/patients/[id]/attachments error:', error);
        return NextResponse.json({ error: 'Failed to create attachment' }, { status: 500 });
    }
}
