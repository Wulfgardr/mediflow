/* @Codex */
'use client';

export type AnyDocLocalExtractionPreview = Readonly<{ status: 'available'; markdown: string }>;

const SCHEMA = 'mediflow.anydoc_local_extraction.v1';
const ROOT_KEYS = ['schemaVersion', 'provenance', 'receipt', 'review', 'writes', 'apply', 'status', 'markdown', 'candidateUse'] as const;
const SOURCE_KEYS = ['attachmentId', 'sourceSha256', 'byteLength'] as const;
const RECEIPT_KEYS = ['receiptId', 'parser', 'outcome', 'sourceSha256', 'sourceByteLength', 'markdownSha256', 'markdownByteLength'] as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

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

/** Returns only transient display text; source evidence and authority never cross this seam. */
export function parseAnyDocLocalExtractionPreview(value: unknown): AnyDocLocalExtractionPreview | null {
    const root = exact(value, ROOT_KEYS);
    if (!root || root.schemaVersion !== SCHEMA || root.review !== 'required' || root.writes !== 0
        || root.apply !== 'none' || root.status !== 'extracted' || root.candidateUse !== 'review_only'
        || typeof root.markdown !== 'string' || root.markdown.length < 1) return null;
    const source = exact(root.provenance, SOURCE_KEYS);
    const receipt = exact(root.receipt, RECEIPT_KEYS);
    if (!source || !receipt || typeof source.attachmentId !== 'string' || source.attachmentId.length < 1
        || !SHA256.test(source.sourceSha256 as string) || !Number.isSafeInteger(source.byteLength)
        || (source.byteLength as number) < 1 || (source.byteLength as number) > MAX_SOURCE_BYTES
        || receipt.parser !== 'anydoc-local' || receipt.outcome !== 'extracted'
        || !SHA256.test(receipt.receiptId as string) || !SHA256.test(receipt.markdownSha256 as string)
        || receipt.sourceSha256 !== source.sourceSha256 || receipt.sourceByteLength !== source.byteLength
        || !Number.isSafeInteger(receipt.markdownByteLength) || (receipt.markdownByteLength as number) < 1
        || (receipt.markdownByteLength as number) > MAX_MARKDOWN_BYTES
        || new TextEncoder().encode(root.markdown).byteLength !== receipt.markdownByteLength) return null;
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
        return parseAnyDocLocalExtractionPreview(await response.json());
    }
    catch { return null; }
}
