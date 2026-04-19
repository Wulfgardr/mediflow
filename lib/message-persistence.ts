/* @Codex */
type StoredMessagePayload = {
    metadata?: string;
    attachmentType?: 'image' | 'file';
    attachmentBase64?: string;
};

/* @Codex */
export function normalizeStoredMessagePayload(body: Record<string, unknown>): StoredMessagePayload {
    const metadata = body.metadata === undefined
        ? undefined
        : typeof body.metadata === 'string'
            ? body.metadata
            : JSON.stringify(body.metadata);

    const attachmentType = body.attachmentType === 'image' || body.attachmentType === 'file'
        ? body.attachmentType
        : undefined;

    const attachmentBase64 = typeof body.attachmentBase64 === 'string'
        ? body.attachmentBase64
        : undefined;

    return {
        metadata,
        attachmentType,
        attachmentBase64,
    };
}
