/* @Codex — inspect compressed raster headers before invoking a browser decoder. */
import { assertImageSize, PreviewError } from './document-viewer-policy.ts';

export type RasterMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/bmp';
const ascii = (bytes: Uint8Array, at: number, size: number) =>
    String.fromCharCode(...bytes.subarray(at, at + size));
export function previewMagic(bytes: Uint8Array): string | null {
    if (/^%PDF-(?:1\.[0-7]|2\.0)/.test(ascii(bytes, 0, 8))) return 'application/pdf';
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (/^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return 'image/gif';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
    if (ascii(bytes, 0, 2) === 'BM') return 'image/bmp';
    return null;
}

export function inspectRaster(bytes: Uint8Array, mime: RasterMime): { width: number; height: number } {
    const bad = () => { throw new PreviewError('invalid_image'); };
    if (previewMagic(bytes) !== mime) throw new PreviewError('mime_mismatch');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const need = (at: number, size: number) => {
        if (!Number.isSafeInteger(at) || at < 0 || size < 0 || at + size > bytes.length) bad();
    };
    const u16 = (at: number, le = false) => { need(at, 2); return view.getUint16(at, le); };
    const u32 = (at: number, le = false) => { need(at, 4); return view.getUint32(at, le); };
    let width = 0;
    let height = 0;
    if (mime === 'image/png') {
        need(0, 33);
        if (u32(8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') bad();
        width = u32(16); height = u32(20);
        assertImageSize(width, height);
        let at = 8;
        let data = false;
        let end = false;
        while (at < bytes.length) {
            need(at, 12);
            const length = u32(at);
            need(at, length + 12);
            const kind = ascii(bytes, at + 4, 4);
            if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') throw new PreviewError('animated_image');
            if (kind === 'IHDR' && at !== 8) bad();
            if (kind === 'IDAT') data = true;
            at += length + 12;
            if (kind === 'IEND') {
                if (length !== 0 || at !== bytes.length) bad();
                end = true; break;
            }
        }
        if (!data || !end) bad();
    } else if (mime === 'image/jpeg') {
        need(0, 4);
        if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) bad();
        let at = 2;
        let scan = false;
        while (at < bytes.length - 2) {
            if (bytes[at++] !== 255) bad();
            while (bytes[at] === 255) at++;
            need(at, 1);
            const marker = bytes[at++];
            if (marker === 0 || marker === 216 || marker === 217) bad();
            if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
            const length = u16(at);
            if (length < 2) bad();
            need(at, length);
            if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
                if (length < 8 || width !== 0) bad();
                height = u16(at + 3); width = u16(at + 5);
                assertImageSize(width, height);
            }
            if (marker === 218) { scan = true; break; }
            at += length;
        }
        if (!scan || !width || !height) bad();
    } else if (mime === 'image/gif') {
        need(0, 13);
        width = u16(6, true); height = u16(8, true);
        assertImageSize(width, height);
        let at = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
        let frames = 0;
        let end = false;
        const blocks = () => {
            for (;;) {
                need(at, 1);
                const n = bytes[at++];
                need(at, n); at += n;
                if (n === 0) return;
            }
        };
        while (at < bytes.length) {
            const kind = bytes[at++];
            if (kind === 59) { end = at === bytes.length; break; }
            if (kind === 33) {
                need(at, 1);
                // Plain-text GIF extensions are not raster content.
                if (bytes[at++] === 1) bad();
                blocks();
            } else if (kind === 44) {
                if (++frames > 1) throw new PreviewError('animated_image');
                need(at, 9);
                const x = u16(at, true), y = u16(at + 2, true);
                const w = u16(at + 4, true), h = u16(at + 6, true);
                assertImageSize(w, h);
                if (x + w > width || y + h > height) bad();
                const packed = bytes[at + 8];
                at += 9 + ((packed & 128) ? 3 * (1 << ((packed & 7) + 1)) : 0);
                need(at, 1); at++; // LZW minimum code size; decoder validates compressed data.
                blocks();
            } else bad();
        }
        if (frames !== 1 || !end) bad();
    } else if (mime === 'image/webp') {
        need(0, 20);
        if (u32(4, true) !== bytes.length - 8) bad();
        let at = 12;
        let frames = 0;
        const u24 = (p: number) => { need(p, 3); return bytes[p] + bytes[p + 1] * 256 + bytes[p + 2] * 65536; };
        while (at < bytes.length) {
            need(at, 8);
            const kind = ascii(bytes, at, 4), n = u32(at + 4, true), p = at + 8;
            need(p, n);
            if (kind === 'ANIM' || kind === 'ANMF') throw new PreviewError('animated_image');
            if (kind === 'VP8X') {
                if (n !== 10) bad();
                if (bytes[p] & 2) throw new PreviewError('animated_image');
                width = u24(p + 4) + 1; height = u24(p + 7) + 1;
                assertImageSize(width, height);
            }
            if (kind === 'VP8 ' || kind === 'VP8L') {
                if (++frames > 1) throw new PreviewError('animated_image');
                let w: number, h: number;
                if (kind === 'VP8 ') {
                    if (n < 10 || ascii(bytes, p + 3, 3) !== '\x9d\x01\x2a') bad();
                    w = u16(p + 6, true) & 0x3fff; h = u16(p + 8, true) & 0x3fff;
                } else {
                    if (n < 5 || bytes[p] !== 47) bad();
                    const bits = u32(p + 1, true);
                    w = (bits & 0x3fff) + 1; h = ((bits >>> 14) & 0x3fff) + 1;
                }
                assertImageSize(w, h);
                if (width && (w !== width || h !== height)) bad();
                width = w; height = h;
            }
            at = p + n + (n % 2);
            need(at, 0);
        }
        if (frames !== 1 || !width || !height) bad();
    } else {
        need(0, 54);
        const dib = u32(14, true), offset = u32(10, true), declared = u32(2, true);
        if (dib < 40 || dib > 124 || offset < 14 + dib || declared !== bytes.length) bad();
        width = view.getInt32(18, true); height = Math.abs(view.getInt32(22, true));
        assertImageSize(width, height);
        const bpp = u16(28, true), compression = u32(30, true);
        if (u16(26, true) !== 1 || ![1, 4, 8, 16, 24, 32].includes(bpp) || ![0, 3].includes(compression)) bad();
        need(offset, Math.ceil(width * bpp / 32) * 4 * height);
    }
    assertImageSize(width, height);
    return { width, height };
}
