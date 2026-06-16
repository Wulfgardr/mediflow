import { NextResponse } from 'next/server';
import { dbServer } from '@/lib/db-server';
import { attachments } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { canTransitionDocumentOcrQueueState, isDocumentOcrQueueState } from '@/lib/document-ocr-queue';
import { applyDocumentOcrReplay } from '@/lib/document-ocr-replay';

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
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }
        const payload = body as Record<string, unknown>;
        const ocrText = typeof payload.ocrText === 'string' ? payload.ocrText : null;
        const documentSha256 = typeof payload.documentSha256 === 'string' ? payload.documentSha256.trim() : '';
        if (ocrText === null || !documentSha256) {
            return NextResponse.json({ error: 'ocrText and documentSha256 are required' }, { status: 400 });
        }

        const existing = await dbServer
            .select({
                id: attachments.id,
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

        if (replay.outcome === 'duplicate') {
            // Idempotenza: stesso hash documento + stesso testo OCR, l'artifact non
            // viene mai riscritto. Lo stato transiente 'processing' viene comunque
            // riallineato allo stato derivato dall'artifact già persistito.
            let settledState: typeof currentState | typeof replay.nextState = currentState;
            if (currentState === 'processing') {
                await dbServer.update(attachments).set({
                    ocrQueueState: replay.nextState,
                    ocrQueueUpdatedAt: new Date(),
                }).where(eq(attachments.id, existing.id));
                settledState = replay.nextState;
            }
            return NextResponse.json({
                outcome: replay.outcome,
                state: settledState,
                reason: existing.ocrQueueReason,
                idempotencyKey: replay.artifact.idempotencyKey,
                sufficientText: replay.sufficientText,
            });
        }

        if (currentState !== 'processing' && !canTransitionDocumentOcrQueueState(currentState, 'processing')) {
            return NextResponse.json({ error: 'Invalid OCR queue state transition' }, { status: 409 });
        }

        await dbServer.update(attachments).set({
            ocrQueueState: replay.nextState,
            ocrQueueUpdatedAt: new Date(),
            ocrReplayArtifactSnapshot: replay.artifactSnapshot,
        }).where(eq(attachments.id, existing.id));

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
    } catch (error) {
        console.error('[API] OCR replay failed:', error);
        return NextResponse.json({ error: 'OCR replay failed' }, { status: 500 });
    }
}
