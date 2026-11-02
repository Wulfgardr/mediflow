/** Limits of the local page renderer used before OCR (`scripts/anydoc-pdf-page-worker.mjs`). */
export const OCR_RENDER_DPI = 144;
export const OCR_MAX_SIDE_PIXELS = 4096;
export const OCR_MAX_PIXELS = 12_000_000;
/** Below half of the original linear resolution an image is not reduced: the text may become
 * too small for OCR. The physician is told why and is asked for a smaller scan. */
export const OCR_MIN_REDUCTION = 0.5;

export type ImagePageGeometry =
    | Readonly<{ ok: true; width: number; height: number; scale: number; pageWidth: number; pageHeight: number }>
    | Readonly<{ ok: false; reason: 'invalid' | 'too-large'; scale?: number }>;

/** Pixels to keep and the PDF page in points such that the worker's render at 144 DPI returns
 * exactly those pixels, within 4096 px per side and 12 Mpx. */
export function fitImageForLocalOcr(width: number, height: number): ImagePageGeometry {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return { ok: false, reason: 'invalid' };
    const scale = Math.min(1, OCR_MAX_SIDE_PIXELS / Math.max(width, height), Math.sqrt(OCR_MAX_PIXELS / (width * height)));
    if (scale < OCR_MIN_REDUCTION) return { ok: false, reason: 'too-large', scale };
    let outWidth = Math.max(1, Math.floor(width * scale)), outHeight = Math.max(1, Math.floor(height * scale));
    while (outWidth * outHeight > OCR_MAX_PIXELS) { outWidth -= 1; outHeight = Math.max(1, Math.floor(outWidth * height / width)); }
    const points = 72 / OCR_RENDER_DPI;
    return { ok: true, width: outWidth, height: outHeight, scale: outWidth / width, pageWidth: outWidth * points, pageHeight: outHeight * points };
}
