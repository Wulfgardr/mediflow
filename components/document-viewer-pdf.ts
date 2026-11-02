/* PDF.js adapter. Imported only by the local preview, never by an API. */
import type { RenderTask } from 'pdfjs-dist';
import { assertImageSize, PREVIEW_LIMITS, PreviewError } from './document-viewer-policy.ts';
import { PreviewScope } from './document-viewer-scope.ts';
import { OwnedStandardFontDataFactory } from './document-viewer-pdf-fonts.ts';
import { boundedCanvasFactory, checkPdfOperators } from './document-viewer-pdf-resources.ts';
import { paintPdfPage, rejectPdfWorkerFailure, type PreviewPdfEngineFactory, type PreviewPdfPage, type PreviewRenderTask } from './document-viewer-pdf-core.ts';

// PDF.js 4.10 exposes onContinue as Function. Do not assert that its task has
// our narrower callback property: install a typed callback through this port.
// Wrapping cancel also preserves the native task's receiver and promise identity.
export function adaptPdfRenderTask(task: Pick<RenderTask, 'promise' | 'cancel' | 'onContinue'>): PreviewRenderTask {
    return {
        promise: task.promise,
        cancel: () => task.cancel(),
        setContinuation: (callback) => { task.onContinue = callback; },
    };
}

export async function preparePdfPreviewInput(bytes: Uint8Array, scope: PreviewScope): Promise<Uint8Array> {
    scope.check();
    let port: Worker;
    try {
        port = new Worker(new URL('./document-viewer-pdf-preflight.worker.ts', import.meta.url), { type: 'module' });
    } catch { throw new PreviewError('runtime_unavailable'); }
    let transferred: Uint8Array | undefined;
    let checked: Uint8Array | undefined;
    let message!: (event: MessageEvent) => void;
    let failure!: (event: Event) => void;
    try {
        const result = new Promise<Uint8Array>((resolve, reject) => {
            failure = (event) => {
                event.preventDefault();
                reject(new PreviewError('runtime_unavailable'));
            };
            message = (event) => {
                const value = event.data;
                if (value?.status === 'ok' && value.bytes instanceof Uint8Array
                    && value.bytes.byteLength > 0 && value.bytes.byteLength <= PREVIEW_LIMITS.sourceBytes) {
                    resolve(value.bytes);
                } else {
                    if (value?.bytes instanceof Uint8Array) value.bytes.fill(0);
                    reject(new PreviewError(value?.status === 'encrypted' ? 'encrypted_pdf'
                        : value?.status === 'limit' || value?.status === 'invalid' ? 'invalid_pdf' : 'runtime_unavailable'));
                }
            };
            port.addEventListener('message', message);
            port.addEventListener('error', failure);
            port.addEventListener('messageerror', failure);
            transferred = bytes.slice();
            port.postMessage(transferred, [transferred.buffer]);
        });
        checked = await scope.wait(result, (late) => { late.fill(0); });
        scope.check();
        return checked;
    } catch (error) {
        checked?.fill(0);
        throw error instanceof PreviewError ? error : new PreviewError('runtime_unavailable');
    } finally {
        port.removeEventListener('message', message);
        port.removeEventListener('error', failure);
        port.removeEventListener('messageerror', failure);
        try { port.terminate(); } finally {
            try { transferred?.fill(0); } catch { /* detached transferred buffer */ }
        }
    }
}

export async function renderPdfPreview(bytes: Uint8Array, number: number, canvas: HTMLCanvasElement, signal: AbortSignal) {
    const moduleScope = new PreviewScope(signal, PREVIEW_LIMITS.pageTimeoutMs);
    let checkedBytes: Uint8Array | undefined;
    try {
        moduleScope.check();
        checkedBytes = await preparePdfPreviewInput(bytes, moduleScope);
        moduleScope.check();
        // Lazy client import; no fake-worker fallback.
        let pdfjs: typeof import('pdfjs-dist');
        try { pdfjs = await moduleScope.wait(import('pdfjs-dist')); }
        catch (error) { throw error instanceof PreviewError ? error : new PreviewError('runtime_unavailable'); }
        moduleScope.check();
        const createEngine: PreviewPdfEngineFactory = (source, fail) => {
            let port: Worker;
            try {
                port = new Worker(new URL('./document-viewer-pdf.worker.ts', import.meta.url), { type: 'module' });
            } catch { throw new PreviewError('runtime_unavailable'); }
            const canvases = boundedCanvasFactory();
            let worker: InstanceType<typeof pdfjs.PDFWorker> | undefined;
            let loading: ReturnType<typeof pdfjs.getDocument> | undefined;
            let transferred: Uint8Array | undefined;
            let disposed = false;
            const workerError = (event: Event) => {
                event.preventDefault();
                fail(new PreviewError('runtime_unavailable'));
            };
            const workerMessage = (event: MessageEvent) => rejectPdfWorkerFailure(event.data, fail);
            port.addEventListener('message', workerMessage);
            port.addEventListener('error', workerError);
            port.addEventListener('messageerror', workerError);
            const dispose = () => {
                if (disposed) return;
                disposed = true;
                port.removeEventListener('message', workerMessage);
                port.removeEventListener('error', workerError);
                port.removeEventListener('messageerror', workerError);
                // Trigger PDF.js cleanup, but never wait for a destroyed peer's
                // acknowledgement. Native worker termination is unconditional.
                try { if (loading) void loading.destroy().catch(() => undefined); } catch { /* no payload logs */ }
                try { worker?.destroy(); } catch { /* no payload logs */ }
                try { port.terminate(); } finally { canvases.dispose(); }
                try { transferred?.fill(0); } catch { /* detached transferred buffer */ }
                transferred = undefined;
            };
            class NoAuxiliaryResources {
                async fetch(): Promise<never> {
                    const error = new PreviewError('missing_resource');
                    fail(error);
                    throw error;
                }
            }
            try {
                worker = pdfjs.PDFWorker.fromPort({ port });
                // Do not transfer/detach the caller-owned source retained for
                // navigation. At most one parser copy exists per requested page.
                transferred = source.slice();
                loading = pdfjs.getDocument({
                    data: transferred,
                    worker,
                    isEvalSupported: false,
                    enableXfa: false,
                    useWorkerFetch: false,
                    CMapReaderFactory: NoAuxiliaryResources,
                    StandardFontDataFactory: OwnedStandardFontDataFactory,
                    CanvasFactory: canvases.CanvasFactory,
                    useSystemFonts: false,
                    disableFontFace: true,
                    stopAtErrors: true,
                    disableRange: true,
                    disableStream: true,
                    disableAutoFetch: true,
                    isOffscreenCanvasSupported: false,
                    maxImageSize: PREVIEW_LIMITS.imagePixels,
                    verbosity: 0,
                });
                loading.onPassword = () => fail(new PreviewError('encrypted_pdf'));
                const opened = loading.promise.then((document) => ({
                    pages: document.numPages,
                    async info() {
                        const metadata = await document.getMetadata();
                        const info = metadata.info as { EncryptFilterName?: unknown; IsXFAPresent?: unknown };
                        return {
                            encrypted: info.EncryptFilterName != null,
                            xfa: document.isPureXfa || info.IsXFAPresent === true,
                        };
                    },
                    async page(pageNumber: number): Promise<PreviewPdfPage> {
                        const page = await document.getPage(pageNumber);
                        return {
                            measure: () => page.getViewport({ scale: 1 }),
                            async operators() {
                                const list = await page.getOperatorList({ intent: 'display', annotationMode: pdfjs.AnnotationMode.DISABLE });
                                checkPdfOperators(list, {
                                    image: pdfjs.OPS.paintImageXObject, inline: pdfjs.OPS.paintInlineImageXObject,
                                    mask: pdfjs.OPS.paintImageMaskXObject, repeat: pdfjs.OPS.paintImageXObjectRepeat,
                                });
                                const seen = new Set<string>();
                                let pixels = 0;
                                // Repeated XObjects have no width/height operands.
                                // Inspect the resolved image too, before any paint.
                                // Decoding has already occurred: this is not a
                                // hard quota on worker/decompressor allocations.
                                for (let index = 0; index < list.fnArray.length; index++) {
                                    if (disposed) throw new PreviewError('cancelled');
                                    const code = list.fnArray[index];
                                    if (code !== pdfjs.OPS.paintImageXObject && code !== pdfjs.OPS.paintImageXObjectRepeat) continue;
                                    const id: unknown = list.argsArray[index]?.[0];
                                    if (typeof id !== 'string') throw new PreviewError('invalid_pdf');
                                    if (seen.has(id)) continue;
                                    seen.add(id);
                                    const pool = id.startsWith('g_') ? page.commonObjs : page.objs;
                                    const value = await new Promise<unknown>((resolve) => { pool.get(id, resolve); });
                                    if (disposed) throw new PreviewError('cancelled');
                                    if (!value || typeof value !== 'object') throw new PreviewError('invalid_pdf');
                                    const image = value as { width?: unknown; height?: unknown; data?: unknown };
                                    if (typeof image.width !== 'number' || typeof image.height !== 'number') throw new PreviewError('invalid_pdf');
                                    assertImageSize(image.width, image.height);
                                    pixels += image.width * image.height;
                                    if (pixels > PREVIEW_LIMITS.pageImagePixels
                                        || (ArrayBuffer.isView(image.data) && image.data.byteLength > PREVIEW_LIMITS.imagePixels * 4)) {
                                        throw new PreviewError('memory_limit');
                                    }
                                }
                                return list;
                            },
                            paint(target, scale) {
                                const context = target.getContext('2d');
                                if (!context) throw new PreviewError('runtime_unavailable');
                                return adaptPdfRenderTask(page.render({
                                    canvasContext: context,
                                    viewport: page.getViewport({ scale }),
                                    intent: 'display',
                                    annotationMode: pdfjs.AnnotationMode.DISABLE,
                                    background: '#ffffff',
                                }));
                            },
                            cleanup: () => { page.cleanup(); },
                        };
                    },
                }));
                return {
                    document: opened,
                    imageOps: {
                        image: pdfjs.OPS.paintImageXObject,
                        inline: pdfjs.OPS.paintInlineImageXObject,
                        mask: pdfjs.OPS.paintImageMaskXObject,
                        repeat: pdfjs.OPS.paintImageXObjectRepeat,
                    },
                    dispose,
                };
            } catch (error) {
                dispose();
                throw error instanceof PreviewError ? error : new PreviewError('runtime_unavailable');
            }
        };
        // One total deadline spans import and paint; the inner scope additionally
        // owns cancellation of every PDF API operation and its native worker.
        return await paintPdfPage(checkedBytes, number, canvas, moduleScope.signal, createEngine);
    } finally {
        checkedBytes?.fill(0);
        moduleScope.finish();
    }
}
