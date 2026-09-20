/* @Codex — local preview policy; no document contents in errors or logs. */
export const PREVIEW_LIMITS = Object.freeze({
    sourceBytes: 25 * 1024 * 1024,
    textWindow: 65_536,
    decodeChunk: 262_144, // divisible by four for base64
    inputTimeoutMs: 15_000,
    pageTimeoutMs: 15_000,
    rasterTimeoutMs: 10_000,
    viewLifetimeMs: 10 * 60_000,
    pages: 500,
    pdfPoints: 14_400,
    canvasDimension: 2_048,
    canvasPixels: 4_000_000,
    imageDimension: 8_192,
    imagePixels: 12_000_000,
    pageImagePixels: 24_000_000,
    scratchPixels: 12_000_000,
    scratchCanvases: 64,
    operators: 50_000,
    operandNodes: 500_000,
    operandBytes: 48 * 1024 * 1024,
    operandDepth: 32,
});
export const MAX_PREVIEW_BYTES = PREVIEW_LIMITS.sourceBytes;

const MESSAGES = {
    size_limit: 'Il documento supera il limite di 25 MiB per l’anteprima. L’allegato non è stato modificato.',
    invalid_source: 'Anteprima disponibile solo da un allegato locale in memoria, non da un indirizzo o collegamento.',
    invalid_base64: 'I dati codificati dell’anteprima non sono validi. L’allegato non è stato modificato.',
    unsupported_type: 'Formato non supportato dall’anteprima locale. L’allegato non è stato modificato.',
    mime_mismatch: 'Il tipo dichiarato non corrisponde al contenuto del documento. Anteprima interrotta.',
    invalid_utf8: 'Il testo non è un documento UTF-8 valido. L’allegato non è stato modificato.',
    invalid_image: 'L’immagine non è leggibile o è danneggiata. L’allegato non è stato modificato.',
    animated_image: 'L’anteprima locale supporta solo immagini statiche, non animate.',
    image_limit: 'L’immagine supera i limiti di dimensione dell’anteprima locale. L’allegato non è stato modificato.',
    invalid_pdf: 'Il PDF non è leggibile o è danneggiato. L’allegato non è stato modificato.',
    encrypted_pdf: 'Il PDF è protetto da cifratura o password e non può essere aperto in questa anteprima.',
    xfa_pdf: 'I moduli PDF XFA non sono supportati dall’anteprima locale.',
    page_limit: 'Il PDF supera il limite di 500 pagine per l’anteprima locale.',
    page_dimensions: 'Le dimensioni della pagina PDF superano i limiti dell’anteprima locale.',
    page_unavailable: 'La pagina richiesta non è disponibile.',
    operation_limit: 'La pagina è troppo complessa per l’anteprima locale. L’allegato non è stato modificato.',
    memory_limit: 'La pagina supera il budget grafico dell’anteprima locale. L’allegato non è stato modificato.',
    missing_resource: 'Il PDF richiede risorse grafiche non disponibili localmente. Nessuna risorsa è stata scaricata.',
    runtime_unavailable: 'Il motore locale di anteprima non è disponibile in questo browser. Chiudi e riapri il documento.',
    timeout: 'L’anteprima ha superato il tempo disponibile ed è stata interrotta. L’allegato non è stato modificato.',
    expired: 'L’anteprima è scaduta e le risorse sono state rilasciate. Chiudi e riapri il documento.',
    cancelled: 'Anteprima interrotta. L’allegato non è stato modificato.',
} as const;
export type PreviewErrorCode = keyof typeof MESSAGES;
export type PreviewFailure = Readonly<{ code: PreviewErrorCode; message: string }>;

export class PreviewError extends Error {
    readonly code: PreviewErrorCode;
    constructor(code: PreviewErrorCode) {
        super(MESSAGES[code]);
        this.name = 'PreviewError';
        this.code = code;
    }
}
export function previewFailure(error: unknown, fallback: PreviewErrorCode = 'invalid_source'): PreviewFailure {
    const code = error instanceof PreviewError ? error.code : fallback;
    return { code, message: MESSAGES[code] };
}
export function assertSourceSize(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0) throw new PreviewError('invalid_source');
    if (size > MAX_PREVIEW_BYTES) throw new PreviewError('size_limit');
}
export function assertImageSize(width: number, height: number): void {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
        throw new PreviewError('invalid_image');
    }
    if (width > PREVIEW_LIMITS.imageDimension || height > PREVIEW_LIMITS.imageDimension
        || width * height > PREVIEW_LIMITS.imagePixels) throw new PreviewError('image_limit');
}
export function previewCanvasSize(width: number, height: number, pdf = false) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
        || (pdf && (width > PREVIEW_LIMITS.pdfPoints || height > PREVIEW_LIMITS.pdfPoints))) {
        throw new PreviewError(pdf ? 'page_dimensions' : 'image_limit');
    }
    // Never round up beyond the budget; tiny positive viewports still get one pixel.
    const scale = Math.min(pdf ? 1.5 : 1, PREVIEW_LIMITS.canvasDimension / width,
        PREVIEW_LIMITS.canvasDimension / height, Math.sqrt(PREVIEW_LIMITS.canvasPixels / width / height));
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    if (w * h > PREVIEW_LIMITS.canvasPixels) throw new PreviewError('memory_limit');
    return { width: w, height: h, scale };
}
export function clearPreviewCanvas(canvas: HTMLCanvasElement): void {
    // Resizing drops the backing store as well as visible decrypted pixels.
    canvas.width = 0;
    canvas.height = 0;
}
export function textWindow(text: string, page: number) {
    const count = Math.max(1, Math.ceil(text.length / PREVIEW_LIMITS.textWindow));
    if (!Number.isInteger(page) || page < 1 || page > count) throw new PreviewError('page_unavailable');
    const boundary = (index: number) => index > 0 && index < text.length
        && text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff
        && text.charCodeAt(index - 1) >= 0xd800 && text.charCodeAt(index - 1) <= 0xdbff ? index + 1 : index;
    return { count, text: text.slice(boundary((page - 1) * PREVIEW_LIMITS.textWindow), boundary(page * PREVIEW_LIMITS.textWindow)) };
}
