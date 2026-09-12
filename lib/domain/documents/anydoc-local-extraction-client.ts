/* @Codex */
'use client';

import {
    ATTACHMENT_EXTRACTION_ACTION_HEADER, ATTACHMENT_EXTRACTION_GRANT_HEADER,
    ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA,
    type AttachmentExtractionAcquisition, type AttachmentExtractionCanonicalSource,
    type AttachmentExtractionProjectionGrant,
} from './attachment-extraction-projection-protocol';

export type AnyDocLocalExtractionPreview = Readonly<{
    status: 'available';
    markdown: string;
    ocr?: Readonly<{ pageCount: number; ocrPageCount: number }>;
    acquisition?: AttachmentExtractionAcquisition;
}>;

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
    let ocr: AnyDocLocalExtractionPreview['ocr'];
    if (Object.hasOwn(receipt, 'ocrProvenance')) {
        const provenance = exact(receipt.ocrProvenance, OCR_PROVENANCE_KEYS);
        if (!provenance || provenance.schemaVersion !== OCR_PROVENANCE_SCHEMA || (provenance.engine !== 'apple_vision' && provenance.engine !== 'tesseract_wasm')
            || !SHA256.test(provenance.scriptSha256 as string) || !SHA256.test(provenance.receiptSetSha256 as string)
            || !Number.isSafeInteger(provenance.pageCount) || (provenance.pageCount as number) < 1
            || (provenance.pageCount as number) > 500 || !Number.isSafeInteger(provenance.ocrPageCount)
            || (provenance.ocrPageCount as number) < 1
            || (provenance.ocrPageCount as number) > (provenance.pageCount as number)) return null;
        ocr = Object.freeze({ pageCount: provenance.pageCount as number, ocrPageCount: provenance.ocrPageCount as number });
    }
    const markdownBytes = new TextEncoder().encode(root.markdown);
    if (markdownBytes.byteLength !== receipt.markdownByteLength) return null;
    let markdownSha256: string;
    try {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', markdownBytes);
        markdownSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
    if (markdownSha256 !== receipt.markdownSha256) return null;
    return Object.freeze(Object.assign(Object.create(null), {
        status: 'available' as const, markdown: root.markdown, ...(ocr ? { ocr } : {}),
    }));
}

export async function requestAnyDocLocalExtractionPreview(
    attachmentId: unknown,
    request: typeof fetch = globalThis.fetch,
    signal?: AbortSignal,
): Promise<AnyDocLocalExtractionPreview | null> {
    if (typeof attachmentId !== 'string' || attachmentId.length < 1 || attachmentId.length > 200
        || /[\u0000-\u001f\u007f]/u.test(attachmentId) || signal?.aborted) return null;
    try {
        const response = await request(`/api/attachments/${encodeURIComponent(attachmentId)}/local-extraction`, {
            method: 'POST', cache: 'no-store', ...(signal ? { signal } : {}),
        });
        if (!response.ok || signal?.aborted) return null;
        const preview = await parsePreview(await response.text(), attachmentId);
        return signal?.aborted ? null : preview;
    }
    catch { return null; }
}


export type AnyDocDecryptedAttachmentSource = Readonly<{
    id: string; data?: string;
}>;

function canonicalSource(value: unknown): AttachmentExtractionCanonicalSource | null {
    const fields = exact(value, ['sourceRef', 'revision', 'freshnessEpoch']);
    if (!fields || typeof fields.sourceRef !== 'string' || !SHA256.test(fields.sourceRef)
        || !Number.isSafeInteger(fields.revision) || (fields.revision as number) < 1
        || !Number.isSafeInteger(fields.freshnessEpoch) || (fields.freshnessEpoch as number) < 1) return null;
    return Object.freeze({ sourceRef: fields.sourceRef, revision: fields.revision as number, freshnessEpoch: fields.freshnessEpoch as number });
}
function sameCanonical(left: AttachmentExtractionCanonicalSource, right: AttachmentExtractionCanonicalSource): boolean {
    return left.sourceRef === right.sourceRef && left.revision === right.revision && left.freshnessEpoch === right.freshnessEpoch;
}
async function boundedResponseText(response: Response, limit: number, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    if (!response.body) {
        const raw = await response.text();
        return !signal?.aborted && new TextEncoder().encode(raw).byteLength <= limit ? raw : null;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let length = 0; let raw = ''; let complete = false;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            if (signal?.aborted) return null;
            const next = await reader.read();
            if (signal?.aborted) return null;
            if (next.done) break;
            length += next.value.byteLength; if (length > limit) return null;
            raw += decoder.decode(next.value, { stream: true });
        }
        raw += decoder.decode(); complete = true; return raw;
    } finally { signal?.removeEventListener('abort', cancel); if (!complete) cancel(); reader.releaseLock(); }
}
function parseGrant(raw: string | null): AttachmentExtractionProjectionGrant | null {
    if (!raw) return null;
    let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
    const fields = exact(value, ['schemaVersion', 'grantId', 'expiresAt', 'canonicalSource']);
    if (!fields || fields.schemaVersion !== ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA
        || typeof fields.grantId !== 'string' || !SHA256.test(fields.grantId)
        || !Number.isSafeInteger(fields.expiresAt) || (fields.expiresAt as number) <= Date.now()) return null;
    const current = canonicalSource(fields.canonicalSource); if (!current) return null;
    return Object.freeze({ schemaVersion: ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA,
        grantId: fields.grantId, expiresAt: fields.expiresAt as number, canonicalSource: current });
}
function decodeClientSource(data: unknown): Uint8Array<ArrayBuffer> | null {
    if (typeof data !== 'string' || !data || data.startsWith('ENC:')
        || data.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 + 1024) return null;
    const header = /^data:[^,]{0,512};base64,/iu.exec(data);
    const base64 = (header ? data.slice(header[0].length) : data).replace(/\s/gu, '');
    if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(base64)) return null;
    try {
        const raw = globalThis.atob(base64);
        if (!raw.length || raw.length > MAX_SOURCE_BYTES || globalThis.btoa(raw) !== base64) return null;
        const bytes = new Uint8Array(raw.length);
        for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
        return bytes;
    } catch { return null; }
}

/** Ordinary encrypted upload: acquire → fresh facade decryption → bounded local projection → review only.
 * The source digest below compares request/response bytes, NEVER ciphertext/plaintext equality.
 */
export async function requestAnyDocDecryptedLocalExtractionPreview(
    attachmentId: string,
    readSource: () => Promise<AnyDocDecryptedAttachmentSource | undefined | null>,
    request: typeof fetch = globalThis.fetch,
    signal?: AbortSignal,
): Promise<AnyDocLocalExtractionPreview | null> {
    if (typeof attachmentId !== 'string' || !attachmentId || attachmentId.length > 200
        || attachmentId.trim() !== attachmentId || /[\u0000-\u001f\u007f]/u.test(attachmentId) || signal?.aborted) return null;
    const endpoint = `/api/attachments/${encodeURIComponent(attachmentId)}/local-extraction`;
    let grant: AttachmentExtractionProjectionGrant | null = null;
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    let released = false;
    const release = () => {
        if (!grant || released) return;
        released = true;
        // No projection or key in cancellation; its failure cannot revive the local operation.
        try { void request(endpoint, { method: 'DELETE', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
            keepalive: true, headers: { [ATTACHMENT_EXTRACTION_GRANT_HEADER]: grant.grantId } }).catch(() => {}); }
        catch { /* Server expiry/owner retirement remain authoritative. */ }
    };
    signal?.addEventListener('abort', release, { once: true });
    try {
        const acquired = await request(endpoint, { method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
            ...(signal ? { signal } : {}), headers: { [ATTACHMENT_EXTRACTION_ACTION_HEADER]: 'acquire' } });
        if (!acquired.ok) return null;
        grant = parseGrant(await boundedResponseText(acquired, 2048, signal));
        if (!grant || signal?.aborted) return null;
        let source = await readSource();
        // The ordinary detail projection deliberately omits host currentness fields.
        // readSource is the existing facade's fresh no-store read after acquire;
        // the server checks the bound row/ciphertext again at consume and finalize.
        if (signal?.aborted || !source || source.id !== attachmentId) return null;
        bytes = decodeClientSource(source.data); source = null;
        if (!bytes || signal?.aborted) return null;
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        if (signal?.aborted) return null;
        const sourceSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const response = await request(endpoint, { method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
            ...(signal ? { signal } : {}), headers: { [ATTACHMENT_EXTRACTION_ACTION_HEADER]: 'project',
                [ATTACHMENT_EXTRACTION_GRANT_HEADER]: grant.grantId, 'Content-Type': 'application/octet-stream' }, body: bytes.buffer });
        if (!response.ok || signal?.aborted) return null;
        const raw = await boundedResponseText(response, MAX_RESPONSE_BYTES + 2048, signal);
        if (!raw || signal?.aborted) return null;
        const envelope = exact(JSON.parse(raw), ['schemaVersion', 'grantId', 'acquisition', 'extraction']);
        if (!envelope || envelope.schemaVersion !== ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA || envelope.grantId !== grant.grantId) return null;
        const acquisition = exact(envelope.acquisition, ['origin', 'ciphertextEquality', 'canonicalSource']);
        const current = acquisition ? canonicalSource(acquisition.canonicalSource) : null;
        if (!acquisition || acquisition.origin !== 'authenticated_client_decryption' || acquisition.ciphertextEquality !== 'not_attested'
            || !current || !sameCanonical(current, grant.canonicalSource)) return null;
        const extraction = exact(envelope.extraction, ROOT_KEYS);
        const provenance = extraction ? exact(extraction.provenance, SOURCE_KEYS) : null;
        if (!provenance || provenance.sourceSha256 !== sourceSha256 || provenance.byteLength !== bytes.byteLength) return null;
        const preview = await parsePreview(JSON.stringify(envelope.extraction), attachmentId);
        if (!preview || signal?.aborted) return null;
        return Object.freeze(Object.assign(Object.create(null), preview, {
            acquisition: Object.freeze({ origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested', canonicalSource: current }),
        }));
    } catch { return null; }
    finally { bytes?.fill(0); signal?.removeEventListener('abort', release); release(); }
}
