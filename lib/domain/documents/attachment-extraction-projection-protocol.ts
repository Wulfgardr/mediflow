/* @Codex */
/** Wire metadata is descriptive. Only the server's live locator grants source access. */
export const ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA = 'mediflow.attachment_extraction_projection.v1' as const;
export const ATTACHMENT_EXTRACTION_ACTION_HEADER = 'X-MediFlow-Extraction-Action';
export const ATTACHMENT_EXTRACTION_GRANT_HEADER = 'X-MediFlow-Extraction-Grant';
export const ATTACHMENT_EXTRACTION_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_EXTRACTION_MAX_PENDING = 16;
export const ATTACHMENT_EXTRACTION_GRANT_TTL_MS = 30_000;
export const ATTACHMENT_EXTRACTION_OPERATION_TTL_MS = 120_000;
export type AttachmentExtractionCanonicalSource = Readonly<{ sourceRef: string; revision: number; freshnessEpoch: number }>;
export type AttachmentExtractionProjectionGrant = Readonly<{
    schemaVersion: typeof ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA;
    grantId: string;
    expiresAt: number;
    canonicalSource: AttachmentExtractionCanonicalSource;
}>;
export type AttachmentExtractionAcquisition = Readonly<{
    origin: 'authenticated_client_decryption';
    ciphertextEquality: 'not_attested';
    canonicalSource: AttachmentExtractionCanonicalSource;
}>;
