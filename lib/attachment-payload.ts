/* @Codex */
const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
/* @Codex */
const ENCRYPTED_ATTACHMENT_PATTERN = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
/* @Codex */
const DATA_URL_BASE64_PREFIX = /^data:[^,]*;base64,/i;

/* @Codex */
function isPlainBase64(value: string): boolean {
    return BASE64_PAYLOAD_PATTERN.test(value) && value.length % 4 === 0;
}

/* @Codex */
export function getAttachmentPayloadByteSize(value: unknown): { ok: true; size: number } | { ok: false; error: string } {
    if (value === undefined || value === null) return { ok: true, size: 0 };
    if (typeof value !== 'string') return { ok: false, error: 'Attachment data must be a base64 string' };

    if (!value) return { ok: true, size: 0 };

    if (value.startsWith('ENC:')) {
        if (!ENCRYPTED_ATTACHMENT_PATTERN.test(value)) {
            return { ok: false, error: 'Attachment data must be valid base64 or encrypted attachment data' };
        }
        return { ok: true, size: Buffer.byteLength(value, 'utf8') };
    }

    const payload = DATA_URL_BASE64_PREFIX.test(value) ? value.slice(value.indexOf(',') + 1) : value;
    const compact = payload.replace(/\s/g, '');
    if (!compact) return { ok: true, size: Buffer.byteLength(value, 'utf8') };
    if (!isPlainBase64(compact)) {
        return { ok: false, error: 'Attachment data must be valid base64 or encrypted attachment data' };
    }

    return { ok: true, size: Buffer.byteLength(value, 'utf8') };
}
