/* @Codex */
import 'server-only';

export const DOCUMENT_SYNTHESIS_HOST_PROJECTION_SCHEMA_VERSION = 'mediflow.document-synthesis.host-projection.v1' as const;

export type DocumentSynthesisHostSourceKind = 'native_text' | 'ocr_text';
export type DocumentSynthesisHostProjection = Readonly<{
    schemaVersion: typeof DOCUMENT_SYNTHESIS_HOST_PROJECTION_SCHEMA_VERSION;
    sourceKind: DocumentSynthesisHostSourceKind;
    sourceText: string;
    classification: 'review_required';
    rationale: 'native_text_normalized' | 'ocr_text_normalized';
}>;

export type DocumentSynthesisHostProjectionErrorCode = 'projection_invalid';

export class DocumentSynthesisHostProjectionError extends Error {
    constructor(readonly code: DocumentSynthesisHostProjectionErrorCode) {
        super(`Document synthesis host projection rejected: ${code}`);
        this.name = 'DocumentSynthesisHostProjectionError';
    }
}

const MAX_SOURCE_TEXT_LENGTH = 12_000;
const SOURCE_KINDS = new Set<DocumentSynthesisHostSourceKind>(['native_text', 'ocr_text']);

function reject(): never {
    throw new DocumentSynthesisHostProjectionError('projection_invalid');
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) reject();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) reject();

    const output: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor)) reject();
        output[key] = descriptor.value;
    }
    return output;
}

function normalizeSourceText(value: unknown): string {
    if (typeof value !== 'string' || value.length > MAX_SOURCE_TEXT_LENGTH
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) reject();
    const normalized = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
    if (normalized.length === 0 || normalized.length > MAX_SOURCE_TEXT_LENGTH) reject();
    return normalized;
}

/**
 * Resolves the sole host-owned document-text projection. This pure boundary
 * performs no lookup, patient or document binding, provider admission,
 * lifecycle access, persistence, network operation, or clinical write.
 */
export function resolveDocumentSynthesisHostProjection(value: unknown): DocumentSynthesisHostProjection {
    try {
        const input = exactDataRecord(value, ['sourceKind', 'sourceText']);
        if (typeof input.sourceKind !== 'string' || !SOURCE_KINDS.has(input.sourceKind as DocumentSynthesisHostSourceKind)) reject();
        const sourceKind = input.sourceKind as DocumentSynthesisHostSourceKind;
        const sourceText = normalizeSourceText(input.sourceText);
        return Object.freeze({
            schemaVersion: DOCUMENT_SYNTHESIS_HOST_PROJECTION_SCHEMA_VERSION,
            sourceKind,
            sourceText,
            classification: 'review_required' as const,
            rationale: sourceKind === 'native_text' ? 'native_text_normalized' as const : 'ocr_text_normalized' as const,
        });
    } catch (error) {
        if (error instanceof DocumentSynthesisHostProjectionError) throw error;
        return reject();
    }
}
