/* @Codex — PDF.js standard-font closure: only emitted package assets, never document URLs. */
import { PreviewError } from './document-viewer-policy.ts';

const STANDARD_FONT_MAX_BYTES = 512 * 1024;

const OWNED_STANDARD_FONT_ASSETS = Object.freeze({
    'FoxitDingbats.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitDingbats.pfb', import.meta.url),
    'FoxitFixed.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitFixed.pfb', import.meta.url),
    'FoxitFixedBold.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitFixedBold.pfb', import.meta.url),
    'FoxitFixedBoldItalic.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb', import.meta.url),
    'FoxitFixedItalic.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb', import.meta.url),
    'FoxitSerif.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitSerif.pfb', import.meta.url),
    'FoxitSerifBold.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitSerifBold.pfb', import.meta.url),
    'FoxitSerifBoldItalic.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb', import.meta.url),
    'FoxitSerifItalic.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb', import.meta.url),
    'FoxitSymbol.pfb': new URL('../node_modules/pdfjs-dist/standard_fonts/FoxitSymbol.pfb', import.meta.url),
    'LiberationSans-Bold.ttf': new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf', import.meta.url),
    'LiberationSans-BoldItalic.ttf': new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf', import.meta.url),
    'LiberationSans-Italic.ttf': new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf', import.meta.url),
    'LiberationSans-Regular.ttf': new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url),
});

type StandardFontFile = keyof typeof OWNED_STANDARD_FONT_ASSETS;

function standardFontAsset(filename: unknown): URL {
    if (typeof filename !== 'string' || !Object.hasOwn(OWNED_STANDARD_FONT_ASSETS, filename)) {
        throw new PreviewError('missing_resource');
    }
    return OWNED_STANDARD_FONT_ASSETS[filename as StandardFontFile];
}

export async function readOwnedStandardFont(
    filename: unknown,
    fetchAsset: typeof fetch = fetch,
): Promise<Uint8Array> {
    const response = await fetchAsset(standardFontAsset(filename), { credentials: 'same-origin' });
    if (!response.ok) throw new PreviewError('missing_resource');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > STANDARD_FONT_MAX_BYTES) {
        bytes.fill(0);
        throw new PreviewError('missing_resource');
    }
    return bytes;
}

export class OwnedStandardFontDataFactory {
    // PDF.js supplies a baseUrl configuration object. It is deliberately ignored:
    // only the static, bundler-emitted allowlist above may be read.
    constructor() {}

    fetch({ filename }: { filename: unknown }): Promise<Uint8Array> {
        return readOwnedStandardFont(filename);
    }
}
