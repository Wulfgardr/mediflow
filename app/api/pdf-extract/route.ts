import { NextResponse } from 'next/server';
/* @Codex */
import {
    inspectPdf,
    PdfInspectionError,
    PDF_INSPECTOR_MAX_BYTES,
} from '@/lib/pdf-inspector-router';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

export const runtime = 'nodejs';

/** Server-side, local-only PDF page inspection and native text extraction. */
export async function POST(req: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }
        if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
            return NextResponse.json({ error: 'Invalid PDF file type' }, { status: 400 });
        }
        if (file.size <= 0 || file.size > PDF_INSPECTOR_MAX_BYTES) {
            return NextResponse.json(
                {
                    error: 'PDF exceeds local inspection limit',
                    textLayer: { state: 'unreadable', reason: 'resource_limit' },
                },
                { status: 413 },
            );
        }

        const inspected = await inspectPdf(Buffer.from(await file.arrayBuffer()));
        return NextResponse.json({
            text: inspected.text,
            textLayer: {
                state: inspected.state,
                pageCount: inspected.pageCount,
                pagesNeedingOcr: inspected.pagesNeedingOcr,
                pages: inspected.pages,
                parser: 'pdf-inspector-per-page',
            },
        });
    } catch (error) {
        const reason = error instanceof PdfInspectionError ? error.reason : 'parser_failed';
        if (reason === 'password_protected' || reason === 'corrupted_pdf') {
            return NextResponse.json(
                { error: 'PDF non leggibile localmente', textLayer: { state: 'unreadable', reason } },
                { status: 422 },
            );
        }
        const status = reason === 'resource_limit' ? 413 : 500;
        return NextResponse.json(
            { error: 'PDF inspection failed', textLayer: { state: 'unreadable', reason } },
            { status },
        );
    }
}
