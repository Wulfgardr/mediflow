/* @Codex */
import { NextResponse } from 'next/server';

import { appendDocumentRouterControlFlowAudit } from '@/lib/document-router-control-flow-audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import type { DocumentDecisionClassification, DocumentDecisionConfidence } from '@/lib/domain/documents/document-decision';
import type { DocumentRouterControlFlowMode } from '@/lib/domain/documents/document-router-control-flow';

const DOCUMENT_CLASSES: ReadonlySet<string> = new Set([
    'identity_document', 'medication_prescription', 'specialist_service_prescription',
    'lab_prescription', 'imaging_prescription', 'screening_prescription_or_invitation',
    'specialist_report', 'lab_report', 'imaging_report', 'exemption_document',
    'prosthetic_prescription', 'administrative', 'mute_or_scanned', 'unknown',
]);
const CONFIDENCES: ReadonlySet<string> = new Set(['low', 'medium', 'high']);
const MODES: ReadonlySet<string> = new Set(['shadow']);

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await request.json() as Record<string, unknown>;
        if (
            typeof body.classification !== 'string' || !DOCUMENT_CLASSES.has(body.classification)
            || typeof body.confidence !== 'string' || !CONFIDENCES.has(body.confidence)
            || typeof body.wouldSkip !== 'boolean'
            || typeof body.mode !== 'string' || !MODES.has(body.mode)
        ) {
            return NextResponse.json({ error: 'Payload audit document router non valido' }, { status: 400 });
        }

        appendDocumentRouterControlFlowAudit({
            classification: body.classification as DocumentDecisionClassification,
            confidence: body.confidence as DocumentDecisionConfidence,
            wouldSkip: body.wouldSkip,
            mode: body.mode as DocumentRouterControlFlowMode,
        });
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Impossibile registrare l\'audit del router documentale' }, { status: 500 });
    }
}
