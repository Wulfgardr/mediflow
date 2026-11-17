'use client';

import type { PDFDocumentLoadingTask, PDFWorker } from 'pdfjs-dist';
import { preparePdfPreviewInput } from '../components/document-viewer-pdf';
import { OwnedStandardFontDataFactory } from '../components/document-viewer-pdf-fonts';
import { PreviewScope } from '../components/document-viewer-scope';

export async function agentVisitPdfText(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> {
    if (bytes.length > 16 * 1024 * 1024) throw new Error('AGENT_PDF_LIMIT');
    const scope = new PreviewScope(signal, 15000);
    let checked: Uint8Array | undefined;
    let port: Worker | undefined;
    let worker: PDFWorker | undefined;
    let task: PDFDocumentLoadingTask | undefined;
    try {
        checked = await preparePdfPreviewInput(bytes, scope);
        const pdfjs = await scope.wait(import('pdfjs-dist'));
        port = new Worker(new URL('../components/document-viewer-pdf.worker.ts', import.meta.url), { type: 'module' });
        worker = pdfjs.PDFWorker.fromPort({ port });
        class NoAuxiliaryResources { async fetch(): Promise<never> { throw new Error('AGENT_PDF_RESOURCE_DENIED'); } }
        task = pdfjs.getDocument({ data: checked, worker, isEvalSupported: false, enableXfa: false, useWorkerFetch: false,
            CMapReaderFactory: NoAuxiliaryResources, StandardFontDataFactory: OwnedStandardFontDataFactory, useSystemFonts: false,
            disableFontFace: true, stopAtErrors: true, disableRange: true, disableStream: true, maxImageSize: 12000000 });
        const pdf = await scope.wait(task.promise);
        if (pdf.numPages < 1 || pdf.numPages > 80) throw new Error('AGENT_PDF_LIMIT');
        let text = '';
        for (let index = 1; index <= pdf.numPages; index++) {
            const page = await scope.wait(pdf.getPage(index));
            const content = await scope.wait(page.getTextContent());
            text += content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') + '\n';
            page.cleanup();
            if (text.length > 2 * 1024 * 1024) throw new Error('AGENT_PDF_LIMIT');
        }
        scope.check();
        return text;
    } finally {
        scope.finish();
        try { if (task) void task.destroy().catch(() => undefined); } catch { }
        try { worker?.destroy(); } catch { }
        try { port?.terminate(); } finally {
            try { checked?.fill(0); } catch { }
        }
    }
}
