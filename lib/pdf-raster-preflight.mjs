import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';

export class PdfRasterLimit extends Error {}
export class PdfRasterEncrypted extends Error {}

// PDF.js has no public pre-decode resource API. Validate every stream, including
// unreachable resources, then serialize the checked graph so its xref and object
// selection cannot differ between pdf-lib and PDF.js. Image streams stay encoded.
export async function preparePdfRasterInput(bytes, { maxPixels, maxDimension, maxBytes }) {
    const reject = () => { throw new PdfRasterLimit('pdf_raster_limit'); };
    if (bytes.byteLength > maxBytes) reject();
    // pdf-lib errors are ES5 subclasses and fail instanceof: read the trailer instead.
    const pdf = await PDFDocument.load(bytes, {
        ignoreEncryption: true, throwOnInvalidObject: true, updateMetadata: false,
    });
    if (pdf.isEncrypted) throw new PdfRasterEncrypted('pdf_encrypted');
    const context = pdf.context;
    const seen = new Set();
    const active = new Set();
    const measured = new Map();
    const resolve = value => {
        const result = value instanceof PDFRef ? context.lookup(value) : value;
        if (value instanceof PDFRef && !result) reject();
        return result;
    };
    const size = (width, height) => {
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
            || width > maxDimension || height > maxDimension || width * height > maxPixels) reject();
    };
    const image = (stream, depth = 0) => {
        if (!(stream instanceof PDFRawStream) || depth > 32 || active.has(stream)) reject();
        if (measured.has(stream)) return measured.get(stream);
        active.add(stream);
        const dict = stream.dict;
        const number = key => {
            const value = resolve(dict.get(PDFName.of(key)));
            return value instanceof PDFNumber ? value.asNumber() : NaN;
        };
        let width = number('Width'), height = number('Height');
        size(width, height);
        const stencil = resolve(dict.get(PDFName.of('ImageMask')));
        if (stencil !== undefined && !(stencil instanceof PDFBool)) reject();
        const bpc = number('BitsPerComponent');
        // Missing codec-derived depths and depths above eight are deliberately
        // refused: they cannot establish the existing four-byte raster bound.
        if (!(stencil instanceof PDFBool && stencil.asBoolean() && Number.isNaN(bpc))
            && ![1, 2, 4, 8].includes(bpc)) reject();
        for (const key of ['SMask', 'Mask']) {
            const mask = resolve(dict.get(PDFName.of(key)));
            if (mask === undefined || mask === PDFName.of('None')) continue;
            if (key === 'Mask' && mask instanceof PDFArray) {
                if (mask.size() > 8 || mask.size() % 2 !== 0) reject();
                for (const entry of mask.asArray()) if (!(resolve(entry) instanceof PDFNumber)) reject();
                continue;
            }
            const dimensions = image(mask, depth + 1);
            width = Math.max(width, dimensions.width);
            height = Math.max(height, dimensions.height);
            size(width, height);
        }
        active.delete(stream);
        const dimensions = { width, height };
        measured.set(stream, dimensions);
        return dimensions;
    };
    const visit = (object, depth = 0) => {
        const value = resolve(object);
        if (seen.has(value)) return;
        if (depth > 64) reject();
        seen.add(value);
        if (value instanceof PDFRawStream) {
            if (resolve(value.dict.get(PDFName.of('Subtype'))) === PDFName.of('Image')
                || value.dict.has(PDFName.of('Width')) || value.dict.has(PDFName.of('Height'))) image(value);
            visit(value.dict, depth + 1);
        } else if (value instanceof PDFDict) {
            for (const entry of value.values()) visit(entry, depth + 1);
        } else if (value instanceof PDFArray) {
            for (const entry of value.asArray()) visit(entry, depth + 1);
        }
    };
    for (const [, object] of context.enumerateIndirectObjects()) visit(object);
    const result = await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
    if (result.byteLength > maxBytes) reject();
    return result;
}
