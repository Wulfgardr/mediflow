/* @Codex */
function toSafeFileToken(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return 'attachment.bin';

    const basename = trimmed.replace(/\\/g, '/').split('/').pop() || trimmed;
    const safe = basename
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '');

    return safe || 'attachment.bin';
}

/* @Codex */
function isCanonicalAttachmentPath(input: string, id: string): boolean {
    const normalized = input.trim().replace(/\\/g, '/');
    if (!normalized.startsWith('attachments/')) return false;

    const basename = normalized.slice('attachments/'.length);
    if (!basename || basename.includes('/')) return false;

    return basename.startsWith(`${id}-`);
}

/* @Codex */
export function buildAttachmentPath(input: unknown, name: string, id: string): string {
    if (typeof input === 'string' && isCanonicalAttachmentPath(input, id)) {
        const basename = input.trim().replace(/\\/g, '/').slice('attachments/'.length);
        return `attachments/${toSafeFileToken(basename)}`;
    }

    const preferredName = typeof input === 'string' && input.trim().length > 0
        ? input
        : name;

    return `attachments/${id}-${toSafeFileToken(preferredName)}`;
}
