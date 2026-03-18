
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { loadPdfJsServer } from '@/lib/pdfjs-server';

/**
 * Server-Side PDF Text Extraction API
 * 
 * Handles PDF parsing on the server to avoid client-side build issues with 'canvas'
 * and heavy worker dependencies.
 */
export async function POST(req: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const pdfjsLib = await loadPdfJsServer();
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!isPdf) {
            return NextResponse.json({ error: "Invalid file type. This route extracts text from PDF only; use OCR endpoints for images." }, { status: 400 });
        }

        // Convert File to ArrayBuffer for pdfjs
        const arrayBuffer = await file.arrayBuffer();

        // Load the document using the legacy build (standard Node.js compatible)
        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
            // Disable worker for server-side usage (runs in main thread, simpler)
            disableFontFace: true,
            verbosity: 0
        });

        const pdf = await loadingTask.promise;
        let fullText = '';

        // Limit pages to avoid timeout on large docs
        const maxPages = Math.min(pdf.numPages, 5);

        for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            // Extract text items and join them
            const pageText = (textContent.items as any[]).map((item) => item.str).join(' ');
            fullText += pageText + '\n\n';
        }

        return NextResponse.json({ text: fullText });

    } catch (error: any) {
        console.error("[API] PDF Extraction Failed:", error);
        return NextResponse.json(
            { error: "Extraction failed: " + (error.message || "Unknown error") },
            { status: 500 }
        );
    }
}
