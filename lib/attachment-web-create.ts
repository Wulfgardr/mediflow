/* @Codex */
import 'server-only';

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

import { attachmentCreateSchema } from './api-schemas/attachments';
import { parseApiBody } from './api-schemas/parse';
import { readBoundedJsonBody } from './bounded-request-body';
import { writeAttachmentWebAudit } from './attachment-web-audit';
import { buildAttachmentPath } from './attachment-path';
import { getAttachmentPayloadByteSize, resolveMaxAttachmentBytes } from './attachment-payload';
import { createHostAttachmentCurrentness } from './attachment-currentness-host';
import { dbServer } from './db-server';
import { isDocumentOcrQueueReason, isDocumentOcrQueueState } from './domain/documents/document-ocr-queue';
import { activePatients } from './patient-lifecycle';
import { attachments, patients } from './schema';
import { unauthorizedResponse } from './security/server-auth';
import type { ServerSession } from './security/server-session';

const mintHostAttachmentCurrentness = createHostAttachmentCurrentness;

/** Creates one web attachment with active-patient validation and initial currentness in one transaction. */
export async function createWebAttachment(
    request: Request,
    session: ServerSession | null,
): Promise<Response> {
    if (!session) return unauthorizedResponse();
    try {
        const maxBytes = resolveMaxAttachmentBytes();
        let json;
        try {
            json = await readBoundedJsonBody(request, maxBytes, 'request-json',
                { signal: request.signal, deadline: Infinity });
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        if (!json.ok) return NextResponse.json(
            { error: json.status === 413 ? 'Attachment payload too large' : 'Invalid JSON body' },
            { status: json.status });
        const parsedBody = parseApiBody(attachmentCreateSchema, json.value);
        if (!parsedBody.ok) return parsedBody.response;
        const body = parsedBody.data;
        if (typeof body.patientId !== 'string' || body.patientId.trim().length === 0) {
            return NextResponse.json({ error: 'patientId required' }, { status: 400 });
        }
        const dataSize = getAttachmentPayloadByteSize(body.data);
        if (!dataSize.ok) return NextResponse.json({ error: dataSize.error }, { status: 400 });
        if (dataSize.size > resolveMaxAttachmentBytes()) {
            return NextResponse.json({ error: 'Attachment payload too large' }, { status: 413 });
        }

        const id = body.id || uuidv4();
        const created = dbServer.transaction((tx): 'created' | 'missing' | 'duplicate' => {
            const patient = tx.select({ id: patients.id }).from(patients)
                .where(and(eq(patients.id, body.patientId), activePatients())).get();
            if (!patient) return 'missing';
            if (tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, id)).get()) return 'duplicate';
            const currentness = mintHostAttachmentCurrentness();
            tx.insert(attachments).values({
                id,
                patientId: body.patientId,
                name: body.name,
                type: body.type,
                size: body.size,
                path: buildAttachmentPath(body.path, body.name, id),
                data: body.data ?? null,
                summarySnapshot: body.summarySnapshot ?? null,
                parseEvidenceArtifactSnapshot: body.parseEvidenceArtifactSnapshot ?? null,
                ocrQueueState: isDocumentOcrQueueState(body.ocrQueueState) ? body.ocrQueueState : null,
                ocrQueueReason: isDocumentOcrQueueReason(body.ocrQueueReason) ? body.ocrQueueReason : null,
                ocrQueueUpdatedAt: isDocumentOcrQueueState(body.ocrQueueState) ? new Date() : null,
                createdAt: new Date(),
                documentSourceRef: currentness.sourceRef,
                documentRevision: currentness.revision,
                documentFreshnessEpoch: currentness.freshnessEpoch,
            }).run();
            writeAttachmentWebAudit(tx, request, session, 'attachment.created', id);
            return 'created';
        }, { behavior: 'immediate' });
        if (created === 'duplicate') return NextResponse.json({ error: 'Attachment already exists' }, { status: 409 });
        if (created === 'missing') return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        return NextResponse.json({ id }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Create Failed' }, { status: 500 });
    }
}
