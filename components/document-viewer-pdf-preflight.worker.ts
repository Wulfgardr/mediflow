import { PdfRasterEncrypted, PdfRasterLimit, preparePdfRasterInput } from '../lib/pdf-raster-preflight.mjs';
import { PREVIEW_LIMITS } from './document-viewer-policy.ts';

const port = self as unknown as {
    onmessage: ((event: MessageEvent<Uint8Array>) => void) | null;
    postMessage: (value: unknown, transfer?: Transferable[]) => void;
};
port.onmessage = async ({ data: bytes }) => {
    let checked: Uint8Array | undefined;
    try {
        checked = await preparePdfRasterInput(bytes, {
            maxPixels: PREVIEW_LIMITS.imagePixels,
            maxDimension: PREVIEW_LIMITS.imageDimension,
            maxBytes: PREVIEW_LIMITS.sourceBytes,
        });
        port.postMessage({ status: 'ok', bytes: checked }, [checked.buffer]);
    } catch (error) {
        port.postMessage({ status: error instanceof PdfRasterEncrypted ? 'encrypted'
            : error instanceof PdfRasterLimit ? 'limit' : 'invalid' });
    } finally {
        bytes.fill(0);
        try { checked?.fill(0); } catch { /* detached transferred buffer */ }
    }
};
