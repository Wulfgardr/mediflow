import 'server-only';

import { ATTACHMENT_COLLECTION_CHANGED, ATTACHMENT_COLLECTION_CHANGED_ERROR, attachmentCollectionMatches } from './attachment-collection-currentness';

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

import { attachmentCreateSchema, type AttachmentCreatePayload } from './api-schemas/attachments';
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

type Tx = Parameters<Parameters<typeof dbServer.transaction>[0]>[0];
type AttachmentCreateResult = { status: 201 | 400 | 404 | 409 | 413; value: Record<string, unknown> };

export function createWebAttachmentInTransaction(
    tx: Tx, request: Request, session: ServerSession, body: AttachmentCreatePayload,
): AttachmentCreateResult {
    if (typeof body.patientId !== 'string' || body.patientId.trim().length === 0) {
        return { status: 400, value: { error: 'patientId required' } };
    }
    const dataSize = getAttachmentPayloadByteSize(body.data);
    if (!dataSize.ok) return { status: 400, value: { error: dataSize.error } };
    if (dataSize.size > resolveMaxAttachmentBytes()) {
        return { status: 413, value: { error: 'Attachment payload too large' } };
    }
    const id = body.id ?? uuidv4();
    const patient = tx.select({ id: patients.id }).from(patients)
        .where(and(eq(patients.id, body.patientId), activePatients())).get();
    if (!patient) return { status: 404, value: { error: 'Patient not found' } };
    if (!attachmentCollectionMatches(tx, body.patientId, body.expectedCollection)) return { status: 409, value: { error: ATTACHMENT_COLLECTION_CHANGED_ERROR, code: ATTACHMENT_COLLECTION_CHANGED } };
    if (tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.id, id)).get()) return { status: 409, value: { error: 'Attachment already exists' } };
    const currentness = mintHostAttachmentCurrentness();
    const inserted = tx.insert(attachments).values({
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
    if (inserted.changes !== 1) throw new Error('Attachment insert did not affect exactly one row');
    writeAttachmentWebAudit(tx, request, session, 'attachment.created', id);
    return { status: 201, value: { id, currentness } };
}

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
        const result = dbServer.transaction(tx => createWebAttachmentInTransaction(tx, request, session, body), { behavior: 'immediate' });
        return NextResponse.json(result.value, { status: result.status });
    } catch {
        return NextResponse.json({ error: 'Create Failed' }, { status: 500 });
    }
}
