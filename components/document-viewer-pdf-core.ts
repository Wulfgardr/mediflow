/* @Codex — testable lifecycle, without importing a runtime engine into unit tests. */
import { assertSourceSize, clearPreviewCanvas, PREVIEW_LIMITS, PreviewError, previewCanvasSize } from './document-viewer-policy.ts';
import { PreviewScope } from './document-viewer-scope.ts';
import { checkPdfOperators, type PreviewImageOps, type PreviewOperatorList } from './document-viewer-pdf-resources.ts';

export interface PreviewRenderTask {
    promise: Promise<unknown>;
    cancel(): void;
    setContinuation(callback: (continueRendering: () => void) => void): void;
}
export interface PreviewPdfPage {
    measure(): { width: number; height: number };
    operators(): Promise<PreviewOperatorList>;
    paint(canvas: HTMLCanvasElement, scale: number): PreviewRenderTask;
    cleanup(): void;
}
export interface PreviewPdfDocument {
    pages: number;
    info(): Promise<{ encrypted: boolean; xfa: boolean }>;
    page(number: number): Promise<PreviewPdfPage>;
}
export interface PreviewPdfEngine {
    document: Promise<PreviewPdfDocument>;
    imageOps: PreviewImageOps;
    // Must terminate the owned native worker synchronously, even if PDF.js'
    // asynchronous destroy handshake cannot complete after an abort.
    dispose(): void;
}
export type PreviewPdfEngineFactory = (bytes: Uint8Array, fail: (error: PreviewError) => void) => PreviewPdfEngine;

export async function paintPdfPage(
    bytes: Uint8Array, number: number, canvas: HTMLCanvasElement, signal: AbortSignal,
    createEngine: PreviewPdfEngineFactory,
    timeoutMs: number = PREVIEW_LIMITS.pageTimeoutMs,
): Promise<{ pages: number; page: number; width: number; height: number }> {
    const scope = new PreviewScope(signal, timeoutMs);
    let engine: PreviewPdfEngine | undefined;
    let page: PreviewPdfPage | undefined;
    let render: PreviewRenderTask | undefined;
    let continuation: ReturnType<typeof setTimeout> | undefined;
    let success = false;
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (continuation !== undefined) clearTimeout(continuation);
        try { render?.cancel(); } catch { /* never leak engine exception text */ }
        try { page?.cleanup(); } catch { /* best-effort before worker termination */ }
        try { engine?.dispose(); } catch { /* adapter disposal is idempotent */ }
    };
    clearPreviewCanvas(canvas);
    const removeAbort = scope.onAbort(() => { clearPreviewCanvas(canvas); dispose(); });
    try {
        scope.check();
        assertSourceSize(bytes.byteLength);
        if (!Number.isInteger(number) || number < 1 || number > PREVIEW_LIMITS.pages) throw new PreviewError('page_unavailable');
        engine = createEngine(bytes, (error) => scope.stop(error));
        // A factory can synchronously fail through its callback. It must not
        // escape disposal merely because engine was assigned after that callback.
        if (scope.signal.aborted) { engine.dispose(); scope.check(); }
        const document = await scope.wait(engine.document);
        scope.check();
        if (!Number.isInteger(document.pages) || document.pages < 1) throw new PreviewError('invalid_pdf');
        if (document.pages > PREVIEW_LIMITS.pages) throw new PreviewError('page_limit');
        if (number > document.pages) throw new PreviewError('page_unavailable');
        const info = await scope.wait(document.info());
        scope.check();
        if (info.encrypted) throw new PreviewError('encrypted_pdf');
        if (info.xfa) throw new PreviewError('xfa_pdf');
        page = await scope.wait(document.page(number), (late) => late.cleanup());
        scope.check();
        const measured = page.measure();
        const size = previewCanvasSize(measured.width, measured.height, true);
        const operators = await scope.wait(page.operators());
        scope.check();
        // Post-materialization admission, NOT a hard cap on parser allocations.
        checkPdfOperators(operators, engine.imageOps);
        scope.check();
        canvas.width = size.width; canvas.height = size.height;
        render = page.paint(canvas, size.scale);
        const task = render;
        task.setContinuation((next) => {
            continuation = setTimeout(() => {
                continuation = undefined;
                if (scope.signal.aborted) { task.cancel(); return; }
                try { next(); } catch { scope.stop(new PreviewError('invalid_pdf')); }
            }, 0);
        });
        await scope.wait(task.promise);
        scope.check();
        success = true;
        return { pages: document.pages, page: number, width: size.width, height: size.height };
    } catch (error) {
        throw error instanceof PreviewError ? error : new PreviewError('invalid_pdf');
    } finally {
        if (!success) clearPreviewCanvas(canvas);
        dispose();
        removeAbort();
        scope.finish();
    }
}
