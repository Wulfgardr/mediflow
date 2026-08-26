/* @Codex */
import { z } from 'zod';
import {
    optionalIdSchema,
    optionalTextSchema,
    requiredTextSchema,
} from './common';
import {
    DOCUMENT_OCR_QUEUE_REASONS,
    DOCUMENT_OCR_QUEUE_STATES,
} from '../domain/documents/document-ocr-queue';

const ocrQueueStateSchema = z.enum(DOCUMENT_OCR_QUEUE_STATES).optional();
const ocrQueueReasonSchema = z.enum(DOCUMENT_OCR_QUEUE_REASONS).optional();

export const attachmentCreateSchema = z.object({
    id: optionalIdSchema,
    patientId: requiredTextSchema,
    name: requiredTextSchema,
    type: requiredTextSchema,
    size: z.number().finite().nonnegative(),
    path: z.string().optional(),
    data: optionalTextSchema,
    summarySnapshot: optionalTextSchema,
    parseEvidenceArtifactSnapshot: optionalTextSchema,
    ocrQueueState: ocrQueueStateSchema,
    ocrQueueReason: ocrQueueReasonSchema,
});

export const attachmentUpdateSchema = z.object({
    summarySnapshot: optionalTextSchema,
    parseEvidenceArtifactSnapshot: optionalTextSchema,
    ocrQueueState: ocrQueueStateSchema,
});

/* @Codex: data-only web CAS boundary; no attachment, patient, or authority is client-owned. */
const attachmentCurrentnessSchema = z.object({
    sourceRef: z.string().regex(/^[0-9a-f]{64}$/u),
    revision: z.number().int().safe().min(1),
    freshnessEpoch: z.number().int().safe().min(1),
}).strict();

/* @Codex */
export const attachmentContentCurrentnessPutSchema = z.object({
    expected: attachmentCurrentnessSchema,
    replacement: z.string().min(1),
}).strict();

export const attachmentOcrReplaySchema = z.object({
    ocrText: z.string(),
    documentSha256: requiredTextSchema,
});

export type AttachmentCreatePayload = z.infer<typeof attachmentCreateSchema>;
export type AttachmentUpdatePayload = z.infer<typeof attachmentUpdateSchema>;
/* @Codex */
export type AttachmentContentCurrentnessPutPayload = z.infer<typeof attachmentContentCurrentnessPutSchema>;
export type AttachmentOcrReplayPayload = z.infer<typeof attachmentOcrReplaySchema>;
