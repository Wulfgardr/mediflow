/** Limits of the local page renderer used before OCR (`scripts/anydoc-pdf-page-worker.mjs`). */
export const OCR_RENDER_DPI = 144;
export const OCR_MAX_SIDE_PIXELS = 4096;
export const OCR_MAX_PIXELS = 12_000_000;
export const OCR_MAX_RASTER_BYTES = 16 * 1024 * 1024;

/** Pixel budget of an image converted in the browser, below the renderer's 12 Mpx. The renderer also
 * refuses a page whose PNG exceeds 16 MiB, and the PNG of a photo grows with sensor noise: at 12 Mpx a
 * sheet photographed with grain (luminance noise sigma 8) renders to 16.6 MiB. PNG size grows about
 * linearly with the pixel count, so 8 Mpx keeps that case near 11 MiB, a third below the limit, while
 * an A4 page still keeps about 2380 x 3360 px, close to 290 dpi. */
export const OCR_IMAGE_PIXEL_BUDGET = 8_000_000;

/** A reduced image keeps at least this many pixels on its short side: an A4 page at 1200 px is about
 * 145 dpi, near the 150 dpi usually taken as the floor for OCR of body text. Only a very elongated
 * image (a long receipt, a panorama) can fall below it; an image that is already small is not reduced. */
export const OCR_MIN_SHORT_SIDE_PIXELS = 1200;

export type ImagePageGeometry =
    | Readonly<{ ok: true; width: number; height: number; scale: number; pageWidth: number; pageHeight: number }>
    | Readonly<{ ok: false; reason: 'invalid' | 'too-elongated'; shortSide?: number }>;

/** Pixels to keep and the PDF page in points such that the worker's render at 144 DPI returns
 * exactly those pixels, within 4096 px per side and the 8 Mpx budget. */
export function fitImageForLocalOcr(width: number, height: number): ImagePageGeometry {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return { ok: false, reason: 'invalid' };
    const scale = Math.min(1, OCR_MAX_SIDE_PIXELS / Math.max(width, height), Math.sqrt(OCR_IMAGE_PIXEL_BUDGET / (width * height)));
    let outWidth = Math.max(1, Math.floor(width * scale)), outHeight = Math.max(1, Math.floor(height * scale));
    while (outWidth * outHeight > OCR_IMAGE_PIXEL_BUDGET) { outWidth -= 1; outHeight = Math.max(1, Math.floor(outWidth * height / width)); }
    const shortSide = Math.min(outWidth, outHeight);
    if (scale < 1 && shortSide < OCR_MIN_SHORT_SIDE_PIXELS) return { ok: false, reason: 'too-elongated', shortSide };
    const points = 72 / OCR_RENDER_DPI;
    return { ok: true, width: outWidth, height: outHeight, scale: outWidth / width, pageWidth: outWidth * points, pageHeight: outHeight * points };
}
