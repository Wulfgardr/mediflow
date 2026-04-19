
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
/* @Codex */
import { loadPdfJsServer } from '@/lib/pdfjs-server';

/* @Codex */
const PDF_SIGNAL_KEYWORDS = [
    'diagnosi', 'terapia', 'farmac', 'prescr', 'anamnesi', 'esami', 'referto',
    'dimission', 'valutazione', 'conclusioni', 'paziente', 'medico', 'controll',
    'rivalut', 'follow', 'domiciliar'
];

/* @Codex */
function buildPdfPageText(items: any[]): string {
    const positioned = items
        .map((item) => ({
            text: typeof item?.str === 'string' ? item.str.trim() : '',
            x: Array.isArray(item?.transform) ? Number(item.transform[4]) || 0 : 0,
            y: Array.isArray(item?.transform) ? Number(item.transform[5]) || 0 : 0,
        }))
        .filter((item) => item.text);

    positioned.sort((left, right) => {
        if (Math.abs(right.y - left.y) > 3) return right.y - left.y;
        return left.x - right.x;
    });

    const lines: Array<{ y: number; parts: Array<{ text: string; x: number }> }> = [];
    for (const item of positioned) {
        const currentLine = lines[lines.length - 1];
        if (!currentLine || Math.abs(currentLine.y - item.y) > 3) {
            lines.push({ y: item.y, parts: [{ text: item.text, x: item.x }] });
            continue;
        }
        currentLine.parts.push({ text: item.text, x: item.x });
    }

    return lines
        .map((line) => line.parts
            .sort((left, right) => left.x - right.x)
            .map((part) => part.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(Boolean)
        .join('\n');
}

/* @Codex */
async function selectPdfPagesForExtraction(pdf: any, maxPages: number): Promise<number[]> {
    const total = pdf.numPages || 1;
    const analysisPages = Math.min(total, Math.max(maxPages + 3, 9));
    const scores: Array<{ page: number; score: number }> = [];

    for (let pageNumber = 1; pageNumber <= analysisPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = (textContent.items as any[]).map((item) => item.str).join(' ');
        const lower = text.toLowerCase();

        let score = text.length;
        for (const keyword of PDF_SIGNAL_KEYWORDS) {
            if (lower.includes(keyword)) score += 500;
        }
        if (/\b\d{1,3}(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|fiala|fiale)\b/i.test(lower)) score += 220;
        if (/\b(?:tac|egds|rx|visita|follow|controll|rivalut)\w*/i.test(lower)) score += 180;

        scores.push({ page: pageNumber, score });
    }

    const selected = new Set<number>([1]);
    if (total > 1) selected.add(total);

    scores
        .sort((left, right) => right.score - left.score)
        .forEach(({ page }) => {
            if (selected.size >= maxPages) return;
            selected.add(page);
        });

    return Array.from(selected).sort((left, right) => left - right).slice(0, maxPages);
}

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

        const pagesToExtract = await selectPdfPagesForExtraction(pdf, Math.min(pdf.numPages, 6));

        for (const pageNumber of pagesToExtract) {
            const page = await pdf.getPage(pageNumber);
            const textContent = await page.getTextContent();

            const pageText = buildPdfPageText(textContent.items as any[]);
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
