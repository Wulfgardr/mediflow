import { NextResponse } from 'next/server';
import { dbServer, runDbServerImmediateTransaction } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { isDocumentOcrQueueState } from '@/lib/domain/documents/document-ocr-queue';
import { applyDocumentOcrReplay } from '@/lib/domain/documents/document-ocr-replay';
import { attachmentOcrReplaySchema } from '@/lib/api-schemas/attachments';
import { parseApiBody } from '@/lib/api-schemas/parse';
/* @Codex */
import { createAttachmentOcrReplayCurrentness } from '@/lib/attachment-ocr-replay-currentness';

/* @Codex */
const attachmentOcrReplayCurrentness = createAttachmentOcrReplayCurrentness({
    database: dbServer,
    runImmediateTransaction: runDbServerImmediateTransaction,
});
/* @Codex */
const ATTACHMENT_OCR_REPLAY_KEYS = new Set<PropertyKey>([
    'ocrText', 'documentSha256',
]);

/**
 * Replay documentale post-OCR per un allegato in coda OCR-needed.
 *
 * Azione esplicita, idempotente per hash documento: lo stesso documentSha256
 * con lo stesso testo OCR normalizzato non riscrive mai l'artifact (outcome
 * 'duplicate') e non duplica né l'allegato né il paziente (update in-place).
 * Il testo OCR transita solo nella richiesta: nello snapshot persistito
 * restano hash, stato e razionali deterministici, mai testo clinico.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const { id } = await params;
        const body = await request.json().catch(() => null) as unknown;
        if (!body || typeof body !== 'object'
            || Reflect.ownKeys(body).some((key) => !ATTACHMENT_OCR_REPLAY_KEYS.has(key))) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }
        const parsedBody = parseApiBody(attachmentOcrReplaySchema, body);
        if (!parsedBody.ok) return parsedBody.response;
        const { ocrText } = parsedBody.data;
        const documentSha256 = parsedBody.data.documentSha256.trim();

        const existing = await dbServer
            .select({
                id: attachments.id,
                documentSourceRef: attachments.documentSourceRef,
                documentRevision: attachments.documentRevision,
                documentFreshnessEpoch: attachments.documentFreshnessEpoch,
                ocrQueueState: attachments.ocrQueueState,
                ocrQueueReason: attachments.ocrQueueReason,
                ocrReplayArtifactSnapshot: attachments.ocrReplayArtifactSnapshot,
            })
            .from(attachments)
            .where(eq(attachments.id, id))
            .get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const currentState = existing.ocrQueueState;
        if (!isDocumentOcrQueueState(currentState)) {
            return NextResponse.json({ error: 'Attachment is not in the OCR queue' }, { status: 409 });
        }

        const replay = applyDocumentOcrReplay({
            attachmentId: existing.id,
            documentSha256,
            ocrText,
            previousArtifactSnapshot: existing.ocrReplayArtifactSnapshot,
        });

        /* @Codex: currentness is host-owned; documentSha256 remains replay evidence only. */
        const outcome = attachmentOcrReplayCurrentness.commit(existing, {
            outcome: replay.outcome,
            nextState: replay.nextState,
            artifactSnapshot: replay.artifactSnapshot,
            updatedAtMs: Date.now(),
        });
        if (outcome.status === 'not_found') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (outcome.status === 'conflict') {
            return NextResponse.json({ error: 'Attachment changed; reload and retry' }, { status: 409 });
        }
        if (outcome.status === 'failed') {
            return NextResponse.json({ error: 'OCR replay failed' }, { status: 500 });
        }

        console.info('[API] OCR replay', {
            attachmentId: existing.id,
            outcome: replay.outcome,
            state: replay.nextState,
            reason: existing.ocrQueueReason,
        });

        return NextResponse.json({
            outcome: replay.outcome,
            state: replay.nextState,
            reason: existing.ocrQueueReason,
            idempotencyKey: replay.artifact.idempotencyKey,
            sufficientText: replay.sufficientText,
        });
    } catch {
        console.error('[API] OCR replay failed');
        return NextResponse.json({ error: 'OCR replay failed' }, { status: 500 });
    }
}
