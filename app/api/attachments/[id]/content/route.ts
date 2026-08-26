/* @Codex */
import { NextResponse } from 'next/server';

import { parseAttachmentContentCurrentnessPut } from '@/lib/api-schemas/attachments';
import { getAttachmentPayloadByteSize, resolveMaxAttachmentBytes } from '@/lib/attachment-payload';
import {
    isAttachmentCurrentnessHostError,
    transitionAttachmentContentCurrentness,
} from '@/lib/attachment-currentness-host';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import type { ServerSession } from '@/lib/security/server-session';

const INVALID_PAYLOAD = 'Invalid payload';

function unavailableResponse() {
    return NextResponse.json({ error: 'Attachment update unavailable' }, { status: 503 });
}

function mapCurrentnessError(error: unknown) {
    if (!isAttachmentCurrentnessHostError(error)) return unavailableResponse();
    switch (error.code) {
        case 'input_invalid': return NextResponse.json({ error: INVALID_PAYLOAD }, { status: 400 });
        case 'attachment_missing': return NextResponse.json({ error: 'Not found' }, { status: 404 });
        case 'currentness_conflict': return NextResponse.json({ error: 'Attachment changed; reload and retry' }, { status: 409 });
        case 'currentness_overflow': return NextResponse.json({ error: 'Attachment currentness cannot advance' }, { status: 409 });
        case 'stored_state_invalid':
        case 'storage_unavailable': return unavailableResponse();
        default: return error.code satisfies never;
    }
}

/** Internal testable adapter; the public route always resolves its own session. */
export async function putAttachmentContent(
    request: Request,
    id: string,
    session: ServerSession | null,
): Promise<Response> {
    if (!session) return unauthorizedResponse();

    const maxBytes = resolveMaxAttachmentBytes();
    const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        return NextResponse.json({ error: 'Attachment payload too large' }, { status: 413 });
    }

    const body = await request.json().catch(() => null) as unknown;
    const parsed = parseAttachmentContentCurrentnessPut(body);
    if (!parsed) {
        return NextResponse.json({ error: INVALID_PAYLOAD }, { status: 400 });
    }
    const payloadSize = getAttachmentPayloadByteSize(parsed.replacement);
    if (!payloadSize.ok) return NextResponse.json({ error: INVALID_PAYLOAD }, { status: 400 });
    if (payloadSize.size > maxBytes) {
        return NextResponse.json({ error: 'Attachment payload too large' }, { status: 413 });
    }

    try {
        const currentness = transitionAttachmentContentCurrentness(id, parsed.expected, parsed.replacement);
        return NextResponse.json(Object.freeze({ outcome: 'replaced', currentness }));
    } catch (error) {
        return mapCurrentnessError(error);
    }
}

/* @Codex */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireSession();
    const { id } = await params;
    return putAttachmentContent(request, id, session);
}
