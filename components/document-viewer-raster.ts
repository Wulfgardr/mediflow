/* @Codex — static raster decoding, one short-lived blob URL, no network inputs. */
import { assertImageSize, clearPreviewCanvas, PREVIEW_LIMITS, PreviewError, previewCanvasSize } from './document-viewer-policy.ts';
import { validatePngPixels } from './document-viewer-png.ts';
import { PreviewScope } from './document-viewer-scope.ts';
import type { DocumentPreview } from './document-viewer-preview.ts';

export async function renderRasterPreview(
    source: Extract<DocumentPreview, { kind: 'image' }>, canvas: HTMLCanvasElement, signal: AbortSignal,
): Promise<void> {
    const scope = new PreviewScope(signal, PREVIEW_LIMITS.rasterTimeoutMs);
    let image: HTMLImageElement | undefined;
    let url: string | undefined;
    let successful = false;
    const removeAbort = scope.onAbort(() => clearPreviewCanvas(canvas));
    clearPreviewCanvas(canvas);
    try {
        scope.check();
        assertImageSize(source.width, source.height);
        if (source.mime === 'image/png') await validatePngPixels(source.bytes, scope);
        // Explicit ArrayBuffer-backed copy is compatible with TS 5.9 BlobPart.
        url = URL.createObjectURL(new Blob([new Uint8Array(source.bytes)], { type: source.mime }));
        image = new Image();
        const target = image;
        const loaded = new Promise<void>((resolve, reject) => {
            target.onload = () => resolve();
            target.onerror = () => reject(new PreviewError('invalid_image'));
        });
        target.src = url;
        await scope.wait(loaded);
        // Wait for native decoding as well. Both onload and decode() may
        // tolerate corrupt PNG data: the streamed validation above is essential.
        await scope.wait(target.decode());
        scope.check();
        assertImageSize(target.naturalWidth, target.naturalHeight);
        // JPEG EXIF orientation may exchange axes, but may not enlarge the image.
        if (!((target.naturalWidth === source.width && target.naturalHeight === source.height)
            || (source.mime === 'image/jpeg' && target.naturalWidth === source.height && target.naturalHeight === source.width))) {
            throw new PreviewError('invalid_image');
        }
        const size = previewCanvasSize(target.naturalWidth, target.naturalHeight);
        canvas.width = size.width; canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new PreviewError('runtime_unavailable');
        context.drawImage(target, 0, 0, size.width, size.height);
        scope.check();
        successful = true;
    } catch (error) {
        throw error instanceof PreviewError ? error : new PreviewError('invalid_image');
    } finally {
        if (image) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
        if (url) URL.revokeObjectURL(url);
        if (!successful) clearPreviewCanvas(canvas);
        removeAbort();
        scope.finish();
    }
}
