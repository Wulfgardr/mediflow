/* @Codex */
'use client';

export type AnyDocLocalExtractionPreview = Readonly<{ status: 'available'; markdown: string }>;

const SCHEMA = 'mediflow.anydoc_local_extraction.v1';
const ROOT_KEYS = ['schemaVersion', 'provenance', 'receipt', 'review', 'writes', 'apply', 'status', 'markdown', 'candidateUse'] as const;
const SOURCE_KEYS = ['attachmentId', 'sourceSha256', 'byteLength'] as const;
const RECEIPT_KEYS = ['receiptId', 'parser', 'outcome', 'sourceSha256', 'sourceByteLength', 'markdownSha256', 'markdownByteLength'] as const;
const OCR_RECEIPT_KEYS = [...RECEIPT_KEYS, 'ocrProvenance'] as const;
const OCR_PROVENANCE_KEYS = ['schemaVersion', 'engine', 'scriptSha256', 'pageCount', 'ocrPageCount', 'receiptSetSha256'] as const;
const OCR_PROVENANCE_SCHEMA = 'mediflow.anydoc_local_ocr_provenance.v1';
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = MAX_MARKDOWN_BYTES + 4096;

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
    try {
        if (value === null || typeof value !== 'object' || Array.isArray(value)
            || Object.getPrototypeOf(value) !== Object.prototype) return null;
        const own = Reflect.ownKeys(value);
        if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
        const result: Record<string, unknown> = Object.create(null);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null;
            result[key] = descriptor.value;
        }
        return result;
    } catch { return null; }
}

async function parsePreview(raw: unknown, expectedAttachmentId: string): Promise<AnyDocLocalExtractionPreview | null> {
    if (typeof raw !== 'string' || raw.length < 1) return null;
    const rawBytes = new TextEncoder().encode(raw);
    if (rawBytes.byteLength > MAX_RESPONSE_BYTES) return null;
    let value: unknown;
    try {
        value = JSON.parse(raw);
        if (JSON.stringify(value) !== raw) return null;
    } catch { return null; }
    const root = exact(value, ROOT_KEYS);
    if (!root || root.schemaVersion !== SCHEMA || root.review !== 'required' || root.writes !== 0
        || root.apply !== 'none' || root.status !== 'extracted' || root.candidateUse !== 'review_only'
        || typeof root.markdown !== 'string' || root.markdown.length < 1) return null;
    const source = exact(root.provenance, SOURCE_KEYS);
    const receipt = exact(root.receipt, RECEIPT_KEYS) ?? exact(root.receipt, OCR_RECEIPT_KEYS);
    if (!source || !receipt || source.attachmentId !== expectedAttachmentId
        || !SHA256.test(source.sourceSha256 as string) || !Number.isSafeInteger(source.byteLength)
        || (source.byteLength as number) < 1 || (source.byteLength as number) > MAX_SOURCE_BYTES
        || receipt.parser !== 'anydoc-local' || receipt.outcome !== 'extracted'
        || !SHA256.test(receipt.receiptId as string) || !SHA256.test(receipt.markdownSha256 as string)
        || receipt.sourceSha256 !== source.sourceSha256 || receipt.sourceByteLength !== source.byteLength
        || !Number.isSafeInteger(receipt.markdownByteLength) || (receipt.markdownByteLength as number) < 1
        || (receipt.markdownByteLength as number) > MAX_MARKDOWN_BYTES) return null;
    if (Object.hasOwn(receipt, 'ocrProvenance')) {
        const provenance = exact(receipt.ocrProvenance, OCR_PROVENANCE_KEYS);
        if (!provenance || provenance.schemaVersion !== OCR_PROVENANCE_SCHEMA || provenance.engine !== 'apple_vision'
            || !SHA256.test(provenance.scriptSha256 as string) || !SHA256.test(provenance.receiptSetSha256 as string)
            || !Number.isSafeInteger(provenance.pageCount) || (provenance.pageCount as number) < 1
            || (provenance.pageCount as number) > 500 || !Number.isSafeInteger(provenance.ocrPageCount)
            || (provenance.ocrPageCount as number) < 1
            || (provenance.ocrPageCount as number) > (provenance.pageCount as number)) return null;
    }
    const markdownBytes = new TextEncoder().encode(root.markdown);
    if (markdownBytes.byteLength !== receipt.markdownByteLength) return null;
    let markdownSha256: string;
    try {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', markdownBytes);
        markdownSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
    if (markdownSha256 !== receipt.markdownSha256) return null;
    return Object.freeze(Object.assign(Object.create(null), { status: 'available' as const, markdown: root.markdown }));
}

export async function requestAnyDocLocalExtractionPreview(
    attachmentId: unknown,
    request: typeof fetch = globalThis.fetch,
): Promise<AnyDocLocalExtractionPreview | null> {
    if (typeof attachmentId !== 'string' || attachmentId.length < 1 || attachmentId.length > 200
        || /[\u0000-\u001f\u007f]/u.test(attachmentId)) return null;
    try {
        const response = await request(`/api/attachments/${encodeURIComponent(attachmentId)}/local-extraction`, { method: 'POST', cache: 'no-store' });
        if (!response.ok) return null;
        return parsePreview(await response.text(), attachmentId);
    }
    catch { return null; }
}
