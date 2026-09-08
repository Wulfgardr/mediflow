/* @Codex — only caller-owned in-memory bytes; never fetch an input URL. */
import { assertSourceSize, PREVIEW_LIMITS, PreviewError } from './document-viewer-policy.ts';
import { inspectRaster, previewMagic, type RasterMime } from './document-viewer-image-header.ts';
import { PreviewScope } from './document-viewer-scope.ts';

export type DocumentPreview =
    | { kind: 'text'; text: string }
    | { kind: 'pdf'; bytes: Uint8Array }
    | { kind: 'image'; bytes: Uint8Array; mime: RasterMime; width: number; height: number };
const TYPES = new Set(['text/plain', 'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);
function declaredMime(value: string): string {
    const match = /^([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;\s*charset=utf-8)?$/i.exec(value);
    if (!match || !TYPES.has(match[1].toLowerCase())) throw new PreviewError('unsupported_type');
    return match[1].toLowerCase();
}
function sextet(code: number): number {
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 71;
    if (code >= 48 && code <= 57) return code + 4;
    if (code === 43) return 62;
    if (code === 47) return 63;
    return -1;
}
async function readBase64(source: string, start: number, scope: PreviewScope): Promise<Uint8Array> {
    const n = source.length - start;
    if (n % 4 !== 0) throw new PreviewError('invalid_base64');
    const padding = n === 0 ? 0 : source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0;
    const end = source.length - padding;
    // Validate even an over-limit payload BEFORE returning size_limit. No giant
    // regex or whole-payload atob copy; malformed and valid oversized are distinct.
    for (let at = start; at < end; at += PREVIEW_LIMITS.decodeChunk) {
        scope.check();
        const stop = Math.min(end, at + PREVIEW_LIMITS.decodeChunk);
        for (let i = at; i < stop; i++) if (sextet(source.charCodeAt(i)) < 0) throw new PreviewError('invalid_base64');
        if (stop < end) await scope.yield();
    }
    if ((padding === 2 && (sextet(source.charCodeAt(end - 1)) & 15) !== 0)
        || (padding === 1 && (sextet(source.charCodeAt(end - 1)) & 3) !== 0)) throw new PreviewError('invalid_base64');
    const length = n / 4 * 3 - padding;
    assertSourceSize(length);
    const bytes = new Uint8Array(length);
    try {
        let offset = 0;
        for (let at = start; at < source.length; at += PREVIEW_LIMITS.decodeChunk) {
            scope.check();
            const binary = atob(source.slice(at, at + PREVIEW_LIMITS.decodeChunk));
            for (let i = 0; i < binary.length; i++) bytes[offset++] = binary.charCodeAt(i);
            if (at + PREVIEW_LIMITS.decodeChunk < source.length) await scope.yield();
        }
        scope.check();
        return bytes;
    } catch (error) {
        bytes.fill(0);
        throw error;
    }
}

export async function readDocumentPreview(file: Blob | string, signal: AbortSignal): Promise<DocumentPreview> {
    const scope = new PreviewScope(signal, PREVIEW_LIMITS.inputTimeoutMs);
    let bytes: Uint8Array | undefined;
    let handedOff = false;
    try {
        scope.check();
        let mime: string;
        if (typeof file === 'string') {
            const comma = file.slice(0, 256).indexOf(',');
            if (comma < 0 || !file.startsWith('data:') || !file.slice(0, comma).endsWith(';base64')) {
                throw new PreviewError('invalid_source');
            }
            mime = declaredMime(file.slice(5, comma - 7));
            bytes = await readBase64(file, comma + 1, scope);
        } else {
            if (!(file instanceof Blob)) throw new PreviewError('invalid_source');
            mime = declaredMime(file.type);
            assertSourceSize(file.size);
            bytes = new Uint8Array(file.size);
            for (let at = 0; at < file.size; at += PREVIEW_LIMITS.decodeChunk) {
                scope.check();
                const part = await scope.wait(file.slice(at, at + PREVIEW_LIMITS.decodeChunk).arrayBuffer(),
                    (late) => new Uint8Array(late).fill(0));
                const chunk = new Uint8Array(part);
                try { scope.check(); bytes.set(chunk, at); } finally { chunk.fill(0); }
                if (at + PREVIEW_LIMITS.decodeChunk < file.size) await scope.yield();
            }
        }
        scope.check();
        const magic = previewMagic(bytes);
        if (mime === 'text/plain') {
            if (magic !== null) throw new PreviewError('mime_mismatch');
            let text: string;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw new PreviewError('invalid_utf8'); }
            if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text)) throw new PreviewError('invalid_utf8');
            scope.check();
            return { kind: 'text', text };
        }
        if (magic !== mime) throw new PreviewError('mime_mismatch');
        if (mime === 'application/pdf') {
            handedOff = true;
            return { kind: 'pdf', bytes };
        }
        const imageMime = mime as RasterMime; // narrowed by TYPES and the branches above
        const dimensions = inspectRaster(bytes, imageMime);
        scope.check();
        handedOff = true;
        return { kind: 'image', bytes, mime: imageMime, ...dimensions };
    } finally {
        if (!handedOff) bytes?.fill(0);
        scope.finish();
    }
}

export function releaseDocumentPreview(preview: DocumentPreview): void {
    if (preview.kind !== 'text') preview.bytes.fill(0);
    // JavaScript strings and the caller's original Blob/data URL are immutable:
    // drop references on unmount; do not claim secure erasure or mutate the caller.
}
