/* @Codex */
export interface PdfDocumentMetadata {
    producer?: string;
    creator?: string;
}

/* @Codex */
const metadataByDocumentSignature = new Map<string, PdfDocumentMetadata>();

/* @Codex */
function cleanMetadataValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : undefined;
}

/* @Codex */
export function normalizePdfDocumentMetadata(input: unknown): PdfDocumentMetadata | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const record = input as Record<string, unknown>;
    const producer = cleanMetadataValue(record.Producer ?? record.producer);
    const creator = cleanMetadataValue(record.Creator ?? record.creator);
    if (!producer && !creator) return undefined;
    return { producer, creator };
}

/* @Codex */
function textSignature(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/* @Codex */
function documentMetadataKey(fileName: string, text: string): string {
    return `${fileName.trim().toLowerCase()}\0${textSignature(text)}`;
}

/* @Codex */
export function rememberPdfDocumentMetadata(
    fileName: string,
    text: string,
    metadata: PdfDocumentMetadata | undefined,
): void {
    if (!fileName || !text || (!metadata?.producer && !metadata?.creator)) return;
    metadataByDocumentSignature.set(documentMetadataKey(fileName, text), metadata);
}

/* @Codex */
export function getRememberedPdfDocumentMetadata(
    fileName: string,
    text: string,
): PdfDocumentMetadata | undefined {
    if (!fileName || !text) return undefined;
    return metadataByDocumentSignature.get(documentMetadataKey(fileName, text));
}
