/* @Codex */
import 'server-only';

import { types } from 'node:util';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

import { attachmentCreateSchema } from './api-schemas/attachments';
import { parseApiBody } from './api-schemas/parse';
import { buildAttachmentPath } from './attachment-path';
import { getAttachmentPayloadByteSize, resolveMaxAttachmentBytes } from './attachment-payload';
import { createHostAttachmentCurrentness } from './attachment-currentness-host';
import { dbServer } from './db-server';
import { isDocumentOcrQueueReason, isDocumentOcrQueueState } from './domain/documents/document-ocr-queue';
import { activePatients } from './patient-lifecycle';
import { attachments, patients } from './schema';
import { unauthorizedResponse } from './security/server-auth';
import type { ServerSession } from './security/server-session';

const KEYS = ['sourceRef', 'revision', 'freshnessEpoch'] as const;
const SOURCE_REF = /^[0-9a-f]{64}$/u;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const reflectOwnKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const regexpTest = Function.call.bind(RegExp.prototype.test) as (expression: RegExp, value: string) => boolean;
const isProxy = types.isProxy;

type InitialCurrentness = Readonly<{ sourceRef: string; revision: 1; freshnessEpoch: 1 }>;

function readInitialCurrentness(value: unknown): InitialCurrentness | null {
    try {
        if (!value || typeof value !== 'object' || arrayIsArray(value) || isProxy(value)
            || objectGetPrototypeOf(value) !== Object.prototype || reflectOwnKeys(value).length !== KEYS.length) return null;
        const descriptors = KEYS.map((key) => objectGetOwnPropertyDescriptor(value, key));
        if (descriptors.some((descriptor) => !descriptor || !objectHasOwn(descriptor, 'value') || descriptor.enumerable !== true)) return null;
        const [sourceRef, revision, freshnessEpoch] = descriptors.map((descriptor) => descriptor!.value);
        if (typeof sourceRef !== 'string' || !regexpTest(SOURCE_REF, sourceRef)
            || revision !== 1 || !numberIsSafeInteger(revision)
            || freshnessEpoch !== 1 || !numberIsSafeInteger(freshnessEpoch)) return null;
        return Object.freeze({ sourceRef, revision, freshnessEpoch });
    } catch {
        return null;
    }
}

/** Creates one web attachment with active-patient validation and initial currentness in one transaction. */
export async function createWebAttachment(
    request: Request,
    session: ServerSession | null,
    mintCurrentness: () => unknown = createHostAttachmentCurrentness,
): Promise<Response> {
    if (!session) return unauthorizedResponse();
    try {
        const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
        if (Number.isFinite(contentLength) && contentLength > resolveMaxAttachmentBytes()) {
            return NextResponse.json({ error: 'Attachment payload too large' }, { status: 413 });
        }
        const parsedBody = parseApiBody(attachmentCreateSchema, await request.json());
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
        const created = dbServer.transaction((tx): 'created' | 'missing' | 'invalid' => {
            const patient = tx.select({ id: patients.id }).from(patients)
                .where(and(eq(patients.id, body.patientId), activePatients())).get();
            if (!patient) return 'missing';
            const currentness = readInitialCurrentness(mintCurrentness());
            if (!currentness) return 'invalid';
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
            return 'created';
        });
        if (created === 'missing') return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        if (created === 'invalid') return NextResponse.json({ error: 'Create Failed' }, { status: 500 });
        return NextResponse.json({ id }, { status: 201 });
    } catch {
        return NextResponse.json({ error: 'Create Failed' }, { status: 500 });
    }
}
