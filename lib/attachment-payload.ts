const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
export const ENCRYPTED_ATTACHMENT_PATTERN = /^ENC:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL_BASE64_PREFIX = /^data:[^,]*;base64,/i;
const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function isPlainBase64(value: string): boolean {
    return BASE64_PAYLOAD_PATTERN.test(value) && value.length % 4 === 0;
}

export function getAttachmentPayloadByteSize(value: unknown): { ok: true; size: number } | { ok: false; error: string } {
    if (value === undefined || value === null) return { ok: true, size: 0 };
    if (typeof value !== 'string') return { ok: false, error: 'Attachment data must be a base64 string' };

    if (!value) return { ok: true, size: 0 };

    if (value.startsWith('ENC:') || value.startsWith('ENC2:')) {
        if (!isSealedAttachmentData(value)) {
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

export function isSealedAttachmentValue(value: unknown): value is string {
    return typeof value === 'string' && ENCRYPTED_ATTACHMENT_PATTERN.test(value);
}

/* extracted from app/api/attachments/route.ts (WUL-194 W5 S1) so the
   paired network boundary shares the exact same wire size limit as the host
   attachment upload; behavior and default are unchanged. */
export function resolveMaxAttachmentBytes(): number {
    const configured = Number.parseInt(process.env.MEDIFLOW_ATTACHMENT_MAX_BYTES ?? '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_ATTACHMENT_BYTES;
}

export function isSealedAttachmentData(value: unknown): value is string {
    return isSealedAttachmentValue(value) || isSealedAttachmentFileData(value);
}

const split = Function.call.bind(String.prototype.split) as (value: string, separator: string) => string[];
const charCodeAt = Function.call.bind(String.prototype.charCodeAt) as (value: string, index: number) => number;

function base64Digit(code: number): number {
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 71;
    if (code >= 48 && code <= 57) return code + 4;
    return code === 43 ? 62 : code === 47 ? 63 : -1;
}

/** Validates the five ENC2 parts in linear time without decoding or matching repeated groups. */
export function isSealedAttachmentFileData(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const parts = split(value, ':');
    if (parts.length !== 5 || parts[0] !== 'ENC2') return false;
    for (let part = 1; part <= 4; part += 1) {
        const text = parts[part]!;
        if (part < 4 && text.length !== (part === 2 ? 64 : 16)) return false;
        if (text.length === 0 || text.length % 4 !== 0) return false;
        const padding = part === 4 ? (text[text.length - 1] === '=' ? (text[text.length - 2] === '=' ? 2 : 1) : 0) : 0;
        const length = text.length - padding;
        if (part === 4 && text.length / 4 * 3 - padding < 17) return false;
        for (let index = 0; index < length; index += 1) {
            if (base64Digit(charCodeAt(text, index)) < 0) return false;
        }
        if (padding && (base64Digit(charCodeAt(text, length - 1)) & (padding === 2 ? 15 : 3)) !== 0) return false;
    }
    return true;
}
